import { match } from 'path-to-regexp';

// path-to-regexp v8 uses {*path} for catch-all wildcards; config uses /** for readability
function toRegexpPattern(pattern) {
  return pattern.replace(/\/\*\*$/, '/{*path}');
}

function compileRoutes(routes) {
  return routes.map(route => ({
    pattern: route.pattern,
    matchFn: match(toRegexpPattern(route.pattern), { decode: decodeURIComponent }),
    sample: route.sample ?? null,
    follow: route.follow ?? true,
  }));
}

export async function crawl(context, config) {
  const origin = new URL(config.url).origin;
  const startUrl = config.url + config.start;

  const includePatterns = (config.crawl.include ?? []).map(r => new RegExp(r));
  const excludePatterns = (config.crawl.exclude ?? []).map(r => new RegExp(r));
  const compiledRoutes = compileRoutes(config.crawl.routes ?? []);
  const seenShapes = new Map();

  const visitedPathnames = new Set();
  const queue = [{ url: startUrl, depth: 0 }];
  const result = [];

  function passesFilters(url) {
    let pathname;
    try { pathname = new URL(url).pathname; } catch { return false; }
    if (includePatterns.length > 0 && !includePatterns.every(re => re.test(pathname))) return false;
    if (excludePatterns.some(re => re.test(pathname))) return false;
    return true;
  }

  function normalizeKey(url) {
    try { return new URL(url).pathname; } catch { return url; }
  }

  function findRoute(url) {
    let pathname;
    try { pathname = new URL(url).pathname; } catch { return null; }
    for (const route of compiledRoutes) {
      if (route.matchFn(pathname)) return route;
    }
    return null;
  }

  while (queue.length > 0 && result.length < config.crawl.maxPages) {
    const { url, depth } = queue.shift();
    const key = normalizeKey(url);

    if (visitedPathnames.has(key)) continue;
    visitedPathnames.add(key);

    if (!passesFilters(url)) continue;

    const matchedRoute = findRoute(url);
    let shouldFollow = true;

    if (matchedRoute !== null) {
      const visitCount = seenShapes.get(matchedRoute.pattern) ?? 0;
      if (matchedRoute.sample !== null && visitCount >= matchedRoute.sample) {
        // Over sample limit — skip entirely, don't visit, don't follow
        continue;
      }
      result.push(url);
      console.log(`  [crawl] ${url} (depth ${depth}) [${matchedRoute.pattern}]`);
      seenShapes.set(matchedRoute.pattern, visitCount + 1);
      shouldFollow = matchedRoute.follow;
    } else {
      // No route matched — visit and follow (existing behavior)
      result.push(url);
      console.log(`  [crawl] ${url} (depth ${depth})`);
    }

    // Don't load the page if we're not following links from it
    if (!shouldFollow) continue;
    if (depth >= config.crawl.maxDepth || result.length >= config.crawl.maxPages) continue;

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const hrefs = await page.$$eval('a[href]', els =>
        els.map(el => el.getAttribute('href')).filter(Boolean)
      );
      for (const href of hrefs) {
        let resolved;
        try { resolved = new URL(href, url).href; } catch { continue; }
        if (!resolved.startsWith(origin)) continue;
        const childKey = normalizeKey(resolved);
        if (!visitedPathnames.has(childKey)) {
          queue.push({ url: resolved, depth: depth + 1 });
        }
      }
    } catch (err) {
      console.warn(`  [crawl] Failed to load ${url}: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  for (const route of (config.crawl.extraRoutes ?? [])) {
    const fullUrl = route.startsWith('http') ? route : config.url + route;
    const key = normalizeKey(fullUrl);
    if (!visitedPathnames.has(key)) {
      visitedPathnames.add(key);
      result.push(fullUrl);
      console.log(`  [crawl] extra: ${fullUrl}`);
    }
  }

  return result;
}
