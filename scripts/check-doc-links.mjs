import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const markdownFiles = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => path.resolve(root, file));

function localTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  target = target.replace(/\s+["'][^"']*["']$/, '');
  if (!target || target.startsWith('/')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;
  const [pathOnly, fragment = ''] = target.split('#', 2);
  try {
    return { path: decodeURIComponent(pathOnly), fragment: decodeURIComponent(fragment).toLowerCase() };
  } catch {
    return { path: pathOnly, fragment: fragment.toLowerCase() };
  }
}

function headingAnchors(markdown) {
  const anchors = new Set();
  const occurrences = new Map();
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (!heading) continue;
    const base = heading
      .replace(/<[^>]*>/g, '')
      .replace(/!?\[([^\]]*)]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

const documents = new Map();
for (const file of markdownFiles) documents.set(file, await readFile(file, 'utf8'));

const failures = [];
let checkedLinks = 0;

for (const file of markdownFiles) {
  const lines = documents.get(file).split(/\r?\n/);
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
      const resolved = target.path ? path.resolve(path.dirname(file), target.path) : file;
      try {
        await access(resolved);
      } catch {
        failures.push(`${path.relative(root, file)}:${index + 1} -> ${match[1]}`);
        continue;
      }
      if (target.fragment && path.extname(resolved).toLowerCase() === '.md') {
        const markdown = documents.get(resolved) ?? (await readFile(resolved, 'utf8'));
        if (!headingAnchors(markdown).has(target.fragment)) {
          failures.push(`${path.relative(root, file)}:${index + 1} -> missing anchor #${target.fragment}`);
        }
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
