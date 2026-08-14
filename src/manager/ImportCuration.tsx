import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { C, type Snippet } from "@/lib/core"
import { useManager } from "./state"
import { say, sayErr } from "./status"

interface Row {
  packName: string
  title: string
  text: string
  tags: string[]
  dupe: boolean
  include: boolean
}

// Import preview as a curation list: every prompt is reviewed (and can be
// excluded) before anything lands in the library. Shared by Settings → library
// imports and the Generate-with-Claude dialog.
export function ImportCuration({
  raw,
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
  const diag = useMemo(() => C.diagnosePack(raw), [raw])
  const singlePack = diag.ok && diag.packs!.length === 1
  const [packName, setPackName] = useState(() => {
    if (!diag.ok || !singlePack) return ""
    const name = diag.packs![0].name
    return name === "Imported" && defaultName ? defaultName : name
  })
  const [rows, setRows] = useState<Row[]>(() => {
    if (!diag.ok) return []
    const isDupe = (p: { title: string; text: string }) =>
      m.snippets.some((s) => s.title === p.title && s.text === p.text)
    const out: Row[] = []
    for (const pk of diag.packs!)
      for (const p of pk.prompts) {
        const dupe = isDupe(p)
        out.push({ packName: pk.name, ...p, dupe, include: !dupe })
      }
    return out
  })

  // Invalid pack JSON: report and dismiss — but never setState during render
  useEffect(() => {
    if (!diag.ok) {
      sayErr(`Can't import: ${diag.message}`)
      onClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diag])
  if (!diag.ok) return null

  const included = rows.filter((r) => r.include).length
  const dupes = rows.filter((r) => r.dupe).length

  const confirm = async () => {
    const target = (name: string) => (singlePack ? packName.trim() || name : name)
    if (singlePack && m.isLocked(packName.trim())) {
      sayErr(`Pack "${packName.trim()}" is locked — pick another name`)
      return
    }
    let added = 0
    let skippedLocked = 0
    const next: Snippet[] = [...m.snippets]
    for (const r of rows) {
      if (!r.include) continue
      const pack = target(r.packName)
      if (m.isLocked(pack)) {
        skippedLocked++
        continue
      }
      next.push({
        id: crypto.randomUUID(),
        title: r.title,
        text: r.text,
        tags: r.tags,
        pack,
        uses: 0,
        pinned: false,
        fieldValues: {},
        configValues: {},
      })
      added++
    }
    await m.persist(next)
    onClose()
    onImported?.()
    say(
      skippedLocked
        ? `Imported ${added} prompts (${skippedLocked} skipped — locked pack)`
        : `Imported ${added} prompts`
    )
  }

  return (
    <div className="mt-3 flex max-h-75 flex-col rounded-md bg-secondary/60 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span>
          {rows.length} prompts
          {dupes ? ` (${dupes} already in library)` : ""}
        </span>
        {singlePack && (
          <>
            <span>as pack:</span>
            <input
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
              spellCheck={false}
              className="w-42 rounded-sm bg-secondary px-2 py-1 text-xs text-foreground outline-none"
            />
          </>
        )}
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
              <Checkbox checked={r.include} className="pointer-events-none" tabIndex={-1} />
              <span className="whitespace-nowrap font-semibold text-foreground">{r.title}</span>
              <span className="min-w-0 flex-1 truncate">{r.text.replace(/\s+/g, " ").slice(0, 80)}</span>
              {r.dupe && (
                <span className="shrink-0 rounded-full bg-secondary px-1.5 text-xs">dupe</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button size="sm" disabled={included === 0} onClick={() => void confirm()}>
          Add {included} prompt{included === 1 ? "" : "s"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
