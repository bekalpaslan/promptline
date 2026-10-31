import { useCallback, useEffect, useRef, useState } from "react"
import { RiArrowDownSLine, RiCheckLine, RiErrorWarningLine, RiFileCopyLine, RiFileTextLine, RiMoreLine, RiPushpin2Fill, RiPushpin2Line } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "./EmptyState"
import { Textarea } from "@/components/ui/textarea"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, useManager } from "./state"
import { Switch } from "@/components/ui/switch"
import { useLibraryMenus } from "./menus"
import { atButton } from "./ctx-menu"
import { copyPrompt } from "./copy"
import { TagStrip, storedTags } from "./TagStrip"
import { ParamsPanel } from "./ParamsPanel"

export function Editor() {
  const m = useManager()
  const snippet = m.snippets.find((s) => s.id === m.activeId)
  // The empty library's one way in is the same New menu as the sidebar's
  // button: it asks what and where, so nothing lands in a pack nobody chose
  const menus = useLibraryMenus({ surface: "editor" })

  if (!snippet) {
    if (m.selection.size > 1) {
      return (
        <EmptyState
          title={`${m.selection.size} prompts selected`}
          hint="Right-click (or press the Menu key) for actions on all of them · click a row to edit one"
        />
      )
    }
    // Nothing until the library has answered: the first paint is a few
    // milliseconds after it, and "No prompts yet" in that gap would be a lie
    // that a slow disk makes readable
    if (m.libraryState === "loading") return null
    if (m.libraryState === "failed") {
      return (
        <EmptyState
          icon={RiErrorWarningLine}
          title="The library didn't load"
          hint="Your prompts are still in their file; nothing on disk was changed. The message at the bottom right says what went wrong, and Settings → Backup and import → Open folder shows the files."
          actions={[{ label: "Open settings", onClick: () => m.showSettings(true), primary: true }]}
        />
      )
    }
    if (!m.snippets.length) {
      return (
        <>
          <EmptyState
            icon={RiFileTextLine}
            title="No prompts yet"
            hint="A pack holds your prompts: make one and write prompts in it, or let an AI draft a pack for a topic — every prompt is reviewed before it is added"
            actions={[
              {
                label: "New",
                primary: true,
                menu: true,
                onClick: (e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  menus.openNewMenu(r.left, r.bottom + 4)
                },
              },
              { label: "Generate pack with AI…", onClick: () => m.openGenerate() },
            ]}
          />
          {menus.element}
        </>
      )
    }
    return (
      <EmptyState
        icon={RiFileTextLine}
        title="Select a prompt to edit it"
        hint={m.hotkey ? `Or press ${C.fmtHotkey(m.hotkey)} in any app to paste one` : "Or use the popup hotkey in any app to paste one"}
        actions={[
          { label: "New prompt", onClick: () => void m.newPrompt(), primary: true },
          { label: "Generate pack with AI…", onClick: () => m.openGenerate() },
        ]}
      />
    )
  }
  return <EditorInner snippet={snippet} />
}

