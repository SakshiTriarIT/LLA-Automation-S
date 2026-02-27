/**
 * Playwright Test config. Uses session saved by salesforce-login.js (.auth/salesforce-auth.json).
 * Run tests after login: npm run login (or login:headed), then tests run automatically; or run: npx playwright test
 */
import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testResultsBase = path.join(__dirname, 'test-results');
const runIdPath = path.join(testResultsBase, '.b2b-run-id');
const RUN_ID_MAX_AGE_MS = 60000; // 1 min: only reuse within same run (main + worker load config within seconds)

function getOrCreateRunTimestamp() {
  mkdirSync(testResultsBase, { recursive: true });
  if (existsSync(runIdPath)) {
    try {
      const stat = statSync(runIdPath);
      if (Date.now() - stat.mtimeMs < RUN_ID_MAX_AGE_MS) {
        const existing = readFileSync(runIdPath, 'utf8').trim();
        if (existing) return existing;
      }
    } catch (_) {}
  }
  const runTimestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
  writeFileSync(runIdPath, runTimestamp, 'utf8');
  return runTimestamp;
}

// One folder per run; config can load twice (main + worker), so reuse same timestamp via .b2b-run-id
const runTimestamp = getOrCreateRunTimestamp();
const b2bOutputDir = path.join(testResultsBase, `b2b-flow-B2B-Flow-${runTimestamp}`);
mkdirSync(b2bOutputDir, { recursive: true });

export default defineConfig({
  testDir: 'tests',
  outputDir: b2bOutputDir,
  reporter: [['html', { outputFolder: path.join(b2bOutputDir, 'playwright-report'), open: 'never' }]],
  projects: [
    {
      name: 'B2B-Flow',
      testMatch: /b2b-flow\.spec\.js/,
      use: {
        baseURL: 'https://test.salesforce.com',
        storageState: path.join(__dirname, '.auth', 'salesforce-auth.json'),
        viewport: null,
        ignoreHTTPSErrors: true,
        channel: 'chrome',
        headless: false,
        launchOptions: { args: ['--start-maximized'] },
        permissions: ['geolocation'],
        geolocation: { longitude: -66.1057, latitude: 18.2208 },
        video: 'on',
        trace: 'on',
      },
    },
  ],
  timeout: 600000,
  expect: { timeout: 15000 },
});