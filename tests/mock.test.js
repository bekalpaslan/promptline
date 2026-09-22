// The three lists of Tauri commands have to agree: what the UI invokes, what
// Rust registers, and what the fake backend (src/lib/dev-mock.ts) answers.
// A command missing from the mock resolves to null in the browser, which
// reads as "cancelled" or "empty" and hides a whole flow from verification
// (CLAUDE.md: "When you add a Tauri command the UI depends on, add it to the
// mock too"); one missing from Rust fails at runtime in both windows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const uiFiles = walk(path.join(root, 'src')).filter(f => !f.endsWith('dev-mock.ts'));
const invoked = new Set();
for (const f of uiFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)) invoked.add(m[1]);
}

// The handler names each command by its module (`commands::get_snippets`);
// the command's name is what the webview invokes
const rust = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const handler = rust.match(/generate_handler!\[([\s\S]*?)\]/);
const registered = new Set(handler[1].split(/[\s,]+/).filter(Boolean).map(c => c.replace(/^.*::/, '')));

const mock = fs.readFileSync(path.join(root, 'src', 'lib', 'dev-mock.ts'), 'utf8');
const body = mock.slice(mock.indexOf('const commands'));
const mocked = new Set([...body.matchAll(/^\s{4}"?([a-z_]+)"?:\s/gm)].map(m => m[1]));

test('every command the UI invokes is registered in Rust', () => {
  assert.ok(invoked.size > 20, `found only ${invoked.size} invokes; the scan is broken`);
  const missing = [...invoked].filter(c => !registered.has(c));
  assert.deepEqual(missing, []);
});

test('every command the UI invokes is answered by the dev mock', () => {
  const missing = [...invoked].filter(c => !mocked.has(c));
  assert.deepEqual(missing, []);
});

test('every command Rust registers is invoked somewhere (no dead commands)', () => {
  const dead = [...registered].filter(c => !invoked.has(c));
  assert.deepEqual(dead, []);
});
