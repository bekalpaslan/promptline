// Promptline shared core — pure logic used by BOTH windows (popup.html, index.html)
// and by the node:test suite (tests/core.test.js). No DOM, no Tauri APIs here.
(function (root) {
  'use strict';

  // ---- Placeholder tokens -------------------------------------------------
  // {clipboard} expands in Rust at paste time; {date}/{time} expand in JS;
  // {{name}} is a config parameter (saved value, no prompt);
  // any other valid {name} is a runtime fill-in field.
  // Invalid names (capitals, a leading digit) are flagged, never silently
  // pasted; purely numeric ones ({0}) are text.
  const RESERVED = ['clipboard', 'date', 'time'];
  const TOKEN_RE_SRC = '\\{\\{([a-zA-Z0-9_]+)\\}\\}|\\{([a-zA-Z0-9_]+)\\}';

  // A name is lowercase letters, digits and underscores, never starting with
  // a digit: {goal_2} is a field, while {0} and {1} (format-string slots in
  // pasted code) stay literal text, as do capitals ({Goal}).
  function isValidParam(name) {
    return /^[a-z_][a-z0-9_]*$/.test(name);
  }

  // Tokenize prompt text into parts for preview rendering.
  // Returns [{type:'text',value} | {type:'builtin'|'field'|'config'|'bad', name, raw}]
  // A purely numeric name ({0}, {{1}}) is text, merged into the run around
  // it, so pasted code with format-string slots shows no chips at all; the
  // other invalid names ({Goal}, {1st}) are near-misses worth flagging.
  function tokenize(text) {
    const parts = [];
    const pushText = value => {
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') last.value += value;
      else parts.push({ type: 'text', value });
    };
    const re = new RegExp(TOKEN_RE_SRC, 'g');
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) pushText(text.slice(last, m.index));
      const name = m[1] || m[2];
      const raw = m[0];
      if (/^\d+$/.test(name)) pushText(raw);
      else if (!isValidParam(name)) parts.push({ type: 'bad', name, raw });
      else if (m[1]) parts.push({ type: 'config', name, raw });
      else if (RESERVED.includes(name)) parts.push({ type: 'builtin', name, raw });
      else parts.push({ type: 'field', name, raw });
      last = re.lastIndex;
    }
    if (last < text.length) pushText(text.slice(last));
    return parts;
  }

  // The name for another copy of a field that asks for its own value: the
  // same stem with the next free number, from 2 ({goal} -> {goal_2}, and
  // {goal_2} -> {goal_3} while {goal_2} is taken). The stem is the name less
  // a trailing _<n>, so every copy counts from the same first. Every name in
  // the text (fields and config params) counts as taken.
  function nextCopyName(name, text) {
    const stem = name.replace(/_\d+$/, '') || name;
    const taken = new Set(tokenize(text || '').filter(t => t.type !== 'text').map(t => t.name));
    let n = 2;
    while (taken.has(`${stem}_${n}`)) n++;
    return `${stem}_${n}`;
  }

  // Remove every {name} / {{name}} from the text, tidying only the
  // whitespace the token leaves behind: a token between two spaces leaves
  // one, a token alone on its line takes the line with it. Nothing else in
  // the text is touched — an earlier version collapsed every run of spaces
  // in the whole prompt, which flattened the indentation of any code in it.
  // Names are [a-z0-9_] (isValidParam), so they need no escaping.
  function removeParamToken(text, name) {
    const token = `(?:\\{\\{${name}\\}\\}|\\{${name}\\})`;
    return text
      .replace(new RegExp(`^[^\\S\\n]*${token}[^\\S\\n]*(?:\\n|$)`, 'gm'), '')
      .replace(new RegExp(`[^\\S\\n]+${token}(?=[^\\S\\n]|\\n|$)`, 'g'), '')
      .replace(new RegExp(`${token}[^\\S\\n]?`, 'g'), '')
      .replace(/\n{3,}/g, '\n\n');
  }

  // Runtime fill-in fields (valid, non-reserved, single-brace), in order, unique.
  function customFields(text) {
    const fields = [];
    for (const t of tokenize(text)) {
      if (t.type === 'field' && !fields.includes(t.name)) fields.push(t.name);
    }
    return fields;
  }

  // Config parameter names ({{name}}), unique.
  function configNames(text) {
    const names = [];
    for (const t of tokenize(text)) {
      if (t.type === 'config' && !names.includes(t.name)) names.push(t.name);
    }
    return names;
  }

  // Expand config params from saved values; UNSET params survive as {{name}}
  // so callers can downgrade them to fill-in fields instead of pasting holes.
  function expandConfig(text, configValues) {
    const values = configValues || {};
    return text.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/g, (match, name) => (values[name] ? values[name] : match));
  }

  // Unset config params become runtime fields for this paste.
  function downgradeUnsetConfig(text) {
    return text.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/g, '{$1}');
  }

  // Fields the popup will actually ask for when this snippet is picked:
  // runtime fields plus any config params without a saved value.
  function requiredInputs(snippet) {
    const base = downgradeUnsetConfig(expandConfig(snippet.text, snippet.configValues));
    return customFields(base);
  }

  // Substitute runtime {field} values. A function replacer, so a value holding
  // `$&`, `$$` or `$'` is inserted literally instead of being read as a
  // replacement pattern. Names without a value are left as they are.
  function fillFields(text, values) {
    const v = values || {};
    return text.replace(/\{([a-z_][a-z0-9_]*)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(v, name) ? v[name] : match);
  }

  function expandBuiltins(text, now) {
    const d = now || new Date();
    return text
      .replaceAll('{date}', d.toLocaleDateString())
      .replaceAll('{time}', d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }

  // ---- Fuzzy matching -----------------------------------------------------
  // Lower score = better. Returns {score, indices} or null on no match.
  // indices are the matched character positions (for highlighting).
  function fuzzyScore(query, text) {
    const q = query.toLowerCase(), t = text.toLowerCase();
    if (!q) return { score: 0, indices: [] };
    const idx = t.indexOf(q);
    if (idx >= 0) {
      return { score: idx, indices: Array.from({ length: q.length }, (_, i) => idx + i) };
    }
    let ti = 0, gaps = 0;
    const indices = [];
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return null;
      indices.push(found);
      gaps += found - ti;
      ti = found + 1;
    }
    return { score: 1000 + gaps, indices }; // subsequence ranks below contiguous
  }

  // Body matching is deliberately stricter than title and tag matching: a
  // short query is a subsequence of almost any paragraph, so subsequence
  // matching over bodies let nearly every prompt through and search stopped
  // narrowing the list. A body qualifies when it contains the query outright
  // (which also covers a word prefix — `plan` in "planning"), or, for a
  // multi-word query, when every word starts a word in it. Lower is better,
  // like fuzzyScore; null is no match.
  function bodyScore(query, text) {
    const q = (query || '').toLowerCase(), t = (text || '').toLowerCase();
    if (!q) return { score: 0 };
    const idx = t.indexOf(q);
    if (idx >= 0) return { score: idx };
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
    let worst = 0;
    for (const w of words) {
      const at = wordStartIndex(t, w);
      if (at < 0) return null;
      worst = Math.max(worst, at);
    }
    return { score: worst };
  }

  // Where `word` starts a word in `text` (already lowercased), or -1
  function wordStartIndex(text, word) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(word, from);
      if (at < 0) return -1;
      if (at === 0 || !/[a-z0-9_]/.test(text[at - 1])) return at;
      from = at + 1;
    }
  }

  // ---- Drafts ---------------------------------------------------------------
  // The manager's "+ New" creates a real prompt so the editor has something
  // to autosave into: the default title, an empty body, never used. It is the
  // manager's to finish (and to sweep at startup — BEHAVIOR.md); the popup
  // has nothing to paste from it, so the ranking leaves it out of the list
  // and of the Ctrl+1..5 slots that follow it.
  const DRAFT_TITLE = 'New prompt';
  function isEmptyDraft(s) {
    return s.title === DRAFT_TITLE && !(s.text || '').trim() && !(s.uses || 0);
  }

  // Titles compare with numeric collation, so "Bulk prompt 2" sorts before
  // "Bulk prompt 10" wherever a tie is broken by title (here, sortPrompts).
  function byTitle(a, b) {
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  }

  // ---- Ranking ---------------------------------------------------------------------
  // The popup's list order, as one pure function. No query text: pinned first
  // in pin order (oldest pin first — a pin is a fixed Ctrl+digit slot, so use
  // counts must never move it), then the rest by most used, then title. With
  // text: title matches rank above tag matches above body matches, each tier
  // by score, ties by uses. Titles and tags match fuzzily (subsequence);
  // bodies have to hold the query itself (see bodyScore).
  // Returns [{s, indices}] where indices are title-highlight positions
  // (UTF-16 offsets into the title; null for tag/body matches).
  function rankSnippets(rawQuery, snippets) {
    const q = parseQuery(rawQuery);
    const pool = snippets.filter(s => !isEmptyDraft(s) && matchesFilters(s, q));
    if (!q.text) {
      return pool
        .slice()
        .sort((a, b) =>
          (+!!b.pinned - +!!a.pinned) ||
          (a.pinned
            // Legacy pins carry no pinnedAt (0) and sort by title among themselves
            ? ((a.pinnedAt || 0) - (b.pinnedAt || 0)) || byTitle(a, b)
            : ((b.uses || 0) - (a.uses || 0)) || byTitle(a, b)))
        .map(s => ({ s, indices: null }));
    }
    return pool
      .map(s => {
        const title = fuzzyScore(q.text, s.title);
        if (title) return { s, score: title.score, indices: title.indices };
        const tag = fuzzyScore(q.text, (s.tags || []).join(' '));
        if (tag) return { s, score: 3000 + tag.score, indices: null };
        const body = bodyScore(q.text, s.text);
        if (body) return { s, score: 5000 + body.score, indices: null };
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.score - b.score) || ((b.s.uses || 0) - (a.s.uses || 0)))
      .map(({ s, indices }) => ({ s, indices }));
  }

  // The popup's Ctrl+1..5 slots: the first `max` (5) entries of the ranked
  // list — pins first in pin order, then by use, or the top search results
  // — that are on screen, wherever the pack layout draws them. `visibleIds`
  // is what the list shows; an entry inside a folded pack or group is not
  // in it and takes no slot, so the digits always name rows the user can
  // see. An untouched draft never takes one (rankSnippets leaves it out;
  // this filters again so the rule holds for any ranked input). One
  // mapping feeds both the row badge and the Ctrl+digit handler.
  const MAX_SLOTS = 5;
  function slotEntries(ranked, visibleIds, max) {
    const shown = visibleIds instanceof Set ? visibleIds : new Set(visibleIds);
    return ranked.filter(e => shown.has(e.s.id) && !isEmptyDraft(e.s)).slice(0, max || MAX_SLOTS);
  }

  // Split a title into code-point segments marked hit/miss from UTF-16
  // match indices, so an emoji (two UTF-16 units) before a match doesn't
  // shift every underline after it.
  function highlightSegments(title, indices) {
    const hits = new Set(indices || []);
    const out = [];
    let unit = 0;
    for (const ch of title) {
      const hit = hits.has(unit) || (ch.length === 2 && hits.has(unit + 1));
      const last = out[out.length - 1];
      if (last && last.hit === hit) last.text += ch;
      else out.push({ text: ch, hit });
      unit += ch.length;
    }
    return out;
  }

  // ---- Search query parsing: `#tag`, `@pack` and `>group` filter terms -----
  // Returns {text, tags: [..], packs: [..], groups: [..]}. A filter value
  // with spaces is quoted: `@"my prompts"`; an unclosed quote is plain text.
  function parseQuery(raw) {
    const tags = [], packs = [], groups = [], words = [];
    for (const term of (raw || '').match(/[#@>]"[^"]*"|\S+/g) || []) {
      const prefix = term[0];
      let value = term.slice(1);
      if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).trim();
      if ((prefix === '#' || prefix === '@' || prefix === '>') && !value) continue;
      if (prefix === '#') tags.push(value.toLowerCase());
      else if (prefix === '@') packs.push(value.toLowerCase());
      else if (prefix === '>') groups.push(value.toLowerCase());
      else words.push(term);
    }
    return { text: words.join(' '), tags, packs, groups };
  }

  // The query term that filters on `name`: quoted when the name has spaces
  function filterTerm(prefix, name) {
    return /\s/.test(name) ? `${prefix}"${name}"` : prefix + name;
  }

  function matchesFilters(snippet, filters) {
    for (const tag of filters.tags) {
      if (!(snippet.tags || []).some(t => t.toLowerCase().includes(tag))) return false;
    }
    for (const pack of filters.packs) {
      if (!(snippet.pack || '').toLowerCase().includes(pack)) return false;
    }
    for (const group of filters.groups || []) {
      if (!(snippet.group || '').toLowerCase().includes(group)) return false;
    }
    return true;
  }

  // The manager sidebar's filter: the popup's #tag, @pack and >group terms,
  // then every free-text word somewhere in the prompt (title, tags, pack,
  // group or body), case-insensitive, in any order. It narrows a list the
  // sidebar keeps in its own order, so it matches rather than ranks.
  function matchesQuery(snippet, query) {
    if (!matchesFilters(snippet, query)) return false;
    const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = [snippet.title, (snippet.tags || []).join(' '), snippet.pack, snippet.group, snippet.text]
      .join(' ')
      .toLowerCase();
    return words.every(w => hay.includes(w));
  }

  // ---- Tag colors (categorical palette, normalized for dark surfaces) ------
  const TAG_COLORS = {
    debug: '#e57a76',
    review: '#b07ce8',
    plan: '#5fb2e8',
    refactor: '#6fd0a0',
    test: '#e8b45f',
    guardrails: '#ea8c4b',
    meta: '#7fc6c9',
    general: '#8fa3c8',
  };

  function tagColor(name) {
    const key = (name || '').toLowerCase();
    if (TAG_COLORS[key]) return TAG_COLORS[key];
    const palette = Object.values(TAG_COLORS);
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }

  // ---- Prompt packs ---------------------------------------------------------
  // Strip markdown code fences that LLMs wrap around generated JSON, and a
  // UTF-8 byte-order mark (Notepad and older PowerShell write one), which
  // JSON.parse rejects.
  function stripFences(raw) {
    return (raw || '').replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  // Accepts: {name, prompts:[...]} | [{name, prompts}, ...] |
  // legacy flat [{title, text, category?|tags?}, ...]. Throws on garbage.
  function parsePacks(raw) {
    return packsFromData(JSON.parse(stripFences(raw)));
  }

  function packsFromData(data) {
    const normPrompt = p => {
      if (!p || typeof p.title !== 'string' || typeof p.text !== 'string') return null;
      let tags = Array.isArray(p.tags) ? p.tags.filter(t => typeof t === 'string') : [];
      if (!tags.length && typeof p.category === 'string' && p.category) tags = [p.category];
      return {
        title: p.title,
        text: p.text,
        tags: tags.map(t => t.trim().toLowerCase()).filter(Boolean),
        group: typeof p.group === 'string' ? p.group.trim() : '',
      };
    };
    const normPack = obj => ({
      name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Imported',
      prompts: (Array.isArray(obj.prompts) ? obj.prompts : []).map(normPrompt).filter(Boolean),
    });
    if (Array.isArray(data)) {
      if (data.length && data.every(x => x && Array.isArray(x.prompts))) return data.map(normPack);
      return [{ name: 'Imported', prompts: data.map(normPrompt).filter(Boolean) }];
    }
    if (data && Array.isArray(data.prompts)) return [normPack(data)];
    throw new Error('unrecognized pack format');
  }

  // Parse with a human-usable diagnosis instead of a generic failure.
  // Returns {ok:true, packs} or {ok:false, code, message} where code is one of
  // 'empty' | 'not-json' | 'malformed' | 'wrong-shape'.
  function diagnosePack(raw) {
    const text = stripFences(raw || '');
    if (!text.trim()) {
      return { ok: false, code: 'empty', message: 'nothing to import — the source is empty' };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (!/^[\[{]/.test(text.trim())) {
        return {
          ok: false, code: 'not-json',
          message: `not JSON — the source starts with "${text.trim().slice(0, 24)}…"`,
        };
      }
      const posMatch = /position (\d+)/.exec(e.message);
      return {
        ok: false, code: 'malformed',
        message: 'the JSON is malformed' + (posMatch ? ` near character ${posMatch[1]}` : '') +
          ' — if this text was copied out of a terminal, the copy itself is likely corrupted; use Import from file instead',
      };
    }
    try {
      return { ok: true, packs: packsFromData(data) };
    } catch {
      return {
        ok: false, code: 'wrong-shape',
        message: 'valid JSON but not a prompt pack — expected {name, prompts: [...]} or an array of prompts',
      };
    }
  }

  // ---- Where a new prompt goes ---------------------------------------------------
  // The pack that last received a prompt if it still exists and is unlocked,
  // else the default pack if it exists and is unlocked, else the first
  // unlocked pack, else a fresh "Unsorted". An empty library (no packs at
  // all) starts with the default pack. One rule for both windows. A pack
  // that is not in `names` is never returned: it used to be, and Ctrl+N
  // offered a "My prompts" nobody had made and conjured it on save.
  function defaultPackFor(lastPack, names, isLocked, defaultPack) {
    const usable = p => !!p && names.includes(p) && !isLocked(p);
    if (usable(lastPack)) return lastPack;
    if (!names.length) return defaultPack;
    if (usable(defaultPack)) return defaultPack;
    return names.find(p => !isLocked(p)) || 'Unsorted';
  }

  // ---- Pins -----------------------------------------------------------------------
  // Whether pinning `ids` fits under `max`, counting only what would newly
  // be pinned: rows in the selection that are already pinned take no new
  // slot. Returns the numbers the message needs.
  function pinPlan(snippets, ids, max) {
    const sel = ids instanceof Set ? ids : new Set(ids);
    let pinnedOutside = 0, pinnedInside = 0, toPin = 0;
    for (const s of snippets) {
      if (sel.has(s.id)) { if (s.pinned) pinnedInside++; else toPin++; }
      else if (s.pinned) pinnedOutside++;
    }
    const already = pinnedOutside + pinnedInside;
    const room = Math.max(0, max - already);
    return { ok: toPin <= room, already, toPin, room };
  }

  // Pin or unpin one snippet, stamping the pin order. Pins are muscle-memory
  // slots (Ctrl+1..5), so the order they are drawn in must be the order they
  // were pinned in, never anything that changes as prompts are pasted.
  // Re-pinning an already-pinned row keeps its original place.
  function withPin(snippet, pinned, now) {
    if (!pinned) return { ...snippet, pinned: false, pinnedAt: 0 };
    return { ...snippet, pinned: true, pinnedAt: snippet.pinnedAt || now || Date.now() };
  }

  // ---- Pack export --------------------------------------------------------------
  // The shareable form of prompts: title, tags, text, and group only when set.
  // Never uses/pinned/fieldValues/configValues — those are personal state.
  // The one place both windows' exports come from, so none can drift.
  function packToJson(name, prompts) {
    return {
      name,
      prompts: prompts.map(({ title, text, tags, group }) =>
        group ? { title, text, tags: tags || [], group } : { title, text, tags: tags || [] }),
    };
  }

  // ---- Delete with undo ------------------------------------------------------
  // Split `list` into what stays and what goes, remembering where each removed
  // item sat so Undo can put it back in place.
  function removeByIds(list, ids) {
    const gone = ids instanceof Set ? ids : new Set(ids);
    const kept = [], removed = [];
    list.forEach((item, index) => {
      if (gone.has(item.id)) removed.push({ item, index });
      else kept.push(item);
    });
    return { kept, removed };
  }

  // Re-insert removed items at their old positions. Idempotent against a list
  // that already holds some of them (an Undo built from a stale snapshot must
  // never duplicate a prompt), and tolerant of a list that has since shrunk.
  function restoreRemoved(list, removed) {
    const out = [...list];
    const present = new Set(out.map(s => s.id));
    const byIndex = [...removed].sort((a, b) => a.index - b.index);
    for (const { item, index } of byIndex) {
      if (present.has(item.id)) continue;
      out.splice(Math.min(index, out.length), 0, item);
      present.add(item.id);
    }
    return out;
  }

  // ---- Library tree --------------------------------------------------------------
  // The manager's list order. Pins come first under every order but "custom",
  // which is the array order itself (arranged by drag). Never mutates.
  const ORDERS = {
    uses: (a, b) => (b.uses || 0) - (a.uses || 0) || byTitle(a, b),
    title: byTitle,
  };
  function sortPrompts(list, orderBy) {
    if (orderBy === 'custom') return [...list];
    const cmp = ORDERS[orderBy] || ORDERS.uses;
    return [...list].sort((a, b) => (+b.pinned - +a.pinned) || cmp(a, b));
  }

  // Packs, their groups, and the prompts in each: the one shape both manager
  // surfaces draw. Packs sort by name and include every name in `packNames`
  // even when empty (an empty pack is real: it can be seen and deleted). A
  // packless prompt belongs to `defaultPack`. Within a pack the ungrouped run
  // comes first, then groups in order of first appearance, so a custom
  // arrangement holds and any other order carries through from the rows.
  // `count` is every prompt in the pack, grouped or not.
  function packTree(snippets, packNames, defaultPack) {
    const packs = new Map();
    for (const name of packNames || []) packs.set(name, { name, count: 0, ungrouped: [], groups: [] });
    for (const s of snippets) {
      const name = s.pack || defaultPack;
      if (!packs.has(name)) packs.set(name, { name, count: 0, ungrouped: [], groups: [] });
      const pack = packs.get(name);
      pack.count++;
      if (!s.group) { pack.ungrouped.push(s); continue; }
      let g = pack.groups.find(x => x.name === s.group);
      if (!g) { g = { name: s.group, items: [] }; pack.groups.push(g); }
      g.items.push(s);
    }
    return [...packs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- Clipboard in previews --------------------------------------------------
  // What a preview shows in place of {clipboard}: the clipboard as it is
  // now, whitespace collapsed to one line and cut at `max` characters with
  // an ellipsis, or a placeholder when there is nothing to paste. The
  // placeholder is a fact, not a hole: an empty clipboard pastes nothing.
  const CLIP_PREVIEW_MAX = 240;
  function clipboardPreview(clip, max) {
    const limit = max || CLIP_PREVIEW_MAX;
    const flat = (clip || '').replace(/\s+/g, ' ').trim();
    if (!flat) return '(clipboard is empty)';
    return flat.length > limit ? flat.slice(0, limit).trimEnd() + '\u2026' : flat;
  }

  // What the editor's Copy button puts on the clipboard: config values in,
  // unset ones downgraded to fields, {date}/{time} expanded, and {clipboard}
  // replaced by the clipboard as it is now — the same steps as a paste,
  // minus the fill-in form the editor has no place for, so {field} tokens
  // stay as typed for the user to fill in by hand.
  function expandForCopy(text, configValues, clip) {
    const base = downgradeUnsetConfig(expandConfig(text, configValues));
    return expandBuiltins(base).split('{clipboard}').join(clip || '');
  }

  // ---- New prompt from the clipboard ----------------------------------------------
  // The title Ctrl+N pre-fills: the clipboard's first non-empty line, cut
  // at the last word boundary within `max` characters (40), or hard at
  // `max` when the line is one long word. Empty when there is no text; the
  // caller names the fallback. It used to cut mid-word.
  const TITLE_MAX = 40;
  function titleFromClipboard(text, max) {
    const limit = max || TITLE_MAX;
    const line = ((text || '').trim().split(/\r?\n/)[0] || '').trim();
    if (line.length <= limit) return line;
    const cut = line.slice(0, limit + 1);
    const at = cut.search(/\s\S*$/);
    return (at > 0 ? cut.slice(0, at) : line.slice(0, limit)).trim();
  }

  // ---- Tags ---------------------------------------------------------------------
  // One rule for a tag typed anywhere: lowercase, and nothing outside
  // [a-z0-9_-]. The menu's "Add tag…" already did this; the editor and pack
  // import only trimmed and lowercased, so a tag with a space could be
  // stored and then never found (`#code review` parses as the tag `code`).
  // The strictest of the three, and every shipped pack's tags pass it as is.
  function normalizeTag(raw) {
    return (raw || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '');
  }

  // ---- Misc -----------------------------------------------------------------
  // "1 prompt", "2 prompts"; an irregular plural is passed in ("1 entry", "2 entries")
  function plural(n, word, pluralWord) {
    return `${n} ${n === 1 ? word : pluralWord || word + 's'}`;
  }

  function fmtHotkey(h) {
    return (h || '')
      .split('+')
      .map(p => (p ? p[0].toUpperCase() + p.slice(1) : p))
      .join('+');
  }

  const PromptlineCore = {
    RESERVED,
    isValidParam,
    tokenize,
    customFields,
    nextCopyName,
    removeParamToken,
    configNames,
    expandConfig,
    downgradeUnsetConfig,
    requiredInputs,
    fillFields,
    expandBuiltins,
    fuzzyScore,
    bodyScore,
    DRAFT_TITLE,
    isEmptyDraft,
    rankSnippets,
    slotEntries,
    highlightSegments,
    parseQuery,
    matchesFilters,
    matchesQuery,
    filterTerm,
    TAG_COLORS,
    tagColor,
    stripFences,
    parsePacks,
    diagnosePack,
    defaultPackFor,
    pinPlan,
    withPin,
    packToJson,
    removeByIds,
    restoreRemoved,
    sortPrompts,
    packTree,
    clipboardPreview,
    expandForCopy,
    titleFromClipboard,
    normalizeTag,
    plural,
    fmtHotkey,
  };

  root.PromptlineCore = PromptlineCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = PromptlineCore;
})(typeof window !== 'undefined' ? window : globalThis);
