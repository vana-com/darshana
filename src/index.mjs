#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { loadConfig, buildConfig } from './config.mjs';
import { ensureAuth } from './auth.mjs';
import { crawl } from './crawl.mjs';
import { captureAll } from './capture.mjs';
import { assemblePdf } from './pdf.mjs';
import { assembleHtml } from './html.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

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

// ── Config summary box ────────────────────────────────────────────────────────

function printConfigSummary(config) {
  const INNER = 48;
  const authLabel = config.public
    ? 'public'
    : config.authScript
      ? `script: ${path.basename(config.authScript)}`
      : 'session file';

  const rows = [
    ['url',       config.url],
    ['start',     config.start],
    ['auth',      authLabel],
    ['themes',    (config.capture.themes ?? ['system']).join(', ')],
    ['viewports', (config.capture.viewports ?? ['desktop']).join(', ')],
    ['maxPages',  `${config.crawl.maxPages}  maxDepth  ${config.crawl.maxDepth}`],
    ['outputs',   (config.outputs ?? ['pdf', 'html']).join(', ')],
    ['outputDir', config.outputDir ?? './darshana-output'],
  ];

  // Compute column widths
  const keyWidth = Math.max(...rows.map(([k]) => k.length));
  const valWidth = INNER - keyWidth - 2; // 2 = space + space

  function trunc(s, max) {
    const str = String(s);
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function pad(s, len) { return s + ' '.repeat(Math.max(0, len - s.length)); }

  const topLabel = ' darshana ';
  const topLineLen = INNER + 2; // borders
  const dashLen = topLineLen - topLabel.length - 2; // -2 for corner chars
  const dashLeft = Math.floor(dashLen / 2);
  const dashRight = dashLen - dashLeft;

  console.log(`┌${'─'.repeat(dashLeft)}${topLabel}${'─'.repeat(dashRight)}┐`);
  for (const [k, v] of rows) {
    const paddedKey = pad(k, keyWidth);
    const truncVal = trunc(v, valWidth);
    const paddedVal = pad(truncVal, valWidth);
    console.log(`│ ${paddedKey} ${paddedVal} │`);
  }
  console.log(`└${'─'.repeat(INNER)}┘`);
}

// ── init subcommand ───────────────────────────────────────────────────────────

async function runInit() {
  const configPath = path.join(process.cwd(), 'review.config.json');

  // Build an `ask` function that works for both TTY and piped stdin.
  // For piped input: readline fires 'close' as soon as the pipe ends, breaking
  // sequential question() calls. We buffer all lines upfront and serve them.
  // For interactive TTY: use readline.question() normally.
  const ask = await makeAsker();

  if (fs.existsSync(configPath)) {
    const overwrite = await ask('review.config.json already exists. Overwrite? (y/N): ');
    if (overwrite.trim().toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // 1. URL
  let url;
  while (true) {
    const raw = await ask('App URL (e.g. https://myapp.example.com): ');
    try { url = new URL(raw.trim()).href.replace(/\/$/, ''); break; }
    catch { console.log('  Invalid URL. Please include the scheme (https://).'); }
  }
  const hostname = new URL(url).hostname;

  // 2. Title
  const titleRaw = await ask(`Title (default: ${hostname}): `);
  const title = titleRaw.trim() || hostname;

  // 3. Auth
  const authRaw = await ask('Is the app public? (y/N): ');
  const isPublic = authRaw.trim().toLowerCase() === 'y';

  // 4. Start path
  const startRaw = await ask('Start path (default: /): ');
  const start = startRaw.trim() || '/';

  // 5. Viewports
  const vpRaw = await ask('Viewports — desktop, mobile, or both? (default: desktop): ');
  const vpInput = vpRaw.trim().toLowerCase() || 'desktop';
  let viewports;
  if (vpInput === 'both') viewports = ['desktop', 'mobile'];
  else if (vpInput === 'mobile') viewports = ['mobile'];
  else viewports = ['desktop'];

  // 6. Themes
  const themeRaw = await ask('Themes — system, dark, light, or multiple? (default: system): ');
  const themeInput = themeRaw.trim() || 'system';
  let themes;
  if (themeInput === 'multiple' || themeInput.includes(',')) {
    themes = themeInput === 'multiple'
      ? ['dark', 'light']
      : themeInput.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    themes = [themeInput];
  }

  // 7. Output dir
  const outRaw = await ask('Output directory (default: ./darshana-output): ');
  const outputDir = outRaw.trim() || './darshana-output';

  const config = {
    title,
    url,
    start,
    public: isPublic,
    capture: { viewports, themes },
    outputDir,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log('✓ review.config.json created. Run: darshana --config review.config.json');
  process.exit(0);
}

// Returns an `ask(question)` function.
// TTY mode: wraps readline.question for interactive line editing.
// Piped mode: buffers all stdin lines first, then serves them sequentially.
async function makeAsker() {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return (q) => new Promise(resolve => rl.question(q, answer => { resolve(answer); }));
  }
  // Non-TTY: read all lines from stdin before asking anything
  const lines = await new Promise(resolve => {
    const buf = [];
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', l => buf.push(l));
    rl.on('close', () => resolve(buf));
  });
  let idx = 0;
  return (q) => {
    const answer = lines[idx++] ?? '';
    console.log(`${q}${answer}`);
    return Promise.resolve(answer);
  };
}

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
    if (a === '--version' || a === '-v') { console.log(`darshana ${pkg.version}`); process.exit(0); }
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

// Dispatch init before parseArgs so we don't need --url
if (process.argv[2] === 'init') {
  runInit();
} else {
  runMain();
}

function runMain() {
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

    const storageStatePath = await ensureAuth(config);
    config._storageStatePath = storageStatePath;

    printConfigSummary(config);

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

  main().catch(err => {
    console.error('[darshana] Fatal:', err);
    process.exit(1);
  });
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
