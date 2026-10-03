# The Indigo trial, 2026-10-03 (the worked example)

Source: the "AI Chat UI Pro" Figma community file
(`dYLlNZXLHqUFfNQrGfqadg`): example screen `3:2`, Foundations `2:99`,
Components `2:2`. Dark only. Comparison page:
https://claude.ai/artifact/Beg45CtWegX3ebt9nhbYK2

## What the file gave, and where it went

| File | Token | Value |
|---|---|---|
| BG `#0B0C11` | surface-0 (dark) | `#0b0c11` |
| Card `#12141B` | surface-sunk, surface-raised (dark) | `#12141b` |
| Primary Indigo `#7380FF` | accent, focus (dark); btn-primary darkened to `#5661f2` for 4.5:1 under white | |
| Tool Green `#38D48C` | success | |
| Code Cyan `#4CD1E6` | param-builtin (the `{clipboard}` chips) | |
| Running `#FFBA43` | warn, param-field | |
| Error `#F2666B` | danger | |
| white 90 % / 55 % | ink / ink-2 (composited on BG) | `#e6e7e7` / `#919294` |
| white 7 % | line | `#1c1d22` |
| indigo 18 % | selection | `#1e213c` |
| radii 10 / 14 / 6 | radius-2 10px (the app's scale gives 6 / 10 / 14) | |
| code block `#050609` | code-ground | |
| state pills: 10 % tint + 35 % edge | chip-tint / chip-edge | |
| message bar pill | radius-search 999px | |
| "+ New chat" filled | the sidebar-new `data-theme` rule | |

Light side, derived: white ground, `#f4f5fa` sunk, `#5563f0` accent and
button, semantic colours darkened to clear 4.5:1 on white (`#c0343a`,
`#8f5806`, `#167a4d`, `#0b7484`). Every pair that failed the checker on
the first run was a light-side text colour; darkening fixed each.

## The skin that sold it

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");
:root { --radius: 10px; --background: #ffffff; --sidebar: #f4f5fa; --secondary: #eef0f7; --muted: #eef0f7;
  --card: #ffffff; --popover: #ffffff; --hover: #eceef6; --accent: rgba(115,128,255,.16); --foreground: #0f1118;
  --muted-foreground: #5c6275; --border: #e6e8f0; --input: #cfd3e3; --link: #5563f0; --ring: #7380ff; --focus: #7380ff;
  --primary: #7380ff; --primary-foreground: #ffffff; --module-border: var(--border); }
.dark { --background: #0b0c11; --sidebar: #12141b; --secondary: rgba(255,255,255,.06); --muted: rgba(255,255,255,.06);
  --card: #12141b; --popover: #12141b; --hover: rgba(255,255,255,.04); --accent: rgba(115,128,255,.18);
  --foreground: rgba(255,255,255,.9); --muted-foreground: rgba(255,255,255,.55); --border: rgba(255,255,255,.07);
  --input: rgba(255,255,255,.12); --link: #7380ff; --ring: #7380ff; --focus: #7380ff; --primary: #7380ff;
  --primary-foreground: #ffffff; --destructive: #f2666b; --warn: #ffba43; --success: #38d48c;
  --param-builtin: #4cd1e6; --param-builtin-bg: rgba(77,209,229,.12); --module-border: var(--border); }
html { --app-font: "Inter", "Segoe UI", system-ui, sans-serif !important; } /* the pref is inline on <html> */
.h-9.border-dashed { border-style: solid; border-color: transparent; background: var(--primary); color: var(--primary-foreground); }
input[role="combobox"] { border-radius: 999px; }
.tag-tint { background-color: color-mix(in srgb, var(--tag) 10%, transparent); border-color: color-mix(in srgb, var(--tag) 35%, transparent); }
#popup-preview { background-color: #050609; }
```

## What the trial taught

- The first shots had no font change: `applyPrefs` sets `--app-font`
  inline, so only `!important` from a stylesheet beats it.
- Translucent whites in the skin became composited hex in the tokens
  file: the contrast checker reads six-digit hex only, and stacked
  translucency drifts anyway.
- The example screen alone showed the indigo almost nowhere (New is a
  dashed outline, New prompt too). Settings, with Generate, and the
  Generate dialog are where a filled primary shows; shoot them.
- Inter is wider than Segoe: the editor's title input reached its edge at
  the manager's default width. Not a bug (the field scrolls, and the right
  padding is reserved for the Saved caption), but worth a sentence.
- Three new tokens were enough for the structural look; the New button
  stayed a `data-theme` rule because Instrument's "accent as text only"
  is a documented principle, not a value.
- About an hour from link to comparison page; half a day to the branch.
