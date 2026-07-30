import { spawnSync } from 'node:child_process';
import { evaluateAuditReport } from './audit-report.mjs';

const allowedAdvisories = new Map();
const includeDevelopmentDependencies = process.argv.includes('--all');
const policyLabel = includeDevelopmentDependencies ? 'full dependency' : 'production dependency';

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const auditArguments = ['audit', ...(includeDevelopmentDependencies ? [] : ['--omit=dev']), '--json'];
const audit = spawnSync(command, auditArguments, {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (audit.error) {
  console.error(`Could not run npm audit: ${audit.error.message}`);
  process.exit(1);
}

if (audit.signal) {
  console.error(`npm audit was terminated by signal ${audit.signal}`);
  process.exit(1);
}

if (audit.status === null) {
  console.error('npm audit ended without an exit status');
  process.exit(1);
}

if (typeof audit.stdout !== 'string' || audit.stdout.trim().length === 0) {
  console.error(audit.stderr?.trim() || 'npm audit produced no report');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  console.error(`npm audit produced invalid JSON: ${error.message}`);
  process.exit(1);
}

let result;
try {
  result = evaluateAuditReport(report, allowedAdvisories);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (![0, 1].includes(audit.status)) {
  console.error(`npm audit exited with unexpected status ${audit.status}`);
  if (audit.stderr?.trim()) console.error(audit.stderr.trim());
  process.exit(1);
}

for (const { advisory, reason } of result.accepted) {
  console.log(`Accepted audit exception: ${advisory.url}`);
  console.log(`Reason: ${reason}`);
}

if (result.blocking.length > 0) {
  console.error(`Unapproved high or critical ${policyLabel} advisories:`);
  for (const advisory of result.blocking) console.error(`- ${advisory.url}: ${advisory.title}`);
  process.exit(1);
}

console.log(`${policyLabel[0].toUpperCase()}${policyLabel.slice(1)} audit policy passed.`);
