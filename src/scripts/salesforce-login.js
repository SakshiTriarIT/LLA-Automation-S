/**
 * Salesforce login with session cookie persistence.
 * Uses a non-private Chromium browser and saves cookies so that:
 * - First run: prompts for username/password; if Salesforce shows OTP, complete it in the browser, then session is saved.
 * - Next runs: reuses saved session → no login, no OTP (OTP only on new session/new IP/private window).
 *
 * Usage:
 *   Set SF_USERNAME and SF_PASSWORD in .env or environment.
 *   npm run login          # headless
 *   npm run login:headed   # visible browser (for first-time OTP entry)
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

/** Read saved state file and return { cookies, lightningBaseUrl }. */
function loadStateFile(statePath) {
  try {
    const raw = readFileSync(statePath, 'utf8');
    const data = JSON.parse(raw);
    const cookies = data.cookies || [];
    const lightningCookie = cookies.find((c) => c.domain && c.domain.includes('lightning.force.com'));
    const lightningBaseUrl = lightningCookie && lightningCookie.domain ? `https://${lightningCookie.domain}` : null;
    return { cookies, lightningBaseUrl };
  } catch {
    return { cookies: [], lightningBaseUrl: null };
  }
}

function waitForEnter(msg = 'Press Enter to close the browser...') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(msg, () => { rl.close(); resolve(); }));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../../');
// Load .env: try project root first, then cwd (so it works from any run directory)
config({ path: resolve(projectRoot, '.env') });
config();

