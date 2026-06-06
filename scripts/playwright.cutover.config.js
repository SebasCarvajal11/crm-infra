// Reuse the locally installed Chrome channel so the cutover check does not
// depend on downloading browser binaries into the repo.
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: '.',
  testMatch: ['*.spec.js'],
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: require.resolve('./playwright.ensure-workers.cjs'),
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
}

module.exports = config
