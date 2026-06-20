/**
 * Example authScript for a password-protected app.
 * Configure in review.config.json as: "authScript": "./auth.mjs"
 *
 * This script receives a Playwright Browser instance, logs in,
 * saves storageState to auth.json, and returns the path.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

export default async function login(browser) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) throw new Error('APP_PASSWORD env var required');

  const context = await browser.newContext();
  const page = await context.newPage();

  // Customize these for your app:
  await page.goto(process.env.APP_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.fill('#password', pw);  // update selector for your login form
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);

  const storagePath = path.join(__dir, 'auth.json');
  await context.storageState({ path: storagePath });
  await context.close();
  return storagePath;
}
