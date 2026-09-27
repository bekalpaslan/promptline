const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const README = path.join(__dirname, '..', 'README.md');
const read = () => fs.readFileSync(README, 'utf8').replace(/\r\n/g, '\n');

/** Asserts each part is found in text, in ascending index order. */
function inOrder(text, parts) {
  let last = -1;
  let lastPart = '(start)';
  for (const part of parts) {
    const idx = text.indexOf(part);
    assert.ok(idx !== -1, `expected to find ${JSON.stringify(part)}`);
    assert.ok(
      idx > last,
      `expected ${JSON.stringify(part)} to come after ${JSON.stringify(lastPart)}, but it came before (or at) it`
    );
    last = idx;
    lastPart = part;
  }
}

// ---- Task 1: README top in pitch order -------------------------------------

test('README top (before the first "## ") holds the pitch order', () => {
  const text = read();
  const topEnd = text.indexOf('\n## ');
  const top = topEnd === -1 ? text : text.slice(0, topEnd);
  inOrder(top, [
    '<picture>',
    '**Copy the error. Hit the hotkey. Paste a real prompt.**',
    '**Copy, hotkey, paste.**',
    '**Packs are files agents write.**',
    '**No telemetry, no account.**',
  ]);
});

test('the third pitch line names the update-check cadence', () => {
  const text = read();
  assert.ok(text.includes('One update check, at startup and once a day, off in a click.'));
});

test('the README no longer aims at "people who talk to AI all day"', () => {
  const text = read();
  assert.equal(text.includes('people who talk to AI all day'), false);
});

test('the lead still names Ctrl+Alt+V as the default hotkey', () => {
  const text = read();
  assert.ok(text.includes('Ctrl+Alt+V'));
});

// ---- Task 2: "Why not…" after Install --------------------------------------

test('"## Why not…" exists once, after Install and before Uninstall', () => {
  const text = read();
  const whyNotMatches = text.match(/^## Why not…$/gm) || [];
  assert.equal(whyNotMatches.length, 1);

  const installIdx = text.indexOf('\n## Install');
  const whyNotIdx = text.indexOf('\n## Why not…');
  const uninstallIdx = text.indexOf('\n## Uninstall');
  assert.ok(installIdx !== -1, 'expected an "## Install" heading');
  assert.ok(uninstallIdx !== -1, 'expected an "## Uninstall" heading');
  assert.ok(whyNotIdx > installIdx, 'Why not… must come after Install');
  assert.ok(whyNotIdx < uninstallIdx, 'Why not… must come before Uninstall');
});

test('the Why not… section holds exactly five answers naming the expected tools', () => {
  const text = read();
  const start = text.indexOf('## Why not…');
  assert.ok(start !== -1);
  const rest = text.slice(start + '## Why not…'.length);
  const nextHeadingIdx = rest.indexOf('\n## ');
  const section = nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx);

  const answers = section.match(/^\*\*Why not .+\?\*\*/gm) || [];
  assert.equal(answers.length, 5);

  for (const tool of [
    'Espanso',
    'AutoHotkey',
    'Raycast',
    'slash commands',
    'Cursor rules',
    'Ditto',
    'clipboard history',
    'Notion',
  ]) {
    assert.ok(section.includes(tool), `expected the Why not… section to name ${tool}`);
  }

  assert.ok(section.includes('macOS only'));
  assert.equal(section.includes('same on both platforms'), false);
});

test('the README no longer claims nobody has started a macOS port', () => {
  const text = read();
  assert.equal(text.includes('nobody has done it yet'), false);
});
