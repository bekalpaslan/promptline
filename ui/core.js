// Promptline shared core — pure logic used by BOTH windows (popup.html, index.html)
// and by the node:test suite (tests/core.test.js). No DOM, no Tauri APIs here.
(function (root) {
  'use strict';

  // ---- Placeholder tokens -------------------------------------------------
  // {clipboard} expands in Rust at paste time; {date}/{time} expand in JS;
  // {{name}} is a config parameter (saved value, no prompt);
  // any other valid {name} is a runtime fill-in field.
  // Invalid names (uppercase/digits) are flagged, never silently pasted.
  const RESERVED = ['clipboard', 'date', 'time'];
  const TOKEN_RE_SRC = '\\{\\{([a-zA-Z0-9_]+)\\}\\}|\\{([a-zA-Z0-9_]+)\\}';

  function isValidParam(name) {
    return /^[a-z_]+$/.test(name);
  }

  // Tokenize prompt text into parts for preview rendering.
  // Returns [{type:'text',value} | {type:'builtin'|'field'|'config'|'bad', name, raw}]
  function tokenize(text) {
    const parts = [];
    const re = new RegExp(TOKEN_RE_SRC, 'g');
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
      const name = m[1] || m[2];
      const raw = m[0];
      if (!isValidParam(name)) parts.push({ type: 'bad', name, raw });
      else if (m[1]) parts.push({ type: 'config', name, raw });
      else if (RESERVED.includes(name)) parts.push({ type: 'builtin', name, raw });
      else parts.push({ type: 'field', name, raw });
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
    return parts;
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
    return text.replace(/\{\{([a-z_]+)\}\}/g, (match, name) => (values[name] ? values[name] : match));
  }

  // Unset config params become runtime fields for this paste.
  function downgradeUnsetConfig(text) {
    return text.replace(/\{\{([a-z_]+)\}\}/g, '{$1}');
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
    return text.replace(/\{([a-z_]+)\}/g, (match, name) =>
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

  // ---- Ranking ---------------------------------------------------------------------
  // The popup's list order, as one pure function. No query text: pinned first
  // in pin order (oldest pin first — a pin is a fixed Ctrl+digit slot, so use
  // counts must never move it), then the rest by most used, then title. With
  // text: title matches rank above tag matches above body matches, each tier
  // by fuzzy score, ties by uses.
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
            ? ((a.pinnedAt || 0) - (b.pinnedAt || 0)) || a.title.localeCompare(b.title)
            : ((b.uses || 0) - (a.uses || 0)) || a.title.localeCompare(b.title)))
        .map(s => ({ s, indices: null }));
    }
    return pool
      .map(s => {
        const title = fuzzyScore(q.text, s.title);
        if (title) return { s, score: title.score, indices: title.indices };
        const tag = fuzzyScore(q.text, (s.tags || []).join(' '));
        if (tag) return { s, score: 3000 + tag.score, indices: null };
        const body = fuzzyScore(q.text, s.text);
        if (body) return { s, score: 5000 + body.score, indices: null };
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.score - b.score) || ((b.s.uses || 0) - (a.s.uses || 0)))
      .map(({ s, indices }) => ({ s, indices }));
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
  // Returns {text, tags: [..], packs: [..], groups: [..]}
  function parseQuery(raw) {
    const tags = [], packs = [], groups = [], words = [];
    for (const term of (raw || '').trim().split(/\s+/).filter(Boolean)) {
      if (term.startsWith('#') && term.length > 1) tags.push(term.slice(1).toLowerCase());
      else if (term.startsWith('@') && term.length > 1) packs.push(term.slice(1).toLowerCase());
      else if (term.startsWith('>') && term.length > 1) groups.push(term.slice(1).toLowerCase());
      else if (term !== '#' && term !== '@' && term !== '>') words.push(term);
    }
    return { text: words.join(' '), tags, packs, groups };
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
  // else the default pack if unlocked, else the first unlocked pack, else a
  // fresh "Unsorted". One rule for both windows.
  function defaultPackFor(lastPack, names, isLocked, defaultPack) {
    const usable = p => !!p && names.includes(p) && !isLocked(p);
    if (usable(lastPack)) return lastPack;
    if (!isLocked(defaultPack)) return defaultPack;
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

  // ---- Misc -----------------------------------------------------------------
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
    configNames,
    expandConfig,
    downgradeUnsetConfig,
    requiredInputs,
    fillFields,
    expandBuiltins,
    fuzzyScore,
    isEmptyDraft,
    rankSnippets,
    highlightSegments,
    parseQuery,
    matchesFilters,
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
    fmtHotkey,
  };

  root.PromptlineCore = PromptlineCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = PromptlineCore;
})(typeof window !== 'undefined' ? window : globalThis);
