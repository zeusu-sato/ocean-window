import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  use: { browserName: 'chromium', channel: 'chrome', baseURL: 'http://127.0.0.1:4179', viewport: { width: 1000, height: 950 } },
  webServer: { command: 'node tools/preview.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
  reporter: 'list'
});
