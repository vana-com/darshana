#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig } from './config.mjs';
import { ensureAuth } from './auth.mjs';
import { crawl } from './crawl.mjs';
import { captureAll } from './capture.mjs';
import { assemblePdf } from './pdf.mjs';
import { assembleHtml } from './html.mjs';

function parseArgs(argv) {
  const args = { config: null, dryRun: false, route: null, authOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) { args.config = argv[++i]; continue; }
    if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
    if (argv[i] === '--route' && argv[i + 1]) { args.route = argv[++i]; continue; }
    if (argv[i] === '--auth-only') { args.authOnly = true; continue; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.config) {
  console.error('Usage: darshana --config <path> [--dry-run] [--route <path>] [--auth-only]');
  process.exit(1);
}

async function main() {
  const config = loadConfig(args.config);
  console.log(`[darshana] ${config.title} — ${config.url}`);

  const storageStatePath = await ensureAuth(config);
  config._storageStatePath = storageStatePath;

  if (args.authOnly) {
    console.log('[darshana] --auth-only done.');
    process.exit(0);
  }

  let urls;
  if (args.route) {
    const fullUrl = args.route.startsWith('http') ? args.route : config.url + args.route;
    urls = [fullUrl];
    console.log(`[darshana] --route mode: ${fullUrl}`);
  } else {
    const crawlBrowser = await chromium.launch({ headless: true });
    const crawlContextOpts = storageStatePath ? { storageState: storageStatePath } : {};
    const crawlContext = await crawlBrowser.newContext(crawlContextOpts);
    try {
      console.log(`[darshana] Crawling from ${config.url}${config.start} ...`);
      urls = await crawl(crawlContext, config);
    } finally {
      await crawlContext.close();
      await crawlBrowser.close();
    }
    console.log(`[darshana] Crawl complete: ${urls.length} URLs found.`);
  }

  if (args.dryRun) {
    console.log('\n[darshana] --dry-run: discovered URLs:');
    for (const u of urls) console.log(`  ${u}`);
    process.exit(0);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(config.capture.launchOptions ?? {}),
  });

  let captures;
  try {
    captures = await captureAll(browser, config, urls);
  } finally {
    await browser.close();
  }

  console.log(`\n[darshana] Captured ${captures.length} page(s).`);

  if (captures.length === 0) {
    console.error('[darshana] No pages captured. Exiting.');
    process.exit(1);
  }

  const outputDir = config.outputDir;
  fs.mkdirSync(outputDir, { recursive: true });

  const outputs = config.outputs ?? ['pdf'];

  if (outputs.includes('pdf')) {
    await assemblePdf(captures, config, outputDir);
  }

  if (outputs.includes('html')) {
    await assembleHtml(captures, config, outputDir);
  }

  if (outputs.includes('images')) {
    await writeImages(captures, outputDir);
  }

  console.log('\n[darshana] Done.');
}

async function writeImages(captures, outputDir) {
  const byViewport = {};
  for (const capture of captures) {
    (byViewport[capture.viewport] = byViewport[capture.viewport] || []).push(capture);
  }
  let total = 0;
  for (const [viewport, vpCaptures] of Object.entries(byViewport)) {
    const vpDir = path.join(outputDir, 'images', viewport);
    fs.mkdirSync(vpDir, { recursive: true });
    vpCaptures.forEach((capture, i) => {
      const slug = slugifyPathname(capture.pathname);
      const filename = `${String(i + 1).padStart(3, '0')}-${slug}-${capture.theme}.png`;
      fs.writeFileSync(path.join(vpDir, filename), capture.imageBuffer);
      console.log(`  [images] ${viewport}/${filename}`);
      total++;
    });
  }
  console.log(`\n[images] Wrote ${total} PNG(s) → ${path.join(outputDir, 'images')}`);
}

function slugifyPathname(pathname) {
  return (pathname ?? '/')
    .replace(/^\//, '')
    .replace(/\//g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'root';
}

main().catch(err => {
  console.error('[darshana] Fatal:', err);
  process.exit(1);
});
