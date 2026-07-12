const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../ui/core.js');

// ---- tokenize / field detection -------------------------------------------

test('tokenize classifies builtin, field, config, bad, and text', () => {
  const parts = core.tokenize('A {clipboard} B {goal} C {{cfg}} D {File} E {step1}');
  const types = parts.map(p => p.type);
  assert.deepEqual(types, [
    'text', 'builtin', 'text', 'field', 'text', 'config', 'text', 'bad', 'text', 'bad',
  ]);
  assert.equal(parts[1].name, 'clipboard');
  assert.equal(parts[3].name, 'goal');
  assert.equal(parts[5].name, 'cfg');
  assert.equal(parts[7].name, 'File');
  assert.equal(parts[9].name, 'step1');
});

test('customFields returns runtime fields only, unique, in order', () => {
  const text = '{goal} then {clipboard} then {goal} and {{cfg}} and {bug}';
  assert.deepEqual(core.customFields(text), ['goal', 'bug']);
});

test('configNames returns double-brace params only', () => {
  assert.deepEqual(core.configNames('{{a}} {b} {{a}} {{c_d}}'), ['a', 'c_d']);
});

test('literal braces in code samples are not treated as params', () => {
  const fields = core.customFields('if (x) { return; } and {ok}');
  assert.deepEqual(fields, ['ok']);
});

// ---- config expansion -------------------------------------------------------

test('expandConfig substitutes set values and preserves unset tokens', () => {
  const out = core.expandConfig('Hi {{name}}, focus: {{focus}}', { name: 'Alp' });
  assert.equal(out, 'Hi Alp, focus: {{focus}}');
});

test('downgradeUnsetConfig turns leftover config params into runtime fields', () => {
  assert.equal(core.downgradeUnsetConfig('x {{focus}} y'), 'x {focus} y');
});

test('empty-string config value counts as unset', () => {
  const out = core.expandConfig('{{a}}', { a: '' });
  assert.equal(out, '{{a}}');
});

test('expandBuiltins replaces date and time deterministically', () => {
  const now = new Date(2026, 6, 12, 9, 5);
  const out = core.expandBuiltins('on {date} at {time}', now);
  assert.ok(!out.includes('{date}'));
  assert.ok(!out.includes('{time}'));
});

// ---- fuzzy matching ---------------------------------------------------------

test('fuzzyScore: contiguous match beats subsequence, indices returned', () => {
  const contiguous = core.fuzzyScore('rev', 'Review this');
  const subsequence = core.fuzzyScore('rvw', 'Review this');
  assert.ok(contiguous.score < subsequence.score);
  assert.deepEqual(contiguous.indices, [0, 1, 2]);
  assert.equal(subsequence.indices.length, 3);
});

test('fuzzyScore: earlier contiguous match ranks better', () => {
  const early = core.fuzzyScore('plan', 'plan before code');
  const late = core.fuzzyScore('plan', 'make a plan');
  assert.ok(early.score < late.score);
});

test('fuzzyScore: no match returns null; empty query matches everything', () => {
  assert.equal(core.fuzzyScore('xyz', 'abc'), null);
  assert.deepEqual(core.fuzzyScore('', 'anything'), { score: 0, indices: [] });
});

// ---- query parsing / filters --------------------------------------------------

test('parseQuery splits #tag and @pack terms from fuzzy text', () => {
  const q = core.parseQuery('#debug root @starter cause');
  assert.deepEqual(q.tags, ['debug']);
  assert.deepEqual(q.packs, ['starter']);
  assert.equal(q.text, 'root cause');
});

test('bare # or @ are ignored, not treated as filters', () => {
  const q = core.parseQuery('# @ hello');
  assert.deepEqual(q.tags, []);
  assert.deepEqual(q.packs, []);
  assert.equal(q.text, 'hello');
});

test('matchesFilters requires every tag and pack filter to hit', () => {
  const s = { tags: ['debug', 'rust'], pack: 'Starter' };
  assert.ok(core.matchesFilters(s, { tags: ['deb'], packs: ['start'] }));
  assert.ok(!core.matchesFilters(s, { tags: ['review'], packs: [] }));
  assert.ok(!core.matchesFilters(s, { tags: [], packs: ['session'] }));
});

// ---- tag colors -----------------------------------------------------------------

test('known tags get fixed colors; unknown tags get a stable hashed color', () => {
  assert.equal(core.tagColor('debug'), core.TAG_COLORS.debug);
  assert.equal(core.tagColor('Debug'), core.TAG_COLORS.debug);
  const a = core.tagColor('custom-tag');
  assert.equal(a, core.tagColor('custom-tag'));
  assert.ok(Object.values(core.TAG_COLORS).includes(a));
});

// ---- pack parsing -----------------------------------------------------------------

test('parsePacks: single pack object', () => {
  const packs = core.parsePacks(JSON.stringify({
    name: 'Rust', prompts: [{ title: 'A', text: 'x', tags: ['Rust', ' Debug '] }],
  }));
  assert.equal(packs.length, 1);
  assert.equal(packs[0].name, 'Rust');
  assert.deepEqual(packs[0].prompts[0].tags, ['rust', 'debug']);
});

test('parsePacks: array of packs (library export)', () => {
  const packs = core.parsePacks(JSON.stringify([
    { name: 'A', prompts: [{ title: 't', text: 'x' }] },
    { name: 'B', prompts: [] },
  ]));
  assert.deepEqual(packs.map(p => p.name), ['A', 'B']);
});

test('parsePacks: legacy flat array, category becomes a tag', () => {
  const packs = core.parsePacks(JSON.stringify([
    { title: 'Old', text: 'x', category: 'Debug' },
  ]));
  assert.equal(packs[0].name, 'Imported');
  assert.deepEqual(packs[0].prompts[0].tags, ['debug']);
});

test('parsePacks: tolerates markdown code fences', () => {
  const raw = '```json\n' + JSON.stringify({ name: 'F', prompts: [] }) + '\n```';
  assert.equal(core.parsePacks(raw)[0].name, 'F');
});

test('parsePacks: invalid prompts are dropped, garbage throws', () => {
  const packs = core.parsePacks(JSON.stringify({
    name: 'P', prompts: [{ title: 'ok', text: 'x' }, { nope: true }, 'junk'],
  }));
  assert.equal(packs[0].prompts.length, 1);
  assert.throws(() => core.parsePacks('not json'));
  assert.throws(() => core.parsePacks('"just a string"'));
});

// ---- misc ------------------------------------------------------------------------

test('fmtHotkey capitalizes parts', () => {
  assert.equal(core.fmtHotkey('ctrl+shift+v'), 'Ctrl+Shift+V');
  assert.equal(core.fmtHotkey('alt+space'), 'Alt+Space');
});
