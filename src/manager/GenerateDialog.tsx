import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RiCheckLine, RiLoader4Line } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { C } from "@/lib/core"
import { cn } from "@/lib/utils"
import { useManager } from "./state"
import { ImportCuration } from "./ImportCuration"
import { say, sayErr } from "./status"

type Path = "chat" | "agent"

// Shared schema/rules for both generation modes (clipboard reply, agent-written file)
function packInstructionRules(tags: string) {
  return `The pack is a JSON object following exactly this schema:

{
  "name": "Short pack name",
  "prompts": [
    {
      "title": "Short imperative name, unique within the pack (max ~40 chars)",
      "tags": ["one", "to", "three lowercase tags"],
      "text": "The prompt body."
    }
  ]
}

Placeholder rules for "text":
- {clipboard} expands to whatever the user has copied (errors, diffs, code). Prefer it wherever the input is something the user would copy.
- {date} and {time} expand automatically.
- Any other {lowercase_word} (e.g. {goal}, {feature}) becomes a fill-in field the user completes before pasting. Use sparingly — max 2 per prompt.
- {{lowercase_word}} (double braces) is a config parameter: the user saves a personal value once and it pastes without asking. Use only for user-specific standing values (e.g. {{standing_instructions}}); ship it empty.

Pack rules:
- 5 to 15 prompts, each genuinely reusable (no one-off prompts)
- Every prompt should encode a working practice, not just a phrasing
- Titles must be unique
- Reuse these existing tags where they fit, adding new ones only when needed: ${tags}`
}

type Segment = string | { chip: string; kind: "topic" | "path" }

function chatInstruction(rules: string, topic: string): Segment[] {
  return [
    `You are generating a prompt pack for Promptline (a prompt-paste tool). Output ONLY the JSON object — no prose, no code fences.\n\n${rules}\n\nGenerate a pack for: `,
    { chip: topic || "(describe a topic above)", kind: "topic" },
  ]
}

function agentInstruction(rules: string, topic: string, filePath: string): Segment[] {
  return [
    `You are creating a prompt pack for Promptline (a prompt-paste tool). Write the pack as JSON directly into this file, replacing its placeholder contents:\n\n`,
    { chip: filePath || "(created at step 1)", kind: "path" },
    `\n\n${rules}\n\nGenerate the pack for: `,
    { chip: topic || "(describe a topic above)", kind: "topic" },
    `\n\nWrite the file; do not print the JSON anywhere else.`,
  ]
}

const segmentsToText = (segs: Segment[]) =>
  segs.map((s) => (typeof s === "string" ? s : s.chip)).join("")

// Live render of exactly what Claude will receive — the editor-preview idiom
function InstructionPreview({ segments }: { segments: Segment[] }) {
  return (
    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-accent/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
      {segments.map((s, i) =>
        typeof s === "string" ? (
          <span key={i}>{s}</span>
        ) : (
          <span
            key={i}
            className={cn(
              "rounded px-1 font-semibold",
              s.kind === "topic" ? "bg-amber-500/15 text-amber-600 dark:text-amber-500" : "bg-cyan-500/15 text-cyan-600 dark:text-cyan-500"
            )}
          >
            {s.chip}
          </span>
        )
      )}
    </div>
  )
}

function Step({
  n,
  title,
  done,
  active,
  last,
  children,
}: {
  n: number
  title: string
  done: boolean
  active: boolean
  last?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
            done
              ? "border-primary bg-primary text-primary-foreground"
              : active
                ? "border-primary text-primary"
                : "border-border text-muted-foreground"
          )}
        >
          {done ? <RiCheckLine className="size-4" /> : n}
        </div>
        {!last && <div className={cn("w-px flex-1", done ? "bg-primary" : "bg-border")} />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-4")}>
        <div className={cn("pt-0.5 text-sm font-semibold", active || done ? "text-foreground" : "text-muted-foreground")}>
          {title}
        </div>
        {(active || done) && children}
      </div>
    </div>
  )
}

