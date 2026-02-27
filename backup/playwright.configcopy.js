/**
 * Playwright Test config. Uses session saved by salesforce-login.js (.auth/salesforce-auth.json).
 * Run tests after login: npm run login (or login:headed), then tests run automatically; or run: npx playwright test
 */
import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: 'tests',
  use: {
    baseURL: 'https://test.salesforce.com',
    storageState: path.join(__dirname, '.auth', 'salesforce-auth.json'),
    viewport: null,
    ignoreHTTPSErrors: true,
    // Use system Chrome so no "npx playwright install" needed (handy behind corporate proxy)
    channel: 'chrome',
    // Run in visible browser (headed), same as login UI
    headless: false,
    launchOptions: { args: ['--start-maximized'] },
    // Allow Location on all pages; set a default so the prompt doesn't appear
    permissions: ['geolocation'],
    geolocation: { longitude: -66.1057, latitude: 18.2208 }, // Puerto Rico (matches common B2B flow)
    video: {
      mode: 'on',
      trace: 'on',
      size: { width: 1280, height: 720 },
    },
  },
  timeout: 600000,
  expect: { timeout: 15000 },
});