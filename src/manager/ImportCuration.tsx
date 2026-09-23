import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { C, type ImportRow as Row, type Snippet } from "@/lib/core"
import { Chip } from "@/components/prompt-bits"
import { fieldVariants } from "@/components/field"
import { cn } from "@/lib/utils"
import { useManager } from "./state"
import { say, sayErr } from "./status"

// Import preview as a curation list: every prompt is reviewed (and can be
// excluded) before anything lands in the library. Shared by Settings → library
// imports and the Generate-with-AI dialog.
export function ImportCuration({
  raw: initialRaw,
  defaultName,
  onClose,
  onImported,
}: {
  raw: string
  defaultName?: string
  onClose: () => void
  /** Called after a successful import, in addition to onClose. */
  onImported?: () => void
}) {
  const m = useManager()
  // Bad JSON is shown inline with the text kept editable, not toasted away:
  // the user pasted it, and the fix is often one stray character
  const [draft, setDraft] = useState(initialRaw)
  const [raw, setRaw] = useState(initialRaw)
  const diag = useMemo(() => C.diagnosePack(raw), [raw])
  const singlePack = diag.ok && diag.packs.length === 1
  const multiPack = diag.ok && diag.packs.length > 1
  const [busy, setBusy] = useState(false)
  const [packName, setPackName] = useState(() => {
    if (!diag.ok || !singlePack) return ""
    const name = diag.packs[0].name
    return name === "Imported" && defaultName ? defaultName : name
  })
  // One row per prompt; a dupe (same title and text in the library) starts unticked
  const rowsFor = (d: typeof diag): Row[] => (d.ok ? C.importRows(d.packs, m.snippets) : [])
  const [rows, setRows] = useState<Row[]>(() => rowsFor(diag))

  if (!diag.ok) {
    return (
      <div className="mt-3 flex flex-col gap-2 rounded-md bg-secondary/60 p-3 text-ui text-muted-foreground">
        <div role="alert" className="text-destructive">Can't import: {diag.message}</div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Pack JSON"
          spellCheck={false}
          rows={6}
          className={cn(fieldVariants(), "w-full resize-y p-2 font-mono")}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              setRaw(draft)
              setRows(rowsFor(C.diagnosePack(draft)))
            }}
          >
            Retry
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  const included = rows.filter((r) => r.include).length
  const dupes = rows.filter((r) => r.dupe).length
  const setAll = (pred: (r: Row) => boolean) => setRows((rs) => rs.map((r) => ({ ...r, include: pred(r) })))

  const confirm = async () => {
    if (busy) return
    if (singlePack && m.isLocked(packName.trim())) {
      sayErr(`Pack "${packName.trim()}" is locked — pick another name`)
      return
    }
    setBusy(true)
    // A single-pack import lands in the name typed above; a prompt bound
    // for a locked pack is skipped and counted (C.curateImport)
    const { prompts, skippedLocked } = C.curateImport(rows, m.isLocked, singlePack ? packName : undefined)
    const added = prompts.length
    const fresh: Snippet[] = prompts.map((p) => ({
      id: crypto.randomUUID(),
      ...p,
      uses: 0,
      pinned: false,
      pinnedAt: 0,
      configValues: {},
    }))
    try {
      // Appended to the current library, not this render's copy
      await m.persist((cur) => [...cur, ...fresh])
    } catch {
      setBusy(false) // persist already toasted; the list stays for a retry
      return
    }
    onClose()
    onImported?.()
    say(
      skippedLocked
        ? `Imported ${added} prompt${added === 1 ? "" : "s"} (${skippedLocked} skipped — locked pack)`
        : `Imported ${added} prompt${added === 1 ? "" : "s"}`
    )
  }

  return (
    <div className="mt-3 flex max-h-75 flex-col rounded-md bg-secondary/60 text-ui text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span>
          {C.plural(rows.length, "prompt")}
          {dupes ? ` (${dupes} already in library)` : ""}
        </span>
        {singlePack && (
          <>
            <label htmlFor="import-pack-name">as pack:</label>
            <input
              id="import-pack-name"
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
              spellCheck={false}
              className={cn(fieldVariants({ size: "sm" }), "w-42")}
            />
          </>
        )}
        {/* Bulk selection: `dupes` was computed but never offered */}
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setAll(() => true)}>
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(() => false)}>
            None
          </Button>
          {dupes > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setAll((r) => !r.dupe)}>
              Only new
            </Button>
          )}
        </span>
      </div>
      <div className="overflow-y-auto p-1 px-2">
        {rows.length === 0 && <div className="px-2 py-2">No usable prompts found in the pack.</div>}
        {rows.map((r, i) => {
          // Not a <label>: label activation forwards to the checkbox's hidden
          // form input, and WebView2 scrolls that input into view — jumping the
          // dialog to the top. Toggle in React; the checkbox is purely visual.
          const toggle = () =>
            setRows((rs) => rs.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))
          return (
            <div
              key={i}
              role="checkbox"
              aria-checked={r.include}
              tabIndex={0}
              className="flex cursor-pointer select-none items-center gap-2 rounded-sm p-1 hover:bg-secondary"
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault()
                  toggle()
                }
              }}
            >
              <Checkbox checked={r.include} className="pointer-events-none" tabIndex={-1} aria-hidden />
              <span className="min-w-0 max-w-[50%] truncate font-semibold text-foreground" title={r.title}>{r.title}</span>
              {multiPack && (
                <Chip tone="primary" title="Pack">
                  {r.packName}
                </Chip>
              )}
              {r.group && (
                <Chip>{r.group}</Chip>
              )}
              <span className="min-w-0 flex-1 truncate">{r.text.replace(/\s+/g, " ").slice(0, 80)}</span>
              {r.dupe && (
                <Chip>dupe</Chip>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button size="sm" disabled={included === 0 || busy} onClick={() => void confirm()}>
          {busy ? "Adding…" : `Add ${included} prompt${included === 1 ? "" : "s"}`}
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
