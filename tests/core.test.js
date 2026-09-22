const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../ui/core.js');

// ---- tokenize / field detection -------------------------------------------

test('tokenize classifies builtin, field, config, bad, and text', () => {
  // Digits are allowed after the first character ({step1}), never first ({1st})
  const parts = core.tokenize('A {clipboard} B {goal} C {{cfg}} D {File} E {step1} F {1st}');
  const types = parts.map(p => p.type);
  assert.deepEqual(types, [
    'text', 'builtin', 'text', 'field', 'text', 'config', 'text', 'bad', 'text', 'field', 'text', 'bad',
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

test('requiredInputs counts runtime fields plus unset config params', () => {
  const s = {
    text: 'Do {goal} with {{standing}} and {{unset}} plus {clipboard}',
    configValues: { standing: 'set value' },
  };
  assert.deepEqual(core.requiredInputs(s), ['goal', 'unset']);
  assert.deepEqual(core.requiredInputs({ text: 'plain {clipboard} only', configValues: {} }), []);
});

test('fillFields inserts values literally, including $ patterns (H5)', () => {
  assert.equal(core.fillFields('cap {goal} now', { goal: 'spend at $$50' }), 'cap spend at $$50 now');
  assert.equal(core.fillFields('see {goal} above', { goal: 'this $& and $\' and $`' }), "see this $& and $' and $` above");
  assert.equal(core.fillFields('{a} and {a} and {b}', { a: '1', b: '' }), '1 and 1 and ');
});

test('fillFields leaves builtins and unvalued fields alone', () => {
  assert.equal(core.fillFields('{clipboard} {goal} {File}', { goal: 'x' }), '{clipboard} x {File}');
  assert.equal(core.fillFields('{goal}', {}), '{goal}');
  assert.equal(core.fillFields('{goal}'), '{goal}');
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

// ---- ranking -------------------------------------------------------------------------

test('rankSnippets: pins lead with no query, then uses, then title', () => {
  const lib = [
    { id: 'a', title: 'Zeta', text: '', tags: [], uses: 9, pinned: false },
    { id: 'b', title: 'Alpha', text: '', tags: [], uses: 0, pinned: true },
    { id: 'c', title: 'Beta', text: '', tags: [], uses: 2, pinned: false },
    { id: 'd', title: 'Gamma', text: '', tags: [], uses: 2, pinned: false },
  ];
  assert.deepEqual(core.rankSnippets('', lib).map(e => e.s.id), ['b', 'a', 'c', 'd']);
  assert.equal(core.rankSnippets('', lib)[0].indices, null);
});

test('rankSnippets: pins hold their pin order whatever their use counts (BH3-1)', () => {
  const lib = [
    { id: 'first', title: 'Zeta', text: '', tags: [], uses: 0, pinned: true, pinnedAt: 100 },
    { id: 'second', title: 'Alpha', text: '', tags: [], uses: 99, pinned: true, pinnedAt: 200 },
    { id: 'plain', title: 'Beta', text: '', tags: [], uses: 5, pinned: false },
  ];
  // Pasting the second pin over and over must not take the first one's Ctrl+1 slot
  assert.deepEqual(core.rankSnippets('', lib).map(e => e.s.id), ['first', 'second', 'plain']);
  // Legacy pins (no stamp) lead, by title among themselves
  const legacy = [
    { id: 'stamped', title: 'Alpha', text: '', tags: [], uses: 0, pinned: true, pinnedAt: 100 },
    { id: 'old-z', title: 'Zeta', text: '', tags: [], uses: 1, pinned: true },
    { id: 'old-b', title: 'Beta', text: '', tags: [], uses: 9, pinned: true },
  ];
  assert.deepEqual(core.rankSnippets('', legacy).map(e => e.s.id), ['old-b', 'old-z', 'stamped']);
});

test('withPin stamps the pin order, keeps it on a re-pin, clears it on unpin (BH3-1)', () => {
  const s = { id: 'a', title: 'A', pinned: false, pinnedAt: 0 };
  const pinned = core.withPin(s, true, 1234);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.pinnedAt, 1234);
  assert.equal(s.pinned, false); // pure
  assert.equal(core.withPin(pinned, true, 9999).pinnedAt, 1234);
  assert.deepEqual(core.withPin(pinned, false, 9999).pinnedAt, 0);
  assert.equal(core.withPin(pinned, false).pinned, false);
  // A legacy pin gets a stamp the next time it is pinned
  assert.equal(core.withPin({ id: 'b', pinned: true }, true, 7).pinnedAt, 7);
});

test("rankSnippets leaves an untouched \"New prompt\" draft out of the list (BH3-L)", () => {
  const lib = [
    { id: 'draft', title: 'New prompt', text: '', tags: [], uses: 0, pinned: false },
    { id: 'blank-ish', title: 'New prompt', text: '  \n ', tags: [], uses: 0, pinned: false },
    { id: 'used', title: 'New prompt', text: '', tags: [], uses: 3, pinned: false },
    { id: 'written', title: 'New prompt', text: 'body', tags: [], uses: 0, pinned: false },
    { id: 'real', title: 'Root cause', text: 'x', tags: [], uses: 0, pinned: false },
  ];
  // Only the untouched drafts drop out; a written or used one is a real prompt
  assert.deepEqual(core.rankSnippets('', lib).map(e => e.s.id), ['used', 'written', 'real']);
  assert.deepEqual(core.rankSnippets('new', lib).map(e => e.s.id), ['used', 'written']);
  assert.equal(core.isEmptyDraft({ title: 'New prompt', text: '', uses: 0 }), true);
  assert.equal(core.isEmptyDraft({ title: 'Mine', text: '', uses: 0 }), false);
});

test('rankSnippets: a title subsequence beats a contiguous tag match beats a body match', () => {
  const lib = [
    { id: 'body', title: 'Nothing here', text: 'plan the work', tags: [], uses: 50 },
    { id: 'tag', title: 'Other', text: '', tags: ['plan'], uses: 50 },
    { id: 'title', title: 'Pick a lane now', text: '', tags: [], uses: 0 },
  ];
  const r = core.rankSnippets('plan', lib);
  assert.deepEqual(r.map(e => e.s.id), ['title', 'tag', 'body']);
  assert.ok(Array.isArray(r[0].indices) && r[0].indices.length === 4);
  assert.equal(r[1].indices, null);
});

test('body matches must hold the query, not merely its letters in order (BH3-M)', () => {
  // "please look at the notes" has p-l-a-n in order: the old subsequence
  // fallback let nearly every prompt through the body tier
  assert.equal(core.bodyScore('plan', 'please look at the notes'), null);
  assert.deepEqual(core.bodyScore('plan', 'plan the work'), { score: 0 });
  assert.deepEqual(core.bodyScore('plan', 'write a planning doc'), { score: 8 });
  // A multi-word query may be spread out, but each word starts a word
  assert.ok(core.bodyScore('fix bug', 'the bug is here, please fix it'));
  assert.equal(core.bodyScore('fix bug', 'the bugle is debugged'), null);
  assert.deepEqual(core.bodyScore('', 'anything'), { score: 0 });

  const lib = [
    { id: 'loose', title: 'Nothing', text: 'please look at the notes', tags: [], uses: 99 },
    { id: 'body', title: 'Nothing here', text: 'plan the work', tags: [], uses: 0 },
    { id: 'title', title: 'Plan first', text: '', tags: [], uses: 0 },
  ];
  // Title still beats body, and the loose one drops out of the list entirely
  assert.deepEqual(core.rankSnippets('plan', lib).map(e => e.s.id), ['title', 'body']);
  // Titles and tags keep fuzzy subsequence matching
  assert.deepEqual(core.rankSnippets('pf', lib).map(e => e.s.id), ['title']);
});

test('rankSnippets honours #tag / @pack / >group filters', () => {
  const lib = [
    { id: 'a', title: 'A', text: '', tags: ['debug'], pack: 'P', group: 'g' },
    { id: 'b', title: 'B', text: '', tags: ['review'], pack: 'P', group: '' },
  ];
  assert.deepEqual(core.rankSnippets('#debug', lib).map(e => e.s.id), ['a']);
  assert.deepEqual(core.rankSnippets('>g', lib).map(e => e.s.id), ['a']);
  assert.deepEqual(core.rankSnippets('@P', lib).map(e => e.s.id), ['a', 'b']);
});

test('highlightSegments keeps underlines aligned after an emoji (L4)', () => {
  const title = '🚀 Root cause';
  const { indices } = core.fuzzyScore('root', title);
  const segs = core.highlightSegments(title, indices);
  assert.deepEqual(segs, [{ text: '🚀 ', hit: false }, { text: 'Root', hit: true }, { text: ' cause', hit: false }]);
  assert.deepEqual(core.highlightSegments('abc', null), [{ text: 'abc', hit: false }]);
  assert.deepEqual(core.highlightSegments('', [0]), []);
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

test('parseQuery: a quoted filter value keeps its spaces; an unclosed quote is text', () => {
  const q = core.parseQuery('@"my prompts" >"code review" #x tail');
  assert.deepEqual(q.packs, ['my prompts']);
  assert.deepEqual(q.groups, ['code review']);
  assert.deepEqual(q.tags, ['x']);
  assert.equal(q.text, 'tail');
  const open = core.parseQuery('@"my prompts');
  assert.deepEqual(open.packs, ['"my']);
  assert.equal(open.text, 'prompts');
  assert.deepEqual(core.parseQuery('@""').packs, []);
});

test('filterTerm quotes only names with whitespace', () => {
  assert.equal(core.filterTerm('@', 'Starter'), '@Starter');
  assert.equal(core.filterTerm('@', 'My prompts'), '@"My prompts"');
  assert.equal(core.filterTerm('>', 'Debugging'), '>Debugging');
});

test('matchesFilters requires every tag and pack filter to hit', () => {
  const s = { tags: ['debug', 'rust'], pack: 'Starter' };
  assert.ok(core.matchesFilters(s, { tags: ['deb'], packs: ['start'] }));
  assert.ok(!core.matchesFilters(s, { tags: ['review'], packs: [] }));
  assert.ok(!core.matchesFilters(s, { tags: [], packs: ['session'] }));
});

test('parseQuery splits >group terms; matchesFilters honours them', () => {
  const q = core.parseQuery('>debug fix > it');
  assert.deepEqual(q.groups, ['debug']);
  assert.equal(q.text, 'fix it');
  const s = { tags: [], pack: 'Promptline', group: 'Debugging' };
  assert.ok(core.matchesFilters(s, { tags: [], packs: [], groups: ['debug'] }));
  assert.ok(!core.matchesFilters(s, { tags: [], packs: [], groups: ['review'] }));
  assert.ok(core.matchesFilters({ tags: [], pack: 'x' }, { tags: [], packs: [] }));
});

test('parsePacks: prompts carry an optional group, trimmed; missing means ungrouped', () => {
  const packs = core.parsePacks(JSON.stringify({
    name: 'P', prompts: [{ title: 'A', text: 'x', group: ' Debugging ' }, { title: 'B', text: 'y' }],
  }));
  assert.equal(packs[0].prompts[0].group, 'Debugging');
  assert.equal(packs[0].prompts[1].group, '');
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

test('stripFences drops a leading UTF-8 BOM, and a BOM file diagnoses ok (M7)', () => {
  const json = JSON.stringify({ name: 'P', prompts: [{ title: 't', text: 'x' }] });
  assert.equal(core.stripFences('\uFEFF' + json), json);
  const d = core.diagnosePack('\uFEFF' + json);
  assert.ok(d.ok, d.message);
  assert.equal(d.packs[0].name, 'P');
  assert.equal(core.parsePacks('\uFEFF```json\n' + json + '\n```')[0].name, 'P');
});

// ---- pack diagnosis ----------------------------------------------------------------

test('diagnosePack: valid pack parses ok', () => {
  const d = core.diagnosePack(JSON.stringify({ name: 'P', prompts: [{ title: 't', text: 'x' }] }));
  assert.ok(d.ok);
  assert.equal(d.packs[0].name, 'P');
});

test('diagnosePack: empty source', () => {
  const d = core.diagnosePack('   ');
  assert.equal(d.ok, false);
  assert.equal(d.code, 'empty');
});

test('diagnosePack: non-JSON text names its prefix', () => {
  const d = core.diagnosePack('Sure! Here is your pack: ...');
  assert.equal(d.code, 'not-json');
  assert.ok(d.message.includes('Sure! Here is your pack'));
});

test('diagnosePack: truncated JSON flags terminal corruption', () => {
  const valid = JSON.stringify({ name: 'P', prompts: [{ title: 't', text: 'x' }] });
  const d = core.diagnosePack(valid.slice(0, valid.length - 10));
  assert.equal(d.code, 'malformed');
  assert.ok(d.message.includes('terminal'));
});

test('diagnosePack: valid JSON, wrong shape', () => {
  const d = core.diagnosePack('{"hello": "world"}');
  assert.equal(d.code, 'wrong-shape');
});

// ---- new prompt from the clipboard --------------------------------------------------

test('titleFromClipboard cuts at a word boundary within 40 characters (L20)', () => {
  const err = "TypeError: cannot read properties of undefined (reading 'id')";
  // Used to be "TypeError: cannot read properties of und"
  assert.equal(core.titleFromClipboard(err), 'TypeError: cannot read properties of');
  assert.ok(core.titleFromClipboard(err).length <= 40);
  // A line that fits comes back whole; the boundary may sit exactly at the limit
  assert.equal(core.titleFromClipboard('Short title'), 'Short title');
  assert.equal(core.titleFromClipboard('a'.repeat(40)), 'a'.repeat(40));
  assert.equal(core.titleFromClipboard('a'.repeat(39) + ' b'), 'a'.repeat(39));
  // One long word: a hard cut is all there is
  assert.equal(core.titleFromClipboard('x'.repeat(50)), 'x'.repeat(40));
  // The first non-empty line, trimmed; `max` is a parameter
  assert.equal(core.titleFromClipboard('\n\n  Fix the build  \nsecond line'), 'Fix the build');
  assert.equal(core.titleFromClipboard('one two three four', 9), 'one two');
  assert.equal(core.titleFromClipboard(''), '');
  assert.equal(core.titleFromClipboard('  \n '), '');
  assert.equal(core.titleFromClipboard(undefined), '');
});

// ---- misc ------------------------------------------------------------------------

test('normalizeTag: lowercase, nothing outside [a-z0-9_-] (M14)', () => {
  assert.equal(core.normalizeTag(' Code Review '), 'codereview');
  assert.equal(core.normalizeTag('code-review_2'), 'code-review_2');
  assert.equal(core.normalizeTag('#Debug!'), 'debug');
  assert.equal(core.normalizeTag(''), '');
  assert.equal(core.normalizeTag(undefined), '');
  // Every shipped tag already passes as is
  for (const t of ['debug', 'review', 'plan', 'refactor', 'test', 'guardrails', 'meta', 'general']) {
    assert.equal(core.normalizeTag(t), t);
  }
});

test('plural counts and pluralises, with an irregular form on request (L6)', () => {
  assert.equal(core.plural(1, 'prompt'), '1 prompt');
  assert.equal(core.plural(0, 'prompt'), '0 prompts');
  assert.equal(core.plural(2, 'prompt'), '2 prompts');
  assert.equal(core.plural(1, 'entry', 'entries'), '1 entry');
  assert.equal(core.plural(3, 'entry', 'entries'), '3 entries');
});

test('DRAFT_TITLE is the title isEmptyDraft looks for', () => {
  assert.equal(core.DRAFT_TITLE, 'New prompt');
  assert.ok(core.isEmptyDraft({ title: core.DRAFT_TITLE, text: '', uses: 0 }));
});

test('fmtHotkey capitalizes parts', () => {
  assert.equal(core.fmtHotkey('ctrl+shift+v'), 'Ctrl+Shift+V');
  assert.equal(core.fmtHotkey('alt+space'), 'Alt+Space');
});

// ---- default pack --------------------------------------------------------------------

test('defaultPackFor: last used, else default, else first unlocked, else Unsorted (L1)', () => {
  const locked = (set) => (p) => set.includes(p);
  const names = ['A', 'My prompts', 'Z'];
  assert.equal(core.defaultPackFor('Z', names, locked([]), 'My prompts'), 'Z');
  assert.equal(core.defaultPackFor('Z', names, locked(['Z']), 'My prompts'), 'My prompts');
  assert.equal(core.defaultPackFor('gone', names, locked([]), 'My prompts'), 'My prompts');
  assert.equal(core.defaultPackFor(null, names, locked(['My prompts']), 'My prompts'), 'A');
  assert.equal(core.defaultPackFor(null, names, locked(names), 'My prompts'), 'Unsorted');
  assert.equal(core.defaultPackFor(null, [], locked([]), 'My prompts'), 'My prompts');
});

test('defaultPackFor never names a pack that does not exist (audit 2026-09-22 #4)', () => {
  const locked = (set) => (p) => set.includes(p);
  // The default pack was deleted or never made: the first existing unlocked pack wins
  assert.equal(core.defaultPackFor(null, ['Work', 'Zed'], locked([]), 'My prompts'), 'Work');
  assert.equal(core.defaultPackFor('gone', ['Work', 'Zed'], locked(['Work']), 'My prompts'), 'Zed');
  // Every existing pack locked: a fresh "Unsorted", still not the phantom default
  assert.equal(core.defaultPackFor(null, ['Work'], locked(['Work']), 'My prompts'), 'Unsorted');
});

// ---- removing a parameter chip -------------------------------------------------------

test('removeParamToken removes the token and only the whitespace around it', () => {
  assert.equal(core.removeParamToken('Fix {goal} now', 'goal'), 'Fix now');
  assert.equal(core.removeParamToken('Fix {{goal}} now', 'goal'), 'Fix now');
  assert.equal(core.removeParamToken('{goal} first', 'goal'), 'first');
  assert.equal(core.removeParamToken('last {goal}', 'goal'), 'last');
  assert.equal(core.removeParamToken('a {goal} b {goal} c', 'goal'), 'a b c');
  // A token alone on its line takes the line with it
  assert.equal(core.removeParamToken('Context:\n{goal}\nGo.', 'goal'), 'Context:\nGo.');
  assert.equal(core.removeParamToken('Context:\n\n{goal}\n\nGo.', 'goal'), 'Context:\n\nGo.');
  // Other names are untouched, including ones sharing a prefix
  assert.equal(core.removeParamToken('{goal} {goal_2} {goals}', 'goal'), '{goal_2} {goals}');
});

test('removeParamToken leaves indentation and aligned text alone (audit 2026-09-22 #5)', () => {
  const code = 'Review:\n\n    def f():\n        return {goal}\n\n| a  |  b |\n';
  assert.equal(core.removeParamToken(code, 'goal'), 'Review:\n\n    def f():\n        return\n\n| a  |  b |\n');
  // Nothing to remove: the text comes back byte-identical
  assert.equal(core.removeParamToken(code, 'other'), code);
});

// ---- pins ---------------------------------------------------------------------------

test('pinPlan counts only newly pinned rows against the limit (UH5)', () => {
  const lib = [
    { id: 'a', pinned: true }, { id: 'b', pinned: true }, { id: 'c', pinned: true },
    { id: 'd', pinned: true }, { id: 'e', pinned: false }, { id: 'f', pinned: false }, { id: 'g', pinned: false },
  ];
  // 3 pinned outside; selection has 1 pinned + 1 unpinned: result would be 5, fine
  assert.deepEqual(core.pinPlan(lib, ['d', 'e'], 5), { ok: true, already: 4, toPin: 1, room: 1 });
  // Two new pins with 4 already: over by one
  assert.deepEqual(core.pinPlan(lib, ['e', 'f'], 5), { ok: false, already: 4, toPin: 2, room: 1 });
  // All selected already pinned: nothing new, always ok
  assert.equal(core.pinPlan(lib, ['a', 'b'], 5).ok, true);
  assert.equal(core.pinPlan(lib, ['e', 'f', 'g'], 5).room, 1);
});

// ---- pack export ------------------------------------------------------------------

test('packToJson keeps title/tags/text, adds group only when set, drops personal state (M1)', () => {
  const out = core.packToJson('P', [
    { id: '1', title: 'A', text: 'x', tags: ['t'], group: 'G', uses: 5, pinned: true, fieldValues: { a: 'b' }, configValues: { c: 'd' } },
    { id: '2', title: 'B', text: 'y', tags: [], group: '', uses: 0, pinned: false },
    { id: '3', title: 'C', text: 'z' },
  ]);
  assert.deepEqual(out, {
    name: 'P',
    prompts: [
      { title: 'A', text: 'x', tags: ['t'], group: 'G' },
      { title: 'B', text: 'y', tags: [] },
      { title: 'C', text: 'z', tags: [] },
    ],
  });
  assert.ok(!('group' in out.prompts[1]));
});

// ---- delete with undo ------------------------------------------------------------

test('removeByIds then restoreRemoved yields the original array, positions kept', () => {
  const list = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const { kept, removed } = core.removeByIds(list, new Set(['b', 'd']));
  assert.deepEqual(kept.map(s => s.id), ['a', 'c']);
  assert.deepEqual(core.restoreRemoved(kept, removed).map(s => s.id), ['a', 'b', 'c', 'd']);
});

test('restoreRemoved never duplicates ids when given a stale, pre-delete list (H1)', () => {
  const list = ['a', 'b', 'c'].map(id => ({ id }));
  const { removed } = core.removeByIds(list, ['b', 'c']);
  // The bug: Undo ran against the array captured before the delete
  const out = core.restoreRemoved(list, removed);
  assert.deepEqual(out.map(s => s.id), ['a', 'b', 'c']);
  assert.equal(new Set(out.map(s => s.id)).size, out.length);
});

test('restoreRemoved clamps positions when the list shrank meanwhile', () => {
  const list = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const { removed } = core.removeByIds(list, ['d']);
  const out = core.restoreRemoved([{ id: 'a' }], removed);
  assert.deepEqual(out.map(s => s.id), ['a', 'd']);
});

// ---- library tree --------------------------------------------------------------

const snip = (id, extra = {}) => ({ id, title: id, text: '', tags: [], pack: 'P', group: '', uses: 0, pinned: false, ...extra });

test('sortPrompts: pins first, then by uses and title; never mutates', () => {
  const list = [
    snip('b', { uses: 1 }),
    snip('a', { uses: 1 }),
    snip('c', { uses: 9 }),
    snip('d', { uses: 0, pinned: true }),
  ];
  const before = list.map(s => s.id);
  assert.deepEqual(core.sortPrompts(list, 'uses').map(s => s.id), ['d', 'c', 'a', 'b']);
  assert.deepEqual(core.sortPrompts(list, 'title').map(s => s.id), ['d', 'a', 'b', 'c']);
  assert.deepEqual(list.map(s => s.id), before);
});

test('sortPrompts: custom is the array order itself, pins included', () => {
  const list = [snip('b'), snip('a', { pinned: true })];
  const out = core.sortPrompts(list, 'custom');
  assert.deepEqual(out.map(s => s.id), ['b', 'a']);
  assert.notEqual(out, list);
});

test('title ties sort numerically: 0, 1, 2, 10, not 0, 1, 10, 2 (L20)', () => {
  const titles = ['Bulk prompt 10', 'Bulk prompt 2', 'Bulk prompt 0', 'Bulk prompt 1', 'Bulk prompt 11'];
  const list = titles.map((t, i) => snip(`s${i}`, { title: t, uses: 3 }));
  const want = ['Bulk prompt 0', 'Bulk prompt 1', 'Bulk prompt 2', 'Bulk prompt 10', 'Bulk prompt 11'];
  assert.deepEqual(core.sortPrompts(list, 'title').map(s => s.title), want);
  assert.deepEqual(core.sortPrompts(list, 'uses').map(s => s.title), want, 'equal uses, title breaks the tie');
  assert.deepEqual(core.rankSnippets('', list).map(e => e.s.title), want, 'the popup agrees');
  const pins = list.map(s => ({ ...s, pinned: true }));
  assert.deepEqual(core.rankSnippets('', pins).map(e => e.s.title), want, 'legacy pins too');
});

test('sortPrompts falls back to uses for an unknown order', () => {
  const list = [snip('a', { uses: 1 }), snip('b', { uses: 5 })];
  assert.deepEqual(core.sortPrompts(list, 'nonsense').map(s => s.id), ['b', 'a']);
});

test('packTree: packs by name, every declared pack present even when empty', () => {
  const tree = core.packTree([snip('x', { pack: 'Zed' })], ['Empty', 'Zed'], 'My prompts');
  assert.deepEqual(tree.map(p => p.name), ['Empty', 'Zed']);
  assert.deepEqual(tree[0], { name: 'Empty', count: 0, ungrouped: [], groups: [] });
  assert.equal(tree[1].count, 1);
});

test('packTree: a packless prompt lands in the default pack', () => {
  const tree = core.packTree([snip('x', { pack: '' })], [], 'My prompts');
  assert.deepEqual(tree.map(p => p.name), ['My prompts']);
  assert.equal(tree[0].ungrouped[0].id, 'x');
});

test('packTree: ungrouped run first, groups in order of first appearance, rows in given order', () => {
  const list = [
    snip('g1', { group: 'Later' }),
    snip('u1'),
    snip('g2', { group: 'Early' }),
    snip('g3', { group: 'Later' }),
    snip('u2'),
  ];
  const [p] = core.packTree(list, [], 'My prompts');
  assert.equal(p.count, 5);
  assert.deepEqual(p.ungrouped.map(s => s.id), ['u1', 'u2']);
  assert.deepEqual(p.groups.map(g => g.name), ['Later', 'Early']);
  assert.deepEqual(p.groups[0].items.map(s => s.id), ['g1', 'g3']);
  assert.deepEqual(p.groups[1].items.map(s => s.id), ['g2']);
});

test('packTree counts every prompt in the pack, pinned and grouped alike', () => {
  const list = [snip('a', { pinned: true }), snip('b', { group: 'G' }), snip('c', { pack: 'Other' })];
  const tree = core.packTree(list, [], 'My prompts');
  assert.deepEqual(tree.map(p => [p.name, p.count]), [['Other', 1], ['P', 2]]);
});

// ---- clipboard in previews ---------------------------------------------------------

test('clipboardPreview flattens whitespace and trims', () => {
  assert.equal(core.clipboardPreview('  fn main() {\n\n  println!("hi");\r\n}  '), 'fn main() { println!("hi"); }');
});

test('clipboardPreview names an empty clipboard instead of showing a hole', () => {
  assert.equal(core.clipboardPreview(''), '(clipboard is empty)');
  assert.equal(core.clipboardPreview('   \n\t '), '(clipboard is empty)');
  assert.equal(core.clipboardPreview(undefined), '(clipboard is empty)');
});

test('clipboardPreview cuts long text at the limit with an ellipsis', () => {
  const out = core.clipboardPreview('a'.repeat(300));
  assert.equal(out.length, 241);
  assert.ok(out.endsWith('\u2026'));
  assert.equal(core.clipboardPreview('hello world', 5), 'hello\u2026');
  assert.equal(core.clipboardPreview('hello world', 11), 'hello world');
});

// ---- copy from the editor ------------------------------------------------------

test('expandForCopy substitutes config and the clipboard, keeps fill-in fields', () => {
  const out = core.expandForCopy('Hi {{name}}: {clipboard} / {goal} / {{unset}}', { name: 'Alp' }, 'PASTED');
  assert.equal(out, 'Hi Alp: PASTED / {goal} / {unset}');
});

test('expandForCopy pastes nothing for an empty clipboard and keeps $ patterns literal', () => {
  assert.equal(core.expandForCopy('a{clipboard}b', {}, ''), 'ab');
  assert.equal(core.expandForCopy('a{clipboard}b', {}, undefined), 'ab');
  assert.equal(core.expandForCopy('{clipboard}', {}, 'cost $& $$ $1'), 'cost $& $$ $1');
});

test('expandForCopy expands {date} and {time} the way a paste does', () => {
  const out = core.expandForCopy('{date}|{time}', {}, '');
  const [date, time] = out.split('|');
  assert.equal(date, new Date().toLocaleDateString());
  assert.ok(/\d/.test(time) && !time.includes('{'), time);
});

// ---- matchesQuery: the manager sidebar's filter --------------------------------
test('matchesQuery: every free-text word, anywhere in the prompt, any order', () => {
  const s = { title: 'Root cause first', text: 'Find the bug', tags: ['debug'], pack: 'Starter', group: 'Triage' };
  const q = (raw) => core.matchesQuery(s, core.parseQuery(raw));
  assert.ok(q(''));
  assert.ok(q('ROOT'));
  assert.ok(q('bug starter'), 'body word plus pack word');
  assert.ok(q('triage cause'), 'group word plus title word, reversed');
  assert.ok(!q('root missing'), 'one word absent fails the whole query');
});

test('matchesQuery applies #tag, @pack and >group terms before the text', () => {
  const s = { title: 'Explain this error', text: '{clipboard}', tags: ['debug'], pack: 'Mock Groups', group: 'Debugging' };
  const q = (raw) => core.matchesQuery(s, core.parseQuery(raw));
  assert.ok(q('#debug err'));
  assert.ok(q('@"mock groups" >debug'));
  assert.ok(!q('#review err'), 'a failed tag term hides a text match');
  assert.ok(!q('@starter'));
});

// ---- repeated fields: numbered copies -------------------------------------------
test('names may hold digits after the first character; {0} and {Goal} stay text', () => {
  assert.deepEqual(core.customFields('{goal} {goal_2} {step3} {0} {1} {Goal}'), ['goal', 'goal_2', 'step3']);
  // Only the near-miss is flagged; the numeric slot is plain text
  const bad = core.tokenize('{0}{Goal}').filter((t) => t.type === 'bad').map((t) => t.raw);
  assert.deepEqual(bad, ['{Goal}']);
});

test('tokenize keeps {0} / {1} as text, in one run with what surrounds them (M7)', () => {
  // Format-string slots in pasted code drew one red "not a param" chip each
  assert.deepEqual(core.tokenize('print("{0} of {1}")'), [{ type: 'text', value: 'print("{0} of {1}")' }]);
  assert.deepEqual(core.tokenize('{0}'), [{ type: 'text', value: '{0}' }]);
  assert.deepEqual(core.tokenize('{{2}} {goal}'), [
    { type: 'text', value: '{{2}} ' },
    { type: 'field', name: 'goal', raw: '{goal}' },
  ]);
  // {1st} still starts with a digit and is a near-miss, not a slot
  assert.deepEqual(core.tokenize('{1st}').map((t) => t.type), ['bad']);
});

test('nextCopyName numbers from 2, skips taken names, and counts from the stem', () => {
  assert.equal(core.nextCopyName('goal', 'Do {goal}'), 'goal_2');
  assert.equal(core.nextCopyName('goal', '{goal} then {goal_2}'), 'goal_3');
  assert.equal(core.nextCopyName('goal_2', '{goal} then {goal_2}'), 'goal_3', 'a copy of a copy shares the stem');
  assert.equal(core.nextCopyName('goal', '{goal} {{goal_2}}'), 'goal_3', 'a config param holds its name too');
});

test('numbered names fill, expand and downgrade like any other (the paste path)', () => {
  assert.equal(core.fillFields('{goal} / {goal_2}', { goal: 'a', goal_2: 'b' }), 'a / b');
  assert.equal(core.expandConfig('{{repo_2}}', { repo_2: 'x' }), 'x');
  assert.equal(core.downgradeUnsetConfig('{{repo_2}}'), '{repo_2}');
  assert.deepEqual(core.requiredInputs({ text: '{goal} {goal_2} {goal}', configValues: {} }), ['goal', 'goal_2']);
});