export function GenerateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const m = useManager()
  const [path, setPath] = useState<Path>("chat")
  const [topic, setTopic] = useState("")
  const [copied, setCopied] = useState(false) // step 1 done (either path)
  const [agentFilePath, setAgentFilePath] = useState("")
  const [watching, setWatching] = useState(false)
  const [importRaw, setImportRaw] = useState<string | null>(null)
  const [imported, setImported] = useState(false)
  const topicRef = useRef<HTMLInputElement>(null)

  const tags = m.allTags().slice(0, 12).join(", ") || "debug, review, plan"
  const rules = packInstructionRules(tags)
  const segments =
    path === "chat" ? chatInstruction(rules, topic.trim()) : agentInstruction(rules, topic.trim(), agentFilePath)

  const reset = () => {
    setTopic("")
    setCopied(false)
    setAgentFilePath("")
    setWatching(false)
    setImportRaw(null)
    setImported(false)
  }

  // Fresh state every time the dialog opens
  useEffect(() => {
    if (open) reset()
  }, [open])

  const switchPath = (p: Path) => {
    setPath(p)
    setCopied(false)
    setWatching(false)
    setImportRaw(null)
    setImported(false)
  }

  const requireTopic = () => {
    const t = topic.trim()
    if (!t) {
      sayErr("Describe a topic first")
      topicRef.current?.focus()
    }
    return t
  }

  // ---- Step 1 actions ----
  const copyChatPrompt = async () => {
    if (!requireTopic()) return
    await invoke("set_clipboard_text", { text: segmentsToText(chatInstruction(rules, topic.trim())) })
    setCopied(true)
    say("Copied — paste it to Claude")
  }

  // Agent mode: the agent writes the pack straight into a file-backed pack's
  // .json — no clipboard transport, immune to terminal copy corruption.
  const copyAgentInstructions = async () => {
    const t = requireTopic()
    if (!t) return
    try {
      let meta = m.packMeta.find((p) => p.name === t)
      let filePath = meta?.path
      if (!meta) {
        filePath = await invoke<string>("create_pack_file", { name: t })
        await m.persistPacks([...m.packMeta, { name: t, locked: false, path: filePath }])
      } else if (!filePath) {
        filePath = await invoke<string>("create_pack_file", { name: t })
        await m.persistPacks(m.packMeta.map((p) => (p.name === t ? { ...p, path: filePath } : p)))
      }
      setAgentFilePath(filePath!)
      await invoke("set_clipboard_text", {
        text: segmentsToText(agentInstruction(rules, t, filePath!)),
      })
      setCopied(true)
      setWatching(true)
      say("Instructions copied — paste them to your agent")
    } catch (e) {
      sayErr(String(e))
    }
  }

  // ---- Step 2 (agent): watch the pack file until Claude fills it ----
  useEffect(() => {
    if (!watching || !agentFilePath || importRaw !== null) return
    const t = setInterval(() => {
      void (async () => {
        try {
          const raw = await invoke<string>("read_pack_file", { path: agentFilePath })
          const diag = C.diagnosePack(raw)
          if (diag.ok && diag.packs!.some((p) => p.prompts.length > 0)) {
            setWatching(false)
            setImportRaw(raw)
            say("Claude wrote the pack — review it below")
          }
        } catch {
          // transient read errors (file mid-write) — keep watching
        }
      })()
    }, 2000)
    return () => clearInterval(t)
  }, [watching, agentFilePath, importRaw])

  const importReply = async () => {
    setImportRaw(await invoke<string>("get_clipboard_text"))
  }

  const close = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const step2Done = importRaw !== null || imported
  const step3Done = imported

  return (
    <Dialog open={open} onOpenChange={close}>
      {/* Base DialogContent caps at sm:max-w-sm — lift it, this dialog is content-heavy */}
      <DialogContent className="flex max-h-[92vh] w-[min(42rem,94vw)] max-w-none flex-col overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-sm">Generate a pack with Claude</DialogTitle>
          <DialogDescription className="sr-only">
            Generate a prompt pack from a topic, then review each prompt before importing.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={topicRef}
          autoFocus
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value)
            // Progress depends on the instruction text — edits invalidate it
            if (!importRaw) {
              setCopied(false)
              setWatching(false)
            }
          }}
          placeholder="What should the pack be about? e.g. Rust + Tauri development"
          spellCheck={false}
          className="rounded-lg bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />

        {/* Path picker — segmented, same idiom as the theme toggle */}
        <div className="flex rounded-[1.375rem] bg-secondary/80 p-1">
          {(
            [
              ["chat", "Chat Claude — copy & paste"],
              ["agent", "Agent — writes the file"],
            ] as const
          ).map(([p, label]) => (
            <button
              key={p}
              className={cn(
                "h-8 flex-1 cursor-pointer rounded-full text-xs font-semibold",
                path === p ? "bg-background text-foreground shadow-[0px_4px_6px_rgba(28,29,34,0.08)]" : "text-muted-foreground"
              )}
              onClick={() => switchPath(p)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* What Claude will receive, rendered live */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            What Claude gets
          </div>
          <InstructionPreview segments={segments} />
        </div>

        {/* Stepper */}
        <div className="mt-1 flex flex-col">
          {path === "chat" ? (
            <>
              <Step n={1} title="Copy the prompt for Claude" done={copied} active={!copied}>
                <Button size="sm" className="mt-1.5 h-auto px-3 py-1.5 text-xs" onClick={() => void copyChatPrompt()}>
                  {copied ? "Copy again" : "Copy prompt"}
                </Button>
              </Step>
              <Step n={2} title="Paste it to Claude, then copy its whole reply" done={step2Done} active={copied && !step2Done}>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  In claude.ai or the Claude app: paste, wait for the JSON reply, copy it.
                </p>
                <Button
                  size="sm"
                  variant={copied ? "default" : "secondary"}
                  className="mt-1.5 h-auto px-3 py-1.5 text-xs"
                  onClick={() => void importReply()}
                >
                  Import reply from clipboard
                </Button>
              </Step>
              <Step n={3} title="Review & add" done={step3Done} active={step2Done && !step3Done} last>
                {importRaw !== null && (
                  <ImportCuration
                    raw={importRaw}
                    defaultName={topic.trim()}
                    onClose={() => setImportRaw(null)}
                    onImported={() => {
                      setImported(true)
                      close(false)
                    }}
                  />
                )}
              </Step>
            </>
          ) : (
            <>
              <Step n={1} title="Create the pack file & copy instructions" done={copied} active={!copied}>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Creates a file-backed pack; the instruction contains its path so the agent writes it directly —
                  no clipboard round-trip.
                </p>
                <Button size="sm" className="mt-1.5 h-auto px-3 py-1.5 text-xs" onClick={() => void copyAgentInstructions()}>
                  {copied ? "Copy again" : "Create file & copy instructions"}
                </Button>
              </Step>
              <Step n={2} title="Paste to your agent — the file reloads by itself" done={step2Done} active={copied && !step2Done}>
                {watching && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <RiLoader4Line className="size-4 animate-spin" />
                    <span className="min-w-0 truncate" title={agentFilePath}>
                      Watching {agentFilePath} …
                    </span>
                  </div>
                )}
              </Step>
              <Step n={3} title="Review & add" done={step3Done} active={step2Done && !step3Done} last>
                {importRaw !== null && (
                  <ImportCuration
                    raw={importRaw}
                    defaultName={topic.trim()}
                    onClose={() => {
                      setImportRaw(null)
                      setWatching(true) // resume watching if they cancel — the agent may rewrite
                    }}
                    onImported={() => {
                      setImported(true)
                      close(false)
                    }}
                  />
                )}
              </Step>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
