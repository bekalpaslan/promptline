import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RiArrowDownSLine, RiArrowRightSLine, RiLock2Fill } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { commitKey, fieldVariants } from "@/components/field"
import { C } from "@/lib/core"
import { Panel, PanelBody } from "@/components/panel"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, useManager } from "./state"
import { ImportCuration } from "./ImportCuration"
import { say, sayErr } from "./status"
import { exportToClipboard, packJson } from "./export"
import { Card } from "./settings-bits"

// Packs: what the library holds and where each one's file is; the
// actions that make a pack sit under the list. Backup and import
// are the library-wide jobs, in their own card, each behind one
// button with a two-item menu: seven buttons in two rows mixed the
// four jobs.
export function PacksCard({
  importRaw,
  setImportRaw,
  askDeletePack,
}: {
  /** The pack text under review, shared with the Backup and import card's Import menu, which sets it too */
  importRaw: string | null
  setImportRaw: (raw: string | null) => void
  /** The one delete dialog (menus.tsx), the Settings pane's instance */
  askDeletePack: (name: string, count: number) => void
}) {
  const m = useManager()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newPackMode, setNewPackMode] = useState(false)
  return (
    <Card title="Packs">
      <div className="flex flex-col gap-1.5">
        {m.packNames().length === 0 && (
          <p className="text-ui text-muted-foreground">No packs yet. New pack makes an empty one; Generate drafts one with an AI.</p>
        )}
        {m.packNames().map((name) => {
          const meta = m.packMeta.find((p) => p.name === name)
          const count = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name).length
          const isOpen = expanded.has(name)
          const Chev = isOpen ? RiArrowDownSLine : RiArrowRightSLine
          return (
            // The expandable panel (components/panel.tsx), as the trees'
            // pack frames and the editor's Prompt panel: the name on the
            // head, the file and its actions on the body
            <Panel key={name} className="overflow-hidden">
              {/* A real disclosure button: Enter/Space work, state is announced */}
              <button
                type="button"
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-ui text-foreground hover:bg-hover"
                onClick={() => {
                  const next = new Set(expanded)
                  if (next.has(name)) next.delete(name)
                  else next.add(name)
                  setExpanded(next)
                }}
              >
                <Chev className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={name}>
                  <bdi>{name}</bdi>
                </span>
                {m.isLocked(name) && <RiLock2Fill className="size-3 shrink-0 text-(--warn)" aria-label="locked" />}
                <span className="text-xs tabular-nums text-muted-foreground">{C.plural(count, "prompt")}</span>
              </button>
              {isOpen && (
                <PanelBody className="flex flex-col gap-2 px-2.5 py-2 text-ui text-muted-foreground">
                  <div className="break-all">{meta?.path || "This pack has no file yet"}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {meta?.path ? (
                      <>
                        <Button
                          size="compact"
                          variant="secondary"
                          onClick={() =>
                            void invoke("set_clipboard_text", { text: meta.path }).then(
                              () => say("Path copied"),
                              (e) => sayErr(`Couldn't copy the path: ${String(e)}`)
                            )
                          }
                        >
                          Copy path
                        </Button>
                        <Button
                          size="compact"
                          variant="secondary"
                          onClick={() =>
                            void invoke("show_in_folder", { path: meta.path }).catch((e) =>
                              sayErr(`Couldn't open the folder: ${String(e)}`)
                            )
                          }
                        >
                          Show in folder
                        </Button>
                        <Button
                          size="compact"
                          variant="secondary"
                          onClick={() =>
                            void invoke<string>("read_pack_file", { path: meta.path })
                              .then(setImportRaw)
                              .catch((e) => sayErr(`Couldn't read the pack file: ${String(e)}`))
                          }
                        >
                          Import from this file…
                        </Button>
                        <Button
                          size="compact"
                          variant="secondary"
                          onClick={() => void exportToClipboard(packJson(m.snippets, name), `Pack "${name}"`)}
                        >
                          Export to clipboard
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="compact"
                        variant="secondary"
                        title="For sharing, or for an agent to write into"
                        onClick={() =>
                          void m.addPackFile(name).then(
                            () => say(`"${name}" now has a file`),
                            (e) => sayErr(`Couldn't create a file for "${name}": ${String(e)}`)
                          )
                        }
                      >
                        Create pack file…
                      </Button>
                    )}
                    <Button
                      size="compact"
                      variant="destructive"
                      disabled={m.isLocked(name)}
                      title={m.isLocked(name) ? "Unlock the pack first (its menu in the sidebar)" : undefined}
                      onClick={() => askDeletePack(name, count)}
                    >
                      {m.isLocked(name) ? "Delete (locked)" : "Delete pack…"}
                    </Button>
                  </div>
                </PanelBody>
              )}
            </Panel>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button size="compact" onClick={() => m.openGenerate()}>
          Generate pack with AI…
        </Button>
        {newPackMode ? (
          <input
            autoFocus
            placeholder="Pack name — Enter to create"
            spellCheck={false}
            className={cn(fieldVariants({ size: "sm" }), "min-w-40 flex-1")}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNewPackMode(false)
              if (commitKey(e)) {
                const name = e.currentTarget.value.trim()
                setNewPackMode(false)
                if (name) void m.addPack(name)
              }
            }}
            onBlur={() => setNewPackMode(false)}
          />
        ) : (
          <Button size="compact" variant="secondary" onClick={() => setNewPackMode(true)}>
            New pack
          </Button>
        )}
      </div>
      {importRaw !== null && <ImportCuration raw={importRaw} onClose={() => setImportRaw(null)} />}
      <p className="mt-3 text-ui leading-relaxed text-muted-foreground">
        Click a pack to see its file. Pack files under %APPDATA%\io.github.bekalpaslan.promptline\packs\ are always
        current — copy one to share or back up, or point an agent at it. Imports are reviewed prompt-by-prompt
        before anything is added.
      </p>
    </Card>
  )
}
