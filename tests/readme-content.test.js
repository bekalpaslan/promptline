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
