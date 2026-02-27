/**
 * Opens the Playwright HTML report for the latest B2B run folder.
 * Usage: node scripts/show-latest-report.js
 * (Run from project root; npm run report)
 */
import { readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testResultsDir = path.join(__dirname, '..', 'test-results');
const reportFolder = 'playwright-report';

if (!existsSync(testResultsDir)) {
  console.error('No test-results folder found. Run the B2B test first: npm run test:b2b');
  process.exit(1);
}

const dirs = readdirSync(testResultsDir)
  .filter((f) => f.startsWith('b2b-flow-B2B-Flow-'))
  .sort()
  .reverse();

if (dirs.length === 0) {
  console.error('No B2B run folder found in test-results. Run: npm run test:b2b');
  process.exit(1);
}

const latestDir = path.join(testResultsDir, dirs[0]);
const reportPath = path.join(latestDir, reportFolder);
if (!existsSync(reportPath)) {
  console.error(`Report folder not found: ${reportPath}`);
  process.exit(1);
}

console.log(`Opening report from latest run: ${dirs[0]}`);
execSync(`npx playwright show-report "${reportPath}"`, { stdio: 'inherit' });
