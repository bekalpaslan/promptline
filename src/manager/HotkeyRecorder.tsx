import { useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { fieldVariants } from "@/components/field"
import { C } from "@/lib/core"
import { cn } from "@/lib/utils"
import { useManager } from "./state"
import { say, sayErr } from "./status"

// The Global hotkey row's controls: the field that records, Apply, Cancel
// and Reset, and the status a screen reader hears
export function HotkeyRecorder() {
  const m = useManager()
  // Hotkey recorder: Record arms the field, a combination becomes `pending`,
  // and only Apply registers it — nothing happens on the first keystroke
  const [recording, setRecording] = useState(false)
  const [recordPreview, setRecordPreview] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const hotkeyRef = useRef<HTMLInputElement>(null)

  const DEFAULT_HOTKEY = "ctrl+alt+v"

  const onHotkeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // A keydown with no key (autofill) or one during IME composition is no hotkey
    if (!recording || !e.key || e.nativeEvent.isComposing) return
    // Tab must keep moving focus: swallowing it registered Shift+Tab as the
    // hotkey and trapped keyboard users in the field
    if (e.key === "Tab") return
    e.preventDefault()
    if (e.key === "Escape") {
      setRecording(false)
      setRecordPreview("")
      e.currentTarget.blur()
      return
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      const held = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"]
        .filter(Boolean)
        .join("+")
      setRecordPreview(held ? held + "+…" : "")
      return
    }
    // The combination in the form Rust registers (C.hotkeyFromEvent); null
    // is a bare key, or a key the parser has no name for (Shift+1 arrives
    // as "!"), which is refused here rather than at Apply
    const combo = C.hotkeyFromEvent(e)
    if (!combo) {
      const key = C.hotkeyKeyName(e.key)
      if (!key) {
        setRecordPreview("")
        sayErr(`"${e.key}" can't be part of a hotkey — use a letter, digit, F-key, arrow or punctuation key`)
      } else {
        setRecordPreview(C.fmtHotkey(key))
        sayErr("Add a modifier (Ctrl/Alt/Shift) — bare keys would fire while typing")
      }
      return
    }
    // Recorded, not applied: Apply registers it, Cancel drops it
    setPending(combo)
    setRecording(false)
    setRecordPreview("")
    e.currentTarget.blur()
  }

  const applyHotkey = async () => {
    if (!pending) return
    try {
      await invoke("set_hotkey", { hotkey: pending })
      m.setHotkey(pending)
      say(`Hotkey set to ${C.fmtHotkey(pending)}`)
      setPending(null)
    } catch {
      // The old hotkey is still registered (H4); keep the pending one for another try
      sayErr(`Couldn't register ${C.fmtHotkey(pending)} — another program may own it; try a different combination`)
    }
  }

  return (
    <>
      <input
        id="setting-hotkey"
        ref={hotkeyRef}
        readOnly
        value={recording ? recordPreview : pending ? C.fmtHotkey(pending) : m.hotkey ? C.fmtHotkey(m.hotkey) : ""}
        placeholder={recording ? "press a combination… (Esc cancels)" : ""}
        aria-describedby="setting-hotkey-help"
        spellCheck={false}
        className={cn(
          fieldVariants(),
          "w-50",
          recording && "ring-2 ring-(--warn)/60",
          pending && !recording && "ring-2 ring-primary/50"
        )}
        onBlur={() => {
          setRecording(false)
          setRecordPreview("")
        }}
        onKeyDown={onHotkeyKeyDown}
      />
      {pending ? (
        <>
          <Button size="compact" onClick={() => void applyHotkey()}>
            Apply {C.fmtHotkey(pending)}
          </Button>
          <Button size="compact" variant="secondary" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          size="compact"
          variant="secondary"
          aria-pressed={recording}
          onClick={() => {
            setRecording(true)
            setRecordPreview("")
            hotkeyRef.current?.focus()
          }}
        >
          {recording ? "Recording…" : "Record"}
        </Button>
      )}
      {m.hotkey !== null && m.hotkey !== DEFAULT_HOTKEY && !pending && (
        <Button size="compact" variant="secondary" onClick={() => setPending(DEFAULT_HOTKEY)}>
          Reset to {C.fmtHotkey(DEFAULT_HOTKEY)}
        </Button>
      )}
      <span role="status" className="sr-only">
        {recording ? "Recording a hotkey — press a combination, Escape cancels" : pending ? `Recorded ${C.fmtHotkey(pending)} — apply or cancel` : ""}
      </span>
    </>
  )
}
