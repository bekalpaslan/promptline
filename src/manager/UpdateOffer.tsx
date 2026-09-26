import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { C } from "@/lib/core"
import { dismissUpdate, installUpdate, type UpdateInfo } from "@/lib/update"
import { sayErr } from "./status"

// The notes are the release's own text, rendered as plain blocks
// (`C.releaseNotesBlocks`), never as HTML: nothing from the feed reaches
// `innerHTML`, so a malformed or hostile release note can't run script or
// carry a live link. Install flushes the editor's pending autosave first —
// the updater plugin ends the process once the install starts, so anything
// still only debounced in the editor would otherwise be lost.
export function UpdateOffer({
  open,
  info,
  onClose,
  flush,
}: {
  open: boolean
  info: UpdateInfo | null
  onClose: () => void
  flush: () => Promise<void>
}) {
  const [installing, setInstalling] = useState(false)

  if (!info) return null

  const later = () => {
    void dismissUpdate(info.version).catch(() => {})
    onClose()
  }

  const install = async () => {
    setInstalling(true)
    try {
      await flush()
      await installUpdate()
    } catch (e) {
      sayErr(`Couldn't install the update: ${e}`)
      setInstalling(false)
    }
  }

  const blocks = C.releaseNotesBlocks(info.notes)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && later()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promptline {info.version} is available</DialogTitle>
          <DialogDescription>
            You have {__APP_VERSION__}. Installing shows a small progress window, then Promptline restarts.
          </DialogDescription>
        </DialogHeader>
        {blocks.length > 0 && (
          <div role="region" aria-label="Release notes" className="max-h-[50vh] overflow-y-auto text-ui">
            {(() => {
              const rendered: React.ReactNode[] = []
              let pendingItems: string[] = []
              const flushItems = (key: string) => {
                if (pendingItems.length) {
                  rendered.push(
                    <ul key={key} className="list-disc pl-5">
                      {pendingItems.map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                  )
                  pendingItems = []
                }
              }
              blocks.forEach((b, i) => {
                if (b.kind === "item") {
                  pendingItems.push(b.text)
                  return
                }
                flushItems(`ul-${i}`)
                if (b.kind === "heading") {
                  rendered.push(
                    <h3 key={i} className="text-ui font-semibold">
                      {b.text}
                    </h3>
                  )
                } else {
                  rendered.push(<p key={i}>{b.text}</p>)
                }
              })
              flushItems("ul-end")
              return rendered
            })()}
          </div>
        )}
        <DialogFooter>
          <Button size="sm" variant="secondary" disabled={installing} onClick={later}>
            Later
          </Button>
          <Button size="sm" disabled={installing} onClick={() => void install()}>
            {installing ? "Installing…" : "Install and restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
