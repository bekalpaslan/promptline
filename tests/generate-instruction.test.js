const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The Generate dialog's survey text and the pack template's description of
// it ship to every user. Until 2026-10-29 both named the maintainer's private
// planning tool as the example of a workflow command, in a command form that
// tool no longer used. The example has to stay generic.
const ROOT = path.join(__dirname, '..');
const FILES = ['src/manager/GenerateDialog.tsx', 'packs/TEMPLATE.md'];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('the shipped instruction names no maintainer-local tool', () => {
  for (const rel of FILES) {
    const text = read(rel);
    assert.equal(/gsd/i.test(text), false, `${rel} names the maintainer's planning tool ("gsd")`);
    assert.equal(text.includes('/gsd'), false, `${rel} names a /gsd command`);
  }
});

test('the survey still asks the agent to wrap the commands the project defines', () => {
  for (const rel of FILES) {
    assert.ok(
      read(rel).includes('slash commands or skills the project defines'),
      `${rel} should point the agent at the project's own slash commands or skills`
    );
  }
});
