# darshana

Crawl any web app and generate a labeled PDF, HTML viewer, or image set for design review.

*Darśana* — Sanskrit for "the act of seeing clearly."

## Try it now

```bash
npx @opendatalabs/darshana --url https://vana.org --public
```

Output lands in `./darshana-output/` — a PDF and a self-contained HTML viewer with sidebar nav, filters, and keyboard navigation.

For a private app, darshana opens a browser so you can log in, then saves the session:

```bash
npx @opendatalabs/darshana --url https://app.vana.org
# A browser opens → log in → press Enter → capture begins
```

## Install

```bash
npm install -g @opendatalabs/darshana
```

Chromium is installed automatically. Or skip the install entirely and use `npx @opendatalabs/darshana`.

**Linux only:** if Chromium fails to launch, you may be missing system libraries. Fix with:
```bash
sudo npx playwright install chromium --with-deps
```

## CLI reference

```
darshana --url <url> [options]         # zero-config
darshana --config <path> [options]     # file-based (CLI args override config)

--url <url>              Base URL to crawl
--config <path>          Path to a JSON config file
--title <string>         Review title (default: hostname)
--start <path>           Starting path (default: /)
--public                 Skip auth — use for public sites
--auth-storage <path>    Where to save/load the session (default: ./darshana-output/auth.json)
--auth-script <path>     Headless login script (see Auth below)
--themes <list>          Comma-separated: system,dark,light (default: system)
--viewports <list>       Comma-separated: desktop,mobile (default: desktop)
--max-depth <n>          BFS depth limit (default: 5)
--max-pages <n>          Page cap (default: 100)
--delay <ms>             Wait after page load before capture (default: 400)
--outputs <list>         Comma-separated: pdf,html,images (default: pdf,html)
--output-dir <path>      Output directory (default: ./darshana-output)
--include <regex>        Crawl only paths matching this pattern (repeatable)
--exclude <regex>        Skip paths matching this pattern (repeatable)
--dry-run                Discover URLs without capturing
--route <path>           Capture a single route only
--auth-only              Save auth session and exit
```

## Config file

For complex projects, a JSON config gives you per-route sampling rules and capture overrides. CLI args always override config file values.

```json
{
  "title": "My App",
  "url": "https://myapp.example.com",
  "start": "/dashboard",
  "public": false,
  "authStorage": "./auth.json",
  "authScript": "./auth.mjs",
  "crawl": {
    "include": ["^/dashboard"],
    "exclude": ["logout", "delete"],
    "maxDepth": 3,
    "maxPages": 50,
    "routes": [
      { "pattern": "/dashboard/records/:id", "sample": 1, "follow": false },
      { "pattern": "/dashboard/runs/:id",    "sample": 2, "follow": false },
      { "pattern": "/dashboard/**",          "follow": true }
    ]
  },
  "capture": {
    "themes": ["dark", "light"],
    "viewports": ["desktop", "mobile"],
    "delay": 400,
    "overrides": [
      { "route": "/dashboard/records/", "delay": 1000 }
    ]
  },
  "outputs": ["pdf", "html"],
  "outputDir": "./output"
}
```

### Routes DSL

Without routes, darshana visits every discovered URL. For apps with millions of records or runs, use routes to sample:

| Field | Type | Default | Description |
|---|---|---|---|
| `pattern` | string | required | Express-style path using `:param` and `/**` |
| `sample` | number | unlimited | Max pages to capture matching this pattern |
| `follow` | boolean | `true` | Whether to BFS-follow links on matching pages |

First match wins.

### Config reference

**Top-level**

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | string | hostname | Cover page and HTML header title |
| `url` | string | required | Base URL |
| `start` | string | `/` | Path to start crawling from |
| `public` | boolean | `false` | Skip auth |
| `authStorage` | string | `./auth.json` | Saved session path |
| `authScript` | string | — | Headless login script |
| `outputs` | string[] | `["pdf","html"]` | Any of `"pdf"`, `"html"`, `"images"` |
| `outputDir` | string | `./darshana-output` | Output directory |

**`crawl`**

| Field | Type | Default | Description |
|---|---|---|---|
| `include` | string[] | `[]` | Regex patterns — pathname must match all |
| `exclude` | string[] | `[]` | Regex patterns — pathname must not match any |
| `maxDepth` | number | `5` | Max BFS depth |
| `maxPages` | number | `100` | Hard page cap |
| `extraRoutes` | string[] | `[]` | Extra paths to capture (not crawled for links) |
| `routes` | Route[] | `[]` | Per-pattern sampling rules |

**`capture`**

| Field | Type | Default | Description |
|---|---|---|---|
| `themes` | string[] | `["system"]` | `"system"` (no injection), `"dark"`, `"light"` |
| `viewports` | string[] | `["desktop"]` | `"desktop"` (1440×900) or `"mobile"` (390×844) |
| `fullPage` | boolean | `true` | Capture full scrollable height |
| `delay` | number | `400` | ms to wait before capture |
| `waitFor` | string | — | CSS selector (prefix `$`) or JS expression to await |
| `overrides` | Override[] | `[]` | Per-route overrides for any capture field |
| `contextOptions` | object | `{}` | Passed to `browser.newContext()` |
| `launchOptions` | object | `{}` | Passed to `chromium.launch()` |
| `playwrightOptions` | object | `{}` | Passed to `page.screenshot()` |
| `routeOptions` | object | — | `{ blockPatterns: string[] }` — abort matching requests |

## Auth

**Headed handover** (default): darshana opens a Chromium window, you log in, press Enter. The session is saved to `authStorage` and reused for 12 hours.

**Headless auth script**: export a default function that receives a `Browser` and returns the path to a saved `storageState`:

```javascript
// auth.mjs
export default async function login(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(process.env.APP_URL + '/login');
  await page.fill('#password', process.env.APP_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);
  await context.storageState({ path: './auth.json' });
  await context.close();
  return './auth.json';
}
```

See [examples/auth-example.mjs](examples/auth-example.mjs) for a full example.

## Outputs

- **`pdf`** — one page per capture, labeled header, cover page
- **`html`** — self-contained file with sidebar nav, theme/viewport filters, keyboard navigation (↑↓), viewport-correct image sizing
- **`images`** — `<outputDir>/images/<viewport>/NNN-slug-theme.png`

## License

MIT
