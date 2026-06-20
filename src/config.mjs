import fs from 'node:fs';
import path from 'node:path';

export const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile:  { width: 390,  height: 844, deviceScaleFactor: 2 },
};

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
