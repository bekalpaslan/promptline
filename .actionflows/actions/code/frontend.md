# code/frontend — HTML/JS UI implementation (Promptline)

extends: code (core contract)
scope: `ui/` only (`index.html` manager window, `popup.html` hotkey popup)

## Guardrails

- **No build step:** both files are self-contained (inline CSS/JS, no bundler, no imports).
  Tauri IPC is `window.__TAURI__.core.invoke` / `window.__TAURI__.event.listen` — the
  `withGlobalTauri` globals, not `@tauri-apps/api` imports.
- **Duplicated helpers by design:** tag-color hashing and the `{token}` regex exist in BOTH
  files. A behavior change to shared logic must be applied to both, or state divergence
  between popup and manager results.
- **Design tokens:** both files share the same `:root` CSS variable palette. New UI uses
  the existing variables, not new hex values.
- **IPC argument casing:** JS `invoke` argument objects use camelCase keys that map to the
  Rust command's snake_case parameters.

## Gate

After any large Write, verify no encoding artifacts: `grep -P '\x7f' ui/*.html` must be
empty (one past incident of DEL bytes corrupting string literals). UI changes are only
visible after an app restart (`promptline.exe` kill + `npx tauri dev`) — report that the
restart is required; do not claim visual verification without it.

## Grants

playwright / chrome-devtools MCP for browser-based checks of the HTML (with `window.__TAURI__` mocked).
