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
      "group": "Optional group within the pack, e.g. a practice or area — omit for ungrouped",
      "text": "The prompt body."
    }
  ]
}

What a good prompt looks like:
- Written to the assistant in the imperative, no preamble. Example: "Review this diff for correctness bugs only — no style or naming comments:\\n\\n{clipboard}"
- Encodes a working practice: an order of operations, a constraint, a stopping point, or an output shape. Not just a polite phrasing of a task.
- Self-contained: reads naturally once placeholders are filled, and makes sense pasted cold into a fresh chat.
- 1 to 5 sentences. Longer only for a genuine checklist.

Placeholder rules for "text":
- {clipboard} expands to whatever the user has copied (errors, diffs, code). Prefer it wherever the input is something the user would copy. Put it on its own line, separated by blank lines.
- {date} and {time} expand automatically.
- Any other {lowercase_word} (e.g. {goal}, {feature}) becomes a fill-in field the user completes before pasting. Name it as a noun for what goes in. Max 2 per prompt.
- {{lowercase_word}} (double braces) is a config parameter: the user saves a personal value once and it pastes without asking. Use only for user-specific standing values (e.g. {{standing_instructions}}); ship it empty.

Pack rules:
- 5 to 15 prompts, each genuinely reusable (no one-off prompts).
- Cover distinct moments of the workflow (starting, diagnosing, deciding, reviewing, wrapping up). No two prompts should ask for nearly the same thing.
- Titles must be unique.
- Reuse these existing tags where they fit, adding new ones only when needed: ${tags}
- Valid JSON: newlines inside "text" as \\n, no trailing commas, no comments.`
}

type Segment = string | { chip: string; kind: "topic" | "path" }

function chatInstruction(rules: string, topic: string): Segment[] {
  return [
    `You are generating a prompt pack for Promptline (a prompt-paste tool). Output ONLY the JSON object — no prose, no code fences.\n\n${rules}\n\nGenerate a pack for: `,
    { chip: topic || "(describe a topic above)", kind: "topic" },
  ]
}

// Where the agent should look before writing anything — shared by both agent variants
const SURVEY = `Before writing anything, survey the project this session runs in: CLAUDE.md and other contributor docs, roadmap or backlog files, recent git log, the test and build commands, and any workflow commands or skills available in this session (for example /gsd:next). Name real files, commands, and conventions from this project rather than generic ones. Where a workflow command already exists, write the prompt that wraps it with the context the user would otherwise type by hand.`

// One practice = one group inside the project's pack; the agent skips
// practices it has nothing specific to say about
const PRACTICES = [
  "Orientation — what to pick next, where we left off",
  "Development — implementing in the project's conventions",
  "Debugging — an error on the clipboard, explaining a module",
  "Verification — tests, typecheck, running the app",
  "Review — diffs, security, consistency with the project's docs",
  "Documentation — updating docs touched by a change",
  "Housekeeping — commits, version bumps, cleanup",
]

function agentInstruction(rules: string, topic: string, filePath: string): Segment[] {
  if (topic) {
    return [
      `You are creating a prompt pack for Promptline (a prompt-paste tool). Write the pack as JSON directly into this file, replacing its placeholder contents:\n\n`,
      { chip: filePath || "(created at step 1)", kind: "path" },
      `\n\n${rules}\n\n${SURVEY}\n\nGenerate the pack for: `,
      { chip: topic, kind: "topic" },
      `\n\nKeep "name" exactly as it is in the file. When done, re-read the file and confirm it parses as JSON. Do not print the JSON anywhere else.`,
    ]
  }
  // Survey mode: no topic — the agent mines the project it runs in, one pack per practice
  return [
    `You are creating a prompt pack for Promptline (a prompt-paste tool) — prompts a developer of THIS project asks over and over. Write it as a single JSON pack object directly into this file, replacing its contents:\n\n`,
    { chip: filePath || "(created at step 1)", kind: "path" },
    `\n\n${rules}\n\n${SURVEY}\n\nName the pack after the project. Set each prompt's "group" to its practice, `,
    { chip: "one group per practice", kind: "topic" },
    `:\n${PRACTICES.map((p) => `- ${p}`).join("\n")}\n\nUse the practice's one-word name as the group. Skip a practice you have nothing project-specific to say about. 3 to 6 prompts per group, 15 to 30 in total (this replaces the 5 to 15 rule above). Write the file once, when every group is done, then re-read it and confirm it parses as JSON. Do not print the JSON anywhere else.`,
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
              "rounded-sm px-1 font-semibold",
              s.kind === "topic" ? "bg-(--param-field-bg) text-(--param-field)" : "bg-(--param-builtin-bg) text-(--param-builtin)"
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
  // How long the agent has been watched for, so the wait can be broken
  const [watchedFor, setWatchedFor] = useState(0)
  const [importRaw, setImportRaw] = useState<string | null>(null)
  const [imported, setImported] = useState(false)
  const topicRef = useRef<HTMLInputElement>(null)
  // The file content whose review was cancelled: watching resumes, but the
  // same content must not reopen the list two seconds later
  const dismissedRaw = useRef<string | null>(null)

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
    dismissedRaw.current = null
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
    const t = topic.trim()
    try {
      const meta = m.packMeta.find((p) => p.name === t)
      let filePath = meta?.path
      if (!t) {
        // Survey mode: several packs land in one scratch file that backs no pack
        filePath = await invoke<string>("create_generated_file")
      } else if (!filePath) {
        // A file for the agent to write into. The pack itself is created on
        // import (L8): cancelling here leaves a file in packs/ (an orphan,
        // never swept — BEHAVIOR.md) but no empty pack in the sidebar.
        filePath = await invoke<string>("create_pack_file", { name: t })
        if (meta) await m.persistPacks(m.packMeta.map((p) => (p.name === t ? { ...p, path: filePath } : p)))
      }
      setAgentFilePath(filePath!)
      dismissedRaw.current = null
      await invoke("set_clipboard_text", {
        text: segmentsToText(agentInstruction(rules, t, filePath!)),
      })
      setCopied(true)
      setWatching(true)
      setWatchedFor(0)
      say("Instructions copied — paste them to your agent")
    } catch (e) {
      sayErr(`Couldn't prepare the pack file: ${e}`)
    }
  }

  // ---- Step 2 (agent): watch the pack file until Claude fills it ----
  useEffect(() => {
    if (!watching || !agentFilePath || importRaw !== null) return
    const t = setInterval(() => {
      setWatchedFor((s) => s + 2)
      void (async () => {
        try {
          const raw = await invoke<string>("read_pack_file", { path: agentFilePath })
          if (raw === dismissedRaw.current) return
          const diag = C.diagnosePack(raw)
          if (diag.ok && diag.packs.some((p) => p.prompts.length > 0)) {
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

  // Import the agent's file by hand (after Stop, or when the poll missed it)
  const importFromFile = async () => {
    try {
      setImportRaw(await invoke<string>("read_pack_file", { path: agentFilePath }))
      setWatching(false)
    } catch (e) {
      sayErr(`Couldn't read the pack file: ${e}`)
    }
  }

  const importReply = async () => {
    setImportRaw(await invoke<string>("get_clipboard_text"))
  }

  const close = (v: boolean) => {
    if (!v) {
      // Closing mid-watch keeps nothing running; the file stays for a manual
      // import from Settings → the pack's "Import from this file…"
      if (watching) say("Stopped watching — the file is still there under Settings → Your library")
      reset()
    }
    onOpenChange(v)
  }

  const step2Done = importRaw !== null || imported
  const step3Done = imported

  return (
    <Dialog open={open} onOpenChange={close}>
      {/* Base DialogContent caps at sm:max-w-sm — lift it, this dialog is content-heavy */}
      <DialogContent className="flex max-h-[92vh] w-[min(42rem,94vw)] max-w-none flex-col overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-sm">Generate pack with Claude</DialogTitle>
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
          placeholder={
            path === "chat"
              ? "What should the pack be about? e.g. Rust + Tauri development"
              : "Optional — narrow to one area, or leave empty to survey the whole project"
          }
          aria-label="Topic"
          spellCheck={false}
          className="rounded-lg bg-secondary px-3 py-2 text-sm text-foreground focus-ring placeholder:text-muted-foreground"
        />

        {path === "agent" && !topic.trim() && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Empty topic: the agent surveys the project it's running in — its docs, git log, build commands, and
            workflow commands like /gsd:next — and writes one pack named after the project, with a group per daily
            practice: orientation, development, debugging, verification, review, documentation, housekeeping.
          </p>
        )}

        {/* Path picker — segmented, same idiom as the theme toggle */}
        <div className="flex rounded-lg bg-(--segment-track) p-1" role="radiogroup" aria-label="How Claude receives the instruction">
          {(
            [
              ["chat", "Chat Claude — copy & paste"],
              ["agent", "Agent — writes the file"],
            ] as const
          ).map(([p, label]) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={path === p}
              className={cn(
                "h-8 flex-1 cursor-pointer rounded-sm text-xs font-semibold focus-ring",
                path === p ? "bg-(--segment-active) text-foreground shadow-(--shadow-segment)" : "text-muted-foreground"
              )}
              onClick={() => switchPath(p)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* What Claude will receive, rendered live */}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What Claude gets
          </div>
          <InstructionPreview segments={segments} />
        </div>

        {/* Stepper */}
        <div className="mt-1 flex flex-col">
          {path === "chat" ? (
            <>
              <Step n={1} title="Copy the prompt for Claude" done={copied} active={!copied}>
                <Button size="sm" className="mt-1.5" onClick={() => void copyChatPrompt()}>
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
                  className="mt-1.5"
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
                  {topic.trim()
                    ? "Creates a file-backed pack; the instruction contains its path so the agent writes it directly — no clipboard round-trip."
                    : "Creates a scratch file; the agent writes the project's pack into it and you review it on import."}
                </p>
                <Button size="sm" className="mt-1.5" onClick={() => void copyAgentInstructions()}>
                  {copied ? "Copy again" : "Create file & copy instructions"}
                </Button>
              </Step>
              <Step n={2} title="Paste to your agent — the file reloads by itself" done={step2Done} active={copied && !step2Done}>
                {watching && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <RiLoader4Line className="size-4 animate-spin" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={agentFilePath} role="status">
                      Watching {agentFilePath} … {watchedFor >= 60 ? `${Math.floor(watchedFor / 60)} min ${watchedFor % 60} s` : `${watchedFor} s`}
                    </span>
                    <Button size="xs" variant="secondary" onClick={() => setWatching(false)}>
                      Stop
                    </Button>
                    <Button size="xs" variant="secondary" onClick={() => void importFromFile()}>
                      Import from file now
                    </Button>
                  </div>
                )}
                {!watching && copied && !step2Done && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Not watching.</span>
                    <Button size="xs" variant="secondary" onClick={() => { setWatching(true); setWatchedFor(0) }}>
                      Keep watching
                    </Button>
                    <Button size="xs" variant="secondary" onClick={() => void importFromFile()}>
                      Import from file…
                    </Button>
                  </div>
                )}
                {watching && watchedFor >= 90 && (
                  <p className="mt-1 text-xs text-muted-foreground" role="status">
                    Still nothing after {Math.floor(watchedFor / 60)} min — agents can take a while; you can also close
                    this dialog and import the file later from Settings.
                  </p>
                )}
              </Step>
              <Step n={3} title="Review & add" done={step3Done} active={step2Done && !step3Done} last>
                {importRaw !== null && (
                  <ImportCuration
                    raw={importRaw}
                    defaultName={topic.trim()}
                    onClose={() => {
                      dismissedRaw.current = importRaw
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
