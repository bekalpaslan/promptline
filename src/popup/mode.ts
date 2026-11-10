import type { Snippet } from "@/lib/core"

// `configFields`: the fields that are really unset {{config}} parameters,
// downgraded to ask (BEHAVIOR.md); the form says so under each, since one
// asked for every day is one the user never learned could be set once
export type FormState = { snippet: Snippet; base: string; fields: string[]; configFields: Set<string>; paste: boolean }
// `id` is the new prompt's, minted when the view opens: a second Enter
// before the first save returns then replaces the same prompt (Rust
// merges by id) instead of saving the clipboard twice
export type CreateState = { id: string; title: string; pack: string; group: string; prefilled: string }

// Which view the window is in. The action panel floats over whatever is
// under it and comes first; then the two views that replace the list (the
// fill-in form, the create view); then the clipboard panel over the rows;
// else the list. Derived once, here: the hint bar, the status region's
// text and the Undo button's keys each tested the same states in the same
// order and could drift apart (REVIEW D6). The key handler still reads the
// states itself: it asks about the clipboard panel before the form, so in
// the one render where both are set (the effect that closes the panel has
// not run yet) a key still goes to the panel; folding it onto this order
// would change that.
export type PopupMode =
  | { kind: "panel"; snippet: Snippet; armed: boolean }
  | { kind: "form"; form: FormState }
  | { kind: "create"; create: CreateState }
  | { kind: "clipboard" }
  | { kind: "list" }

export function popupMode(s: {
  panelFor: Snippet | null
  /** The panel's Delete has been pressed once: "Really delete?" is the question on screen */
  deleteArmed: boolean
  form: FormState | null
  create: CreateState | null
  clipOpen: boolean
}): PopupMode {
  if (s.panelFor) return { kind: "panel", snippet: s.panelFor, armed: s.deleteArmed }
  if (s.form) return { kind: "form", form: s.form }
  if (s.create) return { kind: "create", create: s.create }
  if (s.clipOpen) return { kind: "clipboard" }
  return { kind: "list" }
}
