/**
 * Why Rust opened this window, when it built the manager for a reason: the
 * popup's Edit names a prompt, the update toast or tray item asks for the
 * offer (`opening_script` in `lib.rs`, set before any script here runs).
 * A manager that was already open is told the same through `edit-prompt`
 * and `update-offer` instead, so this is read once, at load.
 */
export type Opening = { edit?: string; offer?: boolean }

function readOpening(): Opening {
  const value = (window as { __PROMPTLINE_OPENING__?: unknown }).__PROMPTLINE_OPENING__
  if (!value || typeof value !== "object") return {}
  const o = value as Record<string, unknown>
  return {
    edit: typeof o.edit === "string" ? o.edit : undefined,
    offer: o.offer === true,
  }
}

export const opening: Opening = readOpening()
