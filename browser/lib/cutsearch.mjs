import fs from 'node:fs';
import path from 'node:path';

// Collects the Cut Search server (from the repository this folder lives in)
// for bundling: server.js, src/, public/ and only the production
// dependencies, without docs, source maps or type definitions.

const SKIP_FILE = /\.(md|markdown|map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/i;
const SKIP_DIR = new Set(['.github', 'test', 'tests', '__tests__', 'docs', 'example', 'examples', 'benchmark', 'benchmarks']);

function* walk(dir, rel = '') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, item.name);
    const r = rel ? `${rel}/${item.name}` : item.name;
    if (item.isDirectory()) {
      if (!SKIP_DIR.has(item.name)) yield* walk(abs, r);
    } else if (item.isFile() && !SKIP_FILE.test(item.name)) {
      yield { rel: r, abs };
    }
  }
}

// Production dependency closure, resolving nested node_modules like Node does.
function dependencyDirs(root) {
  const seen = new Map();
  const visit = (pkgDir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      let dir = pkgDir;
      let found = null;
      while (true) {
        const candidate = path.join(dir, 'node_modules', name);
        if (fs.existsSync(path.join(candidate, 'package.json'))) {
          found = candidate;
          break;
        }
        if (dir === root) break;
        dir = path.dirname(dir);
        if (path.basename(dir) === 'node_modules') dir = path.dirname(dir);
      }
      if (!found) {
        if (pkg.optionalDependencies?.[name]) continue;
        throw new Error(`Cut Search dependency "${name}" isn't installed; run npm install in ${root}`);
      }
      if (!seen.has(found)) {
        seen.set(found, name);
        visit(found);
      }
    }
  };
  visit(root);
  return [...seen.keys()];
}

// Returns [{ rel, abs }] with paths relative to the app folder.
export function cutSearchFiles(root) {
  const files = [];
  for (const name of ['server.js', 'package.json']) files.push({ rel: name, abs: path.join(root, name) });
  for (const dir of ['src', 'public']) for (const f of walk(path.join(root, dir))) files.push({ rel: `${dir}/${f.rel}`, abs: f.abs });
  for (const dir of dependencyDirs(root)) {
    const relDir = path.relative(root, dir).split(path.sep).join('/');
    for (const f of walk(dir)) {
      // Nested node_modules are packages of their own, collected separately.
      if (f.rel.startsWith('node_modules/')) continue;
      files.push({ rel: `${relDir}/${f.rel}`, abs: f.abs });
    }
  }
  return files;
}
