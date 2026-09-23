import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RiArrowDownSLine, RiArrowRightSLine, RiCloseLine, RiComputerLine, RiLock2Fill, RiMoonClearLine, RiSunLine } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { SEGMENT_TRACK, Select, fieldVariants, segmentClass } from "@/components/field"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { C } from "@/lib/core"
import { FONTS, fontStack } from "@/lib/prefs"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, useManager } from "./state"
import { ImportCuration } from "./ImportCuration"
import { say, sayErr } from "./status"

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="module w-full max-w-160 self-center text-card-foreground">
      <h2 className="mb-2 section-title">{title}</h2>
      {children}
    </div>
  )
}

// `htmlFor` ties the caption to the row's control, so it is announced as its
// label; rows whose control brings its own <label> leave it out
function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-3 last:mb-0">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="min-w-28 font-normal text-muted-foreground">
          {label}
        </Label>
      ) : (
        <span className="min-w-28 text-xs text-muted-foreground">{label}</span>
      )}
      {children}
    </div>
  )
}

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

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* The pane replaces the editor; say so, and give it a way out */}
      <div className="flex w-full max-w-160 items-center gap-2 self-center px-1">
        <h1 className="flex-1 text-base font-semibold">Settings</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
          title="Close settings (Esc)"
          className="text-muted-foreground"
          onClick={() => m.showSettings(false)}
        >
          <RiCloseLine className="size-4" />
        </Button>
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
          {m.hotkey !== DEFAULT_HOTKEY && !pending && (
            <Button size="compact" variant="secondary" onClick={() => setPending(DEFAULT_HOTKEY)}>
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
        <p id="setting-hotkey-help" className="mt-3 text-ui leading-relaxed text-muted-foreground">
          Click Record, press a combination, then Apply (Esc cancels). The default Ctrl+Shift+V shadows "paste
          without formatting" in browsers — pick Ctrl+Alt+V if you use that.
        </p>
      </Card>

      <Card title="Appearance">
        <Row label="Theme">
          {/* A setting, not a switch: chosen once, so it lives with the other
              appearance choices rather than in the sidebar. System follows Windows */}
          <div className={cn(SEGMENT_TRACK, "w-full max-w-xs")} role="radiogroup" aria-label="Theme">
            {(
              [
                { id: "system", label: "System", Icon: RiComputerLine },
                { id: "light", label: "Light", Icon: RiSunLine },
                { id: "dark", label: "Dark", Icon: RiMoonClearLine },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = m.prefs.theme === id || (id === "dark" && !["system", "light", "dark"].includes(m.prefs.theme))
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn(segmentClass(active), "flex-1")}
                  onClick={() => void m.savePrefs({ theme: id })}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              )
            })}
          </div>
        </Row>
        <Row label="Popup density" htmlFor="setting-density">
          <Select
            size="sm"
            id="setting-density"
            value={m.prefs.density}
            onChange={(e) => {
              void m.savePrefs({ density: e.target.value }).then(() => say("Density updated — applies next popup"))
            }}
          >
            <option value="comfortable">Comfortable — title + preview line</option>
            <option value="compact">Compact — titles only, twice the rows</option>
          </Select>
        </Row>
        <Row label="Font" htmlFor="setting-font">
          <Select
            size="sm"
            id="setting-font"
            value={m.prefs.font}
            style={{ fontFamily: fontStack(m.prefs.font) }}
            onChange={(e) => {
              void m.savePrefs({ font: e.target.value }).then(() => say("Font updated"))
            }}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                {f.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="UI scale" htmlFor="setting-scale">
          <Select
            size="sm"
            id="setting-scale"
            value={m.prefs.scale}
            onChange={(e) => {
              void m.savePrefs({ scale: e.target.value }).then(() => say("UI scale updated"))
            }}
          >
            <option value="90">90%</option>
            <option value="100">100%</option>
            <option value="110">110%</option>
            <option value="125">125%</option>
          </Select>
        </Row>
        <p className="mt-3 text-ui leading-relaxed text-muted-foreground">
          Theme, font and scale apply everywhere immediately (popup on its next open); density applies to the
          popup the next time it opens. System follows the Windows light or dark mode as it changes.
        </p>
      </Card>

      <Card title="Your library">
        <div className="flex flex-col gap-1.5">
          {m.packNames().map((name) => {
            const meta = m.packMeta.find((p) => p.name === name)
            const count = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name).length
            const isOpen = expanded.has(name)
            const Chev = isOpen ? RiArrowDownSLine : RiArrowRightSLine
            return (
              <div key={name} className="overflow-hidden rounded-md bg-secondary/60">
                {/* A real disclosure button: Enter/Space work, state is announced */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  className="flex w-full cursor-pointer select-none items-center gap-2 px-2.5 py-1.5 text-left text-ui text-foreground hover:bg-secondary"
                  onClick={() => {
                    const next = new Set(expanded)
                    if (next.has(name)) next.delete(name)
                    else next.add(name)
                    setExpanded(next)
                  }}
                >
                  <Chev className="size-4 shrink-0 text-muted-foreground" />
                  <span className="size-2 shrink-0 rounded-full" style={{ background: C.tagColor(name) }} />
                  <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                  {m.isLocked(name) && <RiLock2Fill className="size-3 shrink-0 text-(--warn)" aria-label="locked" />}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {count} prompt{count === 1 ? "" : "s"}
                  </span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2 text-ui text-muted-foreground">
                    <div className="break-all">{meta?.path || "This pack has no file yet"}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {meta?.path ? (
                        <>
                          <Button
                            size="compact"
                            variant="secondary"
                            onClick={() =>
                              void invoke("set_clipboard_text", { text: meta.path }).then(() => say("Path copied"))
                            }
                          >
                            Copy path
                          </Button>
                          <Button
                            size="compact"
                            variant="secondary"
                            onClick={() => void invoke("show_in_folder", { path: meta.path })}
                          >
                            Show in folder
                          </Button>
                          <Button
                            size="compact"
                            variant="secondary"
                            onClick={() =>
                              void invoke<string>("read_pack_file", { path: meta.path })
                                .then(setImportRaw)
                                .catch((e) => sayErr(`Couldn't read the pack file: ${e}`))
                            }
                          >
                            Import from this file…
                          </Button>
                          <Button
                            size="compact"
                            variant="secondary"
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
                          size="compact"
                          variant="secondary"
                          title="For sharing, or for an agent to write into"
                          onClick={() =>
                            void m.addPackFile(name).then(
                              () => say(`"${name}" now has a file`),
                              (e) => sayErr(`Couldn't create a file for "${name}": ${e}`)
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
                        onClick={() => {
                          if (deleteArm !== name) {
                            setDeleteArm(name)
                            return
                          }
                          setDeleteArm(null)
                          void m.deletePack(name)
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
            size="compact"
            // Claude's brand orange, as on claude.ai; white on it is 3.4:1 at
            // this size and weight, the same as the vendor's own button
            className="bg-[#d97757] font-semibold text-white hover:bg-[#e2825f]"
            onClick={() => m.openGenerate()}
          >
            Generate pack with Claude…
          </Button>
          {newPackMode ? (
            <input
              autoFocus
              placeholder="Pack name — Enter to create"
              spellCheck={false}
              className={cn(fieldVariants({ size: "sm" }), "min-w-40 flex-1")}
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
              size="compact"
              variant="secondary"
              onClick={() => setNewPackMode(true)}
            >
              New pack
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="compact"
            variant="secondary"
            onClick={() => {
              const packs = m.packNames().map(packToJson).filter((p) => p.prompts.length)
              void invoke("set_clipboard_text", { text: JSON.stringify(packs, null, 2) }).then(() =>
                say(`Exported ${C.plural(packs.length, "pack")} (${C.plural(m.snippets.length, "prompt")}) to clipboard`)
              )
            }}
          >
            Export library
          </Button>
          <Button
            size="compact"
            variant="secondary"
            onClick={() => void invoke<string>("get_clipboard_text").then(setImportRaw)}
          >
            Import from clipboard
          </Button>
          <Button
            size="compact"
            variant="secondary"
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
          <Button
            size="compact"
            variant="secondary"
            title="The data folder in Explorer: library, packs and the log file"
            onClick={() => void invoke("open_data_dir").catch((e) => sayErr(`Couldn't open the folder: ${e}`))}
          >
            Open folder
          </Button>
        </div>
        {importRaw !== null && <ImportCuration raw={importRaw} onClose={() => setImportRaw(null)} />}
        <p className="mt-3 text-ui leading-relaxed text-muted-foreground">
          Click a pack to see its file. Pack files under %APPDATA%\io.github.bekalpaslan.promptline\packs\ are always current —
          copy one to share or back up; Open folder shows that folder, with the library and the log file beside it.
          Imports are reviewed prompt-by-prompt before anything is added.
        </p>
      </Card>

      <Card title="About">
        <Row label="Version">
          <span className="text-ui tabular-nums">{__APP_VERSION__}</span>
          {/* Buy Me a Coffee, rendered locally rather than by their CDN script:
              a desktop webview holding the user's clipboard and prompt library
              has no business running remote JS, and this way it still works
              offline. A secondary button: the pane's one primary is Generate,
              and a donation link in the same orange read as a second call to
              action. */}
          <Button
            size="compact"
            variant="secondary"
            className="ml-auto"
            onClick={() => {
              void invoke("open_url", { url: "https://buymeacoffee.com/hurryupbob" }).catch((e) =>
                sayErr(`Couldn't open the link: ${e}`)
              )
            }}
          >
            <span aria-hidden>☕</span>
            Buy me a coffee
          </Button>
        </Row>
      </Card>
    </div>
  )
}
