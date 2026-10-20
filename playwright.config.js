import { defineConfig, devices } from '@playwright/test';

const server = (port, env = '') => ({
  command: `${env} PORT=${port} node test/ui-server.js`,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: false,
});

export default defineConfig({
  testDir: 'test',
  testMatch: 'ui.spec.js',
  use: { ...devices['iPhone 13'], browserName: 'chromium' },
  webServer: [
    server(4101),
    server(4102, 'FAKE_ACTIVE=0'),
    server(4103, 'REMOTE_CONTROL_TOKEN=s3cret'),
  ],
});
