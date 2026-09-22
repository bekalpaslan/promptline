// src/lib/core.ts types ui/core.js by hand: `PromptlineCore` is an interface
// written against the UMD module, which tsc never sees. A renamed or
// forgotten export passed every check and failed at runtime in both
// windows (RELEASE-AUDIT.md M14). This pins the two member lists to each
// other; the signatures are still by hand.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../ui/core.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'core.ts'), 'utf8');
const block = /interface PromptlineCore \{\r?\n([\s\S]*?)\r?\n\}/.exec(source);
// One member per line at two spaces of indent, its name first, then `(`,
// `<` (a generic) or `:` (a value)
const declared = [...block[1].matchAll(/^  ([A-Za-z_$][\w$]*)\s*[(<:]/gm)].map(m => m[1]);

test('the PromptlineCore interface is found and non-trivial', () => {
  assert.ok(block, 'interface PromptlineCore { … } not found in src/lib/core.ts');
  assert.ok(declared.length > 30, `parsed only ${declared.length} members; the regex is broken`);
  assert.equal(new Set(declared).size, declared.length, 'a member is declared twice');
});

test('every export of ui/core.js is declared in the interface', () => {
  const missing = Object.keys(core).filter(k => !declared.includes(k));
  assert.deepEqual(missing, [], 'exported by core.js, missing from the interface');
});

test('every interface member is exported by ui/core.js', () => {
  const missing = declared.filter(k => !(k in core));
  assert.deepEqual(missing, [], 'declared in the interface, not exported by core.js');
});
