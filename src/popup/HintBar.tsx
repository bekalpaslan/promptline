import { C } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Keys } from "@/components/prompt-bits"
import type { PopupMode } from "@/popup/mode"
import type { Notice } from "@/popup/Shell"

// window (125% scale, the mono font) wraps between hints instead of being
// clipped by the shell's overflow, and never splits a key from its label.
// A `minor` hint is dropped below 400 px: at the 320 px minimum the bar
// wrapped to two lines and ate a row (L20). A `mid` one shows from 416 px:
// the resting bar's fifth hint (preview), which fit the default 400 px
// until the Keep open pin took the bar's right (2026-10-31) and left room for
// four. A `wide` one shows only from 480 px, in a window the user has
// widened: a sixth hint (fold) wrapped the bar the same way.
// Those widths are the window's at 100% UI scale. The breakpoints are
// container queries on the bar, in rem (the window's width less the
// shell's 18 px of padding and border and the pin's 42 px gutter, 56 px
// in all; 18 through 0.2.26, before the pin moved to the bar), so they
// grow with the UI scale: as viewport pixels they kept showing five hints
// at 125%, where the type is a quarter wider, and the bar wrapped at
// every width.
// A `warn` hint says what the key is about to do wrong, in Warn: text only,
// as every warning in DESIGN.md.
// A `wider` one waits for 540 px: beside the warning's long label, actions
// and preview fit on the line only there (at 480 px they wrapped the bar).
// `tiny`: gives way only in the narrowest bar there is, the 320 px minimum
// at a 125% UI scale (about 13 rem beside the pin's gutter; 16.5 rem at
// 100%, which keeps it), where a Warn hint and one more hint wrapped the
// bar to two lines and took a row from the window
// `widest`: waits for 580 px, where a resting bar has room for a seventh
// hint (the clipboard panel's key; the six before it fill about 400 px of
// a 528 px line)
function Hint({ k, tiny, minor, mid, wide, wider, widest, warn, children }: { k: string; tiny?: boolean; minor?: boolean; mid?: boolean; wide?: boolean; wider?: boolean; widest?: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", tiny && "hidden @min-[16.25rem]:flex", minor && "hidden @min-[21.375rem]:flex", mid && "hidden @min-[22.5rem]:flex", wide && "hidden @min-[26.375rem]:flex", wider && "hidden @min-[30.125rem]:flex", widest && "hidden @min-[33rem]:flex")}>
      <Keys combo={k} />
      <span className={cn(warn && "text-(--warn)")}>{children}</span>
    </span>
  )
}

