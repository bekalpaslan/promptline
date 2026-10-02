const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
// scripts/tokens.mjs is ESM; Node 22.12+ loads it through require()
const tokens = require('../scripts/tokens.mjs');

// ---- design/tokens.json → src/index.css -----------------------------------

test('src/index.css matches design/tokens.json and design/indigo.tokens.json (run `npm run tokens` if not)', () => {
  const css = fs.readFileSync(tokens.CSS_PATH, 'utf8');
  assert.equal(tokens.applyAll(css), css);
});

test('every mapped token exists in every theme file and every contrast pair clears its floor', () => {
  for (const p of tokens.PALETTES) {
    const t = tokens.readTokens(p.file);
    const names = new Set(tokens.allTokens(t).map((x) => x.name));
    for (const name of Object.keys(tokens.MAP)) assert.ok(names.has(name), `${p.id}: MAP names a missing token: ${name}`);
    assert.deepEqual(tokens.contrastFailures(t), [], p.id);
  }
});

test('the two theme files declare the same tokens', () => {
  const [a, b] = tokens.PALETTES.map((p) => tokens.allTokens(tokens.readTokens(p.file)).map((x) => x.name));
  assert.deepEqual(b, a);
});

test('render emits one line per mapped property, the font in the first theme and the radii only there', () => {
  const t = tokens.readTokens();
  const light = tokens.render(t, 'light');
  const dark = tokens.render(t, 'dark');
  const mapped = Object.values(tokens.MAP).flat().length;
  const radii = t.radius.tokens.filter((x) => tokens.MAP[x.name]).flatMap((x) => tokens.MAP[x.name]).length;
  assert.equal(light.length, mapped + 1);
  assert.equal(dark.length, mapped - radii);
  assert.ok(light[0].startsWith('--app-font:'));
  assert.ok(light.some((l) => l.startsWith('--radius: ')));
  assert.ok(!dark.some((l) => l.startsWith('--radius: ')));
  assert.ok(dark.every((l) => /^--[a-z-]+: .+;$/.test(l)));
  // The second theme's regions carry no font stack: Font is the user's own pref
  const indigo = tokens.render(tokens.readTokens(tokens.PALETTES[1].file), 'light', { font: false });
  assert.ok(!indigo.some((l) => l.startsWith('--app-font:')));
  assert.ok(indigo.some((l) => l === '--search-radius: 999px;'));
});

test('apply keeps CRLF and indentation and is idempotent', () => {
  const t = tokens.readTokens();
  const css = ':root {\r\n    color-scheme: light;\r\n    /* @tokens light: generated from design/tokens.json by `npm run tokens`; edit the JSON, not these lines */\r\n    --stale: 1;\r\n    /* @tokens end */\r\n    --kept: 1;\r\n}\r\n.dark {\r\n  /* @tokens dark: generated from design/tokens.json by `npm run tokens`; edit the JSON, not these lines */\r\n  /* @tokens end */\r\n}\r\n';
  const once = tokens.apply(css, t);
  assert.ok(!once.includes('--stale'));
  assert.ok(once.includes('    --kept: 1;'));
  assert.ok(once.includes('\r\n    --background: '));
  assert.ok(once.includes('\r\n  --background: '));
  assert.ok(!once.includes('\n\n') && !/[^\r]\n/.test(once), 'line endings stay CRLF');
  assert.equal(tokens.apply(once, t), once);
});

test('contrast flags a failing pair by theme', () => {
  const t = tokens.readTokens();
  const bad = structuredClone(t);
  bad.color.tokens.find((x) => x.name === 'ink-3').value.light = '#bbbbbb';
  const failures = tokens.contrastFailures(bad);
  assert.ok(failures.some((f) => f.startsWith('light: ink-3 on surface-0:')));
  assert.ok(!failures.some((f) => f.startsWith('dark:')));
});
