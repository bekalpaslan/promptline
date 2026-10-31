import { useRef, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { RiPushpin2Fill, RiPushpin2Line } from "@remixicon/react"
import { cn } from "@/lib/utils"
import { Keys } from "@/components/prompt-bits"
import { footClass } from "@/components/foot"

// One line of feedback above the hint bar: the popup's only channel for an
// error (a failed paste or save), a confirmation that something landed
// (copied, saved, restored: Success text, no fill, as every confirmation in
// DESIGN.md) or a note (undo offered, press Esc again)
// `undo`: the note offers the last delete back, as a button in the strip.
// "fresh" in the session that deleted (bare U works while nothing is typed),
// "kept" on the one summon it survives (Ctrl+Z and the button only: U is
// the first letter of a query the user came back to type).
// `recover`: the paste failed after Rust put the prompt on the clipboard.
// While it shows, Enter dismisses it and does not pick (see the key handler)
export type Notice = { text: string; kind: "error" | "info" | "success"; undo?: "fresh" | "kept"; recover?: boolean }

// A press with the main button moves the window (the hint bar's handle).
// Never from a control inside (the Keep open pin). Says whether it
// started, so the handle can show its grip.
function startWindowDrag(e: React.PointerEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, textarea")) return false
  e.preventDefault()
  void getCurrentWindow().startDragging().catch(() => {})
  return true
}

// Window chrome: 8px radius, 8px padding, a line-strong edge and the one shadow
export function Shell({
  children,
  hint,
  notice,
  announce,
  onUndo,
  undoKeys,
  keepOpen,
  onKeepOpen,
}: {
  children: React.ReactNode
  hint: React.ReactNode
  notice: Notice | null
  /** Keep open is on: the pin at the bar's right is pressed and filled */
  keepOpen: boolean
  /** The pin's click: Ctrl+K's toggle */
  onKeepOpen: () => void
  /** Puts the last deleted prompt back; the strip's Undo button */
  onUndo?: () => void
  /** The keys that undo right now, drawn on the button; none while a view has the keyboard */
  undoKeys?: readonly string[]
  /** What a screen reader should hear about the current state (results, mode) */
  announce: string
}) {
  // The grabbing cursor, for a moment on a press: Windows runs the move
  // itself, so the release never reaches the page, and a timer lets go
  const [gripping, setGripping] = useState(false)
  const gripTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const grip = () => {
    setGripping(true)
    if (gripTimer.current) clearTimeout(gripTimer.current)
    gripTimer.current = setTimeout(() => setGripping(false), 260)
  }
  return (
    // The frame (the padding and the gaps between strips) drags the window:
    // Tauri moves it only when the press lands on this element itself, so
    // the search box, the rows and every control keep their own clicks.
    // A kept-open popup is moved there, beside the work.
    // The shell is the sidebar's pane colour (`sidebar`), not the Paper:
    // the list is the sidebar's tree, and it sits on the same ground in
    // both windows (2026-10-10; the darker of the two was the better).
    // Its insets are the sidebar's too: 12 px at the sides and the top,
    // 8 px between strips (the sidebar's search row, New and tree), and
    // the hint bar at the foot edge to edge, as the sidebar's foot is (it
    // was 8 px all round, with the bar inside; the user wanted the two
    // windows' margins the same, 2026-10-10).
    <div data-tauri-drag-region className="flex h-dvh flex-col gap-2 overflow-hidden rounded-2xl border border-input bg-sidebar px-3 pt-3 text-foreground shadow-(--shadow-shell)">
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      {/* The one landmark: the window's content, whichever mode it is in.
          `contents`, so the shell's column layout is unchanged */}
      <main className="contents">{children}</main>
      {/* Feedback strip: errors stay until Esc or the next summon (the hint
          bar says so), confirmations go with the popup. Two live regions: a
          confirmation is polite, an error on a window that has just
          reappeared is an alert. Two lines, not a truncation: the failed
          paste's message is the one that says where the prompt went, and it
          was cut at the default width (critique popup P1). */}
      <div role="status" aria-live="polite" className="shrink-0 empty:hidden">
        {notice?.kind === "info" && !notice.undo && (
          <div className="line-clamp-2 break-words rounded-md bg-primary/15 px-2 py-1 text-ui text-foreground" title={notice.text}>
            {notice.text}
          </div>
        )}
        {/* The undo offer: what was deleted, and a button that carries its
            keys as key caps. It was a sentence naming keys ("U or Ctrl+Z to
            undo") with nothing to click, and it went on naming U while a
            typed query had already taken that key. The title gives way; the
            button never does. */}
        {notice?.kind === "info" && notice.undo && (
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-primary/15 py-1 pl-2 pr-1 text-ui text-foreground">
            <span className="min-w-0 flex-1 truncate" title={notice.text}>{notice.text}</span>
            <button
              type="button"
              tabIndex={-1}
              className="focus-ring flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-1 font-medium hover:bg-hover"
              onClick={onUndo}
            >
              Undo
              {undoKeys?.map((k) => <Keys key={k} combo={k} />)}
            </button>
          </div>
        )}
        {notice?.kind === "success" && (
          <div className="line-clamp-2 break-words px-2 py-1 text-ui font-medium text-(--success)" title={notice.text}>
            {notice.text}
          </div>
        )}
      </div>
      <div role="alert" className="shrink-0 empty:hidden">
        {notice?.kind === "error" && (
          // Three lines, where a confirmation gets two: the failed paste's
          // message ends with how to recover ("press Ctrl+V there…"), and at
          // the 320 px minimum two lines cut it off before that
          <div className="line-clamp-3 break-words rounded-md bg-destructive/15 px-2 py-1 text-ui text-destructive" title={notice.text}>
            {notice.text}
          </div>
        )}
      </div>
      {/* Wraps rather than clips: at 125% scale, or with the mono font, the
          list's five hints are wider than the window and the shell's
          overflow-hidden used to eat the last of them.
          The bar is also the window's handle: a press anywhere on it drags
          the popup. The frame alone (8 px of padding, the gaps between
          strips) was too thin to find, and a kept-open popup is moved
          often. The drag is started here rather than by Tauri's
          data-tauri-drag-region, which answers only a press on the element
          itself, and the hints are spans inside it. Its one control, the
          Keep open pin, keeps its own press (startWindowDrag skips it). */}
      <div
        className={cn(
          // The sidebar's foot (components/foot.tsx), with the hints in mono
          // and 6 px apart; it breaks out of the shell's side padding to
          // run edge to edge like the sidebar's. The 42 px of right padding
          // are the pin's gutter (the inset, the 24 px button, a hint gap),
          // so a hint never runs under it; the bar's hints have that much
          // less room than the window, and the tiers below allow for it
          footClass,
          "group/bar relative @container -mx-3 gap-x-1.5 pr-[42px] font-mono",
          gripping ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={(e) => {
          if (startWindowDrag(e)) grip()
        }}
      >
        {hint}
        {/* Keep open, as a pin at the bar's right: the same thumbtack a
            pinned prompt wears, outlined while off and filled while on,
            and the sidebar's Settings gear in every other way (a 24 px
            button with a 16 px icon on the foot's 12 px inset, pressed in
            the secondary fill, not the accent, which is the selected
            row's): the two feet end in the same control. It replaced a
            toggle beside the search box and the open hand that marked the
            bar while kept open (2026-10-31): the pin says what the bar is
            for, a palette kept beside the work and moved by this bar. Tab
            never lands on it: the search box keeps the keyboard, and
            Ctrl+K is its key. */}
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={keepOpen}
          aria-label="Keep open (Ctrl K)"
          title={keepOpen ? "Kept open: pastes go to the last window you used. Drag this bar to move it; Ctrl+K or Esc ends it" : "Keep open: stays up beside your work and pastes into the last window you used (Ctrl+K)"}
          className={cn(
            "focus-ring absolute inset-y-0 right-3 my-auto flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-hover hover:text-foreground",
            keepOpen ? "bg-secondary text-foreground" : "text-muted-foreground"
          )}
          // The press stays off the button (a click would focus it), so
          // the search box keeps the keyboard, as the old toggle refocused it
          onPointerDown={(e) => e.preventDefault()}
          onClick={onKeepOpen}
        >
          {keepOpen ? <RiPushpin2Fill className="size-4" aria-hidden /> : <RiPushpin2Line className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  )
}
