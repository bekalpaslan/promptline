import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileTextLine,
} from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "./EmptyState"
import { Textarea } from "@/components/ui/textarea"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, MAX_PINS, useManager } from "./state"
import { ComboInput, Select, fieldVariants } from "@/components/field"
import { Chip, TagPill, chipVariants } from "@/components/prompt-bits"
import { useLibraryMenus } from "./menus"
import { useCtxMenu } from "./ctx-menu"
import { say, sayErr } from "./status"

const BUILTIN_PARAMS = ["clipboard", "date", "time"]
// The stored form of the tags field, so a save and the refresh that follows it
// compare the same way
// One tag rule for the editor, the menus and imports: core's normalizeTag
const storedTags = (raw: string) => raw.split(",").map((t) => C.normalizeTag(t)).filter(Boolean)
const SUGGESTED_PARAMS = ["goal", "feature", "task", "error", "file"]
// Tag pills offered under a prompt's own tags: the most used ones it lacks
const MAX_TAG_PILLS = 6

// One card per parameter kind. The card's Edit toggle reveals delete badges
// on the pills inside (children render from the editing flag).
function ParamSection({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: (editing: boolean) => React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="module flex flex-col gap-3 bg-secondary/50">
      <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
        <span className="section-title">{title}</span>
        <span>· {hint}</span>
        <button
          type="button"
          aria-pressed={editing}
          aria-label={editing ? `Done editing ${title}` : `Edit ${title}`}
          className={cn(
            "ml-auto cursor-pointer font-medium",
            editing ? "text-primary hover:text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </span>
      {children(editing)}
    </div>
  )
}

// Addable chip: a + segment on the left, cut off by a full-height divider
function AddPill({ label, title, onAdd }: { label: string; title: string; onAdd: () => void }) {
  return (
    <Chip add size="md" title={title} onClick={onAdd}>
      {label}
    </Chip>
  )
}

// Delete badge hovering on a pill's corner while its card is in edit mode
function DeleteBadge({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      title="Remove from this prompt"
      aria-label="Remove from this prompt"
      // 14 px badge, 30 px hit area (the ::after inset idiom from checkbox.tsx)
      className="absolute -right-1.5 -top-1.5 flex size-3.5 cursor-pointer items-center justify-center rounded-full bg-destructive text-white opacity-80 shadow-sm transition-transform duration-150 animate-in fade-in zoom-in after:absolute after:-inset-2 after:content-[''] hover:scale-110 hover:opacity-100"
      onClick={(e) => {
        e.stopPropagation()
        onDelete()
      }}
    >
      <RiCloseLine className="size-2.5" />
    </button>
  )
}

// A parameter name is lowercase letters, digits and underscores, never
// starting with a digit (isValidParam in core); what the user typed is folded
// into that, and the fold is shown before Enter rather than discovered in
// the chip afterwards
const paramName = (raw: string) =>
  raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[_0-9]+|_+$/g, "")

function ParamInput({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [raw, setRaw] = useState("")
  const name = paramName(raw)
  const differs = raw.trim() !== "" && name !== raw.trim()
  return (
    <span className="flex items-center gap-1.5">
      <input
        value={raw}
        placeholder={placeholder}
        aria-label={placeholder.replace(/^\+ /, "Add ").replace(/…$/, "")}
        spellCheck={false}
        className={cn(chipVariants({ tone: "neutral", size: "md" }), "w-28 focus-ring placeholder:text-muted-foreground")}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          if (!name) return
          onAdd(name)
          setRaw("")
        }}
      />
      {differs && (
        <span className="text-xs text-muted-foreground" role="status">
          {name ? `will insert {${name}}` : "lowercase letters, digits and _ only"}
        </span>
      )}
    </span>
  )
}

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
    if (!m.snippets.length) {
      return (
        <>
          <EmptyState
            icon={RiFileTextLine}
            title="No prompts yet"
            hint="A pack holds your prompts: make one and write prompts in it, or let Claude draft a pack for a topic — every prompt is reviewed before it is added"
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
              { label: "Generate pack with Claude…", onClick: () => m.openGenerate() },
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
        hint={`Or press ${C.fmtHotkey(m.hotkey)} in any app to paste one`}
        actions={[
          { label: "New prompt", onClick: () => void m.newPrompt(), primary: true },
          { label: "Generate pack with Claude…", onClick: () => m.openGenerate() },
        ]}
      />
    )
  }
  return <EditorInner snippet={snippet} />
}

