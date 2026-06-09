/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: '.',
  testMatch: ['smoke.spec.js'],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: process.env.SMOKE_BASE_URL || 'http://127.0.0.1:80',
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/smoke-report' }],
  ],
  outputDir: 'test-results/smoke-artifacts',
}

module.exports = config
