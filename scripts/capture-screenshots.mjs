import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../docs/assets', import.meta.url));
const port = 3101;
const baseURL = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist-server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      // The build server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the screenshot server');
}

async function submitBallot(page, cuisine) {
  await page.getByRole('button', { name: new RegExp(`^${cuisine}: neutral`) }).click();
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Lock in my vote' }).click();
  await page.waitForURL(/\/lobby$/);
}

async function settleVisuals(page, delay = 500) {
  await page.waitForTimeout(delay);
  await page.addStyleTag({
    content: 'main [style*="opacity"] { opacity: 1 !important; } [data-sonner-toaster] { display: none !important; }',
  });
}

await mkdir(output, { recursive: true });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();

  const landingContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const landing = await landingContext.newPage();
  await landing.goto(baseURL);
  await landing.getByRole('heading', { name: 'Stop debating where to eat.' }).waitFor();
  await settleVisuals(landing);
  await landing.screenshot({ path: `${output}/landing.png` });
  await landingContext.close();

  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto(`${baseURL}/#/create`);
  await host.getByLabel('Session area label').fill('Friday dinner');
  await host.getByRole('button', { name: 'Create session' }).click();
  await host.waitForURL(/#\/s\/[A-Z2-9]{5}\/host$/);
  const code = host.url().match(/#\/s\/([A-Z2-9]{5})\/host$/)?.[1];
  if (!code) throw new Error('Session code was missing from the host URL');

  await guest.goto(`${baseURL}/#/join/${code}`);
  await guest.getByLabel('What should we call you?').fill('Guest');
  await guest.getByRole('button', { name: 'Join the table' }).click();
  await guest.waitForURL(/\/preferences$/);

  await host.getByRole('button', { name: 'Vote too' }).click();
  await host.getByRole('heading', { name: 'What sounds good?' }).waitFor();
  await settleVisuals(host);
  await host.screenshot({ path: `${output}/ballot.png` });

  await Promise.all([
    submitBallot(host, 'Japanese'),
    submitBallot(guest, 'Lebanese'),
  ]);
  await host.getByRole('button', { name: 'Start the reveal' }).click();
  await host.getByRole('button', { name: 'See full results' }).click();
  await host.getByRole('heading', { name: 'Your private fit' }).waitFor();
  await host.setViewportSize({ width: 1280, height: 900 });
  await settleVisuals(host, 3500);
  await host.screenshot({ path: `${output}/result.png` });

  await hostContext.close();
  await guestContext.close();
} finally {
  await browser?.close();
  server.kill();
}
