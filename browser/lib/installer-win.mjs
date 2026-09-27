import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipDirectory } from './zip.mjs';
import { PRODUCT } from './product.mjs';

// Compiles the installer (installer/windows/Setup.cs) with the C# compiler
// that ships with Windows' .NET Framework, embedding the staged browser.

const FRAMEWORK = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const CSC = path.join(FRAMEWORK, 'csc.exe');
const REFERENCES = [
  'System.dll',
  'System.Core.dll',
  'System.Xaml.dll',
  'System.IO.Compression.dll',
  'WPF/PresentationFramework.dll',
  'WPF/PresentationCore.dll',
  'WPF/WindowsBase.dll',
].map((r) => path.join(FRAMEWORK, ...r.split('/')));

function compile({ source, out, defines = [], resources = [], icon, manifest }) {
  const args = [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    `/out:${out}`,
    `/win32icon:${icon}`,
    `/win32manifest:${manifest}`,
    ...REFERENCES.map((r) => `/reference:${r}`),
    ...defines.map((d) => `/define:${d}`),
    ...resources.map(([file, name]) => `/resource:${file},${name}`),
    source,
  ];
  execFileSync(CSC, args, { stdio: 'inherit' });
}

export async function buildWindowsInstaller({ stage, work, distDir, versions, here }) {
  if (!fs.existsSync(CSC)) throw new Error(`The C# compiler wasn't found at ${CSC} (it comes with the .NET Framework 4.x).`);
  const src = path.join(here, 'installer', 'windows');
  const source = path.join(work, 'Setup.cs');
  fs.writeFileSync(
    source,
    fs.readFileSync(path.join(src, 'Setup.cs'), 'utf8').replaceAll('@VERSION@', PRODUCT.version).replaceAll('@FIREFOX_VERSION@', versions.firefox),
  );
  const icon = path.join(stage, 'cut.ico');
  const manifest = path.join(src, 'app.manifest');

  // The uninstaller ships inside the browser folder.
  compile({ source, out: path.join(stage, 'uninstall.exe'), defines: ['UNINSTALLER'], icon, manifest });

  const payload = path.join(work, 'payload.zip');
  const files = zipDirectory(stage, payload, { level: 9 });
  console.log(`  payload: ${files} files, ${(fs.statSync(payload).size / 1048576).toFixed(1)} MB`);

  const out = path.join(distDir, `Cut-Browser-${PRODUCT.version}-Setup-x64.exe`);
  compile({ source, out, resources: [[payload, 'Payload.zip']], icon, manifest });
  fs.rmSync(payload);
  fs.rmSync(source);
  return out;
}
