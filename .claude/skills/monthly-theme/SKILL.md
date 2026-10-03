---
name: monthly-theme
description: Build the month's Promptline theme from a Figma design (or any reference look) and shelve it on a `theme/<id>` branch for the next release. Use this whenever the user shares a Figma link or a design they like and wants to "see it on our UI", try a new look, add a theme, a palette, a skin or a colour scheme, or asks what this month's theme should be, even if they don't say "theme". It interviews, trials the look as a stylesheet over the mock before any code changes, then wires a real theme through the token pipeline.
argument-hint: [figma-url or theme idea]
---

# Monthly theme

Promptline ships one new theme a month (decided 2026-10-03; Indigo was the
first, in 0.2.18). A theme is a palette with a light and a dark side,
chosen under Settings → Appearance → Theme; the light/dark choice is Mode.
Everything the app paints comes from design tokens, so a theme is one
tokens file plus four small wiring points, and the whole thing can be
tried in the browser before a line of app code changes. That trial is the
point of this skill: the user decides on screenshots of their own app,
not on a Figma frame.

The skill ends with the theme on a pushed `theme/<id>` branch, unmerged.
The `release` skill finds it there and folds it into the next release's
notes, so the theme and the release stay separate decisions.

Read BEHAVIOR.md → Theming before starting; it says how the two axes work
and why the themes differ only where they do.

## Contents

