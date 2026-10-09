import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RiAddLine, RiArrowDownSLine, RiCheckLine, RiErrorWarningLine, RiFileCopyLine, RiFileTextLine, RiMoreLine, RiPushpinFill } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "./EmptyState"
import { Textarea } from "@/components/ui/textarea"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, useManager } from "./state"
import { commitKey, fieldVariants } from "@/components/field"
import { Chip, TagPill, chipVariants } from "@/components/prompt-bits"
import { Checkbox } from "@/components/ui/checkbox"
import { useLibraryMenus } from "./menus"
import { useCtxMenu, type CtxItem } from "./ctx-menu"
import { say, sayErr } from "./status"
import { copyPrompt } from "./copy"

const BUILTIN_PARAMS = ["clipboard", "date", "time"]
// Library names the insert menu lists before the typed name covers the rest
const MAX_INSERT_NAMES = 6
// The stored form of the tags field, so a save and the refresh that follows it
// compare the same way
// One tag rule for the editor, the menus and imports: core's normalizeTag
const storedTags = (raw: string) => raw.split(",").map((t) => C.normalizeTag(t)).filter(Boolean)

// A parameter name is lowercase letters, digits and underscores, never
// starting with a digit (isValidParam in core); what the user typed is folded
// into that, and the insert menu says what landed when the fold changed it
const paramName = (raw: string) =>
  raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[_0-9]+|_+$/g, "")

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

