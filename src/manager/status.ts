import { toast } from "sonner"

// Status channel semantics from the legacy UI: successes fade quickly,
// errors stay long enough to be read, destructive actions offer Undo.
export const say = (msg: string) => toast.success(msg, { duration: 3500 })
export const sayErr = (msg: string) => toast.error(msg, { duration: 10000, closeButton: true })
// For things that must not be missed (a quarantined data file, a dead hotkey):
// stays until dismissed
export const sayPersistent = (msg: string) => toast.error(msg, { duration: Infinity, closeButton: true })

// The most recent Undo on offer, so Ctrl+Z can take it without aiming at the
// toast; cleared when it is used or its toast has gone
let lastUndo: { id: string | number; run: () => void } | null = null
const UNDO_MS = 12000
export const sayUndo = (msg: string, onUndo: () => void) => {
  const run = () => {
    if (lastUndo?.run === run) lastUndo = null
    onUndo()
  }
  const id = toast(msg, { duration: UNDO_MS, closeButton: true, action: { label: "Undo", onClick: run } })
  lastUndo = { id, run }
  setTimeout(() => {
    if (lastUndo?.id === id) lastUndo = null
  }, UNDO_MS)
  return id
}
/** Take the Undo currently on offer, if any; true when something was undone */
export const undoLast = (): boolean => {
  if (!lastUndo) return false
  const { id, run } = lastUndo
  toast.dismiss(id)
  run()
  return true
}
