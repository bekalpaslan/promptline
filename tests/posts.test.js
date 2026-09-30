const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The posts section (Phase 10, D-04/D-05): every page's footer links Posts and
// Discussions, /posts/ lists every post, and each post keeps the subpage
// header, its own canonical URL and the plain platform line (D-02).

const SITE = path.join(__dirname, '..', 'site');
const POSTS = path.join(SITE, 'posts');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m),
  );
}

// What a sighted visitor reads: no <head>, scripts, styles, icons, comments or attributes
function visibleText(html) {
  return decode(
    html
      .replace(/<head[\s\S]*?<\/head>/i, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

const count = (text, phrase) => text.toLowerCase().split(phrase.toLowerCase()).length - 1;

// The home page's search phrases (tests/site-content.test.js): once there, never in a post
const PHRASES = ['prompt manager', 'prompt library hotkey', 'snippet manager for ChatGPT', 'prompt templates Claude Code'];

function sitePages(dir = SITE) {
  const skip = new Set(['shots', 'clip']);
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) files.push(...sitePages(path.join(dir, entry.name)));
    } else if (entry.name === 'index.html') {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const postSlugs = () =>
  fs.existsSync(POSTS)
    ? fs.readdirSync(POSTS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];

const postHtml = (slug) => read(path.join(POSTS, slug, 'index.html'));

function main(html) {
  const start = html.indexOf('<main');
  assert.ok(start >= 0, 'missing <main>');
  return html.slice(start, html.indexOf('</main>', start) + '</main>'.length);
}

function nav(html, label) {
  const m = new RegExp(`<nav aria-label="${label}">([\\s\\S]*?)</nav>`).exec(html);
  assert.ok(m, `missing <nav aria-label="${label}">`);
  return m[1];
}

// ---- footers and the index ----

test('every site page\'s footer links Posts and Discussions', () => {
  const pages = sitePages();
  assert.ok(pages.length >= 3, 'expected the home page, code signing and the posts index at least');
  for (const file of pages) {
    const links = nav(read(file), 'Links');
    const where = path.relative(SITE, file);
    assert.equal(links.split('href="/posts/"').length - 1, 1, `${where}: footer should link Posts exactly once`);
    assert.ok(links.includes('href="https://github.com/bekalpaslan/promptline/discussions"'), `${where}: footer has no Discussions link`);
  }
});

test('the posts index links every post', () => {
  const index = read(path.join(POSTS, 'index.html'));
  for (const slug of postSlugs()) {
    assert.ok(index.includes(`href="/posts/${slug}/"`), `/posts/ does not link ${slug}`);
  }
});

test('the posts index\'s canonical is https://promptline.cc/posts/', () => {
  const index = read(path.join(POSTS, 'index.html'));
  assert.ok(index.includes('<link rel="canonical" href="https://promptline.cc/posts/">'));
  assert.ok(index.includes('<meta property="og:url" content="https://promptline.cc/posts/">'));
});

// ---- each post ----

test('each post\'s canonical and og:url are its promptline.cc/posts URL', () => {
  for (const slug of postSlugs()) {
    const html = postHtml(slug);
    const url = `https://promptline.cc/posts/${slug}/`;
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), `${slug}: canonical is not ${url}`);
    assert.ok(html.includes(`<meta property="og:url" content="${url}">`), `${slug}: og:url is not ${url}`);
  }
});

test('post pages keep the subpage header', () => {
  for (const file of [path.join(POSTS, 'index.html'), ...postSlugs().map((s) => path.join(POSTS, s, 'index.html'))]) {
    const hrefs = [...nav(read(file), 'Site').matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, ['/', '/#install', 'https://github.com/bekalpaslan/promptline'], path.relative(SITE, file));
  }
});

test('each post says Windows 10/11 today and macOS in progress, and nothing about signing (D-02)', () => {
  for (const slug of postSlugs()) {
    const text = visibleText(main(postHtml(slug)));
    assert.ok(text.includes('Windows 10/11'), `${slug}: no "Windows 10/11"`);
    assert.ok(text.includes('macOS') && text.includes('in progress'), `${slug}: no "macOS … in progress"`);
    assert.doesNotMatch(text, /\b(un)?sign(ed|ing)\b|SmartScreen|code.signing/i, `${slug}: mentions signing`);
  }
});

test('each post links the home page or the download', () => {
  for (const slug of postSlugs()) {
    const body = main(postHtml(slug));
    assert.ok(body.includes('href="/"') || body.includes('href="/#install"'), `${slug}: no link to / or /#install`);
  }
});

test('no post repeats a home-page search phrase', () => {
  for (const slug of postSlugs()) {
    const text = visibleText(postHtml(slug));
    for (const phrase of PHRASES) {
      assert.equal(count(text, phrase), 0, `${slug} says "${phrase}", which belongs to the home page once`);
    }
  }
});

test('each post has one h1 and a publication date', () => {
  for (const slug of postSlugs()) {
    const body = main(postHtml(slug));
    assert.equal((body.match(/<h1[\s>]/g) || []).length, 1, `${slug}: expected one <h1>`);
    assert.equal((body.match(/<time datetime="\d{4}-\d{2}-\d{2}">/g) || []).length, 1, `${slug}: expected one dated <time>`);
  }
});

test('there is at least one post', () => {
  assert.ok(postSlugs().length >= 1, 'site/posts/ has no post directories');
});

// ---- links into the posts ----

test('the home page links the team-pack post', () => {
  const home = read(path.join(SITE, 'index.html'));
  assert.equal(count(home, 'href="/posts/claude-code-writes-your-pack/"'), 1, 'site/index.html should link the team-pack post once, in the Generate chapter');
});
