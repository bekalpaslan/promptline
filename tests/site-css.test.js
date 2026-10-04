// The site's shared stylesheet: every page under site/ links /site.css and
// keeps only its own rules inline, after it. The tokens and the header live
// in that one file; a page that defines them again has started to drift.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', 'site');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function htmlPages(dir = SITE) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlPages(full));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

test('every site page links /site.css once, before any inline style', () => {
  const pages = htmlPages();
  assert.ok(pages.length >= 5, 'expected the home page, the posts and the code signing policy');
  for (const page of pages) {
    const html = read(page);
    const links = html.match(/<link rel="stylesheet" href="\/site\.css">/g) || [];
    assert.equal(links.length, 1, `${page} should link /site.css exactly once`);
    const style = html.indexOf('<style>');
    if (style !== -1) {
      assert.ok(html.indexOf('href="/site.css"') < style, `${page}: /site.css must come before the page's own <style>, so the page's rules win`);
    }
  }
});

test('no site page defines the tokens or the header itself', () => {
  for (const page of htmlPages()) {
    const html = read(page);
    assert.equal(/--surface-0\s*:/.test(html), false, `${page} defines --surface-0; the tokens belong in site/site.css`);
    assert.equal(/\n\s*header \{ *\n/.test(html), false, `${page} styles the header; that belongs in site/site.css`);
  }
});

test('site/site.css carries both themes, the pinned ones too, and the phone menu', () => {
  const css = read(path.join(SITE, 'site.css'));
  assert.equal((css.match(/--surface-0\s*:/g) || []).length, 3, 'light, system dark and pinned dark');
  assert.match(css, /:root\[data-theme="dark"\] \{/);
  assert.match(css, /:root:not\(\[data-theme="light"\]\) \{/);
  assert.match(css, /\.menu-open \.nav-right \{/);
});
