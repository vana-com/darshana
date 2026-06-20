import fs from 'node:fs';
import readline from 'node:readline';
import { chromium } from 'playwright';

const AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function ensureAuth(config) {
  if (config.public === true) {
    console.log('[auth] Public app — skipping auth.');
    return { storageStatePath: null, authCaptures: [] };
  }

  const storagePath = config.authStorage;

  if (fs.existsSync(storagePath)) {
    const stat = fs.statSync(storagePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < AUTH_MAX_AGE_MS) {
      const ageMin = Math.round(ageMs / 60000);
      console.log(`[auth] Using cached auth (${ageMin}m old): ${storagePath}`);
      return { storageStatePath: storagePath, authCaptures: [] };
    }
    console.log('[auth] Cached auth is stale (>12h) — re-authenticating.');
  }

  if (config.authScript) {
    console.log(`[auth] Running authScript: ${config.authScript}`);
    const mod = await import(config.authScript);
    const fn = mod.default;
    if (typeof fn !== 'function') {
      throw new Error(`authScript must export a default function, got: ${typeof fn}`);
    }
    const browser = await chromium.launch({ headless: true });
    let storagePath;
    try {
      const result = await fn(browser);
      if (typeof result !== 'string') {
        throw new Error('authScript must return a storageState file path string');
      }
      storagePath = result;
    } finally {
      await browser.close();
    }

    // Post-auth verification screenshot using the saved storageState
    const authCaptures = [];
    try {
      console.log('[auth] Capturing post-auth landing page...');
      const verifyBrowser = await chromium.launch({ headless: true });
      try {
        const verifyContext = await verifyBrowser.newContext({ storageState: storagePath });
        const verifyPage = await verifyContext.newPage();
        const landingUrl = config.url + (config.start ?? '/');
        await verifyPage.goto(landingUrl, { waitUntil: 'networkidle', timeout: 30000 });
        const imageBuffer = await verifyPage.screenshot({ fullPage: true, type: 'png' });
        authCaptures.push({
          url: verifyPage.url(),
          pathname: '/_auth/landing',
          theme: 'system',
          viewport: 'desktop',
          section: 'auth',
          label: 'Auth · post-login landing',
          imageBuffer,
        });
        await verifyPage.close();
        await verifyContext.close();
      } finally {
        await verifyBrowser.close();
      }
    } catch (err) {
      console.warn(`[auth] WARNING: post-auth screenshot failed: ${err.message}`);
    }

    return { storageStatePath: storagePath, authCaptures };
  }

  console.log('\n[auth] Launching headed browser for manual login...');
  console.log(`[auth] Navigate to: ${config.url}`);
  console.log('[auth] Log in, then press ENTER here to capture session.\n');

  const startPath = config.start ?? '/';
  const startUrl = config.url + startPath;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(startUrl, { waitUntil: 'load' });

  // Pre-auth screenshot (captures the login/redirect page)
  let preAuthCapture = null;
  try {
    const preAuthImageBuffer = await page.screenshot({ fullPage: true, type: 'png' });
    preAuthCapture = {
      url: page.url(),
      pathname: '/_auth/login',
      theme: 'system',
      viewport: 'desktop',
      section: 'auth',
      label: 'Auth · login page',
      imageBuffer: preAuthImageBuffer,
    };
  } catch (err) {
    console.warn(`[auth] WARNING: pre-auth screenshot failed: ${err.message}`);
  }

  await waitForEnter();

  console.log(`[auth] Saving session to: ${storagePath}`);
  await context.storageState({ path: storagePath });
  await browser.close();

  console.log('[auth] Session saved.\n');

  // Post-auth verification screenshot using a new page with saved storageState
  let postAuthCapture = null;
  try {
    console.log('[auth] Capturing post-auth landing page...');
    const verifyBrowser = await chromium.launch({ headless: true });
    try {
      const verifyContext = await verifyBrowser.newContext({ storageState: storagePath });
      const verifyPage = await verifyContext.newPage();
      await verifyPage.goto(startUrl, { waitUntil: 'networkidle', timeout: 30000 });
      const postAuthImageBuffer = await verifyPage.screenshot({ fullPage: true, type: 'png' });
      postAuthCapture = {
        url: verifyPage.url(),
        pathname: '/_auth/landing',
        theme: 'system',
        viewport: 'desktop',
        section: 'auth',
        label: 'Auth · post-login landing',
        imageBuffer: postAuthImageBuffer,
      };
      await verifyPage.close();
      await verifyContext.close();
    } finally {
      await verifyBrowser.close();
    }
  } catch (err) {
    console.warn(`[auth] WARNING: post-auth screenshot failed: ${err.message}`);
  }

  const authCaptures = [
    ...(preAuthCapture ? [preAuthCapture] : []),
    ...(postAuthCapture ? [postAuthCapture] : []),
  ];

  return { storageStatePath: storagePath, authCaptures };
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}
