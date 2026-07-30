import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const matrix = [
  ['chromium', '3001'],
  ['firefox', '3002'],
  ['webkit', '3003'],
];

for (const [project, port] of matrix) {
  const result = spawnSync(process.execPath, [playwrightCli, 'test', `--project=${project}`], {
    env: { ...process.env, TABLEVOTE_E2E_PORT: port },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${project} browser tests ended on signal ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
