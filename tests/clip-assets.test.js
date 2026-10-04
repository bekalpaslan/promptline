// SITE-01, D-03: docs/clip carries the launch clip in both themes, as video
// (MP4 + WebM), README GIF and poster, each within its size budget so the
// site's video stays sharp at 2x and a few hundred KB. 06-05 adds the
// site/README reference checks to this same file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'docs', 'clip');
const THEMES = ['light', 'dark'];
const BUDGET = { mp4: 800_000, webm: 800_000, gif: 3_000_000, 'poster.png': 700_000 };

function readNormalized(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8').replace(/\r\n/g, '\n');
}

function findVideos(html) {
  return [...html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/g)];
}

function assertBudget(name, ext) {
  const file = path.join(DIR, name);
  const size = fs.statSync(file).size;
  const budget = BUDGET[ext];
  assert.ok(
    size <= budget,
    `docs/clip/${name} is ${size} bytes, over its ${budget} byte budget; rerun \`npm run clip\` with a higher -crf (or lower GIF_FPS/GIF_WIDTH for the gif)`,
  );
}

for (const theme of THEMES) {
  test(`clip-${theme}.mp4 exists, is H.264 MP4, within budget`, () => {
    const name = `clip-${theme}.mp4`;
    const file = path.join(DIR, name);
    assert.ok(fs.existsSync(file), `docs/clip/${name} missing: rerun \`npm run clip\``);
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(4, 8).toString('ascii'), 'ftyp', `docs/clip/${name} has no ftyp box at bytes 4..8`);
    assertBudget(name, 'mp4');
  });

  test(`clip-${theme}.webm exists, is a WebM/EBML container, within budget`, () => {
    const name = `clip-${theme}.webm`;
    const file = path.join(DIR, name);
    assert.ok(fs.existsSync(file), `docs/clip/${name} missing: rerun \`npm run clip\``);
    const buf = fs.readFileSync(file);
    assert.deepEqual(
      [...buf.subarray(0, 4)],
      [0x1a, 0x45, 0xdf, 0xa3],
      `docs/clip/${name} does not start with the EBML signature`,
    );
    assertBudget(name, 'webm');
  });

  test(`clip-${theme}.gif exists, is a GIF89a, within budget`, () => {
    const name = `clip-${theme}.gif`;
    const file = path.join(DIR, name);
    assert.ok(fs.existsSync(file), `docs/clip/${name} missing: rerun \`npm run clip\``);
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a', `docs/clip/${name} has no GIF89a signature`);
    assertBudget(name, 'gif');
  });

  test(`clip-${theme}-poster.png exists, is a 1440x1080 PNG, within budget`, () => {
    const name = `clip-${theme}-poster.png`;
    const file = path.join(DIR, name);
    assert.ok(fs.existsSync(file), `docs/clip/${name} missing: rerun \`npm run clip\``);
    const buf = fs.readFileSync(file);
    assert.deepEqual(
      [...buf.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `docs/clip/${name} has no PNG signature`,
    );
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width, 1440, `docs/clip/${name} width is ${width}, expected 1440`);
    assert.equal(height, 1080, `docs/clip/${name} height is ${height}, expected 1080`);
    assertBudget(name, 'poster.png');
  });
}

