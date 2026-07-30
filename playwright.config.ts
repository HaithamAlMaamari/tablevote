import { defineConfig, devices } from '@playwright/test';

const projectPorts = {
  chromium: 3001,
  firefox: 3002,
  webkit: 3003,
} as const;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  // Each project gets isolated in-memory quotas and session state.
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${projectPorts.chromium}` },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], baseURL: `http://127.0.0.1:${projectPorts.firefox}` },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], baseURL: `http://127.0.0.1:${projectPorts.webkit}` },
    },
  ],
  webServer: Object.values(projectPorts).map((port) => ({
    command: `node -e "process.env.PORT='${port}'; import('./dist-server/index.js').then((module) => module.startServer())"`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  })),
});
