/**
 * B2B Flow test. Runs after login (uses session from .auth/salesforce-auth.json).
 * Live debugging:
 *   - Timestamp on every log line [HH:mm:ss.SSS].
 *   - START/OK/FAILED + duration; OK includes current URL so you see "where we are".
 *   - On failure: screenshot saved and path logged; attached to test report.
 *   - "→ Locate: X" / "✗ ELEMENT NOT FOUND: X" for which element ran or failed.
 *   - TRACK logs: what values we use, what we're waiting for, and how long it took (optimization visibility).
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { appendFile, copyFile } from 'fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.resolve(__dirname, '..', '.auth', 'salesforce-auth.json');

/**
 * Central config: all tunable URLs, timeouts, form values, and selectors.
 * - Change here to optimize; TRACK logs show which values are used and how long each wait took.
 * - TRACK phases: config (at start), waiting (before action), loaded (after success, with durationMs), value (explicit value used), failed (on error).
 * - Add more keys to B2B_CONFIG and pass meta to find(page, desc, fn, { timeout, value, selector }) to trace more elements.
 */
const B2B_CONFIG = {
  urls: {
    lightningHome: 'https://cwc--qasales.sandbox.lightning.force.com/lightning/page/home',
    setupManageUsers: 'https://cwc--qasales.sandbox.my.salesforce-setup.com/lightning/setup/ManageUsers/page?address=%2F00574000001KtCH%3Fnoredirect%3D1%26isUserEntityOverride%3D1',
    b2bQuickSales: 'https://cwc--qasales.sandbox.lightning.force.com/lightning/n/B2BQuickSales',
    accountViewPattern: /\/lightning\/r\/Account\/.*\/view/,
    cartIdInUrl: /cartId=/i,
  },
  // Summary of changes from stats (b2b-stats.log, timeout vs durationMs):
  // - Output: single folder; total run time + Run summary (stepsActionMs, screenshotsSettleMs, otherMs) in finally.
  // - Per-step: TRACK step | step=N actionMs=X screenshotMs=Y; Success screenshot path (Xms).
  // - Timeouts reduced; screenshotSettleMs 2500->1500; postBusinessLicenseWaitMs 5s->3s; creditCheck settles 2s/4s->1s/2s.
  // - Step 29: goto cart URL at start then Add Product .first().
  timeouts: {
    oneAppNav: 20000,
    setupLoad: 15000,
    loginButtonVisible: 120000,
    navigation: 120000,
    lightningUrl: 120000,
    spinnerOverlay: 10000,
    creditCheckTitle: 10000,
    creditCheckTaxNumber: 15000,
    creditCheckClose: 10000,
    creditCheckSpinner: 10000,
    creditCheckSpinnerGeneric: 15000,
    closeButtonVisible: 10000,
    closeButtonEnabled: 10000,
    accountViewUrl: 10000,
    appNavWaffle: 20000,
    cartIdUrl: 60000,
    addressSuggestion: 5000,
    addressSuggestionClick: 5000,
    nextButtonVisible: 5000,
    nextButtonClick: 5000,
    braintreeIframe: 20000,
    braintreePoll: 500,
    braintreeSettle: 3000,
    braintreeFill: 10000,
    addProductAction: 30000,
    defaultLocator: 15000,
    screenshotSettleMs: 1500,
    postBusinessLicenseWaitMs: 3000,
    creditCheckModalSettleMs: 1000,
    creditCheckSpinnerSettleMs: 2000,
  },
  formValues: {
    company: 'test',
    industry: 'Air Services',
    accountType: 'SOHO/Small',
    socialSecurity: '223344556',
    salutation: 'Mr',
    firstName: 'test',
    lastName: 'Auto',
    phone: '(123) 456-7890',
    email: 'testauto@gmail.com',
    addressSearch: '1451',
    addressSuggestion: '1451 Ashford Avenue, San Juan',
    cardholderName: 'Rishi Mahto',
    cardNumber: '4111 1111 1111 1111',
    cardExp: '226',
    cardCvv: '243',
    postalCode: '3431',
    msisdnCount: '999',
  },
  selectors: {
    oneAppNav: 'one-appnav',
    spinnerOverlay: '.spinner-overlay',
    creditCheckSpinner: '.slds-spinner_container',
    spinnerGeneric: '[class*="spinner"]',
    appNavWaffle: '.slds-icon-waffle',
    addressSearchRole: '*Address Search',
    braintreeFrameCardholder: 'braintree-hosted-field-cardholderName',
    braintreeFrameNumber: 'braintree-hosted-field-number',
    braintreeFrameExp: 'braintree-hosted-field-expirationDate',
    braintreeFrameCvv: 'braintree-hosted-field-cvv',
    braintreeFramePostal: 'braintree-hosted-field-postalCode',
  },
};

/**
 * Build a PDF report with all step screenshots (success + failure) from this run.
 * Saves to outputDir as b2b-run-<timestamp>.pdf
 */
async function buildB2BReportPdf(outputDir, logFn = () => {}) {
  if (!existsSync(outputDir)) return null;
  const stepMain = readdirSync(outputDir).filter((f) => /^step-\d+-(ok|fail)\.png$/.test(f));
  const step21Details = readdirSync(outputDir).filter((f) => /^step-21-.+\.png$/.test(f));
  const step28Details = readdirSync(outputDir).filter((f) => /^step-28-.+\.png$/.test(f));
  const step29Details = readdirSync(outputDir).filter((f) => /^step-29-.+\.png$/.test(f));
  const entries = stepMain.map((f) => {
    const m = f.match(/^step-(\d+)-(ok|fail)\.png$/);
    return { step: parseInt(m[1], 10), status: m[2], file: f, sortKey: `${m[1].padStart(3, '0')}-0-${f}` };
  });
  step21Details.sort().forEach((f) => entries.push({ step: 21, status: 'detail', file: f, sortKey: `021-1-${f}` }));
  step28Details.sort().forEach((f) => entries.push({ step: 28, status: 'detail', file: f, sortKey: `028-1-${f}` }));
  step29Details.sort().forEach((f) => entries.push({ step: 29, status: 'detail', file: f, sortKey: `029-1-${f}` }));
  entries.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  if (entries.length === 0) return null;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const titleHeight = 30;

  for (const { step, status, file } of entries) {
    const imgPath = path.join(outputDir, file);
    if (!existsSync(imgPath)) continue;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const label = status === 'detail' ? `Step ${step} - ${file.replace(/^step-\d+-|\.png$/g, '')}` : `Step ${step} - ${status === 'ok' ? 'OK' : 'FAILED'}`;
    page.drawText(label, { font: fontBold, size: 14, x: margin, y: pageHeight - margin - 16 });
    page.drawText(file, { font, size: 10, x: margin, y: pageHeight - margin - 28 });

    try {
      const imgBytes = readFileSync(imgPath);
      const image = await pdfDoc.embedPng(imgBytes);
      const imgW = image.width;
      const imgH = image.height;
      const maxW = pageWidth - 2 * margin;
      const maxH = pageHeight - 2 * margin - titleHeight;
      const scale = Math.min(maxW / imgW, maxH / imgH, 1);
      const w = imgW * scale;
      const h = imgH * scale;
      page.drawImage(image, {
        x: margin,
        y: pageHeight - margin - titleHeight - h,
        width: w,
        height: h,
      });
    } catch (e) {
      page.drawText(`(Could not embed image: ${e.message})`, { font, size: 10, x: margin, y: pageHeight - margin - 50 });
    }
  }

  const runTime = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const pdfPath = path.join(outputDir, `b2b-run-${runTime}.pdf`);
  const pdfBytes = await pdfDoc.save();
  const { writeFile } = await import('fs/promises');
  await writeFile(pdfPath, pdfBytes);
  logFn(`PDF report: ${pdfPath} (${entries.length} screenshots)`);
  return pdfPath;
}

