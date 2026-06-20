import fs from 'node:fs';
import readline from 'node:readline';
import { chromium } from 'playwright';

const AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function ensureAuth(config) {
  if (config.public === true) {
    console.log('[auth] Public app — skipping auth.');
    return null;
  }

  const storagePath = config.authStorage;

  if (fs.existsSync(storagePath)) {
    const stat = fs.statSync(storagePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < AUTH_MAX_AGE_MS) {
      const ageMin = Math.round(ageMs / 60000);
      console.log(`[auth] Using cached auth (${ageMin}m old): ${storagePath}`);
      return storagePath;
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
    try {
      const result = await fn(browser);
      if (typeof result !== 'string') {
        throw new Error('authScript must return a storageState file path string');
      }
      return result;
    } finally {
      await browser.close();
    }
  }

  console.log('\n[auth] Launching headed browser for manual login...');
  console.log(`[auth] Navigate to: ${config.url}`);
  console.log('[auth] Log in, then press ENTER here to capture session.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(config.url);

  await waitForEnter();

  console.log(`[auth] Saving session to: ${storagePath}`);
  await context.storageState({ path: storagePath });
  await browser.close();

  console.log('[auth] Session saved.\n');
  return storagePath;
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
