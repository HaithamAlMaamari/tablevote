import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  'dist',
  'dist-server',
  'node_modules',
  'playwright-report',
  'test-results',
]);

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await markdownFiles(path.join(directory, entry.name))));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function localTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  target = target.replace(/\s+["'][^"']*["']$/, '');
  if (!target || target.startsWith('#') || target.startsWith('/')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;
  const pathOnly = target.split(/[?#]/, 1)[0];
  if (!pathOnly) return null;
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    return pathOnly;
  }
}

const failures = [];
let checkedLinks = 0;

for (const file of await markdownFiles(root)) {
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
      const target = localTarget(match[1]);
      if (!target) continue;
      checkedLinks += 1;
      const resolved = path.resolve(path.dirname(file), target);
      try {
        await access(resolved);
      } catch {
        failures.push(`${path.relative(root, file)}:${index + 1} -> ${match[1]}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local documentation links:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation link check passed (${checkedLinks} local links).`);
}
