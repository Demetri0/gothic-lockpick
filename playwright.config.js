import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:3000',
    testIdAttribute: 'data-test-id',
  },
  webServer: {
    command: 'npx serve . -p 3000 -n --no-clipboard',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});
