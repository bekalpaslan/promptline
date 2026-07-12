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

  // ---- Search query parsing: `#tag` and `@pack` filter terms ---------------
  // Returns {text, tags: [..], packs: [..]}
  function parseQuery(raw) {
    const tags = [], packs = [], words = [];
    for (const term of (raw || '').trim().split(/\s+/).filter(Boolean)) {
      if (term.startsWith('#') && term.length > 1) tags.push(term.slice(1).toLowerCase());
      else if (term.startsWith('@') && term.length > 1) packs.push(term.slice(1).toLowerCase());
      else if (term !== '#' && term !== '@') words.push(term);
    }
    return { text: words.join(' '), tags, packs };
  }

  function matchesFilters(snippet, filters) {
    for (const tag of filters.tags) {
      if (!(snippet.tags || []).some(t => t.toLowerCase().includes(tag))) return false;
    }
    for (const pack of filters.packs) {
      if (!(snippet.pack || '').toLowerCase().includes(pack)) return false;
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
  // Strip markdown code fences that LLMs wrap around generated JSON.
  function stripFences(raw) {
    return (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
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
    expandBuiltins,
    fuzzyScore,
    parseQuery,
    matchesFilters,
    TAG_COLORS,
    tagColor,
    stripFences,
    parsePacks,
    diagnosePack,
    fmtHotkey,
  };

  root.PromptlineCore = PromptlineCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = PromptlineCore;
})(typeof window !== 'undefined' ? window : globalThis);
