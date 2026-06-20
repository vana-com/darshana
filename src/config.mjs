import fs from 'node:fs';
import path from 'node:path';

export const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile:  { width: 390,  height: 844, deviceScaleFactor: 2 },
};

const KNOWN_TOP_LEVEL_KEYS = ['title', 'url', 'start', 'public', 'authStorage', 'authScript', 'crawl', 'capture', 'pdf', 'outputs', 'outputDir'];
const KNOWN_CRAWL_KEYS = ['include', 'exclude', 'maxDepth', 'maxPages', 'extraRoutes', 'routes'];
const KNOWN_CAPTURE_KEYS = ['themes', 'viewports', 'fullPage', 'delay', 'waitFor', 'contextOptions', 'launchOptions', 'playwrightOptions', 'routeOptions', 'overrides'];

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function warnUnknownKeys(obj, knownKeys, section) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) {
      const best = knownKeys.reduce((acc, k) => { const d = levenshtein(key, k); return d < acc.d ? { k, d } : acc; }, { k: null, d: Infinity });
      const prefix = section ? `[darshana] Warning: unknown config field "${section}.${key}"` : `[darshana] Warning: unknown config field "${key}"`;
      const suffix = best.d <= 3 ? ` — did you mean "${section ? section + '.' : ''}${best.k}"?` : '';
      console.warn(prefix + suffix);
    }
  }
}

export function loadConfig(configPath) {
  const absConfigPath = path.resolve(configPath);
  const configDir = path.dirname(absConfigPath);

  if (!fs.existsSync(absConfigPath)) {
    throw new Error(`Config file not found: ${absConfigPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(absConfigPath, 'utf8'));

  if (!raw.url) throw new Error('Config missing required field: url');
  if (!raw.start) throw new Error('Config missing required field: start');

  return buildConfig(raw, configDir);
}

// Build a config object from a plain object (used by both loadConfig and CLI --url mode).
// configDir is used to resolve relative paths; defaults to cwd when not loading from a file.
export function buildConfig(raw, configDir = process.cwd()) {
  // Validate unknown keys and emit typo hints
  warnUnknownKeys(raw, KNOWN_TOP_LEVEL_KEYS, null);
  warnUnknownKeys(raw.crawl, KNOWN_CRAWL_KEYS, 'crawl');
  warnUnknownKeys(raw.capture, KNOWN_CAPTURE_KEYS, 'capture');
  const config = {
    title: raw.title ?? 'Design Review',
    url: raw.url.replace(/\/$/, ''),
    start: raw.start ?? '/',
    public: raw.public ?? false,
    authStorage: raw.authStorage ?? './auth.json',
    authScript: raw.authScript ?? null,

    crawl: {
      include: raw.crawl?.include ?? [],
      exclude: raw.crawl?.exclude ?? [],
      maxDepth: raw.crawl?.maxDepth ?? 5,
      maxPages: raw.crawl?.maxPages ?? 100,
      extraRoutes: raw.crawl?.extraRoutes ?? [],
      routes: raw.crawl?.routes ?? [],
    },

    capture: {
      themes: raw.capture?.themes ?? ['system'],
      viewports: raw.capture?.viewports ?? ['desktop'],
      fullPage: raw.capture?.fullPage ?? true,
      delay: raw.capture?.delay ?? 400,
      waitFor: raw.capture?.waitFor ?? null,
      contextOptions: raw.capture?.contextOptions ?? {},
      launchOptions: raw.capture?.launchOptions ?? {},
      playwrightOptions: raw.capture?.playwrightOptions ?? {},
      routeOptions: raw.capture?.routeOptions ?? null,
      overrides: raw.capture?.overrides ?? [],
    },

    pdf: {
      output: raw.pdf?.output ?? './darshana-output/review.pdf',
      pageSize: raw.pdf?.pageSize ?? 'A4',
    },

    outputs: raw.outputs ?? ['pdf', 'html'],
    outputDir: raw.outputDir ? path.resolve(configDir, raw.outputDir) : null,
  };

  config.authStorage = path.resolve(configDir, config.authStorage);
  if (config.authScript) {
    config.authScript = path.resolve(configDir, config.authScript);
  }
  config.pdf.output = path.resolve(configDir, config.pdf.output);

  if (!config.outputDir) {
    config.outputDir = path.dirname(config.pdf.output);
  }

  return config;
}
