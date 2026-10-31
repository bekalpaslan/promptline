// What the Generate dialog hands an AI, as text: the schema and rules a
// pack must follow, the chat instruction (copied, pasted, the reply copied
// back) and the agent instruction (written straight into a pack file).
// Pure builders over strings; GenerateDialog.tsx renders the segments and
// puts the text on the clipboard.

// Shared schema/rules for both generation modes (clipboard reply, agent-written
// file). The count and the "group" meaning are the two rules a project survey
// changes, so they are parameters here rather than contradicted further down.
type RuleOptions = { count?: string; group?: string }
export function packInstructionRules(tags: string, opts: RuleOptions = {}) {
  const count = opts.count ?? "5 to 15 prompts, each genuinely reusable (no one-off prompts)."
  const group = opts.group ?? "Optional group within the pack, e.g. a practice or area — omit for ungrouped"
  return `The pack is a JSON object following exactly this schema:

{
  "name": "Short pack name",
  "prompts": [
    {
      "title": "Short imperative name, unique within the pack (max ~40 chars)",
      "tags": ["one", "to", "three lowercase tags"],
      "group": "${group}",
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
- ${count}
- Cover distinct moments of the workflow (starting, diagnosing, deciding, reviewing, wrapping up). No two prompts should ask for nearly the same thing.
- Titles must be unique.
- Reuse these existing tags where they fit, adding new ones only when needed: ${tags}
- Valid JSON: newlines inside "text" as \\n, no trailing commas, no comments.`
}

export type Segment = string | { chip: string; kind: "topic" | "path" }

export function chatInstruction(rules: string, topic: string): Segment[] {
  return [
    `You are generating a prompt pack for Promptline (a prompt-paste tool). Output ONLY the JSON object — no prose, no code fences.\n\n${rules}\n\nGenerate a pack for: `,
    { chip: topic || "(describe a topic above)", kind: "topic" },
  ]
}

// Where the agent should look before writing anything — shared by both agent variants
const SURVEY = `Before writing anything, survey the project this session runs in: its agent instructions (CLAUDE.md, AGENTS.md or similar) and other contributor docs, roadmap or backlog files, recent git log, the test and build commands, and any slash commands or skills the project defines. Name real files, commands, and conventions from this project rather than generic ones. Where a workflow command already exists, write the prompt that wraps it with the context the user would otherwise type by hand.`

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

// Both agent prompts share one skeleton: opening, file path, rules, survey,
// scope, closing. Only the scope (a topic, or one group per practice) and the
// two parameterized rules differ, so the two read as one instruction.
export function agentInstruction(tags: string, topic: string, filePath: string): Segment[] {
  const survey = !topic
  const rules = packInstructionRules(
    tags,
    survey
      ? {
          count: "15 to 30 prompts in total, 3 to 6 per group, each genuinely reusable (no one-off prompts).",
          group: "The practice this prompt belongs to, by its one-word name",
        }
      : {}
  )
  const opening = survey
    ? "You are creating a prompt pack for Promptline (a prompt-paste tool): the prompts a developer of THIS project asks over and over."
    : "You are creating a prompt pack for Promptline (a prompt-paste tool)."
  const scope: Segment[] = survey
    ? [
        `Name the pack after the project. Set each prompt's "group" to its practice, `,
        { chip: "one group per practice", kind: "topic" },
        `:\n${PRACTICES.map((p) => `- ${p}`).join("\n")}\n\nSkip a practice you have nothing project-specific to say about.`,
      ]
    : [`Generate the pack for: `, { chip: topic, kind: "topic" }, `\n\nKeep "name" exactly as it is in the file.`]
  return [
    `${opening} Write it as a single JSON pack object directly into this file, replacing its contents:\n\n`,
    { chip: filePath || "(created at step 1)", kind: "path" },
    `\n\n${rules}\n\n${SURVEY}\n\n`,
    ...scope,
    `\n\nWrite the file once, when every prompt is done, then re-read it and confirm it parses as JSON. Do not print the JSON anywhere else.`,
  ]
}

export const segmentsToText = (segs: Segment[]) =>
  segs.map((s) => (typeof s === "string" ? s : s.chip)).join("")