// 06-05: the site and README reference the rendered clip files, one <video>
// per theme, no autoplay/media-attribute shortcuts, and the README's GIF
// <picture> follows GitHub's own theme.
test('site/index.html has exactly one light and one dark clip <video>, no autoplay, preload="none"', () => {
  const html = readNormalized('site/index.html');
  assert.equal((html.match(/<video\b/g) || []).length, 2, 'expected exactly 2 <video> elements');
  assert.equal(html.includes('class="composite"'), false, 'the .composite hero markup must be gone');

  const videos = findVideos(html);
  assert.equal(videos.length, 2);
  for (const [, attrs, inner] of videos) {
    assert.match(attrs, /\bmuted\b/);
    assert.match(attrs, /\bloop\b/);
    assert.match(attrs, /\bplaysinline\b/);
    assert.match(attrs, /preload="none"/);
    assert.equal(/\bautoplay\b/.test(attrs), false);
    assert.match(inner, /<source src="clip\/clip-(light|dark)\.webm" type="video\/webm">/);
    assert.match(inner, /<source src="clip\/clip-(light|dark)\.mp4" type="video\/mp4">/);
    // no <source> media attribute: the page's theme switch drives it, not the browser
    assert.equal(/<source\b[^>]*\bmedia=/.test(inner), false);
  }
  const lightVideo = videos.find(([, attrs]) => attrs.includes('class="light-only"'));
  const darkVideo = videos.find(([, attrs]) => attrs.includes('class="dark-only"'));
  assert.ok(lightVideo, 'expected a light-only clip <video>');
  assert.ok(darkVideo, 'expected a dark-only clip <video>');
  // The poster is a CSS background per theme, never the poster attribute: a
  // display:none video still downloads its poster, so both themes' loaded
  assert.equal(/\bposter=/.test(lightVideo[1] + darkVideo[1]), false, 'no poster attribute on the clip videos');
  assert.match(html, /\.clip video\.light-only \{ background: url\(clip\/clip-light-poster\.webp\)/);
  assert.match(html, /\.clip video\.dark-only \{ background: url\(clip\/clip-dark-poster\.webp\)/);
});

test('site/index.html script drives the clip via syncClip, and the footer names it', () => {
  const html = readNormalized('site/index.html');
  assert.ok((html.match(/syncClip/g) || []).length >= 3, 'syncClip should be defined and called at least 3 times');
  assert.equal(
    (html.match(/plays the clip for the theme showing/g) || []).length,
    1,
    'the script header comment should say it plays the clip for the theme showing',
  );
  assert.equal(
    (html.match(/its one script switches the page between light and dark, plays the clip for the theme showing, and fades the screenshots in/g) || []).length,
    1,
    'the footer privacy sentence should mention the clip',
  );
});

test('README.md leads with the clip GIF <picture>, not the popup screenshot', () => {
  const readme = readNormalized('README.md');
  assert.equal(
    (readme.match(/srcset="docs\/clip\/clip-dark\.gif"/g) || []).length,
    1,
    'README should reference docs/clip/clip-dark.gif once',
  );
  assert.equal(readme.includes('popup-preview-light.png'), false, 'the old popup screenshot picture should be gone');
  assert.match(readme, /<img src="docs\/clip\/clip-light\.gif"/);
});

test('.github/workflows/pages.yml fills site/clip from docs/clip through scripts/site-assets.mjs, and .gitignore ignores it', () => {
  const pagesYml = readNormalized('.github/workflows/pages.yml');
  assert.equal((pagesYml.match(/"docs\/clip\/\*\*"/g) || []).length, 1, 'pages.yml paths should list docs/clip/**');
  assert.equal((pagesYml.match(/node scripts\/site-assets\.mjs/g) || []).length, 1, 'pages.yml should run scripts/site-assets.mjs once');
  const assets = readNormalized('scripts/site-assets.mjs');
  assert.match(assets, /at\('docs', 'clip'\)/, 'site-assets.mjs should read docs/clip');
  assert.match(assets, /at\('site', 'clip', name\)/, 'site-assets.mjs should copy into site/clip');
  assert.match(assets, /-poster\.png/, 'site-assets.mjs should make the WebP posters the page uses');

  const gitignore = readNormalized('.gitignore');
  assert.match(gitignore, /^site\/clip\/$/m);
});

test('CLAUDE.md documents the clip in the site paragraph', () => {
  const claudeMd = readNormalized('CLAUDE.md');
  assert.ok((claudeMd.match(/docs\/clip/g) || []).length >= 2, 'CLAUDE.md should mention docs/clip at least twice');
});