// The bar at the foot: what the keys do right now. One composition over the
// facts App hands it (which view is up, what the selected row would send,
// what the clipboard holds), so the rules for which hint shows, and at which
// width, live in one place.
export function HintBar({
  mode,
  actionCount,
  notice,
  formEmpty,
  formSends,
  formVerb,
  clipScrolls,
  clipEmpty,
  clipEnds,
  headSel,
  headFolded,
  empty,
  selHole,
  selSelfWrap,
  selSends,
  keyCard,
  previewScrolls,
  keepOpen,
}: {
  mode: PopupMode
  /** How many actions the panel lists, for its "1-N pick" hint */
  actionCount: number
  notice: Notice | null
  /** The form's fields still empty */
  formEmpty: number
  /** The form's Enter sends now: no empty field is left ahead of the caret */
  formSends: boolean
  /** What the form's Enter does: paste, paste and enter, or copy */
  formVerb: string
  /** The clipboard panel holds more than fits */
  clipScrolls: boolean
  clipEmpty: boolean
  /** A clipboard of two lines or more: its strip prints the panel's key itself */
  clipEnds: boolean
  /** A pack or group header is selected, and whether it is folded */
  headSel: boolean
  headFolded: boolean
  /** No rows */
  empty: boolean
  /** The selected row would paste a hole where the clipboard goes */
  selHole: boolean
  /** The selected row would wrap the prompt pasted last */
  selSelfWrap: boolean
  /** The selected row is set to Auto enter */
  selSends: boolean
  /** The preview card is open from the keyboard, and whether it holds more than fits */
  keyCard: boolean
  previewScrolls: boolean
  keepOpen: boolean
}) {
  const crowded = selSends || keepOpen
  return mode.kind === "panel" && mode.armed ? (
    // The question on screen, answered in the bar: what Enter does now
    <><Hint k="↵">delete</Hint><Hint k="Esc">cancel</Hint></>
  ) : mode.kind === "panel" ? (
    <><Hint k="↵">run</Hint><Hint k={`1-${actionCount}`}>pick</Hint><Hint k="Esc">back</Hint></>
  ) : mode.kind === "form" ? (
    // Enter in a field goes to the next empty one and sends only when none
    // is left ahead; the bar says which, since it is where the eye checks
    // what Enter does
    // Sending with fields empty is allowed and never silent: the button
    // counts them, and so does the bar, in Warn, in the button's words. The
    // longer label takes the room of copy and newline in a narrow window.
    <>
      {!formSends ? (
        <Hint k="↵">next field</Hint>
      ) : formEmpty ? (
        <Hint k="↵" warn>{`${formVerb} with ${C.plural(formEmpty, "field")} empty`}</Hint>
      ) : (
        <Hint k="↵">{formVerb}</Hint>
      )}
      {mode.form.paste && <Hint k="Ctrl ↵" minor={formSends && formEmpty > 0}>copy</Hint>}
      <Hint k="⇧ ↵" minor={!(formSends && formEmpty > 0)} wider={formSends && formEmpty > 0}>newline</Hint>
      <Hint k="Esc" tiny={formSends && formEmpty > 0}>back</Hint>
    </>
  ) : mode.kind === "create" ? (
    <><Hint k="↵">save</Hint><Hint k="Esc">back</Hint></>
  ) : mode.kind === "clipboard" ? (
    // The clipboard panel: scroll when there is more of it than fits, save
    // it as a prompt, or put it away (Enter too: the row it would paste is
    // under the panel). After a failed paste the recovery stays first: the
    // panel is where the user checks what is on the clipboard, which is
    // the prompt that did not land. The page keys only from 440 px. Beside
    // the recovery Ctrl N leaves the bar (its key cap is on the clipboard
    // line, above the panel), and below 400 px too, where it wrapped the
    // bar beside the pin's gutter; the page keys wait for 540 px and
    // scrolling gives way below 400, so the bar is one line at every
    // width.
    <>
      {notice?.recover && <Hint k="Ctrl V" tiny>in the target</Hint>}
      {clipScrolls && (
        <>
          <Hint k="↑ ↓" minor={!!notice?.recover}>scroll</Hint>
          <Hint k="PgUp PgDn" wide={!notice?.recover} wider={!!notice?.recover}>page</Hint>
        </>
      )}
      {!notice?.recover && <Hint k="Ctrl N" minor>new prompt</Hint>}
      <Hint k="Esc ↵">back</Hint>
    </>
  ) : notice?.recover ? (
    // The paste failed and the prompt is on the clipboard: the bar leads
    // with the recovery, and says Enter no longer pastes
    <><Hint k="Ctrl V" tiny>in the target</Hint><Hint k="↵ Esc">dismiss</Hint></>
  ) : headSel ? (
    // A header is selected: the keys that fold or open it, and leave it
    <>
      {headFolded ? <Hint k="→ ↵">unfold</Hint> : <Hint k="← ↵">fold</Hint>}
      <Hint k="↑ ↓" minor>move</Hint>
      <Hint k="Esc">{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : empty ? (
    // No rows: paste, copy, actions and preview have nothing to act on.
    // What can be done is save the clipboard as a prompt, or leave.
    <>
      {!clipEmpty && <Hint k="Ctrl N">new prompt</Hint>}
      <Hint k="Esc">{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : selHole ? (
    // Enter on this row pastes a hole where the clipboard should be, and the
    // bar is where the eye checks what Enter does. The longer label takes the
    // room of the hints it pushes out: copy goes below 360 px, actions and
    // preview below 500 px, so the bar stays one line at every width.
    <>
      <Hint k="↵" warn>{selSends ? "enter without clipboard" : "paste without clipboard"}</Hint>
      <Hint k="Ctrl ↵" minor>copy</Hint>
      <Hint k="Tab" wider>actions</Hint>
      <Hint k="→" wider>preview</Hint>
      <Hint k="Esc" tiny>{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : selSelfWrap ? (
    // The clipboard holds the prompt pasted last, and this row would paste
    // it again inside itself. Rarely meant; said, not blocked, like the
    // empty clipboard, and with the same room rules.
    <>
      <Hint k="↵" warn>{selSends ? "enter, wraps last prompt" : "paste, wraps last prompt"}</Hint>
      <Hint k="Ctrl ↵" minor>copy</Hint>
      <Hint k="Tab" wider>actions</Hint>
      <Hint k="→" wider>preview</Hint>
      <Hint k="Esc" tiny>{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : keyCard ? (
    // The card is open: what the keys do to it. The page keys only when
    // there is more of it than fits, and both of them: the card opens at
    // the clipboard, which is often its end. Copy is on the card's own
    // button, with its key.
    <>
      <Hint k="↵">paste</Hint>
      {previewScrolls && <Hint k="PgUp PgDn">scroll</Hint>}
      <Hint k="←">back</Hint>
      {/* Esc gives way below 400 px: at the 320 px minimum the four
          wrapped the bar beside the pin's gutter, and ← is the card's key */}
      <Hint k="Esc" minor={previewScrolls}>{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : (
    <>
      {/* "paste and enter" and "Ctrl K kept open" are the long labels: while
          either shows, the bar is crowded and the optional hints wait for
          more room (actions 540 px, preview 580, fold and clipboard leave
          it), and beside "paste and enter" copy goes below 400 (at the
          320 px minimum it wrapped the bar beside the pin's gutter), so
          it stays one line.
          At rest, four hints fill the default 400 px beside the pin's
          gutter (the five before it did without one, through 0.2.26), so
          preview waits for a window a touch wider (`mid`, 416 px) */}
      <Hint k="↵">{selSends ? "paste and enter" : "paste"}</Hint>
      <Hint k="Ctrl ↵" minor={selSends}>copy</Hint>
      <Hint k="Tab" minor={!crowded} wider={crowded}>actions</Hint>
      <Hint k="→" mid={!crowded} widest={crowded}>preview</Hint>
      {/* ← folds the row's pack or group (Ctrl+→ unfolds all); it was the
          one key with no mention on screen. Room for it only in a widened
          window; the pack and group headers name it in their tooltip */}
      {!crowded && <Hint k="←" wide>fold</Hint>}
      {/* The clipboard panel's key; the line's chevron says it opens, this
          says by which key, where there is room for a seventh hint */}
      {/* A clipboard of two lines or more prints the key on its own strip */}
      {!clipEmpty && !clipEnds && !crowded && <Hint k="Ctrl ↓" widest>clipboard</Hint>}
      {/* An error stays until Esc; the bar says so where the strip used to
          append it and get truncated (critique popup P1). Kept open, Esc
          closes and ends it, so the bar names the key that keeps it instead */}
      {keepOpen && notice?.kind !== "error" ? (
        <Hint k="Ctrl K">kept open</Hint>
      ) : (
        <Hint k="Esc">{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
      )}
    </>
  )
}
