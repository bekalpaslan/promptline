import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

// The expandable panel, one look wherever the app folds a thing open: a
// head on its own ground that names the thing, and, open, a body under
// it on a lighter ground (a step up in dark, sunk in light) holding what
// the thing is made of, a list of prompts, a text field, a pack's file and
// actions. The editor's Prompt panel is the pattern (its title line over
// the field); the trees' pack frames and Settings' pack cards draw the
// same since 2026-10-10, and the user asked for it to be named once (the
// `panel-head`, `panel-body` and `panel-edge` tokens in design/tokens.json
// and the palettes' files; Instrument's edge is none, Indigo's its line).
// The head's own layout (a tree header, a title line, a disclosure
// button) and the body's padding are the caller's; the corners are the
// module's 8 px outside, so the body's bottom corners are 7 inside the
// 1 px edge. Folded, a panel is whatever its head is on its own.

export const panelClass = "rounded-lg border border-(--panel-edge) bg-(--panel-head)"
export const panelBodyClass = "rounded-b-[7px] bg-(--panel-body)"

export function Panel({ open = true, className, ...props }: ComponentProps<"div"> & { open?: boolean }) {
  return <div className={cn(open && panelClass, className)} {...props} />
}

export function PanelBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(panelBodyClass, className)} {...props} />
}
