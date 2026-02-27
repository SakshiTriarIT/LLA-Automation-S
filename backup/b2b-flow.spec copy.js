/**
 * B2B Flow test. Runs after login (uses session from .auth/salesforce-auth.json).
 * Live debugging:
 *   - Timestamp on every log line [HH:mm:ss.SSS].
 *   - START/OK/FAILED + duration; OK includes current URL so you see "where we are".
 *   - On failure: screenshot saved and path logged; attached to test report.
 *   - "→ Locate: X" / "✗ ELEMENT NOT FOUND: X" for which element ran or failed.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.resolve(__dirname, '..', '.auth', 'salesforce-auth.json');

/**
 * Build a PDF report with all step screenshots (success + failure) from this run.
 * Saves to outputDir as b2b-run-<timestamp>.pdf
 */
async function buildB2BReportPdf(outputDir, logFn = () => {}) {
  if (!existsSync(outputDir)) return null;
  const stepMain = readdirSync(outputDir).filter((f) => /^step-\d+-(ok|fail)\.png$/.test(f));
  const step21Details = readdirSync(outputDir).filter((f) => /^step-21-.+\.png$/.test(f));
  const entries = stepMain.map((f) => {
    const m = f.match(/^step-(\d+)-(ok|fail)\.png$/);
    return { step: parseInt(m[1], 10), status: m[2], file: f, sortKey: `${m[1].padStart(3, '0')}-0-${f}` };
  });
  step21Details.sort().forEach((f) => entries.push({ step: 21, status: 'detail', file: f, sortKey: `021-1-${f}` }));
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

/** Log with [B2B][HH:mm:ss.SSS] prefix */
const log = (msg) => console.log(`[B2B][${ts()}]`, msg);

/**
 * Run an action that locates/uses an element. Logs which element we're looking for;
 * on failure logs "ELEMENT NOT FOUND: description" so you know exactly which locator failed.
 */
async function find(page, elementDescription, fn) {
  log(`  → Locate: ${elementDescription}`);
  try {
    await fn();
  } catch (err) {
    log(`  ✗ ELEMENT NOT FOUND / FAILED: ${elementDescription}`);
    log(`  ✗ Error: ${err.message}`);
    throw err;
  }
}

/** Wait this long before taking success screenshot so the page can finish rendering (avoids capturing splash/loading). */
const SCREENSHOT_SETTLE_MS = 2500;

/**
 * Run a named step. Logs START, then OK (with duration + URL) or FAILED (with screenshot path).
 * testInfo optional: if provided, screenshot on failure is saved and attached to the report.
 * outputDir optional: when set (timestamped B2B run folder), screenshots go here instead of testInfo.outputDir.
 */
async function step(page, stepNum, stepName, fn, testInfo = null, outputDir = null) {
  const outDir = outputDir || testInfo?.outputDir || path.join(__dirname, '..', 'test-results');
  const start = Date.now();
  log(`START ${stepNum}. ${stepName}`);
  try {
    await fn();
    const ms = Date.now() - start;
    const url = page?.url?.() ?? '?';
    log(`OK ${stepNum}. ${stepName} (${ms}ms) RAN | URL: ${url}`);
    if (testInfo && page && !page.isClosed?.()) {
      try {
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await new Promise((r) => setTimeout(r, SCREENSHOT_SETTLE_MS));
        const name = `step-${stepNum}-ok.png`;
        const outPath = path.join(outDir, name);
        await page.screenshot({ path: outPath, fullPage: true });
        log(`Success screenshot: ${outPath}`);
        await testInfo.attach(name, { path: outPath });
      } catch (e) {
        log(`Success screenshot failed: ${e.message}`);
      }
    }
  } catch (err) {
    const ms = Date.now() - start;
    const url = page?.url?.() ?? 'no page';
    log(`FAILED ${stepNum}. ${stepName} after ${ms}ms | URL: ${url}`);
    log(`Error: ${err.message}`);
    if (testInfo && page && !page.isClosed?.()) {
      try {
        const name = `step-${stepNum}-fail.png`;
        const outPath = path.join(outDir, name);
        await page.screenshot({ path: outPath, fullPage: true });
        log(`Screenshot saved: ${outPath}`);
        await testInfo.attach(name, { path: outPath });
      } catch (e) {
        log(`Screenshot failed: ${e.message}`);
      }
    }
    throw new Error(`B2B step ${stepNum} "${stepName}" failed: ${err.message}`);
  }
}

// Verification tabs: let them load then close. Salesforce tabs: keep open.
const VERIFICATION_TAB_URLS = /suri\.hacienda\.pr\.gov|hacienda\.pr\.gov/;
const KEEP_OPEN_URLS = /salesforce|lightning|one\.one/;

test('B2B Flow', async ({ page, context }, testInfo) => {
  const outDir = testInfo.outputDir;
  log(`Run output folder: ${outDir}`);
  const runStep = (p, num, name, fn) => step(p, num, name, fn, testInfo, outDir);
  let urlWithCartId;
  const captureStep21 = async (label) => {
    const name = `step-21-${label}.png`;
    const outPath = path.join(outDir, name);
    await page.screenshot({ path: outPath, fullPage: true });
    log(`  Step 21 screenshot: ${outPath}`);
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

  await runStep(page, 1, 'Goto Lightning home', () =>
    page.goto('https://cwc--qasales.sandbox.lightning.force.com/lightning/page/home'));
  await runStep(page, 2, 'Wait for one-appnav', () =>
    find(page, "selector 'one-appnav'", () => page.waitForSelector('one-appnav', { timeout: 60000 })));
  await runStep(page, 3, 'Goto Setup Manage Users', () =>
    page.goto('https://cwc--qasales.sandbox.my.salesforce-setup.com/lightning/setup/ManageUsers/page?address=%2F00574000001KtCH%3Fnoredirect%3D1%26isUserEntityOverride%3D1'));
  await runStep(page, 4, 'Wait for setup page load', () =>
    page.waitForLoadState('domcontentloaded'));

  const frame = page.frameLocator('iframe');
  const userDetailRow = frame.getByRole('row', { name: /User Detail/i });
  const loginBtn = userDetailRow.locator('input[name="login"]');

  // If already logged in as the target user, Setup page shows User Detail but no "Login" button → skip to step 8
  const loginBtnVisible = await loginBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (loginBtnVisible) {
    await runStep(page, 5, 'Wait for Login button in User Detail row', () =>
      find(page, "iframe → row 'User Detail' → input[name=login]", () => loginBtn.waitFor({ state: 'visible', timeout: 120000 })));
    await runStep(page, 6, 'Click Login (switch user)', () =>
      find(page, "Login button (click) + wait navigation", () =>
        Promise.all([
          page.waitForNavigation({ timeout: 120000 }),
          loginBtn.click()
        ])));
    await runStep(page, 7, 'Wait for Lightning URL after switch', () =>
      page.waitForURL(/lightning|one\.one/, { timeout: 120000 }));
    log('Login As User successful');
  } else {
    log('Already logged in as user (no Login button on Setup) → skipping steps 5–7, going to B2B Quick Sales');
  }

  await runStep(page, 8, 'Goto B2B Quick Sales', () =>
    page.goto('https://cwc--qasales.sandbox.lightning.force.com/lightning/n/B2BQuickSales'));
  await runStep(page, 9, 'Click New', () =>
    find(page, "button 'New'", () => page.getByRole('button', { name: 'New' }).click()));

  await runStep(page, 10, 'Fill Company, Industry, Account Type', async () => {
    await find(page, "textbox '*Company'", () => page.getByRole('textbox', { name: '*Company' }).fill('test'));
    await find(page, "combobox '*Industry'", () => page.getByRole('combobox', { name: '*Industry' }).click());
    await find(page, "text 'Air Services'", () => page.getByText('Air Services').click());
    await find(page, "combobox '*Account Type'", () => page.getByRole('combobox', { name: '*Account Type' }).click());
    await find(page, "listbox .slds-listbox:visible", async () => {
      const listbox = page.locator('.slds-listbox:visible').last();
      await listbox.waitFor();
      await listbox.locator('[data-value="SOHO/Small"]').click();
    });
  });

  await runStep(page, 11, 'Fill contact fields', async () => {
    await find(page, "textbox 'Social Security Number'", () => page.getByRole('textbox', { name: 'Social Security Number' }).fill('223344556'));
    await find(page, "combobox 'Salutation'", () => page.getByRole('combobox', { name: 'Salutation' }).click());
    await find(page, "text 'Mr' (exact)", () => page.getByText('Mr', { exact: true }).click());
    await find(page, "textbox '*First Name'", () => page.getByRole('textbox', { name: '*First Name' }).fill('test'));
    await find(page, "textbox '*Last Name'", () => page.getByRole('textbox', { name: '*Last Name' }).fill('Auto'));
    await find(page, "textbox '*Phone'", () => page.getByRole('textbox', { name: '*Phone' }).fill('(123) 456-7890'));
    await find(page, "textbox '*Email'", () => page.getByRole('textbox', { name: '*Email' }).fill('testauto@gmail.com'));
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
  await runStep(page, 17, 'Wait 05s after Business License Verify', () =>
    page.waitForTimeout(5000));

  //await runStep(page, 18, 'Create Contact', () =>
 //   find(page, "button 'Create Contact'", () => page.getByRole('button', { name: 'Create Contact' }).click()));
  await runStep(page, 19, 'Wait for spinner hidden', () =>
    find(page, ".spinner-overlay (wait hidden)", () => page.locator('.spinner-overlay').waitFor({ state: 'hidden', timeout: 20000 })));
  await runStep(page, 20, 'Proceed to Credit Check', () =>
    find(page, "button 'Proceed to Credit Check'", () => page.getByRole('button', { name: 'Proceed to Credit Check' }).click()));

  await runStep(page, 21, 'Credit Check screen - Default then Close', async () => {
    await find(page, "Credit Check modal (wait for title + Tax Number + Close)", async () => {
      await page.getByText('Credit Check', { exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
      await page.getByText('Tax Number:').first().waitFor({ state: 'visible', timeout: 15000 });
      await page.getByRole('button', { name: 'Close' }).first().waitFor({ state: 'visible', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 2000));
      await captureStep21('01-modal-visible');
    });
    await find(page, "Credit Check: wait for spinners hidden + settle", async () => {
      await page.locator('.slds-spinner_container').waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {});
      await page.locator('[class*="spinner"]').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 4000));
      await captureStep21('02-after-spinners');
    });
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
      await closeBtn.waitFor({ state: 'visible', timeout: 60000 });
      await expect(closeBtn).toBeEnabled({ timeout: 60000 });
      await captureStep21('04-close-ready');
      await Promise.all([
        closeBtn.click(),
        page.waitForURL(/\/lightning\/r\/Account\/.*\/view/, { timeout: 60000 }),
        page.waitForLoadState('domcontentloaded'),
      ]);
      log('  ✓ Clicked Close and navigated to Account view');
    });
  });

  await runStep(page, 22, 'Wait for Account view ready', async () => {
    await page.waitForLoadState('domcontentloaded');
  });

  await runStep(page, 23, 'Wait for app nav (waffle)', () =>
    find(page, ".slds-icon-waffle (app nav)", () => page.locator('.slds-icon-waffle').waitFor({ timeout: 600000 })));
  await runStep(page, 24, 'Save storage state', () =>
    page.context().storageState({ path: authFile }));

  const CART_ID_URL_TIMEOUT_MS = 60000;
  await runStep(page, 25, 'Continue and goto Account / Enterprise Carts / Create Billing Account', async () => {
    await find(page, "button 'Continue'", () => page.getByRole('button', { name: 'Continue' }).click());
    await find(page, "wait for URL to contain cartId", async () => {
      await page.waitForURL(/cartId=/i, { timeout: CART_ID_URL_TIMEOUT_MS });
      urlWithCartId = page.url();
      log(`  URL (with cartId): ${urlWithCartId}`);
    });
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
      await suggestion.waitFor({ state: 'visible', timeout: 15000 });
      await suggestion.click({ timeout: 10000 });
    });
    const span = page.locator('span').filter({ hasText: 'Ashford Avenue, San Juan, Puerto Rico' }).first();
    const spanVisible = await span.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    if (spanVisible) {
      await find(page, "span 'Ashford Avenue, San Juan, Puerto Rico'", () => span.click({ timeout: 5000, force: true }));
    } else {
      log('  (Address span not shown – selection may be complete, proceeding to Next)');
    }
    await new Promise((r) => setTimeout(r, 800));
    await find(page, "button 'Next'", async () => {
      const nextBtn = page.getByRole('button', { name: 'Next' });
      await nextBtn.waitFor({ state: 'visible', timeout: 15000 });
      await nextBtn.click({ timeout: 10000 });
    });
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
    });
    const cardholderFrame = page.frame({ name: 'braintree-hosted-field-cardholderName' });
    const numberFrame = page.frame({ name: 'braintree-hosted-field-number' });
    const expFrame = page.frame({ name: 'braintree-hosted-field-expirationDate' });
    const cvvFrame = page.frame({ name: 'braintree-hosted-field-cvv' });
    const postalFrame = page.frame({ name: 'braintree-hosted-field-postalCode' });
    if (!cardholderFrame) throw new Error('Braintree cardholder iframe not found by name');
    await find(page, "Cardholder Name (iframe)", () =>
      cardholderFrame.getByRole('textbox', { name: 'Cardholder Name' }).fill('Rishi Mahto', fillTimeout));
    if (numberFrame) await find(page, "Credit Card Number (iframe)", () =>
      numberFrame.getByRole('textbox', { name: 'Credit Card Number' }).fill('4111 1111 1111 1111', fillTimeout));
    if (expFrame) await find(page, "Expiration Date (iframe)", () =>
      expFrame.getByRole('textbox', { name: 'Expiration Date' }).fill('226', fillTimeout));
    if (cvvFrame) await find(page, "CVV (iframe)", () =>
      cvvFrame.getByRole('textbox', { name: 'CVV' }).fill('243', fillTimeout));
    if (postalFrame) await find(page, "Postal Code (iframe)", () =>
      postalFrame.getByRole('textbox', { name: 'Postal Code' }).fill('3431', fillTimeout));
    const saveBtnContext = cardholderFrame.parentFrame() || page;
    await find(page, "button 'Save Payment Method'", () =>
      saveBtnContext.getByRole('button', { name: 'Save Payment Method' }).click(fillTimeout));
  });

  await runStep(page, 28, 'Billing Account - Checkboxes and Save', async () => {
    await find(page, "first checkbox (faux)", () => page.locator('.slds-checkbox_faux').first().click());
    await find(page, "vlocity checkbox (billing)", () => page.locator('vlocity_cmt-omniscript-checkbox:nth-child(4) > slot > .slds-grid > c-input > .slds-form-element > div:nth-child(2) > .slds-checkbox > .slds-checkbox__label > .slds-checkbox_faux').first().click());
    await find(page, "button 'Save' (exact)", () => page.getByRole('button', { name: 'Save', exact: true }).click());
  });

  /**const STEP30_ACTION_TIMEOUT_MS = 30000; 
  await runStep(page, 29, 'New Opportunity and Continue to Cart', async () => {
    await find(page, "text 'New Opportunity'", () => page.getByText('New Opportunity', { exact: true }).click());
    await find(page, "button 'Continue'", () => page.getByRole('button', { name: 'Continue' }).click());
    await page.goto('https://cwc--qasales.sandbox.lightning.force.com/lightning/r/Account/001di00000kXT3HAAW/view?c__cartId=0Q0di000001iij7CAA');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle').catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
  });
*/

  await runStep(page, 29, 'Continue to Cart', async () => {
   // await find(page, "text 'New Opportunity'", () => page.getByText('New Opportunity', { exact: true }).click());
   // await find(page, "button 'Continue'", () => page.getByRole('button', { name: 'Continue' }).click());
    if (!urlWithCartId) throw new Error('urlWithCartId is not set from step 25');
    await page.goto(urlWithCartId);
    await page.waitForLoadState('domcontentloaded');
    log(`Navigated:xxxx`);
   // await page.waitForLoadState('networkidle').catch(() => {});
   // log(`Navigated:yyyy`);
    //await new Promise((r) => setTimeout(r, 3000));
  });

 const STEP30_ACTION_TIMEOUT_MS = 5000;
  await runStep(page, 30, 'Add Product to Cart (Catalog + BYOD)', async () => {
    const t = { timeout: STEP30_ACTION_TIMEOUT_MS };
    const addProductBtn = page.getByRole('button', { name: 'Add Product' });
    await find(page, "button 'Add Product' (nth 5)", async () => {
      await addProductBtn.nth(5).waitFor({ state: 'visible', timeout: t.timeout });
      await addProductBtn.nth(5).click(t);
    });
    await find(page, "button 'Add > Cart'", () => page.getByRole('button', { name: 'Add > Cart' }).click(t));
    await find(page, "button 'Catalog'", () => page.getByRole('button', { name: 'Catalog' }).click(t));
    await find(page, "button 'BYOD'", () => page.getByRole('button', { name: 'BYOD' }).click(t));
    await find(page, "button 'Add Product' (nth 5) again", async () => {
      await addProductBtn.nth(5).waitFor({ state: 'visible', timeout: t.timeout });
      await addProductBtn.nth(5).click(t);
    });
    await find(page, "button 'Add > Cart' again", () => page.getByRole('button', { name: 'Add > Cart' }).click(t));
  });

  await runStep(page, 31, 'SIM & Device Info - MSISDN and Reserve', async () => {
    await find(page, "button 'Show actions'", () => page.getByRole('button', { name: 'Show actions' }).first().click());
    await find(page, "menuitem 'SIM & Device Info'", () => page.getByRole('menuitem', { name: 'SIM & Device Info' }).click());
    await find(page, "textbox 'MSISDN Count'", async () => {
      await page.getByRole('textbox', { name: 'MSISDN Count' }).click();
      await page.getByRole('textbox', { name: 'MSISDN Count' }).fill('999');
    });
    await find(page, "button 'Retrieve'", () => page.getByRole('button', { name: 'Retrieve' }).click());
    await find(page, "button 'Last page'", () => page.getByRole('button', { name: 'Last page' }).click());
    await find(page, "button 'Previous page'", () => page.getByRole('button', { name: 'Previous page' }).click());
    await find(page, "flex icon (reserve)", () => page.locator('vlocity_cmt-flex-card-state:nth-child(10) > .slds-grid.slds-wrap.slds-m-left_xx-small > .slds-col.slds-border_top > vlocity_cmt-block > .slds-grid > div:nth-child(2) > vlocity_cmt-flex-icon > .slds-icon > use').click());
    await find(page, "button 'Reserve MSISDN'", () => page.getByRole('button', { name: 'Reserve MSISDN' }).click());
    await find(page, "text 'Dynamic eSim'", () => page.getByText('Dynamic eSim', { exact: true }).nth(1).click());
    await find(page, "text 'updating ICCID...'", () => page.getByText('updating ICCID...', { exact: true }).click());
    await find(page, "checkout icon", () => page.locator('.checkout-icon > span > lightning-primitive-icon > .slds-icon').click());
  });

  await runStep(page, 32, 'Store Order and Checkout flow', async () => {
    await find(page, "text 'Store Order'", () => page.getByText('Store Order', { exact: true }).click());
    await find(page, "text 'Checking stock...' (wait visible then click)", async () => {
      await page.getByText('Checking stock...', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
      await page.getByText('Checking stock...', { exact: true }).click();
    });
    await find(page, "combobox 'Select Contacts'", () => page.getByRole('combobox', { name: 'Select Contacts' }).click());
    await find(page, "span 'Test NBF'", () => page.locator('span').filter({ hasText: 'Test NBF' }).first().click());
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

  await runStep(page, 33, 'Refresh until ready, Submit Orders, Close', async () => {
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
    try {
      const pdfPath = await buildB2BReportPdf(outDir, log);
      if (pdfPath) log(`Full run report (all success/failure screenshots): ${pdfPath}`);
    } catch (e) {
      log(`PDF report failed: ${e.message}`);
    }
  }
});