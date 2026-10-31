import { TagPill, chipVariants } from "@/components/prompt-bits"
import { commitKey } from "@/components/field"
import { C } from "@/lib/core"
import { cn } from "@/lib/utils"
import { useManager } from "./state"
import { say } from "./status"

// The stored form of the tags field, so a save and the refresh that follows it
// compare the same way
// One tag rule for the editor, the menus and imports: core's normalizeTag
export const storedTags = (raw: string) => raw.split(",").map((t) => C.normalizeTag(t)).filter(Boolean)

// Tags: the prompt's own as chips with an inline ×, and a box that
// completes every other tag in the library as it is typed
export function TagStrip({ snippetId, tags, onChange }: {
  /** The prompt's id, for the completion list's id */
  snippetId: string
  /** The tags field as typed, comma-separated */
  tags: string
  /** The field's edit: the editor marks it dirty and schedules the save */
  onChange: (next: string) => void
}) {
  const m = useManager()
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
    onChange(next.join(", "))
    // A tag is lowercase letters, digits, _ and - (normalizeTag): when the
    // fold changed what was typed ("Review, PLAN"), say what landed
    const typed = raw.split(",").map((t) => t.trim()).filter(Boolean)
    if (added.some((t) => !typed.includes(t))) say(`Added ${added.map((t) => `#${t}`).join(", ")}`)
  }
  const removeTag = (t: string) => onChange(tagList.filter((x) => x !== t).join(", "))
  // Every other tag in the library completes in the "+ tag…" box as it is
  // typed (allTags is by count, most first)
  const otherTags = m.allTags().filter((t) => !tagList.includes(t))
  return (
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
          list={`tags-${snippetId}`}
          spellCheck={false}
          className={cn(chipVariants({ tone: "neutral", size: "md" }), "w-24 focus-ring placeholder:text-muted-foreground")}
          onKeyDown={(e) => {
            if (!commitKey(e)) return
            addTags(e.currentTarget.value)
            e.currentTarget.value = ""
          }}
        />
        <datalist id={`tags-${snippetId}`}>
          {otherTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
    </div>
  )
}
