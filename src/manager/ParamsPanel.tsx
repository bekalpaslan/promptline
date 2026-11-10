import { useMemo } from "react"
import { RiAddLine } from "@remixicon/react"
import { C } from "@/lib/core"
import { cn } from "@/lib/utils"
import { fieldVariants } from "@/components/field"
import { Chip } from "@/components/prompt-bits"
import { useManager } from "./state"
import { atButton, useCtxMenu, type CtxItem } from "./ctx-menu"
import { say, sayErr } from "./status"

const BUILTIN_PARAMS = ["clipboard", "date", "time"]
// Library names the insert menu lists before the typed name covers the rest
const MAX_INSERT_NAMES = 6
// A parameter name is lowercase letters, digits and underscores, never
// starting with a digit (isValidParam in core); what the user typed is folded
// into that, and the insert menu says what landed when the fold changed it
const paramName = (raw: string) =>
  raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[_0-9]+|_+$/g, "")

// Placeholders: only what this prompt's text holds, each a chip of
// its kind with an inline × that takes the token out of the text,
// and one way to add more. A card that listed every name in the
// library offered thirteen chips to a prompt that used one.
export function ParamsPanel({
  text,
  textRef,
  configValues,
  onText,
  onConfigValue,
}: {
  /** The prompt's text as it is in the field now */
  text: string
  /** The field, for the caret an inserted token goes at */
  textRef: React.RefObject<HTMLTextAreaElement | null>
  configValues: Record<string, string>
  /** The text's edit (a token inserted or removed): the editor sets it and schedules the save */
  onText: (next: string) => void
  /** A config parameter's value as typed: the editor stores it and schedules the save */
  onConfigValue: (name: string, value: string) => void
}) {
  const m = useManager()
  const insert = useCtxMenu()
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

  const insertParam = (name: string, asConfig: boolean) => {
    const token = asConfig ? `{{${name}}}` : `{${name}}`
    const el = textRef.current
    const pos = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? pos
    const next = text.slice(0, pos) + token + text.slice(end)
    onText(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos + token.length, pos + token.length)
    })
  }

  // Only the whitespace around the token is tidied (core), never the rest of
  // the text: a global collapse flattened the indentation of code in prompts
  const removeParam = (name: string) => onText(C.removeParamToken(text, name))

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

  return (
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
                value={C.configValue(configValues, name)}
                spellCheck={false}
                placeholder="(unset — will ask as a fill-in field)"
                aria-label={`Value for {{${name}}}`}
                className={cn(fieldVariants({ size: "sm" }), "flex-1")}
                onChange={(e) => onConfigValue(name, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
      {insert.element}
    </div>
  )
}