function EditorInner({ snippet }: { snippet: Snippet }) {
  const m = useManager()
  const [title, setTitle] = useState(snippet.title)
  const [tags, setTags] = useState((snippet.tags || []).join(", "))
  const [pack, setPack] = useState(snippet.pack || DEFAULT_PACK)
  const [group, setGroup] = useState(snippet.group || "")
  const [text, setText] = useState(snippet.text)
  const [configValues, setConfigValues] = useState<Record<string, string>>({ ...(snippet.configValues || {}) })
  const [advOpen, setAdvOpen] = useState(localStorage.getItem("advancedOpen") === "1")
  const [deleteArmed, setDeleteArmed] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const isDraft = C.isEmptyDraft(snippet)

  // Autosave: edits persist on a short debounce — no Save button, no lost drafts
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ title, tags, pack, group, text, configValues })
  latest.current = { title, tags, pack, group, text, configValues }
  // Fields the user has edited since the last save. The sidebar can change
  // tags/pack/group underneath the editor (move-to, add-tag); those land
  // unless the user has a pending edit of that same field.
  const dirty = useRef(new Set<"tags" | "pack" | "group">())
  const mRef = useRef(m)
  mRef.current = m
  // What the header says about the autosave: "Saving…" from the first
  // keystroke until the write lands, "Saved" for a moment after, then
  // nothing. A failed write is toasted by updateSnippet, so it only clears
  // the caption rather than saying anything twice.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
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
    let targetPack = cur.pack.trim() || existing.pack || DEFAULT_PACK
    if (targetPack !== (existing.pack || DEFAULT_PACK) && mgr.isLocked(targetPack)) {
      sayErr(`Pack "${targetPack}" is locked — unlock it to add prompts`)
      targetPack = existing.pack || DEFAULT_PACK
      setPack(targetPack)
    }
    const names = C.configNames(cur.text)
    // Only the editor's own fields go to disk; uses and pinned are
    // merged there from whatever the popup wrote since this render
    try {
      await mgr.updateSnippet(snippet.id, {
        title: cur.title.trim() || "(untitled)",
        tags: storedTags(cur.tags),
        pack: targetPack,
        group: cur.group.trim(),
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
    localStorage.setItem("lastPack", targetPack)
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

  // External changes (move-to-pack, add-tag via context menu) refresh the
  // fields the user isn't mid-edit on. Skipping the whole refresh while a save
  // was pending let the save write the stale pack back, undoing the move.
  //
  // A field is also left alone when the store only holds what this editor's
  // own save just wrote: `dirty` is cleared on commit, and the saved value is
  // trimmed, so re-syncing from it ate the space in a half-typed "my group "
  // the moment the 600 ms autosave landed.
  useEffect(() => {
    const d = dirty.current
    const cur = latest.current
    const tagsInStore = (snippet.tags || []).join(", ")
    if (!d.has("tags") && tagsInStore !== storedTags(cur.tags).join(", ")) setTags(tagsInStore)
    if (!d.has("pack") && (snippet.pack || DEFAULT_PACK) !== (cur.pack.trim() || DEFAULT_PACK))
      setPack(snippet.pack || DEFAULT_PACK)
    if (!d.has("group") && (snippet.group || "") !== cur.group.trim()) setGroup(snippet.group || "")
  }, [snippet.tags, snippet.pack, snippet.group])

  const editTags = (next: string) => {
    dirty.current.add("tags")
    setTags(next)
    scheduleSave()
  }
  const editPack = (next: string) => {
    dirty.current.add("pack")
    setPack(next)
    scheduleSave()
  }
  const editGroup = (next: string) => {
    dirty.current.add("group")
    setGroup(next)
    scheduleSave()
  }

  // Groups already in use in the chosen pack, for the group field's suggestions
  // The group field's list: every group in the pack, the current one checked
  const groupMenu = useCtxMenu()
  const packGroups = useMemo(() => {
    const set = new Set<string>()
    for (const s of m.snippets) if ((s.pack || DEFAULT_PACK) === pack && s.group) set.add(s.group)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [m.snippets, pack])

  // ---- Params ----
  const libraryParams = useMemo(() => {
    const found = new Set<string>()
    for (const s of m.snippets)
      for (const part of C.tokenize(s.text))
        if (part.type === "field" || part.type === "config") found.add(part.name)
    return found
  }, [m.snippets])

  const { configInText, runtimeInText } = useMemo(() => {
    const config = new Set<string>()
    const runtime = new Set<string>()
    for (const part of C.tokenize(text)) {
      if (part.type === "config") config.add(part.name)
      else if (part.type === "field" || part.type === "builtin") runtime.add(part.name)
    }
    return { configInText: config, runtimeInText: runtime }
  }, [text])

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

  const paramChip = (name: string, isBuiltin: boolean, inText: boolean, editing: boolean) => {
    if (!inText)
      return (
        <AddPill
          key={name}
          label={`{${name}}`}
          title={`Insert {${name}}`}
          onAdd={() => insertParam(name, false)}
        />
      )
    // Writing {goal} twice pastes one value in both places; a field that
    // should ask again gets a numbered copy ({goal_2}), which + inserts
    const copy = isBuiltin ? null : C.nextCopyName(name, text)
    return (
      <Chip
        key={name}
        tone={isBuiltin ? "builtin" : "field"}
        size="md"
        title={`{${name}} is in the prompt — Edit to remove`}
        className={cn("relative select-none", copy && !editing && "pr-1")}
      >
        {`{${name}}`}
        {copy && !editing && (
          <button
            type="button"
            title={`Insert {${copy}}: another ${copy.replace(/_\d+$/, "")} with its own value (writing {${name}} again reuses the same one)`}
            aria-label={`Insert {${copy}}`}
            className="flex cursor-pointer rounded-sm opacity-70 hover:bg-background/40 hover:opacity-100"
            onClick={() => insertParam(copy, false)}
          >
            <RiAddLine className="size-3" />
          </button>
        )}
        {editing && <DeleteBadge onDelete={() => removeParam(name)} />}
      </Chip>
    )
  }

  // ---- Tags ----
  const tagList = storedTags(tags)
  const addTag = (t: string) => {
    if (tagList.includes(t)) return
    editTags([...tagList, t].join(", "))
  }
  // "review, plan" in the + tag box is two tags, the way the field itself
  // reads commas — stripping them made one "reviewplan"
  const addTags = (raw: string) => {
    const next = [...tagList]
    for (const t of storedTags(raw)) if (!next.includes(t)) next.push(t)
    if (next.length !== tagList.length) editTags(next.join(", "))
  }
  const removeTag = (t: string) => {
    editTags(tagList.filter((x) => x !== t).join(", "))
  }
  // Pills for the library's most used tags the prompt lacks (allTags is by
  // count, most first); every other tag completes in the "+ tag…" box as
  // it is typed. Every tag as a pill grew the card past the editor.
  const otherTags = m.allTags().filter((t) => !tagList.includes(t))
  const tagSuggestions = otherTags.slice(0, MAX_TAG_PILLS)

  const customParams = new Set([
    ...[...configInText, ...runtimeInText].filter((t) => !BUILTIN_PARAMS.includes(t)),
    ...libraryParams,
    ...SUGGESTED_PARAMS,
  ])
  const configNames = C.configNames(text)
  // Near-miss tokens ({Goal}, {1st}): each chip says only "not a field"; the
  // rule is stated once, here, instead of on every chip
  const badNames = [...new Set(C.tokenize(text).flatMap((p) => (p.type === "bad" ? [p.name] : [])))]

  // ---- Actions ----
  const togglePin = async () => {
    if (!snippet.pinned && m.snippets.filter((x) => x.pinned).length >= MAX_PINS) {
      sayErr(`Max ${MAX_PINS} pins — unpin something first`)
      return
    }
    await m.persist((cur) => cur.map((s) => (s.id === snippet.id ? C.withPin(s, !s.pinned) : s)))
    say(snippet.pinned ? "Unpinned" : "Pinned")
  }

  // Escape disarms the delete button (the 3 s timeout is in doDelete)
  useEffect(() => {
    if (!deleteArmed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setDeleteArmed(false)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [deleteArmed])

  const doDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true)
      setTimeout(() => setDeleteArmed(false), 3000)
      return
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    await m.deleteWithUndo([snippet.id], `Deleted "${snippet.title}"`)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* Where this prompt sits; each crumb shows that pack's or group's
          prompts beside the sidebar (Escape goes to the nearest one) */}
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <button
          type="button"
          className="min-w-0 cursor-pointer truncate rounded-sm font-medium hover:text-foreground focus-ring"
          title={`Show the prompts in ${pack.trim() || DEFAULT_PACK}${group.trim() ? "" : " (Esc)"}`}
          onClick={() => m.openOverview({ pack: pack.trim() || DEFAULT_PACK })}
        >
          {pack.trim() || DEFAULT_PACK}
        </button>
        {group.trim() && (
          <>
            <span aria-hidden>›</span>
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate rounded-sm font-medium hover:text-foreground focus-ring"
              title={`Show the prompts in ${group.trim()} (Esc)`}
              onClick={() => m.openOverview({ pack: pack.trim() || DEFAULT_PACK, group: group.trim() })}
            >
              {group.trim()}
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
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
          spellCheck={false}
          className="min-w-50 flex-[2] bg-transparent py-1 text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground focus:shadow-[0_1px_0_var(--focus)]"
        />
        <Select
          className="min-w-32 flex-1"
          value={pack}
          onChange={(e) => editPack(e.target.value)}
          aria-label="Pack"
        >
          {m.packNames(pack).map((p) => (
            <option key={p} value={p} disabled={m.isLocked(p) && p !== pack}>
              {m.isLocked(p) ? `🔒 ${p}` : p}
            </option>
          ))}
        </Select>
        {/* Group within the pack — a label, so free text with the pack's existing groups as suggestions */}
        <ComboInput
          value={group}
          listLabel="Pick a group"
          onList={
            packGroups.length
              ? (box) =>
                  groupMenu.open(box.left, box.bottom + 4, [
                    { kind: "item", label: "No group", checked: group === "", run: () => editGroup("") },
                    { kind: "sep" },
                    ...packGroups.map((g) => ({
                      kind: "item" as const,
                      label: g,
                      checked: g === group,
                      run: () => editGroup(g),
                    })),
                  ])
              : undefined
          }
          onChange={(e) => {
            editGroup(e.target.value)
          }}
          placeholder="Group (optional)"
          aria-label="Group"
          title={group || undefined}
          spellCheck={false}
          className="min-w-28 max-w-60 shrink-0"
        />
        {groupMenu.element}
        {/* Autosave feedback: the caption fades rather than vanishing, and the
            live region announces only the landing, never each keystroke */}
        <span
          aria-hidden
          className={cn(
            "flex items-center gap-0.5 text-xs text-muted-foreground transition-opacity duration-300",
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
        {snippet.uses > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">used {snippet.uses}×</span>
        )}
        {/* The prompt's own actions sit together in its header: pin, delete */}
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={snippet.pinned}
          title={snippet.pinned ? "Unpin from the popup's top slots" : "Pin to the popup's top slots"}
          onClick={() => void togglePin()}
          className={cn("min-w-14", snippet.pinned && "bg-(--warn)/15 text-(--warn) hover:bg-(--warn)/25")}
        >
          {snippet.pinned ? "Unpin" : "Pin"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          title="Delete prompt"
          aria-label={deleteArmed ? "Confirm delete" : "Delete prompt"}
          onClick={() => void doDelete()}
          className={cn("text-destructive hover:bg-destructive/15", deleteArmed && "bg-destructive/15")}
        >
          <span aria-live="assertive">
            {deleteArmed ? `Really delete "${(snippet.title || "untitled").slice(0, 24)}"?` : <RiDeleteBinLine className="size-4" aria-hidden />}
          </span>
        </Button>
      </div>

      {/* Prompt panel: same header idiom as Advanced options. The field fills
          the card below the header; the textarea is 4 lines by default, grows
          with content, capped at 10 lines. What the prompt would paste is
          shown where it is used (the popup's card and form, the overview);
          the one thing the editor still says about the text is a near-miss
          placeholder, which nothing else would point out. */}
      <div className="module flex flex-col gap-3">
        <span className="section-title">Prompt</span>
        <div className={cn("-mx-3 flex flex-col overflow-hidden border border-transparent bg-secondary/50 focus-within:border-(--focus)", badNames.length ? "" : "-mb-3 rounded-b-xl")}>
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
        {badNames.length > 0 && (
          <p role="note" className="text-xs text-muted-foreground">
            {badNames.map((n) => `{${n}}`).join(", ")} {badNames.length === 1 ? "is" : "are"} plain text: a field name is lowercase letters, digits and _, not
            starting with a digit
          </p>
        )}
      </div>

      {/* Tags: the same card as Built-ins — chips for the prompt's own tags,
          add-pills for the library's other tags, a box for a new one; Edit
          puts a delete badge on each chip */}
      <ParamSection title="Tags" hint="#tag narrows the popup's list — click a pill to add">
        {(editing) => (
          <div className="flex flex-wrap items-center gap-1.5">
            {tagList.map((t) => (
              <TagPill key={t} tag={t} size="md" title={editing ? `#${t}` : `#${t} — Edit to remove`}>
                {editing && <DeleteBadge onDelete={() => removeTag(t)} />}
              </TagPill>
            ))}
            {tagSuggestions.map((t) => (
              <AddPill key={t} label={t} title={`Add tag "${t}"`} onAdd={() => addTag(t)} />
            ))}
            <input
              placeholder="+ tag…"
              aria-label="Add a tag"
              list={`tags-${snippet.id}`}
              spellCheck={false}
              className={cn(chipVariants({ tone: "neutral", size: "md" }), "w-24 focus-ring placeholder:text-muted-foreground")}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                addTags(e.currentTarget.value)
                e.currentTarget.value = ""
              }}
            />
            {/* Every other tag in the library, completed as it is typed */}
            <datalist id={`tags-${snippet.id}`}>
              {otherTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        )}
      </ParamSection>

      {/* One containing card: the toggle is its header, the parameter cards
          sit inside it on the tinted background */}
      <div className="module flex flex-col">
        <button
          className="section-title flex cursor-pointer items-center gap-1 self-start hover:text-primary"
          onClick={() => {
            const next = !advOpen
            setAdvOpen(next)
            localStorage.setItem("advancedOpen", next ? "1" : "0")
          }}
        >
          Advanced options
          {advOpen ? <RiArrowDownSLine className="size-3.5" /> : <RiArrowRightSLine className="size-3.5" />}
        </button>

        {advOpen && (
          <div className="mt-3 flex flex-col gap-3">
          <ParamSection title="Built-ins" hint="expand on their own when pasting — click to insert">
            {(editing) => (
              <div className="flex flex-wrap items-center gap-1.5">
                {BUILTIN_PARAMS.map((p) => paramChip(p, true, runtimeInText.has(p), editing))}
              </div>
            )}
          </ParamSection>

          <ParamSection
            title="Fill-in fields"
            hint={`{name} — you type the value each time you paste`}
          >
            {(editing) => (
              <div className="flex flex-wrap items-center gap-1.5">
                {[...customParams]
                  .filter((p) => !configInText.has(p))
                  .map((p) => paramChip(p, false, runtimeInText.has(p), editing))}
                <ParamInput placeholder="+ field…" onAdd={(name) => insertParam(name, false)} />
              </div>
            )}
          </ParamSection>

          <ParamSection
            title="Config parameters"
            hint={`{{name}} — uses the value saved here, pastes without asking`}
          >
            {(editing) => (
              <>
                {configNames.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {configNames.map((name) => (
                      <div key={name} className="flex items-center gap-3">
                        <span className="flex min-w-32">
                          <Chip tone="config" size="md" className="relative select-none">
                            {`{{${name}}}`}
                            {editing && <DeleteBadge onDelete={() => removeParam(name)} />}
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <ParamInput placeholder="+ config…" onAdd={(name) => insertParam(name, true)} />
                </div>
              </>
            )}
          </ParamSection>

          </div>
        )}
      </div>

    </div>
  )
}
