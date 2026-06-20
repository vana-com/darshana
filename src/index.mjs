#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig, buildConfig } from './config.mjs';
import { ensureAuth } from './auth.mjs';
import { crawl } from './crawl.mjs';
import { captureAll } from './capture.mjs';
import { assemblePdf } from './pdf.mjs';
import { assembleHtml } from './html.mjs';

const USAGE = `
Usage:
  darshana --url <url> [options]          # zero-config mode
  darshana --config <path> [options]      # file-based config

Options:
  --url <url>              Base URL to crawl (required if no --config)
  --config <path>          Path to a JSON config file
  --title <string>         Review title (default: hostname)
  --start <path>           Starting path (default: /)
  --public                 Skip auth entirely
  --auth-storage <path>    Path to saved Playwright storageState (default: ./auth.json)
  --auth-script <path>     Path to a headless auth script
  --themes <list>          Comma-separated: dark,light,system (default: system)
  --viewports <list>       Comma-separated: desktop,mobile (default: desktop)
  --max-depth <n>          BFS depth limit (default: 5)
  --max-pages <n>          Page cap (default: 100)
  --delay <ms>             Wait after page load before capture (default: 400)
  --outputs <list>         Comma-separated: pdf,html,images (default: pdf,html)
  --output-dir <path>      Directory for output files (default: ./darshana-output)
  --include <regex>        Crawl only paths matching this pattern (repeatable)
  --exclude <regex>        Skip paths matching this pattern (repeatable)
  --dry-run                Discover URLs without capturing
  --route <path>           Capture a single route only
  --auth-only              Save auth session and exit
`.trim();

function parseArgs(argv) {
  const args = {
    config: null,
    url: null,
    title: null,
    start: null,
    public: false,
    authStorage: null,
    authScript: null,
    themes: null,
    viewports: null,
    maxDepth: null,
    maxPages: null,
    delay: null,
    outputs: null,
    outputDir: null,
    include: [],
    exclude: [],
    dryRun: false,
    route: null,
    authOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (!argv[i + 1]) { console.error(`Missing value for ${a}`); process.exit(1); } return argv[++i]; };
    if (a === '--config')       { args.config = next(); continue; }
    if (a === '--url')          { args.url = next(); continue; }
    if (a === '--title')        { args.title = next(); continue; }
    if (a === '--start')        { args.start = next(); continue; }
    if (a === '--public')       { args.public = true; continue; }
    if (a === '--auth-storage') { args.authStorage = next(); continue; }
    if (a === '--auth-script')  { args.authScript = next(); continue; }
    if (a === '--themes')       { args.themes = next().split(',').map(s => s.trim()); continue; }
    if (a === '--viewports')    { args.viewports = next().split(',').map(s => s.trim()); continue; }
    if (a === '--max-depth')    { args.maxDepth = parseInt(next(), 10); continue; }
    if (a === '--max-pages')    { args.maxPages = parseInt(next(), 10); continue; }
    if (a === '--delay')        { args.delay = parseInt(next(), 10); continue; }
    if (a === '--outputs')      { args.outputs = next().split(',').map(s => s.trim()); continue; }
    if (a === '--output-dir')   { args.outputDir = next(); continue; }
    if (a === '--include')      { args.include.push(next()); continue; }
    if (a === '--exclude')      { args.exclude.push(next()); continue; }
    if (a === '--dry-run')      { args.dryRun = true; continue; }
    if (a === '--route')        { args.route = next(); continue; }
    if (a === '--auth-only')    { args.authOnly = true; continue; }
    if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    console.error(`Unknown argument: ${a}\n\n${USAGE}`);
    process.exit(1);
  }
  return args;
}

function configFromArgs(args) {
  const url = args.url.replace(/\/$/, '');
  const hostname = new URL(url).hostname;
  const outputDir = args.outputDir ?? './darshana-output';

  const raw = {
    title: args.title ?? hostname,
    url,
    start: args.start ?? '/',
    public: args.public,
    authStorage: args.authStorage ?? path.join(outputDir, 'auth.json'),
    authScript: args.authScript ?? null,
    crawl: {
      include: args.include,
      exclude: args.exclude,
      maxDepth: args.maxDepth ?? 5,
      maxPages: args.maxPages ?? 100,
    },
    capture: {
      themes: args.themes ?? ['system'],
      viewports: args.viewports ?? ['desktop'],
      delay: args.delay ?? 400,
    },
    outputs: args.outputs ?? ['pdf', 'html'],
    outputDir,
  };

  return buildConfig(raw, process.cwd());
}

function applyCliOverrides(config, args) {
  if (args.title)     config.title = args.title;
  if (args.start)     config.start = args.start;
  if (args.public)    config.public = true;
  if (args.authStorage) config.authStorage = path.resolve(args.authStorage);
  if (args.authScript)  config.authScript = path.resolve(args.authScript);
  if (args.themes)    config.capture.themes = args.themes;
  if (args.viewports) config.capture.viewports = args.viewports;
  if (args.maxDepth)  config.crawl.maxDepth = args.maxDepth;
  if (args.maxPages)  config.crawl.maxPages = args.maxPages;
  if (args.delay)     config.capture.delay = args.delay;
  if (args.outputs)   config.outputs = args.outputs;
  if (args.outputDir) config.outputDir = path.resolve(args.outputDir);
  if (args.include.length) config.crawl.include = [...config.crawl.include, ...args.include];
  if (args.exclude.length) config.crawl.exclude = [...config.crawl.exclude, ...args.exclude];
  return config;
}

const args = parseArgs(process.argv.slice(2));

if (!args.config && !args.url) {
  console.error('Error: --url or --config is required\n\n' + USAGE);
  process.exit(1);
}

async function main() {
  let config;
  if (args.config) {
    config = loadConfig(args.config);
    config = applyCliOverrides(config, args);
  } else {
    config = configFromArgs(args);
  }

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

  const outputs = config.outputs ?? ['pdf', 'html'];

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
