# code/rust — Rust/Tauri backend implementation (Promptline)

extends: code (core contract)
scope: `src-tauri/` only

## Guardrails

- **Platform boundary:** all OS-specific code (SendInput, SetForegroundWindow, registry,
  anything from `windows`-rs) lives in the `platform` module of `src-tauri/src/lib.rs`.
  Never call Win32 APIs outside it; the module is the macOS port seam.
- **Data compatibility:** `Snippet`/`Config` structs are serialized to user disk. New fields
  need `#[serde(default)]`; removed fields need a migration in `load_snippets_from_disk`.
  Never break an existing `snippets.json`.
- **Commands:** new `#[tauri::command]` fns must be added to `generate_handler![]` or they
  silently fail from JS.

## Gate

`cargo check` in `src-tauri/` must pass before reporting success. `cargo clippy` warnings
are report-worthy, not blocking. Paste/focus behavior cannot be verified headlessly —
report "needs manual hotkey test" rather than claiming verified.

## Grants

context7 MCP for Tauri 2 / windows-rs / arboard documentation.
