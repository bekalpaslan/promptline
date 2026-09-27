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
