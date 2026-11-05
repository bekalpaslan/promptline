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
import { Chip, PREVIEW_BOX } from "@/components/prompt-bits"
import { SEGMENT_TRACK, fieldVariants, segmentClass } from "@/components/field"
import { useManager } from "./state"
import { ImportCuration } from "./ImportCuration"
import { say, sayErr, sayLong } from "./status"
import { type Segment, agentInstruction, chatInstruction, packInstructionRules, segmentsToText } from "./generate-instructions"

type Path = "chat" | "agent"

// Live render of exactly what the AI will receive — the editor-preview idiom
function InstructionPreview({ segments }: { segments: Segment[] }) {
  // A scroll region with a name and a tab stop, so the keyboard can read
  // it through and a screen reader knows what it is
  return (
    <div role="region" aria-label="What the AI gets" tabIndex={0} className={cn(PREVIEW_BOX, "max-h-40 overflow-y-auto focus-ring")}>
      {segments.map((s, i) =>
        typeof s === "string" ? (
          <span key={i}>{s}</span>
        ) : (
          <Chip key={i} tone={s.kind === "topic" ? "field" : "builtin"} size="inline">
            {s.chip}
          </Chip>
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
  // The agent's file as it was made: the review opens on a change from this,
  // never on what the file already held
  const baselineRaw = useRef<string | null>(null)

  const tags = m.allTags().slice(0, 12).join(", ") || "debug, review, plan"
  const rules = packInstructionRules(tags)
  // Pack names are unique whatever their case, so "work" means the pack "Work"
  const existingPack = m.packNames().find((p) => p.toLowerCase() === topic.trim().toLowerCase())
  const named = existingPack ?? topic.trim()
  const segments =
    path === "chat" ? chatInstruction(rules, topic.trim()) : agentInstruction(tags, named, agentFilePath, !!existingPack)

  const reset = () => {
    setTopic("")
    setCopied(false)
    setAgentFilePath("")
    setWatching(false)
    setImportRaw(null)
    dismissedRaw.current = null
    baselineRaw.current = null
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
    try {
      await invoke("set_clipboard_text", { text: segmentsToText(chatInstruction(rules, topic.trim())) })
    } catch (e) {
      // Step 1 stays open: nothing was copied, so nothing to paste
      sayErr(`Couldn't copy the instruction: ${String(e)}`)
      return
    }
    setCopied(true)
    say("Copied — paste it into your AI chat")
  }

  // Agent mode: the agent writes the pack straight into a .json — no clipboard
  // transport, immune to terminal copy corruption. Always a scratch file that
  // backs no pack, never a live pack's file: the next save would overwrite the
  // agent's work (BEHAVIOR.md). The pack itself is created on import (L8), so
  // cancelling leaves a file but no empty pack in the sidebar.
  const copyAgentInstructions = async () => {
    try {
      // Copy again keeps the file: the first instruction may be with the agent
      let filePath = copied ? agentFilePath : ""
      if (!filePath) {
        filePath = await invoke<string>("create_generated_file", { name: named || null })
        baselineRaw.current = await invoke<string>("read_pack_file", { path: filePath })
        dismissedRaw.current = null
        setAgentFilePath(filePath)
      }
      await invoke("set_clipboard_text", {
        text: segmentsToText(agentInstruction(tags, named, filePath, !!existingPack)),
      })
      setCopied(true)
      setWatching(true)
      setWatchedFor(0)
      say("Instructions copied — paste them to your agent")
    } catch (e) {
      sayErr(`Couldn't prepare the pack file: ${String(e)}`)
    }
  }

  // ---- Step 2 (agent): watch the pack file until the agent fills it ----
  useEffect(() => {
    const baseline = baselineRaw.current
    if (!watching || !agentFilePath || baseline === null || importRaw !== null) return
    // A read still in flight when this watch ends answers for nothing
    let ended = false
    const t = setInterval(() => {
      setWatchedFor((s) => s + 2)
      void (async () => {
        try {
          const raw = await invoke<string>("read_pack_file", { path: agentFilePath })
          if (ended || raw === dismissedRaw.current) return
          if (C.agentFileReady(raw, baseline)) {
            setWatching(false)
            setImportRaw(raw)
            say("The agent wrote the pack — review it below")
          }
        } catch {
          // transient read errors (file mid-write) — keep watching
        }
      })()
    }, 2000)
    return () => {
      ended = true
      clearInterval(t)
    }
  }, [watching, agentFilePath, importRaw])

  // Import the agent's file by hand (after Stop, or when the poll missed it)
  const importFromFile = async () => {
    try {
      setImportRaw(await invoke<string>("read_pack_file", { path: agentFilePath }))
      setWatching(false)
    } catch (e) {
      sayErr(`Couldn't read the pack file: ${String(e)}`)
    }
  }

  const importReply = async () => {
    try {
      setImportRaw(await invoke<string>("get_clipboard_text"))
    } catch (e) {
      sayErr(`Couldn't read the clipboard: ${String(e)}`)
    }
  }

  const close = (v: boolean) => {
    if (!v) {
      // Closing keeps nothing running; the file stays for a manual import, the
      // one route that reaches every file this dialog makes
      if (agentFilePath) {
        const shown = agentFilePath
        sayLong(`The agent's file stays. To bring it in later: Settings → Backup and import → Import… → From file…, then pick ${shown}`, {
          label: "Show file",
          onClick: () => void invoke("show_in_folder", { path: shown }).catch((e) => sayErr(`Couldn't open the folder: ${String(e)}`)),
        })
      }
      reset()
    }
    onOpenChange(v)
  }

  // An import ends the dialog with nothing left to point at
  const finish = () => {
    reset()
    onOpenChange(false)
  }

  const step2Done = importRaw !== null || imported
  const step3Done = imported

  return (
    <Dialog open={open} onOpenChange={close}>
      {/* Base DialogContent caps at sm:max-w-sm — lift it, this dialog is content-heavy */}
      <DialogContent className="flex max-h-[92vh] w-[min(42rem,94vw)] max-w-none flex-col overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-sm">Generate pack with AI</DialogTitle>
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
          className={fieldVariants()}
        />

        {path === "agent" && !topic.trim() && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Empty topic: the agent surveys the project it's running in — its docs, git log, build commands, and
            any slash commands or skills the project defines — and writes one pack named after the project, with a group per daily
            practice: orientation, development, debugging, verification, review, documentation, housekeeping.
          </p>
        )}

        {/* Path picker: the shared segmented control, as the theme toggle */}
        <div className={SEGMENT_TRACK} role="radiogroup" aria-label="How the AI receives the instruction">
          {(
            [
              ["chat", "Chat — copy & paste"],
              ["agent", "Coding agent — writes the file"],
            ] as const
          ).map(([p, label]) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={path === p}
              className={cn(segmentClass(path === p), "flex-1")}
              onClick={() => switchPath(p)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* What the AI will receive, rendered live */}
        <div className="module">
          <div className="mb-1 section-title">
            What the AI gets
          </div>
          <InstructionPreview segments={segments} />
        </div>

        {/* Stepper */}
        <div className="mt-1 flex flex-col">
          {path === "chat" ? (
            <>
              <Step n={1} title="Copy the instruction" done={copied} active={!copied}>
                <Button size="sm" className="mt-1.5" onClick={() => void copyChatPrompt()}>
                  {copied ? "Copy again" : "Copy prompt"}
                </Button>
              </Step>
              <Step n={2} title="Paste it into any AI chat, then copy its whole reply" done={step2Done} active={copied && !step2Done}>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  In claude.ai, ChatGPT, Gemini or any other chat: paste, wait for the JSON reply, copy it.
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
                    onImported={finish}
                  />
                )}
              </Step>
            </>
          ) : (
            <>
              <Step n={1} title="Create the pack file & copy instructions" done={copied} active={!copied}>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {existingPack
                    ? "Creates a scratch copy of this pack; the agent writes new prompts there and your pack changes only when you import."
                    : topic.trim()
                      ? "Creates a scratch file; the instruction contains its path so the agent writes it directly — no clipboard round-trip."
                      : "Creates a scratch file; the agent writes the project's pack into it and you review it on import."}
                </p>
                <Button size="sm" className="mt-1.5" onClick={() => void copyAgentInstructions()}>
                  {copied ? "Copy again" : "Create file & copy instructions"}
                </Button>
              </Step>
              <Step n={2} title="Paste to your agent — the file reloads by itself" done={step2Done} active={copied && !step2Done}>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The agent may ask before writing outside its project; the path in the instruction is the one to allow.
                </p>
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
                    this dialog and import the file later from Settings → Backup and import.
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
                    onImported={finish}
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
