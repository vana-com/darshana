# darshana

Crawl any web app and generate a labeled PDF, HTML viewer, or image set for AI-assisted design review.

*Darśana* — Sanskrit for "the act of seeing clearly."

## Install

```bash
npm install -g @opendatalabs/darshana
# or use directly:
npx @opendatalabs/darshana --config review.config.json
```

After installing, set up Playwright's browser:

```bash
npx playwright install chromium
```

## Quick start

**1. Create a config file** (`review.config.json`):

```json
{
  "title": "My App",
  "url": "https://myapp.example.com",
  "start": "/dashboard",
  "public": false,
  "authStorage": "./auth.json",
  "crawl": {
    "include": ["^/dashboard"],
    "exclude": ["logout", "delete"],
    "maxDepth": 3,
    "maxPages": 50,
    "extraRoutes": []
  },
  "capture": {
    "themes": ["dark"],
    "viewports": ["desktop", "mobile"],
    "delay": 400
  },
  "outputs": ["pdf", "html"],
  "outputDir": "./output"
}
```

**2. Authenticate** (opens a browser — log in, press Enter):

```bash
npx darshana --config review.config.json --auth-only
```

Or provide an `authScript` for headless login (see [examples/auth-example.mjs](examples/auth-example.mjs)).

**3. Generate the review**:

```bash
npx darshana --config review.config.json
```

## Config reference

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | string | `"Design Review"` | Title shown on cover page and HTML header |
| `url` | string | required | Base URL of the app |
| `start` | string | required | Path to start crawling from |
| `public` | boolean | `false` | Skip auth entirely for public sites |
| `authStorage` | string | `"./auth.json"` | Path to saved Playwright storageState |
| `authScript` | string | — | Path to a JS file that handles login programmatically |
| `outputs` | string[] | `["pdf"]` | Any of `"pdf"`, `"html"`, `"images"` |
| `outputDir` | string | same dir as config | Directory for generated output files |

### `crawl`

| Field | Type | Default | Description |
|---|---|---|---|
| `include` | string[] | `[]` | Regex patterns — URL pathname must match all |
| `exclude` | string[] | `[]` | Regex patterns — URL pathname must not match any |
| `maxDepth` | number | `5` | Max BFS depth from start URL |
| `maxPages` | number | `100` | Hard cap on total pages crawled |
| `extraRoutes` | string[] | `[]` | Additional paths to capture (not crawled for links) |
| `routes` | Route[] | `[]` | Per-pattern sampling rules (see Routes DSL) |

### `capture`

| Field | Type | Default | Description |
|---|---|---|---|
| `themes` | string[] | `["dark"]` | Theme names to capture — injected as `data-theme` + CSS class |
| `viewports` | string[] | `["desktop"]` | `"desktop"` (1440×900) or `"mobile"` (390×844) |
| `fullPage` | boolean | `true` | Capture full scrollable page height |
| `delay` | number | `400` | ms to wait after page load before capture |
| `waitFor` | string | — | CSS selector (prefix `$`) or JS expression to wait for |
| `overrides` | Override[] | `[]` | Per-route capture overrides |
| `contextOptions` | object | `{}` | Passed directly to `browser.newContext()` |
| `launchOptions` | object | `{}` | Passed directly to `chromium.launch()` |
| `playwrightOptions` | object | `{}` | Passed directly to `page.screenshot()` |
| `routeOptions` | object | — | `{ blockPatterns: string[] }` — abort matching network requests |

### Routes DSL

Limit how many pages of each "shape" are captured. Uses Express-style `:param` notation.

```json
"routes": [
  { "pattern": "/dashboard/records/:id", "sample": 1, "follow": false },
  { "pattern": "/dashboard/runs/:id",    "sample": 2, "follow": false },
  { "pattern": "/dashboard/**",          "follow": true }
]
```

| Field | Type | Default | Description |
|---|---|---|---|
| `pattern` | string | required | Path pattern using `:param` and `/**` |
| `sample` | number | unlimited | Max pages to visit matching this pattern |
| `follow` | boolean | `true` | Whether to BFS-follow links on matching pages |

Patterns are matched in order — first match wins.

## Auth options

**Headed handover** (default when no `authScript`): darshana opens a browser, you log in manually, press Enter — session is saved to `authStorage`. Sessions are reused for 12 hours.

**Headless auth script**: Create a JS file that exports a default function:

```javascript
export default async function login(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(process.env.APP_URL + '/login');
  await page.fill('#password', process.env.APP_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);
  const storagePath = './auth.json';
  await context.storageState({ path: storagePath });
  await context.close();
  return storagePath;
}
```

Set `"authScript": "./my-auth.mjs"` in config.

## CLI

```bash
darshana --config <path>          # run full pipeline
darshana --config <path> --dry-run   # discover URLs without capturing
darshana --config <path> --route /dashboard  # capture one route only
darshana --config <path> --auth-only  # save auth session and exit
```

## Outputs

- **`pdf`** — `<outputDir>/console-review.pdf` — labeled pages, cover page, one page per capture
- **`html`** — `<outputDir>/console-review.html` — self-contained HTML with sidebar nav, filters, keyboard navigation, viewport-correct sizing
- **`images`** — `<outputDir>/images/<viewport>/NNN-slug-theme.png` — individual screenshots grouped by viewport

## License

MIT
