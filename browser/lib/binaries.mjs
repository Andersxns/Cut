import * as ResEdit from 'resedit';

// Firefox compiles its identity (vendor, name, remoting name, crash and update
// servers) into the launcher executable as a StaticXREAppData struct. Cut
// Browser rewrites those strings in place so the browser runs as "Cut" —
// with its own profile folder and single-instance name — without needing a
// command-line flag that shortcuts, taskbar pins and default-browser
// handlers could lose.

export const FIREFOX_APP_ID = '{ec8030f7-c20a-464f-9b0e-13a3a9e97384}';
const NS_XRE_ENABLE_CRASH_REPORTER = 1 << 3;

// StaticXREAppData (64-bit): 16 pointer-sized slots, flags in slot 7.
const SLOT = { vendor: 0, name: 1, remotingName: 2, version: 3, buildID: 4, id: 5, flags: 7, crashReporterURL: 10, updateURL: 15 };

function writeCString(buf, offset, value, originalLength) {
  const bytes = Buffer.from(value, 'latin1');
  if (bytes.length > originalLength) throw new Error(`"${value}" is longer than the ${originalLength} bytes available`);
  buf.fill(0, offset, offset + originalLength);
  bytes.copy(buf, offset);
}

const cstringAt = (buf, offset) => buf.toString('latin1', offset, buf.indexOf(0, offset));

// Maps between file offsets and virtual addresses for PE and ELF images.
function imageLayout(buf) {
  if (buf.readUInt16LE(0) === 0x5a4d) {
    const pe = buf.readUInt32LE(0x3c);
    const optional = pe + 24;
    if (buf.readUInt16LE(optional) !== 0x20b) throw new Error('expected a 64-bit PE image');
    const base = buf.readBigUInt64LE(optional + 24);
    const sections = [];
    const count = buf.readUInt16LE(pe + 6);
    const table = optional + buf.readUInt16LE(pe + 20);
    for (let i = 0; i < count; i++) {
      const o = table + i * 40;
      sections.push({ vaddr: base + BigInt(buf.readUInt32LE(o + 12)), size: buf.readUInt32LE(o + 16), offset: buf.readUInt32LE(o + 20) });
    }
    return { kind: 'pe', sections };
  }
  if (buf.readUInt32BE(0) === 0x7f454c46) {
    if (buf[4] !== 2 || buf[5] !== 1) throw new Error('expected a 64-bit little-endian ELF image');
    const phoff = Number(buf.readBigUInt64LE(0x20));
    const phentsize = buf.readUInt16LE(0x36);
    const phnum = buf.readUInt16LE(0x38);
    const sections = [];
    for (let i = 0; i < phnum; i++) {
      const o = phoff + i * phentsize;
      if (buf.readUInt32LE(o) !== 1) continue; // PT_LOAD
      sections.push({ vaddr: buf.readBigUInt64LE(o + 0x10), size: Number(buf.readBigUInt64LE(o + 0x20)), offset: Number(buf.readBigUInt64LE(o + 0x08)) });
    }
    return { kind: 'elf', sections };
  }
  throw new Error('unknown executable format');
}

const toVaddr = (layout, offset) => {
  for (const s of layout.sections) if (offset >= s.offset && offset < s.offset + s.size) return s.vaddr + BigInt(offset - s.offset);
  return null;
};
const toOffset = (layout, vaddr) => {
  for (const s of layout.sections) if (vaddr >= s.vaddr && vaddr < s.vaddr + BigInt(s.size)) return s.offset + Number(vaddr - s.vaddr);
  return null;
};

// ELF images may keep pointer values only in relocation addends (RELA);
// PE images and packed ELF relocations (RELR / elfhack) keep them in place.
function relaAddends(buf) {
  const shoff = Number(buf.readBigUInt64LE(0x28));
  const shentsize = buf.readUInt16LE(0x3a);
  const shnum = buf.readUInt16LE(0x3c);
  const map = new Map();
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    if (buf.readUInt32LE(o + 4) !== 4) continue; // SHT_RELA
    const start = Number(buf.readBigUInt64LE(o + 0x18));
    const size = Number(buf.readBigUInt64LE(o + 0x20));
    for (let r = start; r + 24 <= start + size; r += 24) {
      if ((buf.readBigUInt64LE(r + 8) & 0xffffffffn) === 8n) map.set(buf.readBigUInt64LE(r), buf.readBigUInt64LE(r + 16)); // R_X86_64_RELATIVE
    }
  }
  return map;
}