// The crumb line, in the bar above the pane (App.tsx): where the prompt
// sits at the left (pack › group, each crumb opening that overview, the
// chevron the Move-to menu), and at the right its use count, the Pin
// toggle and the ⋯ menu. It was the editor's first line; the bar above
// the pane held the Settings gear alone, and the crumbs are what the bar
// is for (2026-10-10). Nothing while the pane shows something else.
export function EditorCrumbs() {
  const m = useManager()
  const menus = useLibraryMenus({ surface: "editor" })
  const snippet = m.snippets.find((s) => s.id === m.activeId)
  if (!snippet || m.settingsOpen || m.selection.size > 1 || m.view.kind === "overview" || m.view.kind === "all") return null
  const pack = snippet.pack || DEFAULT_PACK
  const group = snippet.group || ""
  return (
    <>
    {/* Where this prompt sits, at the left: each crumb shows that pack's
        or group's prompts beside the sidebar (Escape goes to the nearest
        one), and the chevron moves it. At the right, in one group: the use
        count, the Pin toggle (pressed while pinned, in the pin's Warn) and
        the ⋯ menu, 24 px tall each and 8 px apart. The line is the UI
        size: at 12 px it read as a caption, and "pinned" as a word in the
        line said a state without offering the switch (2026-10-10). The
        bar's side padding is the pane's 12 px plus the 13 px a card's
        border and padding take, so the crumbs, the title and a card's
        header text start on one line, and the right group ends where a
        card's own controls end. */}
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-[25px] text-ui text-muted-foreground">
      <button
        type="button"
        className="min-w-0 cursor-pointer truncate rounded-sm font-medium hover:text-foreground focus-ring"
        title={`Show the prompts in ${pack}${group ? "" : " (Esc)"}`}
        onClick={() => m.openOverview({ pack })}
      >
        <bdi>{pack}</bdi>
      </button>
      {group && (
        <>
          <span aria-hidden>›</span>
          <button
            type="button"
            className="min-w-0 cursor-pointer truncate rounded-sm font-medium hover:text-foreground focus-ring"
            title={`Show the prompts in ${group} (Esc)`}
            onClick={() => m.openOverview({ pack, group })}
          >
            <bdi>{group}</bdi>
          </button>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Move to another pack or group"
        aria-haspopup="menu"
        title="Move to…"
        className="text-muted-foreground"
        onClick={(e) => menus.openMoveTo(...atButton(e), snippet.id)}
      >
        <RiArrowDownSLine className="size-4" />
      </Button>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {/* "Used 7×", a phrase, not the cards' bare "7×": alone at the
            bar's right the number said nothing (the user, 2026-10-16) */}
        {snippet.uses > 0 && (
          <span className="tabular-nums" title={`Pasted ${C.plural(snippet.uses, "time")}`}>
            Used {snippet.uses}×
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={!!snippet.pinned}
          title={snippet.pinned ? "Unpin: leaves the popup's top slots" : "Pin: always in the popup's top slots"}
          className={snippet.pinned ? "text-(--warn) hover:text-(--warn)" : "text-muted-foreground"}
          onClick={() => menus.togglePin([snippet.id])}
        >
          {snippet.pinned ? <RiPushpin2Fill aria-hidden /> : <RiPushpin2Line aria-hidden />}
          {snippet.pinned ? "Pinned" : "Pin"}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Prompt actions"
          aria-haspopup="menu"
          title="Pin, move, tag, export, delete"
          className="text-muted-foreground"
          onClick={(e) => menus.openRowCtx(...atButton(e), new Set([snippet.id]))}
        >
          <RiMoreLine className="size-4" />
        </Button>
      </span>
    </div>
      {menus.element}
    </>
  )
}

// The editor is the prompt and little else: a crumb line that says where
// it sits (and moves it), the title, the text, its tags, and the
// placeholders the text holds. Placement is the store's, not a field: the
// crumb's chevron opens the same Move-to menu the row's right-click does,
// so a move never passes through the autosave and the two can't disagree.
// Pin and Delete sit in one overflow menu, as the row's do; the pin shows
// as the warn-coloured pin the cards draw (the sidebar's row and the
// overview's card carry a quiet pin at the right, PinMark; the popup's
// rows none, its Pinned section says it).
function EditorInner({ snippet }: { snippet: Snippet }) {
  const m = useManager()
  const menus = useLibraryMenus({ surface: "editor" })
  const [title, setTitle] = useState(snippet.title)
  const [tags, setTags] = useState((snippet.tags || []).join(", "))
  const [text, setText] = useState(snippet.text)
  const [configValues, setConfigValues] = useState<Record<string, string>>({ ...(snippet.configValues || {}) })
  const textRef = useRef<HTMLTextAreaElement>(null)
  const isDraft = C.isEmptyDraft(snippet)

  // Autosave: edits persist on a short debounce — no Save button, no lost drafts
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ title, tags, text, configValues })
  latest.current = { title, tags, text, configValues }
  // Fields the user has edited since the last save. The menus can change
  // tags underneath the editor (add-tag); that lands unless the user has a
  // pending edit of the field.
  const dirty = useRef(new Set<"tags">())
  const mRef = useRef(m)
  mRef.current = m
  // What the title says about the autosave: "Saving…" from the first
  // keystroke until the write lands, "Saved" for a moment after, then
  // nothing. A failed write is toasted by updateSnippet, so it only clears
  // the caption rather than saying anything twice.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  // The copy button's check, for a moment after a copy
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  useEffect(() => {
    if (saveState !== "saved") return
    const t = setTimeout(() => setSaveState("idle"), 2000)
    return () => clearTimeout(t)
  }, [saveState])

  const commit = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const cur = latest.current
    const mgr = mRef.current
    mgr.pendingFlush.current = null
    dirty.current.clear()
    const existing = mgr.snippets.find((s) => s.id === snippet.id)
    if (!existing) return
    const names = C.configNames(cur.text)
    // Only the editor's own fields go to disk; uses and pinned are merged
    // there from whatever the popup wrote since this render, and the
    // placement is the store's as of now, so a Move to made while a save
    // was pending is not written back
    try {
      await mgr.updateSnippet(snippet.id, {
        title: cur.title.trim() || "(untitled)",
        tags: storedTags(cur.tags),
        pack: existing.pack || DEFAULT_PACK,
        group: existing.group || "",
        text: cur.text,
        configValues: Object.fromEntries(
          Object.entries(cur.configValues).filter(([k, v]) => names.includes(k) && v !== "")
        ),
      })
    } catch (e) {
      setSaveState("idle")
      throw e
    }
    setSaveState("saved")
    // New prompts default to the pack that last received one
    localStorage.setItem("lastPack", existing.pack || DEFAULT_PACK)
  }, [snippet.id])

  const scheduleSave = useCallback(() => {
    setSaveState("saving")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // A failed save has already been toasted by updateSnippet
    saveTimer.current = setTimeout(() => void commit().catch(() => {}), 600)
    // Park the flush so a quit request can run it before the process exits
    mRef.current.pendingFlush.current = () => commit().catch(() => {})
  }, [commit])

  // Flush pending edits when switching prompts / unmounting
  useEffect(() => {
    const flushRef = mRef.current.pendingFlush
    return () => {
      if (saveTimer.current) void commit().catch(() => {})
      flushRef.current = null
    }
  }, [commit])

  // A tag added from a menu refreshes the field unless the user is mid-edit
  // on it; the saved value is normalised, so re-syncing from it would eat
  // a half-typed tag the moment the 600 ms autosave landed
  useEffect(() => {
    const tagsInStore = (snippet.tags || []).join(", ")
    if (!dirty.current.has("tags") && tagsInStore !== storedTags(latest.current.tags).join(", ")) setTags(tagsInStore)
  }, [snippet.tags])

  const editTags = (next: string) => {
    dirty.current.add("tags")
    setTags(next)
    scheduleSave()
  }

  // Near-miss tokens ({Goal}, {1st}): each chip says only "not a field"; the
  // rule is stated once, here, instead of on every chip
  const badNames = [...new Set(C.tokenize(text).flatMap((p) => (p.type === "bad" ? [p.name] : [])))]

  const setTextAnd = (next: string) => {
    setText(next)
    scheduleSave()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* The title, alone on its line at the heading size nothing else in
          the pane uses. The autosave caption sits at its tail, over the room
          a title leaves, so it takes no width of its own. Inset 13 px (a
          card's border and padding), so the title's text and the "Prompt"
          header under it start on one line (2026-10-10). */}
      <span className="relative flex min-w-0 px-[13px]">
        <input
          autoFocus={isDraft}
          onFocus={(e) => {
            if (isDraft) e.currentTarget.select()
          }}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave()
          }}
          placeholder="Title"
          aria-label="Title"
          // A title longer than the line ends in an ellipsis while the field
          // is not focused (it used to clip mid-letter), and the tooltip
          // carries the whole of it
          title={title.length > 40 ? title : undefined}
          spellCheck={false}
          className="w-full text-ellipsis bg-transparent py-1 pr-16 text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground focus:shadow-[0_1px_0_var(--focus)]"
        />
        {/* Autosave feedback: the caption fades rather than vanishing, and the
            live region announces only the landing, never each keystroke */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5 text-xs text-muted-foreground transition-opacity duration-300",
            saveState === "idle" && "opacity-0"
          )}
        >
          {saveState === "saving" ? (
            "Saving…"
          ) : (
            <>
              <RiCheckLine className="size-3.5" />
              Saved
            </>
          )}
        </span>
        <span role="status" className="sr-only">
          {saveState === "saved" ? "Saved" : ""}
        </span>
      </span>

      {/* Prompt panel: the field fills the card below the header; the
          textarea is 4 lines by default, grows with content, capped at 10
          lines. What the prompt would paste is shown where it is used (the
          popup's card and form, the overview); the one thing the editor
          still says about the text is a near-miss placeholder, which
          nothing else would point out. */}
      <div className="module flex flex-col gap-3">
        {/* Copy sits on the text it copies: what is in the field now,
            unsaved edits and all, the way an overview card copies (./copy) */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="section-title">Prompt</span>
          <Button
            variant="ghost"
            size="xs"
            aria-label="Copy prompt"
            title={C.requiredInputs({ text, configValues }).length ? "Copy, with the clipboard filled in (fill-in fields stay as typed)" : "Copy, with the clipboard filled in"}
            className={cn("-my-1 ml-auto", copied ? "text-(--success)" : "text-muted-foreground")}
            disabled={!text.trim()}
            onClick={() => void copyPrompt({ title, text, configValues }).then((ok) => ok && setCopied(true))}
          >
            {copied ? <RiCheckLine aria-hidden /> : <RiFileCopyLine aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        {/* Full bleed to the card's edge, with the card's 12 px inside, so
            the text starts under "Prompt" above it; the focus edge is an
            inset ring, not a border, so it adds no pixel to the inset
            (at px-4 behind a 1 px border the text sat 5 px right of the
            header) */}
        <div className="-mx-3 flex flex-col overflow-hidden bg-(--panel-body) ring-1 ring-inset ring-transparent focus-within:ring-(--focus)">
          <Textarea
            ref={textRef}
            value={text}
            onChange={(e) => setTextAnd(e.target.value)}
            aria-label="Prompt text"
            spellCheck={false}
            placeholder="Prompt text…  Use {clipboard}, {date}, {time}, any {lowercase_word} as a fill-in field, or {{lowercase_word}} as a saved config parameter."
            className="min-h-[calc(4lh+1.5rem)] max-h-[calc(10lh+1.5rem)] resize-none rounded-none border-0 bg-transparent px-3 py-3 leading-relaxed placeholder:text-muted-foreground/80 focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        {/* Auto enter: the field's footer. Off, it is the "Prompt" header's
            quiet twin under the field. On, it lights up in Warn, the colour
            that says "this changes what happens" in every theme (pins,
            locks, "paste without clipboard"): the unset-config strip's tint,
            Warn at 15%, with Warn text. It was the primary, which is the
            accent in Indigo and the ink in Instrument, so the same band meant
            two different things. The toggle leads; the title and what it
            does follow. The popup
            presses Enter after pasting the prompt, for quick replies to an
            agent. Saved at once (not by the text's autosave, which doesn't
            carry it), and kept out of pack files and exports, so a shared
            pack can't arrive set to run a command. */}
        <label
          className={cn(
            "-mx-3 -mb-3 -mt-3 flex min-w-0 cursor-pointer items-center gap-2 rounded-b-xl px-3 py-2.5 transition-colors duration-150",
            snippet.autoEnter ? "bg-(--warn)/15 text-(--warn)" : "text-muted-foreground"
          )}
          title="The popup presses Enter after pasting this prompt, so it is sent at once. For quick replies; never for commands you want to read first"
        >
          <Switch
            aria-label="Auto enter"
            checked={!!snippet.autoEnter}
            onCheckedChange={(on) => {
              const id = snippet.id
              void m.persist((cur) => cur.map((s) => (s.id === id ? { ...s, autoEnter: on || undefined } : s)))
            }}
            // On, the track is Warn, like the band; off, the shared switch's
            // own colours
            className="data-checked:bg-(--warn) data-checked:focus-visible:ring-(--warn)/50"
            thumbClassName="data-checked:bg-background"
          />
          <span className={cn("text-ui font-semibold", !snippet.autoEnter && "section-title")}>Auto enter</span>
          <span className={cn("min-w-0 truncate text-xs", snippet.autoEnter && "text-foreground")}>· presses Enter after the popup pastes it</span>
        </label>
        {badNames.length > 0 && (
          <p role="note" className="text-xs text-muted-foreground">
            {badNames.map((n) => `{${n}}`).join(", ")} {badNames.length === 1 ? "is" : "are"} plain text: a field name is lowercase letters, digits and _, not
            starting with a digit
          </p>
        )}
      </div>

      <TagStrip snippetId={snippet.id} tags={tags} onChange={editTags} />

      <ParamsPanel
        text={text}
        textRef={textRef}
        configValues={configValues}
        onText={setTextAnd}
        onConfigValue={(name, value) => {
          setConfigValues((v) => ({ ...v, [name]: value }))
          scheduleSave()
        }}
      />
      {menus.element}
    </div>
  )
}
