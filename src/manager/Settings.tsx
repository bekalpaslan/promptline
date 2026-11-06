import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RiComputerLine, RiMoonClearLine, RiSunLine } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { SEGMENT_TRACK, Select, segmentClass } from "@/components/field"
import { Checkbox } from "@/components/ui/checkbox"
import { FONTS, PALETTES, fontStack } from "@/lib/prefs"
import { cn } from "@/lib/utils"
import { useManager } from "./state"
import { HotkeyRecorder } from "./HotkeyRecorder"
import { PacksCard } from "./PacksCard"
import { Card, Row } from "./settings-bits"
import { useLibraryMenus } from "./menus"
import { useCtxMenu } from "./ctx-menu"
import { say, sayErr } from "./status"
import { exportToClipboard, exportToFile, libraryJson, librarySummary } from "./export"
import { checkForUpdates } from "@/lib/update"

export function Settings() {
  const m = useManager()
  const [importRaw, setImportRaw] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // The one delete dialog (menus.tsx), and the two-item menus behind Export and Import
  const menus = useLibraryMenus({ surface: "settings" })
  const files = useCtxMenu()

  const { readAutostart } = m
  useEffect(() => {
    void readAutostart()
  }, [readAutostart])

  const toggleAutostart = async (enabled: boolean) => {
    try {
      await m.setAutostart(enabled)
      say(enabled ? "Autostart enabled" : "Autostart disabled")
    } catch (e) {
      sayErr(String(e))
    }
  }

  // Works with the automatic check off (D-04): a user who wants no
  // background network can still ask by hand
  const checkNow = async () => {
    setChecking(true)
    try {
      const found = await checkForUpdates()
      if (found) m.openUpdateOffer(found)
      else say("You're on the latest version")
    } catch (e) {
      sayErr(`Couldn't check for updates: ${String(e)}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* The pane replaces the editor; the gear above it, pressed, is the
          way out (and Escape). A × here was a second close beside it, and
          the pane's one heading is set at the heading size so the cards'
          titles read as a step below it rather than beside it. */}
      <h1 className="w-full max-w-160 self-center px-1 text-lg font-semibold">Settings</h1>
      <Card title="General">
        <Row label="Global hotkey" htmlFor="setting-hotkey">
          <HotkeyRecorder />
        </Row>
        <Row label="Startup">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={m.autostart === true} onCheckedChange={(v) => void toggleAutostart(v === true)} />
            Start with Windows
          </label>
        </Row>
        <p id="setting-hotkey-help" className="mt-3 text-ui leading-relaxed text-muted-foreground">
          Click Record, press a combination, then Apply (Esc cancels). The default is Ctrl+Alt+V. Promptline takes the
          combination from every other program while it runs: Ctrl+Alt+V is how Czech, Slovak, Hungarian, Croatian and
          Slovenian layouts type @ (AltGr+V) and Introduce Variable in JetBrains IDEs, and Ctrl+Shift+V is paste in
          Windows Terminal.
        </p>
      </Card>

      <Card title="Appearance">
        <Row label="Theme" htmlFor="setting-palette">
          {/* The palette; each has a light and a dark side, picked by Mode below */}
          <Select
            size="sm"
            id="setting-palette"
            value={m.prefs.palette}
            onChange={(e) => {
              void m.savePrefs({ palette: e.target.value }).then(() => say("Theme updated"))
            }}
          >
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Mode">
          {/* A setting, not a switch: chosen once, so it lives with the other
              appearance choices rather than in the sidebar. System follows Windows */}
          <div className={cn(SEGMENT_TRACK, "w-full max-w-xs")} role="radiogroup" aria-label="Mode">
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
          Theme, mode, font and scale apply everywhere immediately (popup on its next open); density applies to
          the popup the next time it opens. System follows the Windows light or dark mode as it changes.
        </p>
      </Card>

      <PacksCard importRaw={importRaw} setImportRaw={setImportRaw} askDeletePack={menus.askDeletePack} />

      <Card title="Backup and import">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="compact"
            variant="secondary"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const packs = libraryJson(m.snippets, m.packNames())
              files.open(r.left, r.bottom + 4, [
                { kind: "header", text: "Export the library" },
                { kind: "item", label: "To clipboard", run: () => void exportToClipboard(packs, librarySummary(packs)) },
                { kind: "item", label: "To file…", run: () => void exportToFile(packs, "Promptline library", librarySummary(packs)) },
              ])
            }}
          >
            Export…
          </Button>
          <Button
            size="compact"
            variant="secondary"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              files.open(r.left, r.bottom + 4, [
                { kind: "header", text: "Import a pack or a library" },
                {
                  kind: "item",
                  label: "From clipboard",
                  run: () =>
                    void invoke<string>("get_clipboard_text").then(setImportRaw, (e) => sayErr(`Couldn't read the clipboard: ${String(e)}`)),
                },
                {
                  kind: "item",
                  label: "From file…",
                  run: () =>
                    void invoke<string | null>("import_pack_file")
                      .then((raw) => {
                        if (raw !== null) setImportRaw(raw) // null = user cancelled the picker
                      })
                      .catch((e) => sayErr(`Couldn't read the file: ${String(e)}`)),
                },
              ])
            }}
          >
            Import…
          </Button>
          <Button
            size="compact"
            variant="secondary"
            title="The data folder in Explorer: library, packs and the log file"
            onClick={() => void invoke("open_data_dir").catch((e) => sayErr(`Couldn't open the folder: ${String(e)}`))}
          >
            Open folder
          </Button>
        </div>
        <p className="mt-3 text-ui leading-relaxed text-muted-foreground">
          Export writes every pack as the JSON Import reads, to the clipboard or a file. Open folder shows the
          data folder, with the library and the log file beside the packs.
        </p>
      </Card>

      <Card title="About">
        <Row label="Version">
          <span className="text-ui tabular-nums">{__APP_VERSION__}</span>
          {/* Nothing until get_update_state has answered: an old Rust that
              lacks the command leaves `update` null and these hidden */}
          {m.update && (
            <Button size="compact" variant="secondary" disabled={checking} onClick={() => void checkNow()}>
              {checking ? "Checking…" : "Check for updates"}
            </Button>
          )}
          {m.update?.available && (
            // D-07: Later silenced the toast, not the offer — the About card
            // keeps it on offer until it's installed
            <Button size="compact" variant="secondary" onClick={() => m.openUpdateOffer()}>
              Update to {m.update.available.version}
            </Button>
          )}
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
                sayErr(`Couldn't open the link: ${String(e)}`)
              )
            }}
          >
            <span aria-hidden>☕</span>
            Buy me a coffee
          </Button>
        </Row>
        {m.update && (
          <Row label="Updates">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={m.update.autoCheck}
                onCheckedChange={(v) => void m.setAutoUpdateCheck(v === true)}
              />
              Check for updates automatically
            </label>
          </Row>
        )}
        {m.update && (
          <p className="mt-3 text-ui leading-relaxed text-muted-foreground">
            At startup and once a day, Promptline fetches promptline.cc/latest.json to see whether there's a
            newer version. The request is the same for everyone and carries nothing about you. Turn it off
            here; Check for updates still works.
          </p>
        )}
      </Card>
      {menus.element}
      {files.element}
    </div>
  )
}