function findAppData(buf) {
  const layout = imageLayout(buf);
  const idBytes = Buffer.from(`${FIREFOX_APP_ID}\0`, 'latin1');
  const idOffsets = [];
  for (let i = buf.indexOf(idBytes); i !== -1; i = buf.indexOf(idBytes, i + 1)) idOffsets.push(i);
  const idAddrs = new Set(idOffsets.map((o) => toVaddr(layout, o)).filter((v) => v !== null));
  const rela = layout.kind === 'elf' ? relaAddends(buf) : new Map();
  // pointer(slotOffset) → the address stored there (in place, or via RELA).
  const pointer = (slotOffset) => {
    const inPlace = buf.readBigUInt64LE(slotOffset);
    if (inPlace !== 0n || layout.kind === 'pe') return inPlace;
    const slotAddr = toVaddr(layout, slotOffset);
    return (slotAddr !== null && rela.get(slotAddr)) || 0n;
  };
  const candidates = [];
  for (let i = 0; i + 8 <= buf.length; i += 8) {
    const v = pointer(i);
    if (v && idAddrs.has(v)) candidates.push(i - SLOT.id * 8);
  }
  for (const start of candidates) {
    if (start < 0) continue;
    const str = (slot) => {
      const off = toOffset(layout, pointer(start + slot * 8));
      return off === null ? null : { offset: off, value: cstringAt(buf, off) };
    };
    const fields = Object.fromEntries(['vendor', 'name', 'remotingName', 'version', 'buildID', 'crashReporterURL', 'updateURL'].map((k) => [k, str(SLOT[k])]));
    if (fields.name && fields.remotingName && /^\d+\.\d+/.test(fields.version?.value || '') && /^\d{14}$/.test(fields.buildID?.value || '')) {
      return { start, fields, flagsOffset: start + SLOT.flags * 8 };
    }
  }
  throw new Error('could not find Firefox’s application data in this executable');
}

// identity: { vendor, name, remotingName } — each no longer than the original —
// and optionally buildID (14 digits). A new build ID makes Firefox discard
// its per-profile cache of compiled interface code, so an updated Cut
// Browser on the same Firefox version doesn't run stale code.
export function patchAppData(buf, identity) {
  const { fields, flagsOffset } = findAppData(buf);
  const info = { version: fields.version.value, firefoxBuildID: fields.buildID.value, buildID: identity.buildID || fields.buildID.value };
  for (const key of ['vendor', 'name', 'remotingName']) writeCString(buf, fields[key].offset, identity[key], fields[key].value.length);
  if (identity.buildID) {
    if (!/^\d{14}$/.test(identity.buildID)) throw new Error(`build ID must be 14 digits: ${identity.buildID}`);
    writeCString(buf, fields.buildID.offset, identity.buildID, fields.buildID.value.length);
  }
  // No crash reporter or Mozilla update server: Cut Browser has neither.
  for (const key of ['crashReporterURL', 'updateURL']) if (fields[key]) writeCString(buf, fields[key].offset, '', fields[key].value.length);
  buf.writeUInt32LE(buf.readUInt32LE(flagsOffset) & ~NS_XRE_ENABLE_CRASH_REPORTER, flagsOffset);
  return info;
}

export function readAppData(buf) {
  const { fields, flagsOffset } = findAppData(buf);
  return { ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v?.value])), flags: buf.readUInt32LE(flagsOffset) };
}

// Replaces every icon group and the version strings of a Windows executable.
// icons: (groupId) => ICO buffer.
export function rebrandExecutable(buf, { icons, strings, version }) {
  const exe = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  for (const group of ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)) {
    const source = icons(group.id);
    if (!source) continue;
    const ico = ResEdit.Data.IconFile.from(source);
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, ico.icons.map((i) => i.data));
  }
  for (const info of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
    for (const language of info.getAllLanguagesForStringValues()) info.setStringValues(language, strings);
    if (version) {
      info.setFileVersion(version);
      info.setProductVersion(version);
    }
    info.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  return Buffer.from(exe.generate());
}
