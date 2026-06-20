import fs from 'node:fs';
import path from 'node:path';
import { VIEWPORT_PRESETS } from './config.mjs';

export async function assembleHtml(pages, config, outputDir) {
  const date = new Date().toISOString().slice(0, 10);
  const title = config.title ?? 'Design Review';

  // Generate viewport-specific CSS widths from actual config
  const viewportCss = config.capture.viewports.map(vp => {
    const preset = VIEWPORT_PRESETS[vp] ?? { width: 1440 };
    const cssWidth = vp === 'desktop' ? '100%' : `${preset.width}px`;
    return `img[data-viewport="${vp}"] { width: ${cssWidth}; max-width: ${preset.width}px; }`;
  }).join('\n    ');

  const authPages = pages.filter(p => p.section === 'auth');
  const appPages = pages.filter(p => p.section !== 'auth');
  const hasAuthCaptures = authPages.length > 0;

  const pageSections = [];

  pages.forEach((capture, i) => {
    const idx = i + 1;
    const pageId = `page-${idx}`;
    const base64 = capture.imageBuffer.toString('base64');
    const sectionAttr = capture.section === 'auth' ? ' data-section="auth"' : '';

    pageSections.push(`<div class="page" id="${pageId}" data-theme="${escHtml(capture.theme)}" data-viewport="${escHtml(capture.viewport)}"${sectionAttr}>
      <div class="label"><span class="idx">${idx}</span>${escHtml(capture.label)}</div>
      <img src="data:image/png;base64,${base64}" alt="${escHtml(capture.label)}" data-viewport="${escHtml(capture.viewport)}"${sectionAttr} loading="lazy">
    </div>`);
  });

  // Build sidebar nav items
  let navHtml;
  if (hasAuthCaptures) {
    // Auth group
    const authItems = [];
    pages.forEach((capture, i) => {
      if (capture.section !== 'auth') return;
      const idx = i + 1;
      const pageId = `page-${idx}`;
      authItems.push(
        `<li data-section="auth"><a href="#${pageId}">${escHtml(capture.label)}</a></li>`
      );
    });

    // Pages group
    const pageItems = [];
    pages.forEach((capture, i) => {
      if (capture.section === 'auth') return;
      const idx = i + 1;
      const pageId = `page-${idx}`;
      pageItems.push(
        `<li data-theme="${escHtml(capture.theme)}" data-viewport="${escHtml(capture.viewport)}"><a href="#${pageId}" data-theme="${escHtml(capture.theme)}" data-viewport="${escHtml(capture.viewport)}">${escHtml(capture.label)}</a></li>`
      );
    });

    navHtml = `
      <div class="section-group">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="chevron">&#9660;</span> Auth
        </div>
        <ul class="section-list">
          ${authItems.join('\n          ')}
        </ul>
      </div>
      <div class="section-group">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="chevron">&#9660;</span> Pages
        </div>
        <ul class="section-list" id="pages-section-list">
          ${pageItems.join('\n          ')}
        </ul>
      </div>`;
  } else {
    // Flat nav — same as original behavior
    const flatItems = pages.map((capture, i) => {
      const idx = i + 1;
      const pageId = `page-${idx}`;
      return `<li data-theme="${escHtml(capture.theme)}" data-viewport="${escHtml(capture.viewport)}"><a href="#${pageId}" data-theme="${escHtml(capture.theme)}" data-viewport="${escHtml(capture.viewport)}">${escHtml(capture.label)}</a></li>`;
    });
    navHtml = `<ul id="nav-list">\n      ${flatItems.join('\n      ')}\n    </ul>`;
  }

  const themes = [...new Set(appPages.map(p => p.theme))];
  const viewports = [...new Set(appPages.map(p => p.viewport))];

  const themeCheckboxes = themes.map(t =>
    `<label><input type="checkbox" data-filter="theme" value="${escHtml(t)}" checked> ${escHtml(t)}</label>`
  ).join('\n      ');

  const viewportCheckboxes = viewports.map(v =>
    `<label><input type="checkbox" data-filter="viewport" value="${escHtml(v)}" checked> ${escHtml(v)}</label>`
  ).join('\n      ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { background: #1a1a1a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; display: flex; min-height: 100vh; }

    #sidebar { width: 240px; min-width: 240px; background: #111; border-right: 1px solid #2a2a2a; position: fixed; top: 0; left: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; z-index: 100; }
    .nav-header { padding: 16px; font-size: 13px; font-weight: 600; color: #fff; border-bottom: 1px solid #2a2a2a; }
    .nav-meta { padding: 8px 16px; font-size: 11px; color: #555; border-bottom: 1px solid #2a2a2a; }
    .filters { padding: 12px 16px; border-bottom: 1px solid #2a2a2a; }
    .filters label { display: block; font-size: 12px; color: #aaa; margin: 4px 0; cursor: pointer; }
    .filters label input { margin-right: 6px; accent-color: #4a9eff; }
    .filter-group-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.08em; margin: 8px 0 4px; }
    #nav-list { list-style: none; margin: 0; padding: 8px 0; flex: 1; }
    #nav-list li a { display: block; padding: 5px 16px; font-size: 11px; color: #666; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #nav-list li a:hover, #nav-list li a.active { background: #1e1e1e; color: #fff; }
    #nav-list li[data-hidden] { display: none; }

    .section-group { flex-shrink: 0; }
    .section-header { position: sticky; top: 0; background: #111; z-index: 1; padding: 8px 16px; font-size: 10px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #2a2a2a; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; }
    .section-header:hover { color: #bbb; }
    .section-header .chevron { font-size: 8px; transition: transform 0.15s; display: inline-block; }
    .section-header.collapsed .chevron { transform: rotate(-90deg); }
    .section-list { list-style: none; margin: 0; padding: 4px 0; }
    .section-list.collapsed { display: none; }
    .section-list li a { display: block; padding: 5px 16px; font-size: 11px; color: #666; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .section-list li a:hover, .section-list li a.active { background: #1e1e1e; color: #fff; }
    .section-list li[data-hidden] { display: none; }
    .section-list li[data-section="auth"] a { color: #7a8aaa; }
    .section-list li[data-section="auth"] a:hover { color: #aab8d4; background: #1e1e1e; }

    #content { margin-left: 240px; flex: 1; padding: 32px; min-width: 0; }
    .cover { padding: 48px 0 40px; border-bottom: 1px solid #2a2a2a; margin-bottom: 48px; }
    .cover h1 { font-size: 1.75rem; margin: 0 0 8px; font-weight: 600; }
    .cover p { color: #666; margin: 4px 0; font-size: 13px; }

    .page { margin-bottom: 56px; }
    .page[data-hidden] { display: none; }
    .label { background: #0d0d0d; border: 1px solid #2a2a2a; border-bottom: none; padding: 8px 14px; font-size: 12px; color: #ccc; font-family: 'SF Mono', 'Fira Code', monospace; display: flex; align-items: center; gap: 10px; border-radius: 6px 6px 0 0; }
    .label .idx { background: #2a2a2a; color: #888; padding: 1px 6px; border-radius: 3px; font-size: 10px; min-width: 24px; text-align: center; }
    .page[data-section="auth"] .label { background: #0d0f1a; border-color: #2a2e42; color: #9aadcc; }
    .page img { display: block; border: 1px solid #2a2a2a; border-radius: 0 0 6px 6px; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
    img[data-viewport="mobile"] { border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }

    ${viewportCss}

    @media (max-width: 600px) {
      #sidebar { display: none; }
      #content { margin-left: 0; }
    }
  </style>
</head>
<body>
  <nav id="sidebar">
    <div class="nav-header">${escHtml(title)}</div>
    <div class="nav-meta">${escHtml(date)} · ${pages.length} pages</div>
    <div class="filters">
      <div class="filter-group-label">Theme</div>
      ${themeCheckboxes}
      <div class="filter-group-label" style="margin-top:10px">Viewport</div>
      ${viewportCheckboxes}
    </div>
    ${navHtml}
  </nav>
  <main id="content">
    <div class="cover">
      <h1>${escHtml(title)}</h1>
      <p>${escHtml(config.url)}</p>
      <p>${escHtml(date)} · ${pages.length} pages</p>
    </div>
    ${pageSections.join('\n    ')}
  </main>
  <script>
    function toggleSection(header) {
      header.classList.toggle('collapsed');
      const list = header.nextElementSibling;
      if (list && list.classList.contains('section-list')) {
        list.classList.toggle('collapsed');
      }
    }

    function applyFilters() {
      const checked = { theme: new Set(), viewport: new Set() };
      document.querySelectorAll('input[data-filter]').forEach(cb => {
        if (cb.checked) checked[cb.dataset.filter].add(cb.value);
      });
      document.querySelectorAll('.page').forEach(page => {
        // Auth captures are always visible — not part of the theme/viewport matrix
        if (page.dataset.section === 'auth') return;
        const visible = checked.theme.has(page.dataset.theme) && checked.viewport.has(page.dataset.viewport);
        page.toggleAttribute('data-hidden', !visible);
        // Also hide/show the corresponding nav item in the Pages section list
        const link = document.querySelector('.section-list a[href="#' + page.id + '"]');
        if (link) link.closest('li')?.toggleAttribute('data-hidden', !visible);
        // Flat nav fallback
        const flatLink = document.querySelector('#nav-list a[href="#' + page.id + '"]');
        if (flatLink) flatLink.closest('li')?.toggleAttribute('data-hidden', !visible);
      });
    }
    document.querySelectorAll('input[data-filter]').forEach(cb => cb.addEventListener('change', applyFilters));

    let currentIdx = 0;
    function visiblePages() { return [...document.querySelectorAll('.page:not([data-hidden])')]; }
    document.addEventListener('keydown', e => {
      const ps = visiblePages();
      if (!ps.length) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') currentIdx = Math.min(currentIdx + 1, ps.length - 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') currentIdx = Math.max(currentIdx - 1, 0);
      else return;
      ps[currentIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelectorAll('.section-list li a, #nav-list li a').forEach(a => a.classList.remove('active'));
      const link = document.querySelector('a[href="#' + ps[currentIdx].id + '"]');
      if (link) { link.classList.add('active'); link.scrollIntoView({ block: 'nearest' }); }
    });

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.hasAttribute('data-hidden')) {
          const id = entry.target.id;
          document.querySelectorAll('.section-list li a, #nav-list li a').forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.page').forEach(p => observer.observe(p));
  </script>
</body>
</html>`;

  const outputPath = path.join(outputDir, 'console-review.html');
  fs.writeFileSync(outputPath, html, 'utf8');
  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n[html] Wrote ${pages.length} pages (${sizeMB} MB) → ${outputPath}`);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
