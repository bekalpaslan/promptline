const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// SITE-04 and the footer's promise ("loads nothing from other sites"): every
// page under site/ must load its own resources from its own origin. Outbound
// links (<a href>) are exempt by design -- they're navigations a visitor
// chooses, not loads the page makes on its own.

const ABSOLUTE = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const LOADED_TAGS = ['img', 'script', 'link', 'video', 'audio', 'source', 'track', 'iframe', 'embed', 'object', 'input'];
const TAG_RE = new RegExp(`<(${LOADED_TAGS.join('|')})\\b[^>]*>`, 'gi');
const ATTR_RE = /\s(src|href|poster|srcset|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function attrValue(m) {
  return m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
}

function flaggedUrl(url) {
  return ABSOLUTE.test(url);
}

function offSiteLoads(html) {
  html = html.replace(/\r\n/g, '\n');
  const found = [];

  for (const tagMatch of html.matchAll(TAG_RE)) {
    const tag = tagMatch[1].toLowerCase();
    const tagHtml = tagMatch[0];

    if (tag === 'link') {
      const relMatch = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagHtml);
      const rel = relMatch ? (relMatch[1] ?? relMatch[2] ?? relMatch[3]) : '';
      if (rel && rel.toLowerCase().includes('canonical')) continue;
    }

    if (tag === 'script') {
      const srcMatch = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagHtml);
      if (srcMatch) {
        found.push({ tag, attr: 'src', url: srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] });
      }
      continue;
    }

    for (const attrMatch of tagHtml.matchAll(ATTR_RE)) {
      const attr = attrMatch[1].toLowerCase();
      const value = attrValue(attrMatch);
      if (value === undefined) continue;

      if (attr === 'srcset') {
        for (const candidate of value.split(',')) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url && flaggedUrl(url)) found.push({ tag, attr, url });
        }
        continue;
      }

      if (attr === 'href' && tag !== 'link') continue; // <a href> is a navigation, never collected
      if (flaggedUrl(value)) found.push({ tag, attr, url: value });
    }
  }

  // <style>...</style> bodies and inline style="..." attributes: flag url(...) and @import
  const styleBodies = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const styleAttrs = [...html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]);
  for (const body of [...styleBodies, ...styleAttrs]) {
    if (/@import/i.test(body)) found.push({ tag: 'style', attr: '@import', url: body.trim().slice(0, 80) });
    for (const urlMatch of body.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
      const raw = urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? '';
      const url = raw.trim();
      if (url && flaggedUrl(url)) found.push({ tag: 'style', attr: 'url()', url });
    }
  }

  return found;
}

test('offSiteLoads flags an absolute img src', () => {
  assert.deepEqual(offSiteLoads('<img src="https://x.test/a.png">'), [{ tag: 'img', attr: 'src', url: 'https://x.test/a.png' }]);
});

test('offSiteLoads never collects an <a href>, even an absolute one', () => {
  assert.deepEqual(offSiteLoads('<a href="https://github.com">GitHub</a>'), []);
});

test('offSiteLoads skips a canonical <link>', () => {
  assert.deepEqual(offSiteLoads('<link rel="canonical" href="https://promptline.cc/">'), []);
});

test('offSiteLoads flags a protocol-relative video poster', () => {
  assert.deepEqual(offSiteLoads('<video poster="//cdn.test/p.png"></video>'), [{ tag: 'video', attr: 'poster', url: '//cdn.test/p.png' }]);
});

test('offSiteLoads flags only the absolute candidate in a srcset', () => {
  assert.deepEqual(
    offSiteLoads('<img srcset="a.png 1x, https://x.test/b.png 2x">'),
    [{ tag: 'img', attr: 'srcset', url: 'https://x.test/b.png' }],
  );
});

test('offSiteLoads flags a <script src> of any origin, since the site\'s one script is inline', () => {
  assert.deepEqual(offSiteLoads('<script src="a.js"></script>'), [{ tag: 'script', attr: 'src', url: 'a.js' }]);
});

test('offSiteLoads flags an absolute url() inside a <style> block', () => {
  assert.deepEqual(
    offSiteLoads('<style>body{background:url(https://x.test/f.woff2)}</style>'),
    [{ tag: 'style', attr: 'url()', url: 'https://x.test/f.woff2' }],
  );
});

test('offSiteLoads flags any @import', () => {
  const found = offSiteLoads('<style>@import "https://x.test/f.css";</style>');
  assert.equal(found.length, 1);
  assert.equal(found[0].attr, '@import');
});

test('every site/**/*.html page has zero off-site loads', () => {
  const siteDir = path.join(__dirname, '..', 'site');
  const skip = new Set(['shots', 'clip']);

  function walk(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        files.push(...walk(path.join(dir, entry.name)));
      } else if (entry.name.endsWith('.html')) {
        files.push(path.join(dir, entry.name));
      }
    }
    return files;
  }

  for (const file of walk(siteDir)) {
    const html = fs.readFileSync(file, 'utf8');
    assert.deepEqual(offSiteLoads(html), [], `${path.relative(siteDir, file)} loads something off-site`);
  }
});