/** Timestamp for live debugging */
const ts = () => new Date().toTimeString().slice(0, 12);

/** Set at test start to path inside b2b-flow-B2B-Flow; all log() lines are appended there. */
let b2bStatsFilePath = null;
/** Set at test start; step() accumulates actionMs and screenshotMs for run summary. */
let b2bRunStats = null;

/** Log with [B2B][HH:mm:ss.SSS] prefix; also appends to b2b-stats.log in run folder when b2bStatsFilePath is set. */
function log(msg) {
  const line = `[B2B][${ts()}] ${String(msg)}`;
  console.log(`[B2B][${ts()}]`, msg);
  if (b2bStatsFilePath) appendFile(b2bStatsFilePath, line + '\n').catch(() => {});
}

/**
 * Track element/value usage and load times for optimization.
 * phase: 'config' | 'waiting' | 'loaded' | 'value'
 * data: { element?, value?, timeout?, durationMs?, selector?, ... }
 */
function logTrack(phase, data) {
  const parts = Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 60 ? v.slice(0, 57) + '...' : v}`).join(' ');
  log(`  TRACK ${phase} | ${parts}`);
}

/**
 * Run an action that locates/uses an element. Logs which element we're looking for;
 * on failure logs "ELEMENT NOT FOUND: description". Optional meta logs TRACK waiting/loaded.
 */
async function find(page, elementDescription, fn, meta = null) {
  const start = Date.now();
  log(`  → Locate: ${elementDescription}`);
  if (meta) logTrack('waiting', { element: elementDescription, ...meta });
  try {
    await fn();
    const durationMs = Date.now() - start;
    if (meta) logTrack('loaded', { element: elementDescription, durationMs, ...meta });
  } catch (err) {
    const durationMs = Date.now() - start;
    log(`  ✗ ELEMENT NOT FOUND / FAILED: ${elementDescription}`);
    log(`  ✗ Error: ${err.message}`);
    if (meta) logTrack('failed', { element: elementDescription, durationMs, error: err.message });
    throw err;
  }
}

/** Wait this long before taking success screenshot (avoids capturing splash/loading). Defined in B2B_CONFIG.timeouts.screenshotSettleMs. */
const SCREENSHOT_SETTLE_MS = B2B_CONFIG.timeouts.screenshotSettleMs;

/**
 * Run a named step. Logs START, then OK (with duration + URL) or FAILED (with screenshot path).
 * testInfo optional: if provided, screenshot on failure is saved and attached to the report.
 * outputDir optional: when set (timestamped B2B run folder), screenshots go here instead of testInfo.outputDir.
 * context optional: on failure, if the main page is closed, try to screenshot any other open page so we still capture state.
 */
async function step(page, stepNum, stepName, fn, testInfo = null, outputDir = null, context = null) {
  const outDir = outputDir || testInfo?.outputDir || path.join(__dirname, '..', 'test-results');
  const start = Date.now();
  log(`START ${stepNum}. ${stepName}`);
  try {
    await fn();
    const actionMs = Date.now() - start;
    const url = page?.url?.() ?? '?';
    log(`OK ${stepNum}. ${stepName} (${actionMs}ms) RAN | URL: ${url}`);
    let screenshotMs = 0;
    if (testInfo && page && !page.isClosed?.()) {
      try {
        const screenshotStart = Date.now();
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await new Promise((r) => setTimeout(r, SCREENSHOT_SETTLE_MS));
        const name = `step-${stepNum}-ok.png`;
        const outPath = path.join(outDir, name);
        await page.screenshot({ path: outPath, fullPage: true });
        screenshotMs = Date.now() - screenshotStart;
        if (b2bRunStats) logTrack('step', { step: stepNum, actionMs, screenshotMs });
        log(`Success screenshot: ${outPath} (${screenshotMs}ms)`);
        await testInfo.attach(name, { path: outPath });
      } catch (e) {
        log(`Success screenshot failed: ${e.message}`);
      }
    }
    if (b2bRunStats) {
      b2bRunStats.steps.push({ stepNum, actionMs, screenshotMs });
      b2bRunStats.totalActionMs += actionMs;
      b2bRunStats.totalScreenshotMs += screenshotMs;
    }
  } catch (err) {
    const actionMs = Date.now() - start;
    const url = page?.url?.() ?? 'no page';
    log(`FAILED ${stepNum}. ${stepName} after ${actionMs}ms | URL: ${url}`);
    if (b2bRunStats) {
      b2bRunStats.steps.push({ stepNum, actionMs, screenshotMs: 0 });
      b2bRunStats.totalActionMs += actionMs;
    }
    log(`Error: ${err.message}`);
    // Capture failure screenshot: use main page if still open, else any open page from context (e.g. after tab closed)
    let targetPage = page && !page.isClosed?.() ? page : null;
    if (!targetPage && context?.pages) {
      const pages = context.pages();
      targetPage = pages.find((p) => !p.isClosed?.());
    }
    if (testInfo && targetPage) {
      try {
        const name = `step-${stepNum}-fail.png`;
        const outPath = path.join(outDir, name);
        await targetPage.screenshot({ path: outPath, fullPage: true });
        log(`Screenshot saved: ${outPath}`);
        await testInfo.attach(name, { path: outPath });
      } catch (e) {
        log(`Screenshot failed: ${e.message}`);
      }
    } else if (testInfo && !targetPage) {
      log(`Screenshot skipped: no open page (main page closed and no other page in context)`);
    }
    throw new Error(`B2B step ${stepNum} "${stepName}" failed: ${err.message}`);
  }
}

// Verification tabs: let them load then close. Salesforce tabs: keep open.
const VERIFICATION_TAB_URLS = /suri\.hacienda\.pr\.gov|hacienda\.pr\.gov/;
const KEEP_OPEN_URLS = /salesforce|lightning|one\.one/;

test('B2B Flow', async ({ page, context }, testInfo) => {
  // One folder per run: timestamped folder (b2b-flow-B2B-Flow-<datetime>). Playwright may set outputDir to that or a subfolder (B2B-Flow-<id>).
  const base = path.basename(testInfo.outputDir);
  const isPlaywrightSubfolder = base.startsWith('B2B-Flow-') && !base.includes('T');
  const outDir = isPlaywrightSubfolder ? path.dirname(testInfo.outputDir) : testInfo.outputDir;
  mkdirSync(outDir, { recursive: true });
  b2bStatsFilePath = path.join(outDir, 'b2b-stats.log');
  const runStartMs = Date.now();
  b2bRunStats = { steps: [], totalActionMs: 0, totalScreenshotMs: 0 };
  appendFile(b2bStatsFilePath, `[B2B] B2B Flow run started - stats log\n[B2B] Output folder: ${outDir}\n`).catch(() => {});
  log(`Run output folder: ${outDir}`);
  log(`Stats file: ${b2bStatsFilePath}`);
  logTrack('config', {
    urls: Object.keys(B2B_CONFIG.urls).join(','),
    timeouts: Object.keys(B2B_CONFIG.timeouts).length + ' keys',
    formValues: Object.keys(B2B_CONFIG.formValues).join(','),
    selectors: Object.keys(B2B_CONFIG.selectors).join(','),
  });
  log('Defined timeouts (ms) – B2B_CONFIG.timeouts:');
  Object.entries(B2B_CONFIG.timeouts).forEach(([k, v]) => log(`  ${k}=${v}`));
  log(`Test timeout (ms): ${testInfo.timeout}`);
  const runStep = (p, num, name, fn) => step(p, num, name, fn, testInfo, outDir, context);
  let urlWithCartId;
  const captureStep21 = async (label) => {
    const name = `step-21-${label}.png`;
    const outPath = path.join(outDir, name);
    await page.screenshot({ path: outPath, fullPage: true });
    log(`  Step 21 screenshot: ${outPath}`);
  };
  /** Detail screenshots for steps 28–29: step-{stepNum}-{label}.png */
  const captureDetail = async (stepNum, label) => {
    const name = `step-${stepNum}-${label}.png`;
    const outPath = path.join(outDir, name);
    await page.screenshot({ path: outPath, fullPage: true });
    log(`  [${stepNum}] Screenshot: ${outPath}`);
  };

  try {
  // Explicitly grant geolocation so "Allow location" prompt does not appear (Chrome can ignore config)
  const geoOrigins = [
    'https://cwc--qasales.sandbox.lightning.force.com',
    'https://test.salesforce.com',
    'https://cwc--qasales.sandbox.my.salesforce-setup.com',
  ];
  for (const origin of geoOrigins) {
    await context.grantPermissions(['geolocation'], { origin }).catch(() => {});
  }
  await context.setGeolocation({ longitude: -66.1057, latitude: 18.2208 });

  context.on('page', (newPage) => {
    (async () => {
      await new Promise((r) => setTimeout(r, 2000));
      const url = newPage.url();
      if (VERIFICATION_TAB_URLS.test(url)) {
        log('Verification tab opened, waiting for load then closing: ' + url);
        await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
        await newPage.close();
        log('Verification tab closed');
        return;
      }
      if (KEEP_OPEN_URLS.test(url)) return;
      log('Closing new tab/popup: ' + url);
      await newPage.close();
    })().catch(() => {});
  });

  await runStep(page, 1, 'Goto Lightning home', () => {
    logTrack('value', { url: 'lightningHome', value: B2B_CONFIG.urls.lightningHome });
    return page.goto(B2B_CONFIG.urls.lightningHome);
  });
  await runStep(page, 2, 'Wait for one-appnav', () =>
    find(page, "selector 'one-appnav'", () => page.waitForSelector(B2B_CONFIG.selectors.oneAppNav, { timeout: B2B_CONFIG.timeouts.oneAppNav }), { timeout: B2B_CONFIG.timeouts.oneAppNav, selector: B2B_CONFIG.selectors.oneAppNav }));
  await runStep(page, 3, 'Goto Setup Manage Users', () => {
    logTrack('value', { url: 'setupManageUsers', value: B2B_CONFIG.urls.setupManageUsers });
    return page.goto(B2B_CONFIG.urls.setupManageUsers);
  });
  await runStep(page, 4, 'Wait for setup page load', () =>
    page.waitForLoadState('domcontentloaded'));

  const frame = page.frameLocator('iframe');
  const userDetailRow = frame.getByRole('row', { name: /User Detail/i });
  const loginBtn = userDetailRow.locator('input[name="login"]');

  // If already logged in as the target user, Setup page shows User Detail but no "Login" button → skip to step 8
  const loginBtnVisible = await loginBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (loginBtnVisible) {
    await runStep(page, 5, 'Wait for Login button in User Detail row', () =>
      find(page, "iframe → row 'User Detail' → input[name=login]", () => loginBtn.waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.loginButtonVisible }), { timeout: B2B_CONFIG.timeouts.loginButtonVisible }));
    await runStep(page, 6, 'Click Login (switch user)', () =>
      find(page, "Login button (click) + wait navigation", () =>
        Promise.all([
          page.waitForNavigation({ timeout: B2B_CONFIG.timeouts.navigation }),
          loginBtn.click()
        ]), { timeout: B2B_CONFIG.timeouts.navigation }));
    await runStep(page, 7, 'Wait for Lightning URL after switch', () =>
      find(page, "URL matches lightning|one.one", () => page.waitForURL(/lightning|one\.one/, { timeout: B2B_CONFIG.timeouts.lightningUrl }), { timeout: B2B_CONFIG.timeouts.lightningUrl }));
    log('Login As User successful');
  } else {
    log('Already logged in as user (no Login button on Setup) → skipping steps 5–7, going to B2B Quick Sales');
  }

   //COMMENTED: steps 8–23 (do not remove)
  await runStep(page, 8, 'Goto B2B Quick Sales', () =>
    page.goto('https://cwc--qasales.sandbox.lightning.force.com/lightning/n/B2BQuickSales'));
  await runStep(page, 9, 'Click New', () =>
    find(page, "button 'New'", () => page.getByRole('button', { name: 'New' }).click()));

  await runStep(page, 10, 'Fill Company, Industry, Account Type', async () => {
    await find(page, "textbox '*Company'", () => page.getByRole('textbox', { name: '*Company' }).fill(B2B_CONFIG.formValues.company), { value: B2B_CONFIG.formValues.company });
    await find(page, "combobox '*Industry'", () => page.getByRole('combobox', { name: '*Industry' }).click());
    await find(page, "text 'Air Services'", () => page.getByText(B2B_CONFIG.formValues.industry).click(), { value: B2B_CONFIG.formValues.industry });
    await find(page, "combobox '*Account Type'", () => page.getByRole('combobox', { name: '*Account Type' }).click());
    await find(page, "listbox .slds-listbox:visible", async () => {
      const listbox = page.locator('.slds-listbox:visible').last();
      await listbox.waitFor();
      await listbox.locator(`[data-value="${B2B_CONFIG.formValues.accountType}"]`).click();
    }, { value: B2B_CONFIG.formValues.accountType });
  });

  await runStep(page, 11, 'Fill contact fields', async () => {
    await find(page, "textbox 'Social Security Number'", () => page.getByRole('textbox', { name: 'Social Security Number' }).fill(B2B_CONFIG.formValues.socialSecurity), { value: '(masked)' });
    await find(page, "combobox 'Salutation'", () => page.getByRole('combobox', { name: 'Salutation' }).click());
    await find(page, "text 'Mr' (exact)", () => page.getByText(B2B_CONFIG.formValues.salutation, { exact: true }).click(), { value: B2B_CONFIG.formValues.salutation });
    await find(page, "textbox '*First Name'", () => page.getByRole('textbox', { name: '*First Name' }).fill(B2B_CONFIG.formValues.firstName), { value: B2B_CONFIG.formValues.firstName });
    await find(page, "textbox '*Last Name'", () => page.getByRole('textbox', { name: '*Last Name' }).fill(B2B_CONFIG.formValues.lastName), { value: B2B_CONFIG.formValues.lastName });
    await find(page, "textbox '*Phone'", () => page.getByRole('textbox', { name: '*Phone' }).fill(B2B_CONFIG.formValues.phone), { value: B2B_CONFIG.formValues.phone });
    await find(page, "textbox '*Email'", () => page.getByRole('textbox', { name: '*Email' }).fill(B2B_CONFIG.formValues.email), { value: B2B_CONFIG.formValues.email });
    await find(page, "checkbox 'Marketing Opt In'", () => page.locator('.slds-checkbox_faux').click());
  });

  await runStep(page, 12, 'Click Create Customer Account', () =>
    find(page, "button 'Create Customer Account'", () => page.getByRole('button', { name: 'Create Customer Account' }).click()));

  await runStep(page, 13, 'Address Search - wait input and type', async () => {
    await find(page, "Address Search input (text=Address Search + slds-form-element)", async () => {
      const addressInput = page
        .locator('text=Address Search')
        .locator('xpath=ancestor::div[contains(@class,"slds-form-element")]')
        .locator('input')
        .first();
      await addressInput.waitFor({ state: 'visible' });
      await addressInput.scrollIntoViewIfNeeded();
      await addressInput.click();
      await addressInput.pressSequentially('1', { delay: 200 });
      await page.waitForTimeout(800);
      await addressInput.pressSequentially('451 Ashford', { delay: 120 });
    });
  });
  await runStep(page, 14, 'Address - wait predictions and select', async () => {
    await page.waitForTimeout(2500);
    await find(page, "Address Search input (ArrowDown+Enter)", async () => {
      const addressInput = page
        .locator('text=Address Search')
        .locator('xpath=ancestor::div[contains(@class,"slds-form-element")]')
        .locator('input')
        .first();
      await addressInput.press('ArrowDown');
      await addressInput.press('Enter');
    });
    await page.waitForTimeout(2000);
  });

  await runStep(page, 15, 'Certificate of Registration - Verify', async () => {
    await find(page, "link 'Certificate of Registration'", () => page.getByRole('link', { name: 'Certificate of Registration' }).click());
    await find(page, "button 'Verify' (Certificate) - wait enabled then click", async () => {
      const certVerifyBtn = page.getByRole('button', { name: 'Verify' }).first();
      await expect(certVerifyBtn).toBeEnabled({ timeout: 120000 });
      await certVerifyBtn.click();
    });
  });
  await runStep(page, 16, 'Wait 5s then Business License - Verify', async () => {
    await page.waitForTimeout(5000);
    await find(page, "link 'Business License' (wait visible)", () => page.getByRole('link', { name: 'Business License' }).waitFor({ state: 'visible' }));
    await find(page, "link 'Business License' (click)", () => page.getByRole('link', { name: 'Business License' }).click());
    await find(page, "button 'Verify' (Business License) - wait enabled then click", async () => {
      const licenseVerifyBtn = page.getByRole('button', { name: 'Verify' }).first();
      await expect(licenseVerifyBtn).toBeEnabled({ timeout: 120000 });
      await licenseVerifyBtn.click();
    });
  });
  await runStep(page, 17, 'Wait after Business License Verify', () =>
    page.waitForTimeout(B2B_CONFIG.timeouts.postBusinessLicenseWaitMs));

  //await runStep(page, 18, 'Create Contact', () =>
 //   find(page, "button 'Create Contact'", () => page.getByRole('button', { name: 'Create Contact' }).click()));
  await runStep(page, 19, 'Wait for spinner hidden', () =>
    find(page, ".spinner-overlay (wait hidden)", () => page.locator('.spinner-overlay').waitFor({ state: 'hidden', timeout: B2B_CONFIG.timeouts.spinnerOverlay }), { timeout: B2B_CONFIG.timeouts.spinnerOverlay }));
  await runStep(page, 20, 'Proceed to Credit Check', () =>
    find(page, "button 'Proceed to Credit Check'", () => page.getByRole('button', { name: 'Proceed to Credit Check' }).click()));

  await runStep(page, 21, 'Credit Check screen - Default then Close', async () => {
    await find(page, "Credit Check modal (wait for title + Tax Number + Close)", async () => {
      await page.getByText('Credit Check', { exact: true }).first().waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.creditCheckTitle });
      await page.getByText('Tax Number:').first().waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.creditCheckTaxNumber });
      await page.getByRole('button', { name: 'Close' }).first().waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.creditCheckClose });
      await new Promise((r) => setTimeout(r, B2B_CONFIG.timeouts.creditCheckModalSettleMs));
      await captureStep21('01-modal-visible');
    }, { timeout: B2B_CONFIG.timeouts.creditCheckTitle });
    await find(page, "Credit Check: wait for spinners hidden + settle", async () => {
      await page.locator('.slds-spinner_container').waitFor({ state: 'hidden', timeout: B2B_CONFIG.timeouts.creditCheckSpinner }).catch(() => {});
      await page.locator('[class*="spinner"]').first().waitFor({ state: 'hidden', timeout: B2B_CONFIG.timeouts.creditCheckSpinnerGeneric }).catch(() => {});
      await new Promise((r) => setTimeout(r, B2B_CONFIG.timeouts.creditCheckSpinnerSettleMs));
      await captureStep21('02-after-spinners');
    }, { timeout: B2B_CONFIG.timeouts.creditCheckSpinner });
    await find(page, "Credit Check: click 'Default' (Tax Number)", async () => {
      const tryClick = async () => {
        const dialog = page.locator('[role="dialog"]').first();
        if (await dialog.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
          const inDialog = dialog.getByRole('button', { name: 'Default' }).first();
          if (await inDialog.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
            await inDialog.scrollIntoViewIfNeeded();
            await inDialog.click({ force: true });
            return true;
          }
        }
        const byRole = page.getByRole('button', { name: 'Default' }).first();
        if (await byRole.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
          await byRole.scrollIntoViewIfNeeded();
          await byRole.click({ force: true });
          return true;
        }
        const byText = page.getByText('Default', { exact: true }).first();
        if (await byText.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
          await byText.scrollIntoViewIfNeeded();
          await byText.click({ force: true });
          return true;
        }
        const byXpath = page.locator('//*[normalize-space()="Default"]').first();
        if (await byXpath.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
          await byXpath.scrollIntoViewIfNeeded();
          await byXpath.click({ force: true });
          return true;
        }
        return false;
      };
      let done = await tryClick();
      if (!done) {
        done = await page.evaluate(() => {
          const isVisible = (el) => el && el.offsetParent !== null && (el.offsetWidth > 0 || el.offsetHeight > 0);
          const candidates = [];
          function walk(node) {
            if (!node || node.nodeType !== 1) return;
            if ((node.textContent || '').trim() === 'Default' && isVisible(node)) candidates.push(node);
            if (node.shadowRoot) walk(node.shadowRoot);
            const children = node.children || [];
            for (let i = 0; i < children.length; i++) walk(children[i]);
          }
          walk(document.body);
          const innermost = candidates.filter((e) => !candidates.some((c) => c !== e && e.contains(c)));
          const el = innermost.find((e) => {
            const par = e.parentElement;
            return !par || (par.textContent || '').trim() === 'Default' || par.tagName === 'BODY';
          }) || innermost[0] || candidates[0];
          if (el) { el.click(); return true; }
          return false;
        });
      }
      if (done) log('  ✓ Clicked Default (Tax Number)');
      else throw new Error('Could not find or click Default with any strategy');
      await captureStep21('03-after-default-click');
    });
    await find(page, "Credit Check: Close (article) then wait for Account view", async () => {
      const closeBtn = page.getByRole('article').getByRole('button', { name: 'Close' });
      await closeBtn.waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.closeButtonVisible });
      await expect(closeBtn).toBeEnabled({ timeout: B2B_CONFIG.timeouts.closeButtonEnabled });
      await captureStep21('04-close-ready');
      await Promise.all([
        closeBtn.click(),
        page.waitForURL(/\/lightning\/r\/Account\/.*\/view/, { timeout: B2B_CONFIG.timeouts.accountViewUrl }),
        page.waitForLoadState('domcontentloaded'),
      ]);
      log('  ✓ Clicked Close and navigated to Account view');
    }, { timeout: B2B_CONFIG.timeouts.accountViewUrl });
  });

  await runStep(page, 22, 'Wait for Account view ready', async () => {
    await page.waitForLoadState('domcontentloaded');
  });

  await runStep(page, 23, 'Wait for app nav (waffle)', () =>
    find(page, ".slds-icon-waffle (app nav)", () => page.locator('.slds-icon-waffle').waitFor({ timeout: B2B_CONFIG.timeouts.appNavWaffle }), { timeout: B2B_CONFIG.timeouts.appNavWaffle }));
  //END COMMENTED: steps 8–23 
  await runStep(page, 24, 'Save storage state', () =>
    page.context().storageState({ path: authFile }));

  const CART_ID_URL_TIMEOUT_MS = 60000;
  await runStep(page, 25, 'Continue and goto Account / Enterprise Carts / Create Billing Account', async () => {
    await find(page, "button 'Continue'", () => page.getByRole('button', { name: 'Continue' }).click());
    await find(page, "wait for URL to contain cartId", async () => {
      await page.waitForURL(/cartId=/i, { timeout: CART_ID_URL_TIMEOUT_MS });
      urlWithCartId = page.url();
      log(`  URL (with cartId): ${urlWithCartId}`);
    }, { timeout: CART_ID_URL_TIMEOUT_MS });
    await page.goto(urlWithCartId);
    await page.waitForLoadState('domcontentloaded');
    await find(page, "button 'Enterprise Carts Overview'", () => page.getByRole('button', { name: 'Enterprise Carts Overview' }).click());
    await find(page, "button 'Create Billing Account'", () => page.getByRole('button', { name: 'Create Billing Account' }).click());
  });

  await runStep(page, 26, 'Billing Account - Address Search and Next', async () => {
    await find(page, "combobox 'Address Search'", async () => {
      const addr = page.getByRole('combobox', { name: '*Address Search' });
      await addr.click();
      await addr.fill('1451');
      await new Promise((r) => setTimeout(r, 1500));
    });
    await find(page, "text '1451 Ashford Avenue, San Juan'", async () => {
      const suggestion = page.getByText('1451 Ashford Avenue, San Juan').first();
      await suggestion.waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.addressSuggestion });
      await suggestion.click({ timeout: B2B_CONFIG.timeouts.addressSuggestionClick });
    }, { timeout: B2B_CONFIG.timeouts.addressSuggestion });
    const span = page.locator('span').filter({ hasText: 'Ashford Avenue, San Juan, Puerto Rico' }).first();
    const spanVisible = await span.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    if (spanVisible) {
      await find(page, "span 'Ashford Avenue, San Juan, Puerto Rico'", () => span.click({ timeout: 5000, force: true }), { timeout: 5000 });
    } else {
      log('  (Address span not shown – selection may be complete, proceeding to Next)');
    }
    await new Promise((r) => setTimeout(r, 800));
    await find(page, "button 'Next'", async () => {
      const nextBtn = page.getByRole('button', { name: 'Next' });
      await nextBtn.waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.nextButtonVisible });
      await nextBtn.click({ timeout: B2B_CONFIG.timeouts.nextButtonClick });
    }, { timeout: B2B_CONFIG.timeouts.nextButtonVisible });
  });

  const BRAINTREE_IFRAME_WAIT_MS = 60000;
  const BRAINTREE_IFRAME_POLL_MS = 500;
  const BRAINTREE_IFRAME_SETTLE_MS = 3000;
  await runStep(page, 27, 'Billing Account - Braintree payment form', async () => {
    const fillTimeout = { timeout: 20000 };
    await find(page, "wait for Braintree card form (cardholder iframe by name)", async () => {
      const maxPolls = Math.ceil(BRAINTREE_IFRAME_WAIT_MS / BRAINTREE_IFRAME_POLL_MS);
      for (let i = 0; i < maxPolls; i++) {
        if (page.frame({ name: 'braintree-hosted-field-cardholderName' })) break;
        await new Promise((r) => setTimeout(r, BRAINTREE_IFRAME_POLL_MS));
      }
      await new Promise((r) => setTimeout(r, BRAINTREE_IFRAME_SETTLE_MS));
    }, { timeout: BRAINTREE_IFRAME_WAIT_MS });
    const cardholderFrame = page.frame({ name: 'braintree-hosted-field-cardholderName' });
    const numberFrame = page.frame({ name: 'braintree-hosted-field-number' });
    const expFrame = page.frame({ name: 'braintree-hosted-field-expirationDate' });
    const cvvFrame = page.frame({ name: 'braintree-hosted-field-cvv' });
    const postalFrame = page.frame({ name: 'braintree-hosted-field-postalCode' });
    if (!cardholderFrame) throw new Error('Braintree cardholder iframe not found by name');
    const braintreeFillMeta = { timeout: B2B_CONFIG.timeouts.braintreeFill };
    await find(page, "Cardholder Name (iframe)", () =>
      cardholderFrame.getByRole('textbox', { name: 'Cardholder Name' }).fill('Rishi Mahto', fillTimeout), braintreeFillMeta);
    if (numberFrame) await find(page, "Credit Card Number (iframe)", () =>
      numberFrame.getByRole('textbox', { name: 'Credit Card Number' }).fill('4111 1111 1111 1111', fillTimeout), braintreeFillMeta);
    if (expFrame) await find(page, "Expiration Date (iframe)", () =>
      expFrame.getByRole('textbox', { name: 'Expiration Date' }).fill('226', fillTimeout), braintreeFillMeta);
    if (cvvFrame) await find(page, "CVV (iframe)", () =>
      cvvFrame.getByRole('textbox', { name: 'CVV' }).fill('243', fillTimeout), braintreeFillMeta);
    if (postalFrame) await find(page, "Postal Code (iframe)", () =>
      postalFrame.getByRole('textbox', { name: 'Postal Code' }).fill('3431', fillTimeout), braintreeFillMeta);
    const saveBtnContext = cardholderFrame.parentFrame() || page;
    await find(page, "button 'Save Payment Method'", () =>
      saveBtnContext.getByRole('button', { name: 'Save Payment Method' }).click(fillTimeout), braintreeFillMeta);
  });

  await runStep(page, 28, 'Billing Account - Checkboxes and Save', async () => {
    await captureDetail(28, '00-billing-before-checkboxes');
    log('  [28] Clicking first checkbox (faux)...');
    await find(page, "first checkbox (faux)", () => page.locator('.slds-checkbox_faux').first().click());
    await captureDetail(28, '01-after-first-checkbox');
    log('  [28] First checkbox done. Clicking vlocity checkbox (billing)...');
    await find(page, "vlocity checkbox (billing)", () => page.locator('vlocity_cmt-omniscript-checkbox:nth-child(4) > slot > .slds-grid > c-input > .slds-form-element > div:nth-child(2) > .slds-checkbox > .slds-checkbox__label > .slds-checkbox_faux').first().click());
    await captureDetail(28, '02-after-vlocity-checkbox');
    log('  [28] Vlocity checkbox done. Clicking button Save (exact)...');
    await find(page, "button 'Save' (exact)", () => page.getByRole('button', { name: 'Save', exact: true }).click());
    await captureDetail(28, '03-after-save-click');
    log('  [28] Save clicked. Step 28 complete.');
  });

  // Add Product: go to cart URL first so Add Product view is visible, then Add Product / Cart / Catalog / BYOD
  //urlWithCartId="https://cwc--qasales.sandbox.lightning.force.com/lightning/r/Account/001di00000kxncNAAQ/view?c__cartId=0Q0di000001jYg5CAE"
  const STEP29_ACTION_TIMEOUT_MS = B2B_CONFIG.timeouts.addProductAction;
  const GOTO_CART_TIMEOUT_MS = 20000;
  const GOTO_CART_SETTLE_MS = 3000;
  await runStep(page, 29, 'Add Product to Cart (Catalog + BYOD)', async () => {
    let cartFrame = null;
    log('  [29] Step 29 started. urlWithCartId=' + (urlWithCartId ? urlWithCartId : 'NOT SET'));
    await captureDetail(29, '00-step-started');
    if (urlWithCartId) {
      log('  [29] Goto cart URL...');
      await find(page, "goto cart URL (urlWithCartId)", async () => {
        await page.goto(urlWithCartId, { timeout: GOTO_CART_TIMEOUT_MS });
        log('  [29] goto() done. Waiting domcontentloaded...');
        await page.waitForLoadState('domcontentloaded');
        log(`  [29] domcontentloaded done. Settle ${GOTO_CART_SETTLE_MS}ms...`);
        await new Promise((r) => setTimeout(r, GOTO_CART_SETTLE_MS));
        log('  [29] Goto cart URL complete. Current URL: ' + page.url());
      }, { timeout: GOTO_CART_TIMEOUT_MS });
      await captureDetail(29, '01-after-goto-cart-url');
      const tGotoDone = Date.now();
      const INITIAL_CART_WAIT_MS = 20000;
      log('  [29] TRACE: Waiting ' + INITIAL_CART_WAIT_MS / 1000 + 's for cart UI to render...');
      await new Promise((r) => setTimeout(r, INITIAL_CART_WAIT_MS));
      const afterWait = Date.now();
      log('  [29] TIMING: initial wait=' + (afterWait - tGotoDone) + 'ms | elapsed since goto complete=' + (afterWait - tGotoDone) + 'ms');
      const traceButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        return buttons.map((b) => (b.getAttribute('aria-label') || b.textContent || b.innerText || '').trim().slice(0, 80)).filter(Boolean);
      }).catch(() => []);
      log('  [29] TRACE: Button names on page (sample): ' + [...new Set(traceButtons)].slice(0, 30).join(' | '));
      await captureDetail(29, '02-after-cart-ui-wait');
      let cartFrame = null;
      const findCartFrame = async () => {
        const frames = page.frames();
        const childCount = frames.length - 1;
        const t0 = Date.now();
        log('  [29] TRACE: Checking ' + childCount + ' child frame(s) for Catalog...');
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          try {
            const visible = await frame.getByRole('button', { name: 'Add > Catalog' }).first().isVisible({ timeout: 5000 }).catch(() => false);
            if (visible) return frame;
          } catch (_) {}
        }
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          try {
            const visible = await frame.getByRole('button', { name: 'Catalog', exact: true }).first().isVisible({ timeout: 5000 }).catch(() => false);
            if (visible) return frame;
          } catch (_) {}
        }
        log('  [29] TIMING: frame check took ' + (Date.now() - t0) + 'ms (0 frames with Catalog)');
        return null;
      };
      const tFrameStart = Date.now();
      cartFrame = await findCartFrame();
      const childFrameCount = page.frames().length - 1;
      if (!cartFrame && childFrameCount === 0) {
        log('  [29] TIMING: 0 child frames — skipping retry waits, trying main page (shadow DOM) immediately (saves up to 24s)');
      }
      for (let attempt = 1; attempt <= 3 && !cartFrame && childFrameCount > 0; attempt++) {
        if (attempt > 1) {
          log('  [29] TRACE: Attempt ' + attempt + ': no frame with Catalog. Waiting 8s before retry...');
          await new Promise((r) => setTimeout(r, 8000));
        }
        cartFrame = await findCartFrame();
        if (cartFrame) break;
      }
      const tBeforeMain = Date.now();
      if (!cartFrame) {
        log('  [29] TRACE: Trying main page (shadow DOM) for Catalog...');
        const mainCheckStart = Date.now();
        const mainHasCatalog = await page.getByRole('button', { name: 'Catalog', exact: true }).first().isVisible({ timeout: 8000 }).catch(() => false);
        log('  [29] TIMING: main page Catalog check=' + (Date.now() - mainCheckStart) + 'ms');
        if (mainHasCatalog) {
          log('  [29] TRACE: Using main page (Catalog in shadow DOM)');
        } else {
          throw new Error('Cart iframe not found: no frame and no main-page Catalog button after retries');
        }
      } else {
        log('  [29] TRACE: Using cart iframe for catalog actions');
      }
      const tCatalogReady = Date.now();
      log('  [29] TIMING: total from goto complete to Catalog ready = ' + (tCatalogReady - tGotoDone) + 'ms');
      await captureDetail(29, '03-cart-context-ready');
    }



    const cartCtx = cartFrame || page;
    const t = { timeout: STEP29_ACTION_TIMEOUT_MS };
    const step29Meta = { timeout: STEP29_ACTION_TIMEOUT_MS };

    const clickCatalogOpen = async () => {
      const catalogIcon = cartCtx.getByRole('button', { name: 'Catalog', exact: true });
      if (await catalogIcon.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await catalogIcon.click(t);
      } else {
        throw new Error('Catalog (icon) button not visible');
      }
    };

    log('  [29] ─── Catalog: open (first time) ───');
    await find(page, "open catalog (Catalog)", clickCatalogOpen, step29Meta);
    await captureDetail(29, '04-catalog-opened');

    const catalogProductRowName = 'Liberty Business On The Go';
    log('  [29] Catalog: add product "' + catalogProductRowName + '" → Add Product');
    await find(page, `row '${catalogProductRowName}' → Add Product`, async () => {
      const row = cartCtx.locator('.table-row').filter({ hasText: catalogProductRowName });
      await row.getByRole('button', { name: 'Add Product' }).waitFor({ state: 'visible', timeout: t.timeout });
      await row.getByRole('button', { name: 'Add Product' }).click(t);
    }, step29Meta);
    await captureDetail(29, '05-after-liberty-add-product');

    log('  [29] Cart: Add > Cart');
    await find(page, "button 'Add > Cart'", () => cartCtx.getByRole('button', { name: 'Add > Cart' }).click(t), step29Meta);
    await captureDetail(29, '06-after-first-add-to-cart');

    log('  [29] ─── Catalog: open again (for BYOD) ───');
    await new Promise((r) => setTimeout(r, 2000));
    const waitForCatalogPanel = async (timeoutMs = 15000) => {
      const byodCategory = cartCtx.getByRole('button', { name: /BYOD/i }).first();
      await byodCategory.waitFor({ state: 'visible', timeout: timeoutMs });
    };
    let catalogPanelOpened = false;
    for (let attempt = 1; attempt <= 3 && !catalogPanelOpened; attempt++) {
      log('  [29]   Attempt ' + attempt + '/3: click Catalog icon');
      await find(page, "open catalog (Catalog)", clickCatalogOpen, step29Meta);
      log('  [29]   Waiting for BYOD category (max 12s)');
      const opened = await waitForCatalogPanel(12000).then(() => true).catch(() => false);
      if (opened) {
        catalogPanelOpened = true;
        log('  [29]   OK — catalog panel open, BYOD visible');
        break;
      }
      log('  [29]   Panel not open, retry in 2s');
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!catalogPanelOpened) throw new Error('Catalog panel did not open after 3 attempts (BYOD category never visible)');
    await new Promise((r) => setTimeout(r, 2000));
    await captureDetail(29, '07-catalog-opened-again');
    log('  [29] Clicking BYOD category...');
    await find(page, "BYOD category (button)", async () => {
      const byodCategory = cartCtx.getByRole('button', { name: /BYOD/i }).first();
      await byodCategory.waitFor({ state: 'visible', timeout: t.timeout });
      await byodCategory.click(t);
    }, step29Meta);
    await captureDetail(29, '08-after-byod-category');
    log('  [29] BYOD category clicked. Finding row BYOD Basic Phone and clicking Add Product in that row...');
    const byodProductRowName = 'BYOD Mobile Phone';
    await find(page, `row '${byodProductRowName}' → Add Product`, async () => {
      const row = cartCtx.locator('.table-row').filter({ hasText: byodProductRowName });
      await row.getByRole('button', { name: 'Add Product' }).waitFor({ state: 'visible', timeout: t.timeout });
      log('  [29] Add Product in BYOD row visible. Clicking...');
      await row.getByRole('button', { name: 'Add Product' }).click(t);
      log('  [29] Add Product (BYOD row) clicked.');
    }, step29Meta);
    await captureDetail(29, '09-after-byod-add-product');
    await new Promise((r) => setTimeout(r, 30000));
    log('  [29] Clicking Add > Cart again...');
    await find(page, "button 'Add > Cart' again", () => cartCtx.getByRole('button', { name: 'Add > Cart' }).click(t), step29Meta);
    await new Promise((r) => setTimeout(r, 3000));
    await captureDetail(29, '10-after-second-add-to-cart');
    const SHOW_ACTIONS_BUTTON_TEXT = 'Show actions';
    const LIBERTY_ROW_PRODUCT_NAME = 'Liberty Business On The Go';
    log('  [29] Show actions in row "' + LIBERTY_ROW_PRODUCT_NAME + '" – clicking button: "' + SHOW_ACTIONS_BUTTON_TEXT + '"');
    await find(page, "Show actions (Liberty Business On The Go row)", async () => {
      const libertyRow = cartCtx.locator('div.slds-grid.slds-wrap').filter({ hasText: LIBERTY_ROW_PRODUCT_NAME }).first();
      await libertyRow.getByRole('button', { name: SHOW_ACTIONS_BUTTON_TEXT }).first().click(t);
    }, step29Meta);
    log('  [29] Step 29 complete.');
  });

  await runStep(page, 30, 'SIM & Device Info - MSISDN and Reserve', async () => {
    await find(page, "menuitem 'SIM & Device Info'", () => page.getByRole('menuitem', { name: 'SIM & Device Info' }).click());
    await find(page, "textbox 'MSISDN Count'", async () => {
      await page.getByRole('textbox', { name: 'MSISDN Count' }).click();
      await page.getByRole('textbox', { name: 'MSISDN Count' }).fill('999');
    });
    await find(page, "click elsewhere (so Retrieve appears)", async () => {
      await page.keyboard.press('Tab');
      await new Promise((r) => setTimeout(r, 500));
    });
    await find(page, "button 'Retrieve' (wait visible then click)", async () => {
      await page.getByRole('button', { name: 'Retrieve' }).waitFor({ state: 'visible', timeout: 30000 });
      await page.getByRole('button', { name: 'Retrieve' }).click();
    }, { timeout: 35000 });
    await new Promise((r) => setTimeout(r, 4000));

    await find(page, "first Add icon (+)", async () => {
      const candidates = [
        page.locator('vlocity_cmt-flex-icon').filter({ has: page.locator('use[href*="svg_new"]') }).first(),
        page.locator('vlocity_cmt-flex-icon').filter({ has: page.locator('use[href*="new"]') }).first(),
        page.locator('vlocity_cmt-flex-icon').filter({ has: page.locator('svg.slds-icon') }).first(),
        page.locator('vlocity_cmt-flex-icon').filter({ has: page.locator('use') }).first(),
        page.locator('vlocity_cmt-flex-icon[data-element-label="block2icon0"]').first(),
        page.locator('vlocity_cmt-flex-icon').first(),
      ];
      for (const el of candidates) {
        if (await el.isVisible({ timeout: 4000 }).catch(() => false)) {
          await el.click({ force: true });
          return;
        }
      }
      throw new Error('First Add icon (+) not found');
    }, { timeout: 25000 });
    await new Promise((r) => setTimeout(r, 1500));
    await find(page, "button 'Reserve MSISDN' (wait enabled then click)", async () => {
      await page.getByRole('button', { name: 'Reserve MSISDN' }).waitFor({ state: 'visible', timeout: 20000 });
      await page.getByRole('button', { name: 'Reserve MSISDN' }).click();
    }, { timeout: 25000 });
    await find(page, "text 'Dynamic eSim'", () => page.getByText('Dynamic eSim', { exact: true }).nth(1).click());
    await find(page, "text 'updating ICCID...'", () => page.getByText('updating ICCID...', { exact: true }).click());
    await find(page, "checkout icon", () => page.locator('.checkout-icon > span > lightning-primitive-icon > .slds-icon').click());
  });

  await runStep(page, 31, 'Store Order and Checkout flow', async () => {
    await find(page, "text 'Store Order'", () => page.getByText('Store Order', { exact: true }).click());
    await find(page, "text 'Checking stock...' (wait visible then click)", async () => {
      await page.getByText('Checking stock...', { exact: true }).waitFor({ state: 'visible', timeout: B2B_CONFIG.timeouts.defaultLocator });
      await page.getByText('Checking stock...', { exact: true }).click();
    }, { timeout: B2B_CONFIG.timeouts.defaultLocator });
    await find(page, "combobox 'Select Contacts'", () => page.getByRole('combobox', { name: 'Select Contacts' }).click());
    await find(page, "span 'Test Auto'", () => page.locator('span').filter({ hasText: 'Test Auto' }).first().click());
    await find(page, "first checkbox", () => page.locator('.slds-checkbox_faux').first().click());
    await find(page, "button 'Continue'", () => page.getByRole('button', { name: 'Continue' }).click());
    await find(page, "checkbox and Continue again", async () => {
      await page.locator('.slds-checkbox_faux').first().click();
      await page.getByRole('button', { name: 'Continue' }).click();
    });
    await find(page, "button 'Check Payment Status'", () => page.getByRole('button', { name: 'Check Payment Status' }).click());
    await find(page, "button 'Next'", () => page.getByRole('button', { name: 'Next' }).click());
    await find(page, "button 'Create Orders' (exact)", () => page.getByRole('button', { name: 'Create Orders', exact: true }).click());
  });

  await runStep(page, 32, 'Refresh until ready, Submit Orders, Close', async () => {
    const refreshBtn = page.getByRole('button', { name: 'Refresh' });
    for (let i = 0; i < 18; i++) {
      await refreshBtn.click().catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
    }
    await find(page, "button 'Submit Orders'", () => page.getByRole('button', { name: 'Submit Orders' }).click());
    await find(page, "tab Close button", () => page.locator('#tab-3').getByRole('button', { name: 'Close' }).click());
    await refreshBtn.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    await refreshBtn.click().catch(() => {});
  });

  log('DONE - B2B Flow completed successfully');
  } finally {
    const runDurationMs = Date.now() - runStartMs;
    const h = Math.floor(runDurationMs / 3600000);
    const m = Math.floor((runDurationMs % 3600000) / 60000);
    const s = Math.floor((runDurationMs % 60000) / 1000);
    const hhmmss = [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
    log(`Total run time: ${hhmmss} (${runDurationMs}ms)`);
    if (b2bRunStats && b2bRunStats.steps.length > 0) {
      const { totalActionMs, totalScreenshotMs } = b2bRunStats;
      const otherMs = runDurationMs - totalActionMs - totalScreenshotMs;
      log(`Run summary: stepsActionMs=${totalActionMs} screenshotsSettleMs=${totalScreenshotMs} otherMs=${otherMs} (navigate/tabs/pdf)`);
    }
    try {
      const pdfPath = await buildB2BReportPdf(outDir, log);
      if (pdfPath) log(`Full run report (all success/failure screenshots): ${pdfPath}`);
    } catch (e) {
      log(`PDF report failed: ${e.message}`);
    }
    try {
      let video = null;
      if (typeof testInfo.video === 'function') {
        video = await testInfo.video();
      } else if (testInfo.video) {
        video = testInfo.video;
      }
      if (!video && page && !page.isClosed?.()) {
        try {
          video = page.video?.() ?? null;
        } catch (_) {}
      }
      if (video && typeof video.path === 'function') {
        const videoPath = await Promise.resolve(video.path());
        if (videoPath) {
          log(`Video saved: ${videoPath}`);
          const dest = path.join(outDir, 'b2b-recording.webm');
          await copyFile(videoPath, dest);
          log(`Video also copied to: ${dest}`);
        }
      } else {
        log('Video: not recorded (video not available; ensure video: "on" in playwright.config.js)');
      }
    } catch (e) {
      log(`Video path/copy: ${e.message}`);
    }
    b2bStatsFilePath = null;
    b2bRunStats = null;
  }
});