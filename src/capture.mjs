import { VIEWPORT_PRESETS } from './config.mjs';

const NEXTJS_HIDE_STYLE =
  'nextjs-portal,[data-nextjs-toast],[data-nextjs-dialog],#__next-build-watcher{display:none!important}';

export async function captureAll(browser, config, urls) {
  const results = [];
  const themes = config.capture.themes;
  const viewportNames = config.capture.viewports;

  for (const viewportName of viewportNames) {
    for (const theme of themes) {
      const vpPreset = VIEWPORT_PRESETS[viewportName] ?? { width: 1440, height: 900, deviceScaleFactor: 1 };
      const storageStatePath = config._storageStatePath ?? null;

      const contextOpts = {
        viewport: { width: vpPreset.width, height: vpPreset.height },
        deviceScaleFactor: vpPreset.deviceScaleFactor ?? 1,
        ...(config.capture.contextOptions ?? {}),
        ...(storageStatePath ? { storageState: storageStatePath } : {}),
      };

      console.log(`\n[capture] Segment: ${viewportName} / ${theme} (${urls.length} URLs)`);
      const context = await browser.newContext(contextOpts);

      for (const url of urls) {
        let pathname;
        try { pathname = new URL(url).pathname; } catch { pathname = url; }

        const override = resolveOverride(config.capture.overrides, pathname);

        const effectiveThemes = override?.themes;
        if (effectiveThemes && !effectiveThemes.includes(theme)) {
          console.log(`  [capture] skip ${pathname} [${theme}] (override)`);
          continue;
        }
        const effectiveViewports = override?.viewports;
        if (effectiveViewports && !effectiveViewports.includes(viewportName)) {
          console.log(`  [capture] skip ${pathname} [${viewportName}] (override)`);
          continue;
        }

        const delay = override?.delay ?? config.capture.delay ?? 400;
        const waitFor = override?.waitFor ?? config.capture.waitFor ?? null;
        const label = makeLabel(pathname, viewportName, theme);

        console.log(`  [capture] ${label}`);
        const page = await context.newPage();

        try {
          const blockPatterns = config.capture.routeOptions?.blockPatterns ?? [];
          if (blockPatterns.length > 0) {
            await page.route('**/*', (route) => {
              const reqUrl = route.request().url();
              if (blockPatterns.some(pat => reqUrl.includes(pat))) {
                route.abort();
              } else {
                route.continue();
              }
            });
          }

          await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
          await page.addStyleTag({ content: NEXTJS_HIDE_STYLE }).catch(() => {});

          // 'system' = no injection; let the page's own prefers-color-scheme take effect
          if (theme !== 'system') {
            await page.evaluate((t) => {
              const html = document.documentElement;
              html.setAttribute('data-theme', t);
              if (t === 'dark') {
                html.classList.add('dark');
                html.classList.remove('light');
              } else {
                html.classList.add('light');
                html.classList.remove('dark');
              }
            }, theme);
          }

          if (waitFor) {
            if (waitFor.startsWith('$')) {
              await page.waitForSelector(waitFor.slice(1), { timeout: 15000 });
            } else {
              await page.waitForFunction(waitFor, { timeout: 15000 });
            }
          }

          if (delay > 0) await page.waitForTimeout(delay);

          const imageBuffer = await page.screenshot({
            fullPage: config.capture.fullPage ?? true,
            type: 'png',
            ...(config.capture.playwrightOptions ?? {}),
          });

          results.push({ url, pathname, theme, viewport: viewportName, imageBuffer, label });
        } catch (err) {
          console.error(`  [capture] FAILED ${pathname}: ${err.message}`);
        } finally {
          await page.close();
        }
      }

      await context.close();
      console.log(`[capture] Segment done: ${viewportName} / ${theme}`);
    }
  }

  return results;
}

function resolveOverride(overrides, pathname) {
  if (!overrides?.length) return null;
  for (const ov of overrides) {
    if (new RegExp(ov.route).test(pathname)) return ov;
  }
  return null;
}

function makeLabel(pathname, viewport, theme) {
  const humanPath = pathname.replace(/^\//, '').replace(/-/g, ' ') || '/';
  return `${humanPath}  ·  ${viewport}  ·  ${theme}`;
}