// The editor is the prompt and little else: a crumb line that says where
// it sits (and moves it), the title, the text, its tags, and the
// placeholders the text holds. Placement is the store's, not a field: the
// crumb's chevron opens the same Move-to menu the row's right-click does,
// so a move never passes through the autosave and the two can't disagree.
// Pin and Delete sit in one overflow menu, as the row's do; the pin shows
// as the same warn-coloured pin the tree and the cards draw.
function EditorInner({ snippet }: { snippet: Snippet }) {
  const m = useManager()
  const menus = useLibraryMenus({ surface: "editor" })
  const insert = useCtxMenu()
  const [title, setTitle] = useState(snippet.title)
  const [tags, setTags] = useState((snippet.tags || []).join(", "))
  const [text, setText] = useState(snippet.text)
  const [configValues, setConfigValues] = useState<Record<string, string>>({ ...(snippet.configValues || {}) })
  const textRef = useRef<HTMLTextAreaElement>(null)
  const isDraft = C.isEmptyDraft(snippet)
  const pack = snippet.pack || DEFAULT_PACK
  const group = snippet.group || ""

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

  // ---- Placeholders ----
  // The names the library uses, offered by the insert menu most-used first
  // (by how many prompts hold each) and capped at six, the typed name
  // covering the rest; a numbered copy of one of them ({goal_2}) is left
  // out, since the + on {goal}'s chip makes it
  const libraryParams = useMemo(() => {
    const prompts = new Map<string, number>()
    for (const s of m.snippets) {
      const seen = new Set<string>()
      for (const part of C.tokenize(s.text))
        if ((part.type === "field" || part.type === "config") && !seen.has(part.name)) {
          seen.add(part.name)
          prompts.set(part.name, (prompts.get(part.name) || 0) + 1)
        }
    }
    return C.dropNumberedCopies(prompts.keys()).sort((a, b) => (prompts.get(b) || 0) - (prompts.get(a) || 0) || a.localeCompare(b))
  }, [m.snippets])

  const { builtinsInText, fieldsInText } = useMemo(() => {
    const builtins: string[] = []
    const fields: string[] = []
    for (const part of C.tokenize(text)) {
      if (part.type === "builtin" && !builtins.includes(part.name)) builtins.push(part.name)
      else if (part.type === "field" && !fields.includes(part.name)) fields.push(part.name)
    }
    return { builtinsInText: builtins, fieldsInText: fields }
  }, [text])
  const configNames = C.configNames(text)
  // Near-miss tokens ({Goal}, {1st}): each chip says only "not a field"; the
  // rule is stated once, here, instead of on every chip
  const badNames = [...new Set(C.tokenize(text).flatMap((p) => (p.type === "bad" ? [p.name] : [])))]

  const setTextAnd = (next: string) => {
    setText(next)
    scheduleSave()
  }

  const insertParam = (name: string, asConfig: boolean) => {
    const token = asConfig ? `{{${name}}}` : `{${name}}`
    const el = textRef.current
    const pos = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? pos
    const next = text.slice(0, pos) + token + text.slice(end)
    setTextAnd(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos + token.length, pos + token.length)
    })
  }

  // Only the whitespace around the token is tidied (core), never the rest of
  // the text: a global collapse flattened the indentation of code in prompts
  const removeParam = (name: string) => setTextAnd(C.removeParamToken(text, name))

  // The insert menu: a name to type, then the built-ins and the library's
  // names the text doesn't hold yet. {{name}} typed in braces is a config
  // parameter; anything else is a fill-in field
  const openInsert = (x: number, y: number) => {
    const inText = new Set([...builtinsInText, ...fieldsInText, ...configNames])
    const offer = (names: string[], asConfig = false): CtxItem[] =>
      names.filter((n) => !inText.has(n)).map((n) => ({ kind: "item", label: asConfig ? `{{${n}}}` : `{${n}}`, run: () => insertParam(n, asConfig) }))
    const builtins = offer(BUILTIN_PARAMS)
    const library = offer(libraryParams).slice(0, MAX_INSERT_NAMES)
    insert.open(x, y, [
      { kind: "header", text: "Insert a placeholder" },
      {
        kind: "input",
        placeholder: "name — Enter inserts it",
        onSubmit: (raw) => {
          const asConfig = /^\{\{.*\}\}$/.test(raw)
          const name = paramName(raw.replace(/^\{+|\}+$/g, ""))
          if (!name) {
            if (raw) sayErr("A name is lowercase letters, digits and _, not starting with a digit")
            return
          }
          insertParam(name, asConfig)
          if (name !== raw.replace(/^\{+|\}+$/g, "").trim()) say(`Inserted ${asConfig ? `{{${name}}}` : `{${name}}`}`)
        },
      },
      // The rule under the input, in the name-label's quiet ink, where the
      // placeholder used to clip before it reached it
      { kind: "header", text: "{name} asks each time; {{name}} saves a value", name: true },
      ...(builtins.length ? [{ kind: "header", text: "Filled in when pasting" } satisfies CtxItem, ...builtins] : []),
      ...(library.length ? [{ kind: "header", text: "Fields used in the library" } satisfies CtxItem, ...library] : []),
    ])
  }

  // ---- Tags ----
  const tagList = storedTags(tags)
  // "review, plan" in the + tag box is two tags, the way the field itself
  // reads commas — stripping them made one "reviewplan"
  const addTags = (raw: string) => {
    const next = [...tagList]
    const added: string[] = []
    for (const t of storedTags(raw))
      if (!next.includes(t)) {
        next.push(t)
        added.push(t)
      }
    if (!added.length) return
    editTags(next.join(", "))
    // A tag is lowercase letters, digits, _ and - (normalizeTag): when the
    // fold changed what was typed ("Review, PLAN"), say what landed
    const typed = raw.split(",").map((t) => t.trim()).filter(Boolean)
    if (added.some((t) => !typed.includes(t))) say(`Added ${added.map((t) => `#${t}`).join(", ")}`)
  }
  const removeTag = (t: string) => editTags(tagList.filter((x) => x !== t).join(", "))
  // Every other tag in the library completes in the "+ tag…" box as it is
  // typed (allTags is by count, most first)
  const otherTags = m.allTags().filter((t) => !tagList.includes(t))

  // ---- Actions: the prompt's own menu, the one its row's right-click
  // opens (Pin, Move to, Add tag, Export, Delete), less Move up and down,
  // which only the sidebar has rows for. A ⋯ that offered Pin and Delete
  // alone was a second, smaller menu for the same prompt.
  const atButton = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return [r.left, r.bottom + 4] as const
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* Where this prompt sits: each crumb shows that pack's or group's
          prompts beside the sidebar (Escape goes to the nearest one), and
          the chevron moves it. The use count and the pin are read here too,
          in the ink of the line, so nothing but the title is lit. */}
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
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
          size="icon-xs"
          aria-label="Move to another pack or group"
          aria-haspopup="menu"
          title="Move to…"
          className="text-muted-foreground"
          onClick={(e) => menus.openMoveTo(...atButton(e), snippet.id)}
        >
          <RiArrowDownSLine className="size-3.5" />
        </Button>
        {snippet.pinned && (
          <span className="flex items-center gap-1 text-(--warn)" title="Pinned: always in the popup's top slots">
            <RiPushpinFill className="size-3" aria-hidden />
            pinned
          </span>
        )}
        {snippet.uses > 0 && (
          <span className="tabular-nums" title={`Pasted ${C.plural(snippet.uses, "time")}`}>
            {snippet.uses}×
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Prompt actions"
          aria-haspopup="menu"
          title="Pin, move, tag, export, delete"
          className="ml-auto text-muted-foreground"
          onClick={(e) => menus.openRowCtx(...atButton(e), new Set([snippet.id]))}
        >
          <RiMoreLine className="size-4" />
        </Button>
      </div>

      {/* The title, alone on its line at the heading size nothing else in
          the pane uses. The autosave caption sits at its tail, over the room
          a title leaves, so it takes no width of its own. */}
      <span className="relative flex min-w-0">
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
        <div className="-mx-3 flex flex-col overflow-hidden border border-transparent bg-secondary focus-within:border-(--focus)">
          <Textarea
            ref={textRef}
            value={text}
            onChange={(e) => setTextAnd(e.target.value)}
            aria-label="Prompt text"
            spellCheck={false}
            placeholder="Prompt text…  Use {clipboard}, {date}, {time}, any {lowercase_word} as a fill-in field, or {{lowercase_word}} as a saved config parameter."
            className="min-h-[calc(4lh+1.5rem)] max-h-[calc(10lh+1.5rem)] resize-none rounded-none border-0 bg-transparent px-4 py-3 leading-relaxed placeholder:text-muted-foreground/80 focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        {/* Auto enter: the field's footer, the header's twin under it (its
            title on the left, its control on the right). The popup presses
            Enter after pasting the prompt, for quick replies to an agent.
            Saved at once (not by the text's autosave, which doesn't carry
            it), and kept out of pack files and exports, so a shared pack
            can't arrive set to run a command. */}
        <label
          className="flex min-w-0 cursor-pointer items-center gap-2"
          title="The popup presses Enter after pasting this prompt, so it is sent at once. For quick replies; never for commands you want to read first"
        >
          <span className="section-title">Auto enter</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">· presses Enter after the popup pastes it</span>
          <Checkbox
            className="ml-auto"
            aria-label="Auto enter"
            checked={!!snippet.autoEnter}
            onCheckedChange={(on) => {
              const id = snippet.id
              void m.persist((cur) => cur.map((s) => (s.id === id ? { ...s, autoEnter: on === true || undefined } : s)))
            }}
          />
        </label>
        {badNames.length > 0 && (
          <p role="note" className="text-xs text-muted-foreground">
            {badNames.map((n) => `{${n}}`).join(", ")} {badNames.length === 1 ? "is" : "are"} plain text: a field name is lowercase letters, digits and _, not
            starting with a digit
          </p>
        )}
      </div>

      {/* Tags: the prompt's own as chips with an inline ×, and a box that
          completes every other tag in the library as it is typed */}
      <div className="module flex flex-col gap-3">
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
          <span className="section-title">Tags</span>
          <span>· #tag narrows the popup's list</span>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {tagList.map((t) => (
            <TagPill key={t} tag={t} size="md" title={`#${t}`} onRemove={() => removeTag(t)} />
          ))}
          <input
            placeholder="+ tag…"
            aria-label="Add a tag"
            list={`tags-${snippet.id}`}
            spellCheck={false}
            className={cn(chipVariants({ tone: "neutral", size: "md" }), "w-24 focus-ring placeholder:text-muted-foreground")}
            onKeyDown={(e) => {
              if (!commitKey(e)) return
              addTags(e.currentTarget.value)
              e.currentTarget.value = ""
            }}
          />
          <datalist id={`tags-${snippet.id}`}>
            {otherTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Placeholders: only what this prompt's text holds, each a chip of
          its kind with an inline × that takes the token out of the text,
          and one way to add more. A card that listed every name in the
          library offered thirteen chips to a prompt that used one. */}
      <div className="module flex flex-col gap-3">
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
          <span className="section-title">Placeholders</span>
          <span>· filled in, or asked for, when it pastes</span>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {builtinsInText.map((name) => (
            <Chip
              key={name}
              tone="builtin"
              size="md"
              title={`{${name}} is filled in when pasting`}
              onRemove={() => removeParam(name)}
              removeLabel={`Remove {${name}} from the text`}
            >
              {`{${name}}`}
            </Chip>
          ))}
          {fieldsInText.map((name) => {
            // Writing {goal} twice pastes one value in both places; a field
            // that should ask again gets a numbered copy ({goal_2}), which + inserts
            const copy = C.nextCopyName(name, text)
            return (
              <Chip
                key={name}
                tone="field"
                size="md"
                title={`{${name}} asks for a value before pasting`}
                onRemove={() => removeParam(name)}
                removeLabel={`Remove {${name}} from the text`}
              >
                {`{${name}}`}
                <button
                  type="button"
                  title={`Insert {${copy}}: another ${copy.replace(/_\d+$/, "")} with its own value (writing {${name}} again reuses the same one)`}
                  aria-label={`Insert {${copy}}`}
                  className="flex cursor-pointer rounded-sm opacity-70 hover:bg-background/40 hover:opacity-100"
                  onClick={() => insertParam(copy, false)}
                >
                  <RiAddLine className="size-3" />
                </button>
              </Chip>
            )
          })}
          <Chip add size="md" title="Insert a placeholder at the cursor" aria-label="Insert a placeholder" onClick={(e) => openInsert(...atButton(e as React.MouseEvent<HTMLElement>))}>
            insert…
          </Chip>
        </div>
        {configNames.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {configNames.map((name) => (
              <div key={name} className="flex items-center gap-3">
                <span className="flex min-w-32">
                  <Chip
                    tone="config"
                    size="md"
                    title={`{{${name}}} pastes the value saved here without asking`}
                    onRemove={() => removeParam(name)}
                    removeLabel={`Remove {{${name}}} from the text`}
                  >
                    {`{{${name}}}`}
                  </Chip>
                </span>
                <input
                  value={configValues[name] || ""}
                  spellCheck={false}
                  placeholder="(unset — will ask as a fill-in field)"
                  aria-label={`Value for {{${name}}}`}
                  className={cn(fieldVariants({ size: "sm" }), "flex-1")}
                  onChange={(e) => {
                    setConfigValues((v) => ({ ...v, [name]: e.target.value }))
                    scheduleSave()
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {menus.element}
      {insert.element}
    </div>
  )
}
