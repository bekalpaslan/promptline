import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RiArrowDownSFill, RiArrowRightSFill, RiCloseLine, RiLock2Fill } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { C } from "@/lib/core"
import { FONTS, fontStack } from "@/lib/prefs"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, useManager } from "./state"
import { ImportCuration } from "./ImportCuration"
import { say, sayErr } from "./status"

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-160 self-center rounded-xl bg-card p-3 text-card-foreground">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  )
}

// `htmlFor` ties the caption to the row's control, so it is announced as its
// label; rows whose control brings its own <label> leave it out
function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  const Tag = htmlFor ? "label" : "span"
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-3 last:mb-0">
      <Tag htmlFor={htmlFor} className="min-w-28 text-xs text-muted-foreground">
        {label}
      </Tag>
      {children}
    </div>
  )
}

const selectCls =
  "cursor-pointer rounded-md bg-secondary px-2 py-1 text-xs text-foreground outline-none"

export function Settings() {
  const m = useManager()
  // Hotkey recorder: Record arms the field, a combination becomes `pending`,
  // and only Apply registers it — nothing happens on the first keystroke
  const [recording, setRecording] = useState(false)
  const [recordPreview, setRecordPreview] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const hotkeyRef = useRef<HTMLInputElement>(null)
  const [autostart, setAutostart] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newPackMode, setNewPackMode] = useState(false)
  const [importRaw, setImportRaw] = useState<string | null>(null)
  const [deleteArm, setDeleteArm] = useState<string | null>(null)

  useEffect(() => {
    void invoke<boolean>("get_autostart").then(setAutostart)
  }, [])

  // An armed "Really delete?" disarms on Escape or after 3 s, like the
  // editor's delete button (UM23)
  useEffect(() => {
    if (!deleteArm) return
    const t = setTimeout(() => setDeleteArm(null), 3000)
    // Capture phase, and preventDefault: an Escape that disarms must not
    // also close the Settings pane (App.tsx checks defaultPrevented)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setDeleteArm(null)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [deleteArm])

  const DEFAULT_HOTKEY = "ctrl+shift+v"

  const onHotkeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return
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
    const parts = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "super"].filter(
      (p): p is string => !!p
    )
    const key = e.key === " " ? "space" : e.key.toLowerCase()
    parts.push(key)
    const combo = parts.join("+")
    if (parts.length < 2) {
      setRecordPreview(C.fmtHotkey(combo))
      sayErr("Add a modifier (Ctrl/Alt/Shift) — bare keys would fire while typing")
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

  const toggleAutostart = async (enabled: boolean) => {
    setAutostart(enabled)
    try {
      await invoke("set_autostart", { enabled })
      say(enabled ? "Autostart enabled" : "Autostart disabled")
    } catch (e) {
      sayErr(String(e))
      setAutostart(!enabled)
    }
  }

  const packToJson = (name: string) =>
    C.packToJson(name, m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name))

  const deletePack = async (name: string) => {
    const ids = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name).map((s) => s.id)
    const pack = m.packMeta.find((p) => p.name === name) ?? { name, locked: false }
    // Prompts first, then metadata (see Sidebar.deletePack)
    await m.deleteWithUndo(ids, `Deleted pack "${name}" (${ids.length} prompt${ids.length === 1 ? "" : "s"})`, { pack })
    await m.persistPacks(m.packMeta.filter((p) => p.name !== name))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* The pane replaces the editor; say so, and give it a way out */}
      <div className="flex w-full max-w-160 items-center gap-2 self-center px-1">
        <h1 className="flex-1 text-base font-semibold">Settings</h1>
        <button
          type="button"
          aria-label="Close settings"
          title="Close settings (Esc)"
          className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={() => m.showSettings(false)}
        >
          <RiCloseLine className="size-4" />
        </button>
      </div>
      <Card title="General">
        <Row label="Global hotkey" htmlFor="setting-hotkey">
          <input
            id="setting-hotkey"
            ref={hotkeyRef}
            readOnly
            value={recording ? recordPreview : pending ? C.fmtHotkey(pending) : C.fmtHotkey(m.hotkey)}
            placeholder={recording ? "press a combination… (Esc cancels)" : ""}
            aria-describedby="setting-hotkey-help"
            spellCheck={false}
            className={cn(
              "w-50 rounded-md bg-secondary px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground",
              recording && "ring-2 ring-amber-500/60",
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
              <Button size="sm" className="h-auto px-2.5 py-1 text-xs" onClick={() => void applyHotkey()}>
                Apply {C.fmtHotkey(pending)}
              </Button>
              <Button size="sm" variant="secondary" className="h-auto px-2.5 py-1 text-xs" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="h-auto px-2.5 py-1 text-xs"
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
          {m.hotkey !== DEFAULT_HOTKEY && !pending && (
            <Button size="sm" variant="secondary" className="h-auto px-2.5 py-1 text-xs" onClick={() => setPending(DEFAULT_HOTKEY)}>
              Reset to {C.fmtHotkey(DEFAULT_HOTKEY)}
            </Button>
          )}
          <span role="status" className="sr-only">
            {recording ? "Recording a hotkey — press a combination, Escape cancels" : pending ? `Recorded ${C.fmtHotkey(pending)} — apply or cancel` : ""}
          </span>
        </Row>
        <Row label="Startup">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={autostart} onCheckedChange={(v) => void toggleAutostart(v === true)} />
            Start with Windows
          </label>
        </Row>
        <p id="setting-hotkey-help" className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Click Record, press a combination, then Apply (Esc cancels). The default Ctrl+Shift+V shadows "paste
          without formatting" in browsers — pick Ctrl+Alt+V if you use that.
        </p>
      </Card>

      <Card title="Appearance">
        <Row label="Popup density" htmlFor="setting-density">
          <select
            id="setting-density"
            value={m.prefs.density}
            onChange={(e) => {
              void m.savePrefs({ density: e.target.value }).then(() => say("Density updated — applies next popup"))
            }}
            className={selectCls}
          >
            <option value="comfortable">Comfortable — title + preview line</option>
            <option value="compact">Compact — titles only, twice the rows</option>
          </select>
        </Row>
        <Row label="Font" htmlFor="setting-font">
          <select
            id="setting-font"
            value={m.prefs.font}
            style={{ fontFamily: fontStack(m.prefs.font) }}
            onChange={(e) => {
              void m.savePrefs({ font: e.target.value }).then(() => say("Font updated"))
            }}
            className={selectCls}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="UI scale" htmlFor="setting-scale">
          <select
            id="setting-scale"
            value={m.prefs.scale}
            onChange={(e) => {
              void m.savePrefs({ scale: e.target.value }).then(() => say("UI scale updated"))
            }}
            className={selectCls}
          >
            <option value="90">90%</option>
            <option value="100">100%</option>
            <option value="110">110%</option>
            <option value="125">125%</option>
          </select>
        </Row>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Font and scale apply everywhere immediately (popup on its next open); density applies to the popup
          the next time it opens. Theme switches with the Light/Dark toggle at the bottom of the sidebar.
        </p>
      </Card>

      <Card title="Your library">
        <div className="flex flex-col gap-1.5">
          {m.packNames().map((name) => {
            const meta = m.packMeta.find((p) => p.name === name)
            const count = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name).length
            const isOpen = expanded.has(name)
            const Chev = isOpen ? RiArrowDownSFill : RiArrowRightSFill
            return (
              <div key={name} className="overflow-hidden rounded-md bg-secondary/60">
                {/* A real disclosure button: Enter/Space work, state is announced */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  className="flex w-full cursor-pointer select-none items-center gap-2 px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
                  onClick={() => {
                    const next = new Set(expanded)
                    if (next.has(name)) next.delete(name)
                    else next.add(name)
                    setExpanded(next)
                  }}
                >
                  <Chev className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="size-1.75 shrink-0 rounded-full" style={{ background: C.tagColor(name) }} />
                  <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                  {m.isLocked(name) && <RiLock2Fill className="size-2.5 shrink-0 text-amber-500" aria-label="locked" />}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {count} prompt{count === 1 ? "" : "s"}
                  </span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
                    <div className="break-all">{meta?.path || "This pack has no file yet"}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {meta?.path ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-auto px-2.5 py-1 text-xs"
                            onClick={() =>
                              void invoke("set_clipboard_text", { text: meta.path }).then(() => say("Path copied"))
                            }
                          >
                            Copy path
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-auto px-2.5 py-1 text-xs"
                            onClick={() => void invoke("show_in_folder", { path: meta.path })}
                          >
                            Show in folder
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-auto px-2.5 py-1 text-xs"
                            onClick={() =>
                              void invoke<string>("read_pack_file", { path: meta.path })
                                .then(setImportRaw)
                                .catch((e) => sayErr(`Couldn't read the pack file: ${e}`))
                            }
                          >
                            Import from this file…
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-auto px-2.5 py-1 text-xs"
                            onClick={() =>
                              void invoke("set_clipboard_text", {
                                text: JSON.stringify(packToJson(name), null, 2),
                              }).then(() => say(`Pack "${name}" copied to clipboard`))
                            }
                          >
                            Export to clipboard
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-auto px-2.5 py-1 text-xs"
                          onClick={() =>
                            void (async () => {
                              try {
                                const path = await invoke<string>("create_pack_file", { name })
                                const next = meta
                                  ? m.packMeta.map((p) => (p.name === name ? { ...p, path } : p))
                                  : [...m.packMeta, { name, locked: false, path }]
                                await m.persistPacks(next)
                                await m.persist([...m.snippets])
                                say(`"${name}" now has a file`)
                              } catch (e) {
                                sayErr(`Couldn't create a file for "${name}": ${e}`)
                              }
                            })()
                          }
                        >
                          Give this pack a file…
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={m.isLocked(name)}
                        className="h-auto px-2.5 py-1 text-xs text-destructive hover:bg-destructive/15"
                        onClick={() => {
                          if (deleteArm !== name) {
                            setDeleteArm(name)
                            return
                          }
                          setDeleteArm(null)
                          void deletePack(name)
                        }}
                      >
                        <span aria-live="assertive">
                          {m.isLocked(name)
                            ? "Delete (locked)"
                            : deleteArm === name
                              ? count
                                ? `Really delete ${count} prompt${count === 1 ? "" : "s"}?`
                                : "Really delete pack?"
                              : "Delete pack"}
                        </span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            className="h-auto bg-[#d97757] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#e2825f]"
            onClick={() => m.openGenerate()}
          >
            Generate pack with Claude…
          </Button>
          {newPackMode ? (
            <input
              autoFocus
              placeholder="Pack name — Enter to create"
              spellCheck={false}
              className="min-w-40 flex-1 rounded-md bg-secondary px-3 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Escape") setNewPackMode(false)
                if (e.key === "Enter") {
                  const name = e.currentTarget.value.trim()
                  setNewPackMode(false)
                  if (name) void m.addPack(name)
                }
              }}
              onBlur={() => setNewPackMode(false)}
            />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="h-auto px-2.5 py-1 text-xs"
              onClick={() => setNewPackMode(true)}
            >
              + New
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-auto px-2.5 py-1 text-xs"
            onClick={() => {
              const packs = m.packNames().map(packToJson).filter((p) => p.prompts.length)
              void invoke("set_clipboard_text", { text: JSON.stringify(packs, null, 2) }).then(() =>
                say(`Exported ${packs.length} packs (${m.snippets.length} prompts) to clipboard`)
              )
            }}
          >
            Export library
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-auto px-2.5 py-1 text-xs"
            onClick={() => void invoke<string>("get_clipboard_text").then(setImportRaw)}
          >
            Import from clipboard
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-auto px-2.5 py-1 text-xs"
            onClick={() =>
              void invoke<string | null>("import_pack_file")
                .then((raw) => {
                  if (raw !== null) setImportRaw(raw) // null = user cancelled the picker
                })
                .catch((e) => sayErr(`Couldn't read the file: ${e}`))
            }
          >
            Import from file…
          </Button>
        </div>
        {importRaw !== null && <ImportCuration raw={importRaw} onClose={() => setImportRaw(null)} />}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Click a pack to see its file. Pack files under %APPDATA%\com.promptline.app\packs\ are always current —
          copy one to share or back up. Imports are reviewed prompt-by-prompt before anything is added.
        </p>
      </Card>

      {/* Buy Me a Coffee, rendered locally rather than by their CDN script:
          a desktop webview holding the user's clipboard and prompt library has
          no business running remote JS, and this way it still works offline.
          Colours mirror the button's own config. */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-3 self-center">
        <span className="max-w-72 text-xs leading-relaxed text-muted-foreground">
          This app is open source. If you find it useful, I'd appreciate it if you'd consider:
        </span>
        <button
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-black px-4 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.03]"
          style={{ background: "#d97757" }}
          onClick={() => {
            void invoke("open_url", { url: "https://buymeacoffee.com/hurryupbob" }).catch((e) =>
              sayErr(`Couldn't open the link: ${e}`)
            )
          }}
        >
          <span style={{ color: "#FFDD00" }}>☕</span>
          Buy me a coffee
        </button>
      </div>
    </div>
  )
}
