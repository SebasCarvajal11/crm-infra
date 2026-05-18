// Reuse the locally installed Chrome channel so the cutover check does not
// depend on downloading browser binaries into the repo.
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: '.',
  testMatch: ['frontend-cutover.spec.js'],
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
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
