import { execFileSync } from 'node:child_process';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const forbiddenDirectories = [
  '.opencode/',
  'blob-report/',
  'coverage/',
  'dist-server/',
  'dist/',
  'node_modules/',
  'playwright-report/',
  'test-results/',
];
const forbiddenExtensions = /\.(?:cer|crt|db|key|log|p12|pem|pfx|sqlite|sqlite3)$/i;
const privateKeyNames = /(^|\/)(?:id_dsa|id_ecdsa|id_ed25519|id_rsa)$/;

const forbiddenFiles = trackedFiles.filter((file) => {
  if (forbiddenDirectories.some((directory) => file.startsWith(directory))) return true;
  if (file === '.git.broken-worktree') return true;
  if (forbiddenExtensions.test(file)) return true;
  if (privateKeyNames.test(file)) return true;
  if (/(^|\/)\.envrc(?:\.|$)/.test(file)) return true;
  return /(^|\/)\.env(?:\.|$)/.test(file) && file !== '.env.example';
});

if (forbiddenFiles.length > 0) {
  console.error(`Forbidden local or sensitive files are tracked:\n${forbiddenFiles.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Repository file check passed (${trackedFiles.length} tracked files).`);
}
