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

test('tokenize: empty braces and an unterminated brace are text (L23)', () => {
  assert.deepEqual(core.tokenize('{}'), [{ type: 'text', value: '{}' }]);
  assert.deepEqual(core.tokenize('{{}}'), [{ type: 'text', value: '{{}}' }]);
  assert.deepEqual(core.tokenize('ask {goal'), [{ type: 'text', value: 'ask {goal' }]);
  assert.deepEqual(core.tokenize('{goal} {'), [{ type: 'field', name: 'goal', raw: '{goal}' }, { type: 'text', value: ' {' }]);
  assert.deepEqual(core.tokenize(''), []);
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

test('expandBuiltins replaces date and time from the injected clock (L23)', () => {
  const now = new Date(2026, 6, 12, 9, 5);
  // The exact strings the locale produces for that instant, not merely "the tokens went away"
  const date = now.toLocaleDateString();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  assert.equal(core.expandBuiltins('on {date} at {time}, {date} again', now), `on ${date} at ${time}, ${date} again`);
  assert.ok(/9|09/.test(time) && /05/.test(time), time);
  // No clock injected: today
  assert.equal(core.expandBuiltins('{date}'), new Date().toLocaleDateString());
});

test('fillFields inserts a value holding {clipboard} or {{cfg}} literally; later steps see them (L23)', () => {
  // The paste path is expandConfig → downgradeUnsetConfig → fillFields →
  // expandBuiltins → Rust's {clipboard}. A value is inserted as typed and
  // never re-scanned by fillFields itself, so a {{cfg}} in it stays as
  // braces (config already expanded, earlier), while a {clipboard} in it
  // is real to the steps that follow.
  const out = core.fillFields('Goal: {goal}', { goal: 'see {clipboard} and {{cfg}} and {other}' });
  assert.equal(out, 'Goal: see {clipboard} and {{cfg}} and {other}');
  assert.equal(core.fillFields('{a} {b}', { a: '{b}', b: 'x' }), '{b} x', 'an inserted {b} is not filled by the same pass');
  // The popup's order: config, then the fill-in values, then builtins, then
  // Rust's {clipboard}. A {{cfg}} typed into a field therefore stays braces
  // in what is pasted, while a {clipboard} typed into one is expanded.
  const base = core.downgradeUnsetConfig(core.expandConfig('{{cfg}}: {goal}', { cfg: 'set' }));
  assert.equal(core.expandBuiltins(core.fillFields(base, { goal: '{{cfg}} {clipboard}' })), 'set: {{cfg}} {clipboard}');
  // The editor's Copy has no form, so its config pass runs over the text as
  // typed; the same braces in the text itself do expand there
  assert.equal(core.expandForCopy('see {clipboard} and {{cfg}}', { cfg: 'set' }, 'CLIP'), 'see CLIP and set');
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

test('slotEntries: pins first in pin order, folded entries take no slot, at most five (L10)', () => {
  const lib = [
    { id: 'p2', title: 'Pin two', text: 'x', tags: [], uses: 99, pinned: true, pinnedAt: 200 },
    { id: 'p1', title: 'Pin one', text: 'x', tags: [], uses: 0, pinned: true, pinnedAt: 100 },
    { id: 'u9', title: 'Used nine', text: 'x', tags: [], uses: 9, pack: 'Folded' },
    { id: 'u5', title: 'Used five', text: 'x', tags: [], uses: 5 },
    { id: 'u4', title: 'Used four', text: 'x', tags: [], uses: 4 },
    { id: 'u3', title: 'Used three', text: 'x', tags: [], uses: 3 },
    { id: 'u2', title: 'Used two', text: 'x', tags: [], uses: 2 },
    { id: 'u1', title: 'Used one', text: 'x', tags: [], uses: 1 },
  ];
  const ranked = core.rankSnippets('', lib);
  const ids = (es) => es.map(e => e.s.id);
  const all = new Set(lib.map(s => s.id));
  // Everything on screen: the pins lead in pin order, then by use, five in all
  assert.deepEqual(ids(core.slotEntries(ranked, all)), ['p1', 'p2', 'u9', 'u5', 'u4']);
  // The most-used prompt sits in a folded pack: it takes no slot and the
  // next visible one moves up, so the digits always name rows on screen
  const shown = new Set([...all].filter(id => id !== 'u9'));
  assert.deepEqual(ids(core.slotEntries(ranked, shown)), ['p1', 'p2', 'u5', 'u4', 'u3']);
  // An array of ids works too; `max` is a parameter
  assert.deepEqual(ids(core.slotEntries(ranked, [...shown], 2)), ['p1', 'p2']);
  assert.deepEqual(core.slotEntries(ranked, []), []);
});

test('slotEntries never hands a slot to an untouched draft', () => {
  const draft = { id: 'd', title: core.DRAFT_TITLE, text: '', tags: [], uses: 0 };
  const real = { id: 'r', title: 'Real', text: 'x', tags: [], uses: 0 };
  // rankSnippets already drops it; a ranked list built by hand is filtered too
  assert.deepEqual(core.slotEntries(core.rankSnippets('', [draft, real]), ['d', 'r']).map(e => e.s.id), ['r']);
  assert.deepEqual(core.slotEntries([{ s: draft }, { s: real }], ['d', 'r']).map(e => e.s.id), ['r']);
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

test('parsePacks: CRLF input parses, and the text keeps its line breaks (L23)', () => {
  const raw = '{\r\n  "name": "Win",\r\n  "prompts": [\r\n    { "title": "A", "text": "line one\\r\\nline two", "tags": ["x"] }\r\n  ]\r\n}\r\n';
  const packs = core.parsePacks(raw);
  assert.equal(packs[0].name, 'Win');
  assert.equal(packs[0].prompts[0].text, 'line one\r\nline two');
  // Fenced and CRLF at once, as pasted from a Windows terminal
  assert.equal(core.parsePacks('```json\r\n' + raw + '```')[0].name, 'Win');
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
    { id: '1', title: 'A', text: 'x', tags: ['t'], group: 'G', uses: 5, pinned: true, configValues: { c: 'd' } },
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

test('sortPrompts treats a missing uses as 0, like rankSnippets (L23)', () => {
  const list = [snip('none', { uses: undefined }), snip('one', { uses: 1 }), snip('zero', { uses: 0 })];
  delete list[0].uses;
  assert.deepEqual(core.sortPrompts(list, 'uses').map(s => s.id), ['one', 'none', 'zero']);
  assert.deepEqual(core.rankSnippets('', list).map(e => e.s.id), ['one', 'none', 'zero']);
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

test('orderPacks: A–Z until arranged, then the arrangement with newcomers after it A–Z', () => {
  const names = ['beta', 'Alpha', 'Gamma', 'delta'];
  assert.deepEqual(core.orderPacks(names, null), ['Alpha', 'beta', 'delta', 'Gamma']);
  assert.deepEqual(core.orderPacks(names, ['Gamma', 'beta']), ['Gamma', 'beta', 'Alpha', 'delta']);
  // A name the arrangement holds but the library doesn't is not conjured
  assert.deepEqual(core.orderPacks(['beta'], ['Gone', 'beta']), ['beta']);
  assert.deepEqual(names, ['beta', 'Alpha', 'Gamma', 'delta'], 'never mutates');
});

test('movePack: before or after the target; unknown names leave the order be', () => {
  const order = ['A', 'B', 'C', 'D'];
  assert.deepEqual(core.movePack(order, 'D', 'B', false), ['A', 'D', 'B', 'C']);
  assert.deepEqual(core.movePack(order, 'A', 'C', true), ['B', 'C', 'A', 'D']);
  assert.deepEqual(core.movePack(order, 'A', 'D', true), ['B', 'C', 'D', 'A']);
  assert.deepEqual(core.movePack(order, 'B', 'B', true), order);
  assert.deepEqual(core.movePack(order, 'X', 'B', true), order);
  assert.deepEqual(core.movePack(order, 'B', 'X', true), order);
  assert.deepEqual(order, ['A', 'B', 'C', 'D'], 'never mutates');
});

test('packTree: packs in the order given, a pack only prompts name after them by name', () => {
  const list = [snip('x', { pack: 'Zed' }), snip('y', { pack: 'Mid' }), snip('z', { pack: 'Apex' })];
  const tree = core.packTree(list, ['Zed', 'Empty'], 'My prompts');
  assert.deepEqual(tree.map(p => p.name), ['Zed', 'Empty', 'Apex', 'Mid']);
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

test('clipboardPreview never cuts a surrogate pair in half (L23)', () => {
  // "ab\ud83d\ude80": the limit falls between the emoji's two UTF-16 units
  const out = core.clipboardPreview('ab\u{1F680}cd', 3);
  assert.equal(out, 'ab\u2026');
  assert.ok(!/[\uD800-\uDBFF]\u2026/.test(out), 'no lone high surrogate before the ellipsis');
  assert.equal(core.clipboardPreview('ab\u{1F680}cd', 4), 'ab\u{1F680}\u2026');
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
  // A fixed clock: comparing against new Date() flaked across midnight (L23)
  const now = new Date(2026, 0, 31, 23, 59);
  const out = core.expandForCopy('{date}|{time}', {}, '', now);
  assert.equal(out, `${now.toLocaleDateString()}|${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
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
  // A two-digit copy: the stem is still "goal", so the count starts over
  // from 2 and fills the first free number, not 11 (L23)
  assert.equal(core.nextCopyName('goal_10', '{goal} {goal_10}'), 'goal_2');
  assert.equal(core.nextCopyName('goal_10', '{goal} {goal_2} {goal_10}'), 'goal_3');
  assert.equal(core.nextCopyName('goal_10', '{goal_10}'), 'goal_2', 'the stem itself need not be present');
});

test('dropNumberedCopies leaves out the copies of a name that is present, keeps a lone numbered name', () => {
  // The editor offers the library's names as chips; a prompt using {goal},
  // {goal_2} and {goal_3} made all three show up, and inserting {goal_2}
  // alone gives a "Goal 2" with no goal. The + on {goal}'s chip is the way.
  assert.deepEqual(core.dropNumberedCopies(['goal', 'goal_2', 'goal_3', 'file']), ['goal', 'file']);
  assert.deepEqual(core.dropNumberedCopies(['step_2', 'other']), ['step_2', 'other'], 'no stem around: a name of its own');
  assert.deepEqual(core.dropNumberedCopies(['goal_10', 'goal']), ['goal'], 'any number, any order');
  assert.deepEqual(core.dropNumberedCopies(new Set(['goal', 'goal'])), ['goal'], 'takes any iterable, drops duplicates');
  assert.deepEqual(core.dropNumberedCopies([]), []);
});

test('numbered names fill, expand and downgrade like any other (the paste path)', () => {
  assert.equal(core.fillFields('{goal} / {goal_2}', { goal: 'a', goal_2: 'b' }), 'a / b');
  assert.equal(core.expandConfig('{{repo_2}}', { repo_2: 'x' }), 'x');
  assert.equal(core.downgradeUnsetConfig('{{repo_2}}'), '{repo_2}');
  assert.deepEqual(core.requiredInputs({ text: '{goal} {goal_2} {goal}', configValues: {} }), ['goal', 'goal_2']);
});

// ---- one tag rule ---------------------------------------------------------------------

test('parsePacks normalises tags the way "Add tag…" and the editor do', () => {
  const packs = core.parsePacks(JSON.stringify({ name: 'P', prompts: [{ title: 't', text: 'x', tags: [' Code Review ', 'ok_tag', '', 'a-b'] }] }));
  assert.deepEqual(packs[0].prompts[0].tags, ['codereview', 'ok_tag', 'a-b']);
});

// ---- the manager's helpers (audit L10) ---------------------------------------------

test('freeName takes the base, then numbers from 2, case-insensitively', () => {
  assert.equal(core.freeName('New pack', []), 'New pack');
  assert.equal(core.freeName('New pack', ['new PACK']), 'New pack 2');
  assert.equal(core.freeName('New pack', ['New pack', 'New pack 2', 'new pack 3']), 'New pack 4');
  // A gap is filled before the series is extended
  assert.equal(core.freeName('New group', ['New group', 'New group 3']), 'New group 2');
});

test('groupsIn lists a pack\'s groups once, A–Z, with packless prompts in the default pack', () => {
  const snippets = [
    { pack: 'Work', group: 'Review' },
    { pack: 'Work', group: 'Debug' },
    { pack: 'Work', group: 'Review' },
    { pack: 'Work', group: '' },
    { pack: '', group: 'Loose' },
    { pack: 'Other', group: 'Elsewhere' },
  ];
  assert.deepEqual(core.groupsIn(snippets, 'Work', 'My prompts'), ['Debug', 'Review']);
  assert.deepEqual(core.groupsIn(snippets, 'My prompts', 'My prompts'), ['Loose']);
  assert.deepEqual(core.groupsIn(snippets, 'Empty', 'My prompts'), []);
});

test('tagsByCount orders tags by use, first seen first among ties', () => {
  const snippets = [{ tags: ['b', 'a'] }, { tags: ['a'] }, { tags: [] }, {}, { tags: ['c', 'a'] }];
  assert.deepEqual(core.tagsByCount(snippets), ['a', 'b', 'c']);
  assert.deepEqual(core.tagsByCount([]), []);
});

const prompt = (id, pack, group, extra = {}) => ({ id, title: id, text: 'x', tags: [], pack, group, uses: 0, pinned: false, pinnedAt: 0, ...extra });

test('displayOrder is the array under custom, sorted otherwise, and by pack when grouped', () => {
  const list = [
    prompt('w2', 'Work', 'G', { uses: 2 }),
    prompt('a1', 'Alpha', '', { uses: 1 }),
    prompt('w9', 'Work', '', { uses: 9 }),
    prompt('a5', 'Alpha', 'G', { uses: 5, pinned: true }),
  ];
  const ids = (rows) => rows.map((s) => s.id);
  assert.deepEqual(ids(core.displayOrder(list, 'custom', true, [], 'My prompts')), ['w2', 'a1', 'w9', 'a5']);
  // One list: pins first, then most used
  assert.deepEqual(ids(core.displayOrder(list, 'uses', false, [], 'My prompts')), ['a5', 'w9', 'w2', 'a1']);
  // Grouped: packs A–Z, each pack's ungrouped run first, then its groups
  assert.deepEqual(ids(core.displayOrder(list, 'uses', true, ['Alpha', 'Work', 'Empty'], 'My prompts')), ['a1', 'a5', 'w9', 'w2']);
  // The ungrouped run comes before the groups whatever the order within
  assert.deepEqual(ids(core.displayOrder(list, 'title', true, [], 'My prompts')), ['a1', 'a5', 'w9', 'w2']);
  assert.deepEqual(ids(core.displayOrder(list, 'title', false, [], 'My prompts')), ['a5', 'a1', 'w2', 'w9']);
  // Never the same array
  assert.notEqual(core.displayOrder(list, 'custom', true, [], 'My prompts'), list);
});

test('treeRows walks packs, their ungrouped run and their groups, folds applied', () => {
  const list = [prompt('u1', 'Work', ''), prompt('g1', 'Work', 'G'), prompt('g2', 'Work', 'G'), prompt('o1', 'Other', 'H')];
  const tree = core.packTree(list, ['Empty', 'Other', 'Work'], 'My prompts');
  const noFolds = { packs: new Set(), groups: new Set() };
  const rows = core.treeRows(tree, noFolds, false);
  // Roving focus walks this order: pack, its prompts, each group and its prompts
  assert.deepEqual(rows.map((r) => r.key), [
    'pack:Empty',
    'pack:Other', `group:${core.groupKey('Other', 'H')}`, 'snip:o1',
    'pack:Work', 'snip:u1', `group:${core.groupKey('Work', 'G')}`, 'snip:g1', 'snip:g2',
  ]);
  assert.deepEqual(rows.map((r) => r.level), [1, 1, 2, 3, 1, 2, 2, 3, 3]);
  // An empty pack is a row with nothing to open; Right on it goes nowhere
  assert.deepEqual(rows[0], { key: 'pack:Empty', kind: 'pack', name: 'Empty', count: 0, level: 1, expanded: true, hasChildren: false });
  // Left targets: a prompt's parent is its pack or group, a group's is its pack
  assert.equal(rows[5].parent, 'pack:Work');
  assert.equal(rows[6].parent, 'pack:Work');
  assert.equal(rows[7].parent, `group:${core.groupKey('Work', 'G')}`);
  assert.equal(rows[4].parent, undefined);
  // Right on an open pack or group with children steps to the next row, its first child
  assert.ok(rows[4].expanded && rows[4].hasChildren && rows[5].parent === rows[4].key);
  assert.ok(rows[6].expanded && rows[6].hasChildren && rows[7].parent === rows[6].key);
  assert.equal(rows[6].count, 2);
  assert.equal(rows[4].count, 3);
});

test('treeRows hides a folded pack\'s or group\'s rows, and a search opens every fold', () => {
  const list = [prompt('u1', 'Work', ''), prompt('g1', 'Work', 'G'), prompt('o1', 'Other', '')];
  const tree = core.packTree(list, [], 'My prompts');
  const folds = { packs: new Set(['Other']), groups: new Set([core.groupKey('Work', 'G')]) };
  const rows = core.treeRows(tree, folds, false);
  assert.deepEqual(rows.map((r) => r.key), ['pack:Other', 'pack:Work', 'snip:u1', `group:${core.groupKey('Work', 'G')}`]);
  // A folded row says so, and still has children to open with Right
  assert.deepEqual([rows[0].expanded, rows[0].hasChildren], [false, true]);
  assert.deepEqual([rows[3].expanded, rows[3].hasChildren], [false, true]);
  // Searching: every fold open; a pack with no hits is a closed header with nothing under it
  const searched = core.treeRows(core.packTree(list.filter((s) => s.id !== 'o1'), ['Other'], 'My prompts'), folds, true);
  assert.deepEqual(searched.map((r) => r.key), ['pack:Other', 'pack:Work', 'snip:u1', `group:${core.groupKey('Work', 'G')}`, 'snip:g1']);
  assert.deepEqual([searched[0].expanded, searched[0].hasChildren], [false, false]);
  assert.ok(searched[3].expanded);
});

test('groupKey is a pack and a label with a separator no name can hold', () => {
  assert.equal(core.groupKey('Work', 'G'), 'Work\u0000G');
  assert.notEqual(core.groupKey('Work G', ''), core.groupKey('Work', 'G'));
});

// ---- import curation ------------------------------------------------------------------

test('importRows marks a prompt the library already holds as a dupe, unticked', () => {
  const library = [{ title: 'Same', text: 'body' }, { title: 'Same title', text: 'other body' }];
  const packs = [
    { name: 'A', prompts: [{ title: 'Same', text: 'body', tags: ['t'], group: 'G' }, { title: 'Same title', text: 'body', tags: [], group: '' }] },
    { name: 'B', prompts: [{ title: 'New', text: 'x', tags: [], group: '' }] },
  ];
  const rows = core.importRows(packs, library);
  assert.deepEqual(rows.map((r) => [r.packName, r.title, r.dupe, r.include]), [
    ['A', 'Same', true, false],
    ['A', 'Same title', false, true], // same title, different text: not a dupe
    ['B', 'New', false, true],
  ]);
  assert.deepEqual(rows[0], { packName: 'A', title: 'Same', text: 'body', tags: ['t'], group: 'G', dupe: true, hidden: [], include: false });
});

test('importRows starts a prompt with hidden characters unticked, wherever they hide', () => {
  const packs = [
    { name: 'A', prompts: [
      { title: 'Clean', text: 'Fix the bug ❤️', tags: [], group: '' },
      { title: 'Smuggled', text: 'Fix the bug\u{E0041}\u{E0042}', tags: [], group: '' },
      { title: 'Title‮', text: 'body', tags: [], group: '' },
      { title: 'In group', text: 'body', tags: [], group: 'G​' },
    ] },
    { name: 'Pack⁦', prompts: [{ title: 'In pack name', text: 'body', tags: [], group: '' }] },
  ];
  const rows = core.importRows(packs, []);
  assert.deepEqual(rows.map((r) => [r.title, r.hidden.length > 0, r.include]), [
    ['Clean', false, true],
    ['Smuggled', true, false],
    ['Title‮', true, false],
    ['In group', true, false],
    ['In pack name', true, false],
  ]);
  assert.deepEqual(rows[1].hidden, [{ kind: 'tag', count: 2 }]);
});

// ---- hidden characters -----------------------------------------------------------

test('hiddenChars finds tag characters, bidi controls, control characters and invisibles, by kind', () => {
  assert.deepEqual(core.hiddenChars(''), []);
  assert.deepEqual(core.hiddenChars(null), []);
  assert.deepEqual(core.hiddenChars('plain text\twith tabs\r\nand lines'), []);
  // ASCII smuggling: "hi" as tag characters a model reads but nobody sees
  assert.deepEqual(core.hiddenChars('Summarise this\u{E0068}\u{E0069}'), [{ kind: 'tag', count: 2 }]);
  // Trojan Source: an override and an isolate
  assert.deepEqual(core.hiddenChars('a‮b⁦c'), [{ kind: 'bidi', count: 2 }]);
  // ESC starts a terminal escape sequence; DEL and C1 controls count too
  assert.deepEqual(core.hiddenChars('x\u001b[2Jy\u007f\u0085'), [{ kind: 'control', count: 3 }]);
  // Zero-width space, word joiner, a mid-text BOM, a Hangul filler, a variation selector from the supplement
  assert.deepEqual(core.hiddenChars('a​b⁠c﻿dㅤe\u{E0100}'), [{ kind: 'invisible', count: 5 }]);
  // Kinds come in a fixed order, whatever order the text has them in
  assert.deepEqual(core.hiddenChars('​\u001b‮\u{E0041}').map((f) => f.kind), ['tag', 'bidi', 'control', 'invisible']);
});

test('hiddenChars lets honest invisibles through: emoji joiners, a variation selector, flags, Persian, RTL marks', () => {
  assert.deepEqual(core.hiddenChars('family \u{1F468}‍\u{1F469}‍\u{1F467}'), []);
  assert.deepEqual(core.hiddenChars('love ❤️'), []);
  assert.deepEqual(core.hiddenChars('on fire ❤️‍\u{1F525}, pride \u{1F3F3}️‍\u{1F308}'), []);
  assert.deepEqual(core.hiddenChars('Scotland \u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'), []);
  assert.deepEqual(core.hiddenChars('می‌خواهم'), []); // ZWNJ in a Persian word
  assert.deepEqual(core.hiddenChars('שלום‏!'), []); // RLM after Hebrew
  assert.deepEqual(core.hiddenChars('co­operate'), []); // one soft hyphen
});

test('hiddenChars counts honest invisibles in a run, or next to a hidden character', () => {
  // A run of joiners is how zero-width steganography encodes bits
  assert.deepEqual(core.hiddenChars('ok‌‍‌‍ok'), [{ kind: 'invisible', count: 4 }]);
  assert.deepEqual(core.hiddenChars('x️️x'), [{ kind: 'invisible', count: 2 }]);
  // A lone joiner beside a zero-width space counts with it
  assert.deepEqual(core.hiddenChars('a​‍b'), [{ kind: 'invisible', count: 2 }]);
  // Tags after a black flag that never reach the cancel tag are smuggling, not a flag
  assert.deepEqual(core.hiddenChars('\u{1F3F4}\u{E0068}\u{E0069}'), [{ kind: 'tag', count: 2 }]);
  // A flag's tag run is short; a long one is smuggling even when it ends in a cancel tag
  const long = '\u{1F3F4}' + '\u{E0061}'.repeat(12) + '\u{E007F}';
  assert.deepEqual(core.hiddenChars(long), [{ kind: 'tag', count: 13 }]);
});

test('describeHidden names the kinds and counts in words', () => {
  assert.equal(core.describeHidden([]), '');
  assert.equal(core.describeHidden([{ kind: 'tag', count: 1 }]), '1 tag character');
  assert.equal(core.describeHidden([{ kind: 'tag', count: 14 }, { kind: 'bidi', count: 2 }]), '14 tag characters and 2 direction controls');
  assert.equal(
    core.describeHidden([{ kind: 'bidi', count: 1 }, { kind: 'control', count: 3 }, { kind: 'invisible', count: 2 }]),
    '1 direction control, 3 control characters and 2 invisible characters'
  );
});

test('curateImport adds the ticked rows, renames a single-pack import, and skips locked packs', () => {
  const rows = [
    { packName: 'A', title: 'a1', text: 'x', tags: ['t'], group: 'G', dupe: false, include: true },
    { packName: 'A', title: 'a2', text: 'x', tags: [], group: '', dupe: true, include: false },
    { packName: 'Locked', title: 'l1', text: 'x', tags: [], group: '', dupe: false, include: true },
  ];
  const isLocked = (p) => p === 'Locked';
  // Every row keeps its own pack; the unticked one stays out, the locked one is counted
  assert.deepEqual(core.curateImport(rows, isLocked), {
    prompts: [{ title: 'a1', text: 'x', tags: ['t'], pack: 'A', group: 'G' }],
    skippedLocked: 1,
  });
  // A target name (single-pack import) takes every row, so a locked target skips them all
  assert.deepEqual(core.curateImport(rows, isLocked, ' Mine ').prompts.map((p) => p.pack), ['Mine', 'Mine']);
  assert.deepEqual(core.curateImport(rows, isLocked, 'Locked'), { prompts: [], skippedLocked: 2 });
  // A blank target means "as named"
  assert.equal(core.curateImport(rows, isLocked, '  ').prompts[0].pack, 'A');
});

// ---- the hotkey recorder ---------------------------------------------------------------

test('hotkeyFromEvent emits modifiers in a fixed order, then the key, or null', () => {
  const ev = (key, mods = {}) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key, ...mods });
  assert.equal(core.hotkeyFromEvent(ev('V', { ctrlKey: true, shiftKey: true })), 'ctrl+shift+v');
  assert.equal(core.hotkeyFromEvent(ev('v', { shiftKey: true, ctrlKey: true, altKey: true, metaKey: true })), 'ctrl+alt+shift+super+v');
  assert.equal(core.hotkeyFromEvent(ev(' ', { ctrlKey: true, altKey: true })), 'ctrl+alt+space');
  assert.equal(core.hotkeyFromEvent(ev('F5', { altKey: true })), 'alt+f5');
  assert.equal(core.hotkeyFromEvent(ev('ArrowUp', { metaKey: true })), 'super+arrowup');
  assert.equal(core.hotkeyFromEvent(ev(',', { ctrlKey: true })), 'ctrl+,');
  // Nothing to record: a bare key, a modifier alone, no key
  assert.equal(core.hotkeyFromEvent(ev('a')), null);
  assert.equal(core.hotkeyFromEvent(ev('Control', { ctrlKey: true })), null);
  assert.equal(core.hotkeyFromEvent(ev('', { ctrlKey: true })), null);
  assert.equal(core.hotkeyFromEvent(ev(undefined, { ctrlKey: true })), null);
  // A key the parser has no name for: Shift+1 arrives as "!", a dead key as "Dead"
  assert.equal(core.hotkeyFromEvent(ev('!', { ctrlKey: true, shiftKey: true })), null);
  assert.equal(core.hotkeyFromEvent(ev('Dead', { ctrlKey: true })), null);
  assert.equal(core.hotkeyFromEvent(ev('ü', { ctrlKey: true })), null);
  assert.equal(core.hotkeyFromEvent(ev('Tab', { ctrlKey: true })), null);
});

test('hotkeyKeyName is the vocabulary lib.rs parses: letters, digits, F1–F12, punctuation, named keys', () => {
  for (const k of 'abcdefghijklmnopqrstuvwxyz0123456789') assert.equal(core.hotkeyKeyName(k), k);
  assert.equal(core.hotkeyKeyName('Q'), 'q');
  for (let n = 1; n <= 12; n++) assert.equal(core.hotkeyKeyName(`F${n}`), `f${n}`);
  assert.equal(core.hotkeyKeyName('F13'), null);
  for (const k of ",.;/-='`[]\\") assert.equal(core.hotkeyKeyName(k), k);
  for (const k of ['Space', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
    assert.equal(core.hotkeyKeyName(k), k.toLowerCase());
  assert.equal(core.hotkeyKeyName(' '), 'space');
  for (const k of ['!', '<', 'Escape', 'Tab', 'CapsLock', 'Unidentified', '', undefined]) assert.equal(core.hotkeyKeyName(k), null);
});

// ---- theme ------------------------------------------------------------------------------

test('resolveTheme: system follows the OS, explicit choices win, legacy values are dark', () => {
  assert.equal(core.resolveTheme('system', true), 'dark');
  assert.equal(core.resolveTheme('system', false), 'light');
  assert.equal(core.resolveTheme('light', true), 'light');
  assert.equal(core.resolveTheme('dark', false), 'dark');
  assert.equal(core.resolveTheme('sand', false), 'dark');
  assert.equal(core.resolveTheme(null, false), 'dark');
});

test('moveGroup swaps a group past its neighbour in the pack and leaves every other row in its slot', () => {
  const list = [
    prompt('u1', 'Work', ''), prompt('o1', 'Other', 'X'), prompt('a1', 'Work', 'A'),
    prompt('a2', 'Work', 'A'), prompt('b1', 'Work', 'B'), prompt('o2', 'Other', 'Y'),
  ];
  const ids = (l) => l.map((s) => s.id);
  assert.deepEqual(ids(core.moveGroup(list, 'Work', 'B', -1, 'My prompts')), ['u1', 'o1', 'b1', 'a1', 'a2', 'o2']);
  assert.deepEqual(ids(core.moveGroup(list, 'Work', 'A', 1, 'My prompts')), ['u1', 'o1', 'b1', 'a1', 'a2', 'o2']);
  // Nothing to pass at either edge, and no such group
  assert.equal(core.moveGroup(list, 'Work', 'A', -1, 'My prompts'), null);
  assert.equal(core.moveGroup(list, 'Work', 'B', 1, 'My prompts'), null);
  assert.equal(core.moveGroup(list, 'Work', 'Nope', 1, 'My prompts'), null);
  assert.deepEqual(ids(list), ['u1', 'o1', 'a1', 'a2', 'b1', 'o2'], 'never mutates');
});
