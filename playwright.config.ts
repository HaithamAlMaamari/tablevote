import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.TABLEVOTE_E2E_PORT ?? 3001);

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  // The matrix runner gives every browser a fresh server and bounded in-memory state.
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `node -e "process.env.PORT='${port}'; import('./dist-server/index.js').then((module) => module.startServer())"`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
