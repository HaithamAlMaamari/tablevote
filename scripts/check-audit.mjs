import { spawnSync } from 'node:child_process';

const allowedAdvisories = new Map([
  [
    'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
    'TableVote is a client-only HashRouter SPA and does not enable React Router RSC or server actions.',
  ],
]);

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const audit = spawnSync(command, ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (!audit.stdout) {
  console.error(audit.stderr || 'npm audit produced no report');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error(audit.stdout);
  process.exit(1);
}

const blocking = [];
const accepted = [];
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const advisory of vulnerability.via ?? []) {
    if (typeof advisory === 'string') continue;
    if (!['high', 'critical'].includes(advisory.severity)) continue;
    const reason = allowedAdvisories.get(advisory.url);
    if (reason) accepted.push({ advisory, reason });
    else blocking.push(advisory);
  }
}

for (const { advisory, reason } of accepted) {
  console.log(`Accepted audit exception: ${advisory.url}`);
  console.log(`Reason: ${reason}`);
}

if (blocking.length > 0) {
  console.error('Unapproved high or critical production advisories:');
  for (const advisory of blocking) console.error(`- ${advisory.url}: ${advisory.title}`);
  process.exit(1);
}

console.log('Production dependency audit policy passed.');
