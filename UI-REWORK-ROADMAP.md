# Promptline UI Rework Roadmap

> **Status (2026-07-12): all phases implemented.** Phase 0 in commit `27793f0`;
> test infra in `e43cbd0`; Phases 1–5 in the full-rework commit that follows.
> Two deliberate deviations: the popup's two bottom meta-bars (hint + clipboard
> preview) were kept separate rather than merged (2.6), and the long-term
> "direct API call" variant of 4.4 remains future work.

Synthesized from three parallel audits (2026-07-12): UX heuristics (Nielsen/Krug,
severity-rated), visual design system (tokens/type/spacing/states/palette), and
interaction+IA (benchmarked against Raycast / VS Code / Alfred / Linear).
Overall heuristic score at audit time: **6/10** — fast, well-crafted core loop;
no catastrophic blockers; real gaps in safety, feedback, and keyboard parity.

Items marked ⚠ were flagged independently by 2+ audits (highest confidence).
Effort: S < half a session · M ≈ a session · L > a session.

---

## Phase 0 — Correctness & safety (do first; all are "current UI is wrong")

| # | Item | Effort | Source |
|---|---|---|---|
| 0.1 | ⚠ **Hover steals keyboard selection + full list re-render on mousemove.** Ignore hover-select until real mouse movement after last keydown; swap `.selected` classes instead of rebuilding the list. Can paste the wrong prompt today. | S | IA#3, UX#4 |
| 0.2 | ⚠ **Prompt delete: two-click confirm + "Deleted — Undo" status action.** Same pattern as pack delete; also move Delete away from Pin (`margin-left:auto`). | S | UX#1, IA#8, VD§5.2 |
| 0.3 | ⚠ **Dirty-state guard in editor** — better: Linear-style autosave on blur/debounce, drop the Save button; keep explicit confirm only for moves into locked packs. Silent draft loss is the worst manager defect. | M | UX#2, IA#7 |
| 0.4 | ⚠ **State-aware popup hint bar** — list mode: `↵ Paste · Ctrl+↵ Copy · Esc Close`; form mode: `↵ Paste · Ctrl+↵ Copy · Shift+↵ Newline · Esc Back`. Make Ctrl+Enter actually override paste/copy inside the form (today the mode is frozen at form open). | S | IA#1, UX#7 |
| 0.5 | ⚠ **Errors must persist** — status split: successes fade (3.5s), errors stay until next action, brief fade-in for peripheral catch. Inline "Saved ✓" on the button as secondary channel. | S | UX#3, UX#16 |
| 0.6 | **Unset `{{config}}` params must not paste invisible holes** — popup shows a warning strip (reuse clipPreview pattern) or downgrades the param to a fill-in field for that paste. | S | UX#5 |
| 0.7 | **`+ New` creates persisted junk** — keep new prompts as drafts until first save, or GC untitled+empty prompts on load. | S | UX#8 |
| 0.8 | **Near-miss tokens flagged in preview** — `{File}`/`{step1}` render as "not a field: use lowercase" instead of passing silently. | S | UX#11 |

## Phase 1 — Token & state foundation (unblocks everything visual)