1. [Interview](#1-interview-one-question-at-a-time): source, name, scope,
   the light side and the font, one question at a time.
2. [Read the design](#2-read-the-design): the Figma MCP calls, the
   design-to-code resource, the palette as token names.
3. [Trial as a skin](#3-trial-as-a-skin-before-any-code): a stylesheet
   over the mock, `shoot-skin.mjs`, the before/after page, the go.
4. [Wire the theme](#4-wire-the-theme): the branch, `make-theme.cjs`,
   `wire-theme.cjs`, a new structural token, docs, tests, checks, push.
5. [Shelve and report](#5-shelve-and-report): what the release skill
   looks for, what to tell the user.

Scripts in `scripts/`: `shoot-skin.mjs` (both windows, both modes, with
and without a skin or a saved palette), `make-theme.cjs` (a tokens file
from a values map, translucency composited to hex), `wire-theme.cjs`
(the four wiring points, idempotent). `assets/compare.html` is the
before/after page; `references/indigo-trial.md` is the worked example.

## 1. Interview (one question at a time)

The user prefers one decision at a time with a recommended default first.
Ask with AskUserQuestion, in this order, skipping what the request already
answers:

1. **Source.** A Figma link (file key and node id from the URL), several
   links (an example screen, a Foundations page and a Components page are
   the useful trio), or a described look. Ask for node links if the URL
   has none; never guess a node id.
2. **Name.** A short id (`indigo`, `ember`) and a label. Recommend naming
   by the accent colour or the mood, not by the source: the name outlives
   where it came from.
3. **Scope.** Tokens only, or also the "structural touches" the file
   needs (today's tokens cover: search-box radius, chip tint and edge,
   the hover card's ground; the sidebar's New button is the one
   `data-theme` rule). Recommend tokens plus the existing touches; a new
   structural idea becomes a new token with the default theme's value in
   `design/tokens.json`, never a component fork.
4. **Light side.** Most design files are dark only. Say that the light
   side will be derived from the same hues at the same contrast steps and
   needs the user's eyes before it ships. A theme never chooses the font;
   if the file leans on a face the app doesn't ship, offer to add it under
   Font as a separate choice (it must be OFL or similar, shipped via
   fontsource like Outfit and Inter, and named in THIRD-PARTY-NOTICES.md).

## 2. Read the design

With the Figma MCP: `get_screenshot` for the visual target, `get_metadata`
for structure, `get_variable_defs` (often empty on community files), and
`get_design_context` for exact values. The design-to-code resource at
`skill://figma/figma-design-to-code/SKILL.md` must be read before
`get_design_context`; pass `skillNames: "resource:figma-design-to-code"`.
Download screenshots with curl into the scratchpad and look at them.

Write down the palette as it maps to the app's token names (see
`design/tokens.json`'s `usage` lines): surfaces, ink levels, line, accent,
primary button, semantic colours, the placeholder-chip pairs, radii. A
Foundations page gives the semantic set (success, warning, error, code);
an example screen gives the surfaces and the accent's role. Note what the
file does with the accent: Instrument keeps it to text, focus and
matches; a file that leads with a filled primary wants `btn-primary` to
be the accent.

## 3. Trial as a skin, before any code

A skin is a stylesheet that overrides the app's CSS variables, injected
over the mock pages. It costs nothing and shows the theme on the real
screens with the real demo library.

1. Start Vite: `npx vite --port 5175 --strictPort` (background; 5173 is
   often held). Stop it when done.
2. Write `test-results/skin/<id>.css` (gitignored): `:root { … }` for the
   light side and `.dark { … }` for the dark, over the variable names in
   `src/index.css` (`--background`, `--sidebar`, `--primary`…). Set
   `--radius`. The font pref is set inline on `<html>`, so a font override
   needs `html { --app-font: … !important }`. Add the structural touches
   as plain rules keyed on classes (`.h-9.border-dashed` is the sidebar's
   New, `input[role="combobox"]` the popup search, `.tag-tint` the chips,
   `#popup-preview` the hover card). `references/indigo-trial.md` has the
   skin that became Indigo, as a worked example.
3. Shoot: `node .claude/skills/monthly-theme/scripts/shoot-skin.mjs
   --skin test-results/skin/<id>.css --out test-results/skin/shots`. It
   stages the same screens as `e2e/shots.spec.ts` (overview, editor,
   settings, generate, popup, preview, search, form), both modes, with and
   without the skin, at the windows' real sizes. It runs from inside the
   repo so it finds Playwright; a copy outside the tree cannot.
4. Look at the shots yourself first (Read the PNGs): the font landed, the
   primary shows where it should, nothing clipped. Fix the skin and reshoot.
5. Publish a before/after page: copy `assets/compare.html` into the
   scratchpad, set its `SCREENS` list and texts, publish it with the shots
   as `files` (root = the scratchpad; `shots/<name>-<mode>-<now|skin>.png`).
   Load the `artifact-design` skill first, as the Artifact tool asks.
6. Show the user the link and ask for a go, with what you'd watch (a wider
   font reaching the title field's edge, a derived light side, an accent
   now used as a fill). A theme that doesn't survive this step costs an
   hour, not a branch.

## 4. Wire the theme

On a branch: `git checkout -b theme/<id>` from an up-to-date master.
If the working tree carries another session's changes, stop and say so;
the branch must hold only the theme.

1. **Tokens file.** `node .claude/skills/monthly-theme/scripts/make-theme.cjs
   <id> <values.json> "<Label>"` writes `design/<id>.tokens.json` from
   `design/tokens.json`'s shape with your values. The values file maps
   token name → `{light, dark}` (and radii → string, mix → percent
   strings); the script composites `rgba(...)` onto the named ground so
   the contrast checker, which reads only six-digit hex, can judge it.
   Every token in the base file needs a value; the script lists what's
   missing. Keep `param-config` at Instrument's orchid unless the file
   has a third hue.
2. **Wiring.** `node .claude/skills/monthly-theme/scripts/wire-theme.cjs
   <id> "<Label>"` adds the theme to `PALETTES` in `scripts/tokens.mjs`,
   the two marker regions in `src/index.css` (under
   `:root[data-theme="<id>"]` and `:root[data-theme="<id>"].dark`, with
   `--module-border`), the Settings list in `src/lib/prefs.ts`, and widens
   `resolvePalette` in `ui/core.js` (it rewrites the function to a list of
   ids). It is idempotent; run it, then `npm run tokens`. A contrast
   failure names the pair and the theme: darken the text or lighten the
   ground, never lower the floor.
3. **Structural touch that is new** (rare): a token with the default
   theme's current value in `design/tokens.json` (and `MAP` in
   `scripts/tokens.mjs`), read by the component through `var(--…)`. The
   New-button rule is the only `data-theme` selector; a second one needs a
   reason written into BEHAVIOR.md.
4. **Docs.** BEHAVIOR.md → Theming: one sentence on what the theme is and
   anything it does differently. README's Settings bullet lists the
   themes. `design/<id>.release-notes.md`: the user-facing bullets for the
   release's Themes section, in the voice of `gh release view` notes (what
   they see and press; lead bullet names the look in a sentence). The
   release skill reads this file.
5. **Tests.** `tests/core.test.js` has a `resolvePalette` case; add the
   id. The tokens tests check both files declare the same tokens and clear
   contrast by themselves. The Playwright theme case (manager and popup)
   is generic; add one only if the theme has a visible structural touch
   the others don't.
6. **Checks**, all seven (CLAUDE.md → Checks), and a run of
   `shoot-skin.mjs --palette <id>` (no `--skin`: it sets the saved
   preference instead) to see the real theme once, both modes.
7. `unix2dos` the touched files, commit (`Themes: <Label>, this month's
   theme` with the why in the body), push the branch, and do not merge.

## 5. Shelve and report

Report: the branch name, the artifact link, what the theme changes beyond
colour, what was derived rather than taken from the file, and the one line
the release will pitch. Save a memory note if the trial taught something
about the pipeline (a new token kind, a composite that was tricky).

The release skill picks the shelf up by finding `design/*.tokens.json`
files added since the last tag, on master or on an unmerged `theme/*`
branch. A theme shelved and then rejected is a branch to delete, nothing
more.