const SALESFORCE_URL = 'https://test.salesforce.com/';
const SALESFORCE_HOME_URL = 'https://test.salesforce.com/lightning/page/home';
const AUTH_DIR = resolve(projectRoot, '.auth');
const BROWSER_PROFILE_DIR = resolve(AUTH_DIR, 'browser-profile');
const STATE_FILE = resolve(AUTH_DIR, 'salesforce-auth.json');
const HEADED = process.argv.includes('--headed');
const DEBUG = process.argv.includes('--debug');
const log = (...args) => DEBUG && console.log('[debug]', ...args);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const username = (process.env.SF_USERNAME || '').trim();
  const password = (process.env.SF_PASSWORD || '').trim();

  if (!username || !password) {
    console.error('Set SF_USERNAME and SF_PASSWORD in .env (in the project root).');
    console.error('Current .env lookup: project root =', projectRoot);
    process.exit(1);
  }
  console.log('Using credentials from .env (username length:', username.length, ')');

  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
  if (!existsSync(BROWSER_PROFILE_DIR)) {
    mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
  }

  // Always use persistent context (real profile) so the browser opens as a normal window, not private/incognito.
  // Create the profile dir first so the browser treats it as a real profile (important on Mac).
  const hasSavedState = existsSync(STATE_FILE);
  let context;
  let savedStateData = null;

  const persistentContextOptions = {
    headless: !HEADED,
    viewport: null,
    ignoreHTTPSErrors: true,
    // Force normal (non-guest, non-incognito) window on all platforms, especially Mac
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--start-maximized',
    ],
    permissions: ['geolocation'],
    geolocation: { longitude: -66.1057, latitude: 18.2208 },
  };

  for (const channel of ['chrome', 'msedge']) {
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        ...persistentContextOptions,
        channel,
      });
      log('Using browser channel:', channel);
      break;
    } catch {
      continue;
    }
  }
  if (!context) {
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, persistentContextOptions);
    log('Using browser: bundled Chromium');
  }

  if (hasSavedState) {
    savedStateData = loadStateFile(STATE_FILE);
    if (savedStateData.cookies.length > 0) {
      await context.addCookies(savedStateData.cookies);
      console.log('Loaded saved session from', STATE_FILE);
    }
  }

  let page = context.pages()[0];
  if (!page) page = await context.newPage();

  try {
    let loginFilled = false;
    let isLoggedInUrl = false;

    if (hasSavedState && savedStateData && savedStateData.lightningBaseUrl) {
      // Open dashboard directly using the Lightning URL from saved cookies (session is on that domain).
      const dashboardUrl = `${savedStateData.lightningBaseUrl}/lightning/page/home`;
      console.log('Loading saved session and opening dashboard...');
      log('Dashboard URL from state:', dashboardUrl);
      await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await delay(3000);
      const currentUrl = page.url();
      isLoggedInUrl = !currentUrl.includes('login') && (currentUrl.includes('lightning') || currentUrl.includes('my.salesforce.com'));
      log('URL after loading saved state:', currentUrl, 'isLoggedInUrl:', isLoggedInUrl);
      if (isLoggedInUrl) {
        console.log('Already logged in. Dashboard opened.');
      }
    } else if (hasSavedState) {
      // State file had no Lightning URL; go to generic login and let redirect happen
      await page.goto(SALESFORCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await delay(3000);
      const currentUrl = page.url();
      isLoggedInUrl = !currentUrl.includes('login') && (currentUrl.includes('lightning') || currentUrl.includes('my.salesforce.com'));
      if (isLoggedInUrl) {
        console.log('Already logged in.');
      }
    }

    if (!isLoggedInUrl) {
      // No saved state or session expired: go to login page
      await page.goto(SALESFORCE_URL, { waitUntil: 'load', timeout: 60000 });
      log('URL after goto:', page.url());
      await delay(5000);
      const currentUrl = page.url();
      isLoggedInUrl = /lightning|home\.jsp|\.com\/home|Setup|secur\/frontdoor|salesforce\.com\/[a-z0-9]{15}/i.test(currentUrl) ||
        (currentUrl.includes('salesforce.com') && !currentUrl.includes('/login') && currentUrl !== SALESFORCE_URL);
      log('URL after wait:', currentUrl, 'isLoggedInUrl:', isLoggedInUrl);
      if (isLoggedInUrl) {
        console.log('Already logged in. Opening dashboard...');
        await page.goto(SALESFORCE_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
    }

    if (!isLoggedInUrl) {
      // Run inside a frame: wait for login inputs, fill and submit. Returns { done, message }.
      const fillLoginInFrame = async (frame, user, pass) => {
      return frame.evaluate(
        ({ username, password }) => {
          const find = (sel) => document.querySelector(sel);
          const u = find('input#username') || find('input[name="username"]') || find('input.username') || find('input[type="email"]');
          const p = find('input#password') || find('input[name="pw"]') || find('input[type="password"]');
          if (!u || !p) return { done: false, message: !u ? 'no username field' : 'no password field' };
          u.focus();
          u.value = username;
          u.dispatchEvent(new Event('input', { bubbles: true }));
          u.dispatchEvent(new Event('change', { bubbles: true }));
          p.focus();
          p.value = password;
          p.dispatchEvent(new Event('input', { bubbles: true }));
          p.dispatchEvent(new Event('change', { bubbles: true }));
          const btn = find('input#Login') || find('input[name="Login"]') || find('button[type="submit"]') || find('input[type="submit"]');
          if (btn) {
            btn.click();
            return { done: true, message: 'submitted' };
          }
          const form = find('form#login_form') || find('form[name="login"]') || u.closest('form');
          if (form) {
            form.submit();
            return { done: true, message: 'form submitted' };
          }
          return { done: true, message: 'filled, no button' };
        },
        { username: user, password: pass }
      );
    };

    // Poll until login form exists in frame (check every 500ms, up to maxWait)
    const waitAndFillFrame = async (frame, user, pass, maxWaitMs = 35000) => {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        try {
          const result = await fillLoginInFrame(frame, user, pass);
          if (result.done) return result;
          log('Form not ready:', result.message);
        } catch (e) {
          log('Frame evaluate error:', e.message);
        }
        await delay(500);
      }
      return { done: false, message: 'timeout' };
    };

      console.log('Entering credentials in UI: username', username, 'password', password);
      // 1) Wait for sessionserver iframe and fill via JS inside it (bulletproof)
    const maxWait = 35000;
    const pollStart = Date.now();
    while (Date.now() - pollStart < maxWait) {
      const sessionFrame = page.frames().find((f) => f.url().includes('sessionserver'));
      if (sessionFrame) {
        log('Found sessionserver frame, filling via JS...');
        const result = await waitAndFillFrame(sessionFrame, username, password, 20000);
        if (result.done) {
          loginFilled = true;
          log('Login filled in sessionserver iframe:', result.message);
          break;
        }
      }
      await delay(800);
    }

    // 2) Try main frame (form might be in main document in some setups)
    if (!loginFilled) {
      log('Trying main frame...');
      const result = await waitAndFillFrame(page.mainFrame(), username, password, 15000);
      if (result.done) {
        loginFilled = true;
        log('Login filled in main frame:', result.message);
      }
    }

    // 3) Try every other frame
    if (!loginFilled) {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame() || frame.url().includes('sessionserver')) continue;
        const result = await waitAndFillFrame(frame, username, password, 8000);
        if (result.done) {
          loginFilled = true;
          log('Login filled in frame:', result.message);
          break;
        }
      }
    }
    } // end else (need to log in)

    if (loginFilled) {
      console.log('Credentials entered from .env. Waiting for next page...');
      await page.waitForLoadState('domcontentloaded');

      // Salesforce may show OTP/verification for new session / new IP / private window.
      const otpSelectors = 'input[id*="otp"], input[name*="otp"], input[placeholder*="code"], #emc, #tlkp_verify, .verify-identity, #smc';
      const otpVisible = await page.waitForSelector(otpSelectors, { state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
      if (otpVisible) {
        console.log('OTP/verification detected. Enter the code in the browser.');
      }

      // Save session only after you're fully on the dashboard (so next run stays logged in).
      if (HEADED) {
        console.log('');
        console.log('>>> Complete OTP in the browser if asked. When you see the Salesforce dashboard, press Enter to SAVE session. <<<');
        console.log('');
        await waitForEnter('Press Enter when you see the Salesforce dashboard (to save session for next run)...');
      } else {
        const postLoginSelectors = 'div[id="content"], [data-aura-rendered-by], .slds-global-header, #phHeader, .slds-page-header';
        await page.waitForSelector(postLoginSelectors, { timeout: 120000 }).catch(() => {});
      }
      await context.storageState({ path: STATE_FILE });
      console.log('Session saved to', STATE_FILE);
      if (HEADED) {
        console.log('');
        await waitForEnter('Press Enter to close the browser...');
      }
      await context.close();
      context = null;
      return;
    } else if (!isLoggedInUrl) {
      if (DEBUG) {
        console.log('[debug] Login form not detected after checking all frames. URL:', page.url());
      }
      console.log('Already logged in (session from cookies).');
    }

    if (HEADED) {
      await waitForEnter('Press Enter to close the browser...');
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (context) await context.close();
  }
}

main();