| # | Item | Effort | Source |
|---|---|---|---|
| 1.1 | ⚠ **Extract remaining tokens**: `--accent-hover/-ring/-soft/-text` (4/7/1/1 hardcoded sites), `--param-builtin/-field/-config` (+soft/border variants, 12 sites), `--success`, separate `--warn` for pin/lock (stop reusing the field-amber literal). Consider `color-mix()` for ring/soft. Identical token block in both files with a sync-comment header. | M | VD§1.2-1.4 |
| 1.2 | **Fix Sand `--line` aliasing `--bg-2`** — either distinct hairline (#34322f) or commit to borderless inputs in both themes (today the two themes render input affordances differently). | S | VD§1.5 |
| 1.3 | **Type scale: 10 steps → 5** (`10 / 11.5 / 12.5 / 14 / 16` as vars); weight cleanup (pills→500, 700 only for uppercase micro-labels); delete no-op letter-spacing; `tabular-nums` on counters. | M | VD§2 |
| 1.4 | **Spacing/radius normalization**: 4px grid for padding (2px sub-step for pills), gaps `4/8/12/16`, radii `6/8/12`. Move inline style-attribute paddings into shared rules. | M | VD§3 |
| 1.5 | ⚠ **Interaction states**: global `:focus-visible` ring on buttons/chips; `tabindex` + Enter/Space on sidebar rows, group headers, param chips (manager currently has zero keyboard path); global `:active` press and `:disabled` rules; ring on `#orderBy`. | M | VD§4, UX theme 3 |

## Phase 2 — Palette & visual clarity

| # | Item | Effort | Source |
|---|---|---|---|
| 2.1 | **Renormalize the 8 tag hues to equal OKLCH lightness/chroma** (~L0.75 C0.11): fix invisible `general` gray, dark `refactor` green, and the amber-vs-orange twin (`test`/`guardrails` are ~10° apart — indistinguishable at 10px). | M | VD§6.1-6.2 |
| 2.2 | ⚠ **Resolve the three-violets problem**: accent #645bc5 vs config-param #b07ce8 vs `review` tag (same hex). Move config-param to orchid (~#d67ad0, the palette's empty hue slot); `review` keeps its violet. | S | VD§6.3, VD noted clash flagged at theme time |
| 2.3 | **Pill tint robustness across themes**: alpha 13%→18% + 1px `color+'44'` border so hue is carried by an edge (pattern already proven by `.pchip.present`). | S | VD§6.4 |
| 2.4 | **Contrast: bump `--text-3` one step for sub-12px text** (hint bar, previews, counters currently near/below 4.5:1). | S | UX#14 |
| 2.5 | **Emoji → inline SVG icons** (📌 ⚙ ✕ 🔒 ＋): font-independent, theme-tintable. Lucide-style, inlined. | S | IA-fix, VD§5.1 |
| 2.6 | **Hierarchy nudges**: editor title input 15-16px/600 (tags/pack secondary); settings card h2 gets the uppercase micro-label idiom or 14/600; header h1 16/700. Merge popup clip-preview into the hint row (two stacked meta-bars today). | S | VD§5 |

## Phase 3 — Popup power (the daily surface)

| # | Item | Effort | Source |
|---|---|---|---|
| 3.1 | **Match highlighting** — return indices from `fuzzyScore`, bold matched chars. Sub-second confidence requires seeing *why* a row matched. | S | IA#2 |
| 3.2 | **Ctrl+1..9 quick-paste** with faint ordinals on the first rows; pins (max 5, already top-anchored) become stable muscle-memory slots. | S | IA#5 |
| 3.3 | ⚠ **Keyboard access to the preview card** — show for keyboard-selected item on dwell or Right-arrow/Tab; today the only view of full text + token types is mouse-only and arrows actively hide it. | S/M | UX#4, IA#4 |
| 3.4 | **`#tag` / `@pack` filter syntax** in popup search (+ clickable pills to apply filter); tags stop being pure decoration. | S/M | IA#6 |
| 3.5 | **Tab = action panel** on selected item: Paste / Copy / Pin / **Edit in manager** (no path exists today) / Delete. Needs a Rust command to focus manager on a prompt id. | M | IA#4 |
| 3.6 | **Density option**: Comfortable (current) vs Compact (no preview line, ~2× rows). | S | IA#15 |

## Phase 4 — Manager IA restructure (order matters)

| # | Item | Effort | Source |
|---|---|---|---|
| 4.1 | **Import preview becomes a curation list** — per-prompt rows (title, first line, tags, new/dupe badge) with include-checkboxes; serves both Import pack and Import Claude's reply. Generated packs need a curation gate. | M | IA#9 |
| 4.2 | **Sidebar multi-select + context menu** (Move to pack…, Add tag…, Export, Delete). Reorganization is O(n) full edit cycles today. Depends: 0.2, 0.3. | M | IA#10 |
| 4.3 | **Pack management moves into the sidebar** — operations on group headers (rename/lock/export/delete inline, "New pack" row); Settings "Packs" card shrinks to a link; editor keeps only assignment. Kills the `＋ New pack…` input-swap dance. Depends: 4.2. | M | IA#11 |
| 4.4 | **Generate-with-Claude leaves Settings** — `+ New ▾ → Generate pack with Claude…` opens a focused dialog (topic → steps → 4.1 preview). Settings is for configuration, not creation. Long-term: direct API call, no clipboard round-trip. Depends: 4.1. | M/L | IA#12 |
| 4.5 | **Settings gets a side-nav shell** (General · Appearance · Data) replacing the sidebar while active — fixes silent exit via sidebar click and the un-applied hotkey loss. Theme moves to Appearance **and into config.json** (localStorage today: excluded from export, profile-fragile). Depends: 4.3, 4.4 shrink the content first. | M | IA#13, UX#9 |

## Phase 5 — Onboarding & polish

| # | Item | Effort | Source |
|---|---|---|---|
| 5.1 | ⚠ **Hotkey visibility**: show the current binding in the manager header ("Press **Ctrl+Shift+V** anywhere") and in empty states. The product's premise is currently invisible in the product. | S | UX#6, IA#14 |
| 5.2 | **First-run banner with live rehearsal** — "try it now" + checkmark when the popup has fired once (needs a Rust-side flag); link to change hotkey re browser conflict. | M | IA#14 |
| 5.3 | **Hotkey recorder input** (press keys to capture) replacing free-text grammar + raw Rust error passthrough. | M | UX#10, IA#14 |
| 5.4 | **Field-value memory transparency** — mark pre-filled runtime values as "last used"; consider per-field opt-out in Advanced. | S | UX#13 |
| 5.5 | **Empty-state copy fixes** ("left-click the tray icon"). | S | UX#15 |

---

## Suggested execution order

Phase 0 in one session (eight S/M fixes, immediately shippable).
Phase 1 next — it's the multiplier; nothing in 2/3 should land before tokens exist.
Phases 2 and 3 parallelize cleanly (different concerns, different files-ish).
Phase 4 sequentially (4.1 → 4.2 → 4.3 → 4.4 → 4.5).
Phase 5 anytime after 0; 5.1 is cheap enough to smuggle into Phase 0.

## Deliberately deprioritized
Drag-reorder (no manual sort exists), frecency ranking (revisit if ranking
complaints), separate settings window (in-window rail is enough at this scale).
