import { toast } from "sonner"

// Status channel semantics from the legacy UI: successes fade quickly,
// errors stay long enough to be read, destructive actions offer Undo.
export const say = (msg: string) => toast.success(msg, { duration: 3500 })
export const sayErr = (msg: string) => toast.error(msg, { duration: 10000 })
export const sayUndo = (msg: string, onUndo: () => void) =>
  toast(msg, { duration: 8000, action: { label: "Undo", onClick: onUndo } })
