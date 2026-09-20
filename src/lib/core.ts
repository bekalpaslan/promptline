// Bridge to the shared UMD core (ui/core.js) — pure logic used by the legacy
// UI, the node:test suite, and this React app. Importing the file registers
// window.PromptlineCore as a side effect; this module re-exports it typed.
import "../../ui/core.js"

export interface Snippet {
  id: string
  title: string
  text: string
  tags: string[]
  pack: string
  /** Group within the pack; empty = ungrouped */
  group: string
  uses: number
  pinned: boolean
  /** When this prompt was pinned (ms since epoch); 0 = not pinned, or a legacy pin */
  pinnedAt: number
  fieldValues: Record<string, string>
  configValues: Record<string, string>
}

/** What every snippet command returns: the library and the revision it was read at */
export interface Library {
  snippets: Snippet[]
  revision: number
}

/** The fields the manager's editor owns; see `SnippetEdit` in lib.rs */
export type SnippetEdit = Pick<Snippet, "title" | "text" | "tags" | "pack" | "group" | "configValues">

/** What the popup changes; see `SnippetPatch` in lib.rs */
export type SnippetPatch = Partial<Pick<Snippet, "pinned" | "fieldValues">>

/** A refused write, typed; see `StoreError` in lib.rs */
export type StoreError = { kind: "stale"; revision: number } | { kind: "failed"; message: string }

export const isStoreError = (e: unknown): e is StoreError =>
  typeof e === "object" && e !== null && "kind" in e

export type TokenPart =
  | { type: "text"; value: string }
  | { type: "builtin" | "field" | "config" | "bad"; name: string; raw: string }

export interface PackMeta {
  name: string
  locked: boolean
  path?: string
}

export interface ParsedQuery {
  text: string
  tags: string[]
  packs: string[]
  groups: string[]
}

/** The manager's list order: pins first by use or title, or the array order itself */
export type OrderBy = "uses" | "title" | "custom"

/** One pack of the library tree: its ungrouped run, then its groups in first-appearance order */
export interface PackNode<T> {
  name: string
  /** Every prompt in the pack, grouped or not */
  count: number
  ungrouped: T[]
  groups: { name: string; items: T[] }[]
}

/** A removed item and the index it sat at, for Undo */
export interface Removed<T> {
  item: T
  index: number
}

export interface FuzzyResult {
  score: number
  indices: number[]
}

/** A prompt as it appears in a pack file, after parsing */
export interface ParsedPrompt {
  title: string
  text: string
  tags: string[]
  group: string
}

export interface ParsedPack {
  name: string
  prompts: ParsedPrompt[]
}

/** Result of `diagnosePack`: a discriminated union, so `packs` needs no `!` */
export type PackDiagnosis =
  | { ok: true; packs: ParsedPack[] }
  | { ok: false; code: "empty" | "not-json" | "malformed" | "wrong-shape"; message: string }

interface PromptlineCore {
  tokenize(text: string): TokenPart[]
  customFields(text: string): string[]
  configNames(text: string): string[]
  expandConfig(text: string, values?: Record<string, string>): string
  downgradeUnsetConfig(text: string): string
  requiredInputs(snippet: Pick<Snippet, "text" | "configValues">): string[]
  /** Substitute runtime {field} values literally (safe for `$` patterns) */
  fillFields(text: string, values: Record<string, string>): string
  expandBuiltins(text: string): string
  fuzzyScore(query: string, target: string): FuzzyResult | null
  /** How well a prompt body answers a query: contiguous, or every word a word-prefix. Lower is better; null is no match. */
  bodyScore(query: string, text: string): { score: number } | null
  /** An untouched "+ New" draft: the manager's to finish, never the popup's to paste */
  isEmptyDraft(snippet: Pick<Snippet, "title" | "text" | "uses">): boolean
  /** The popup's list order: filters, then pins/uses or title>tag>body fuzzy tiers */
  rankSnippets(query: string, snippets: Snippet[]): { s: Snippet; indices: number[] | null }[]
  /** Title split into code-point runs marked hit/miss from UTF-16 match indices */
  highlightSegments(title: string, indices: number[] | null): { text: string; hit: boolean }[]
  parseQuery(raw: string): ParsedQuery
  /** `@name`, or `@"two words"` when the name has whitespace */
  filterTerm(prefix: "#" | "@" | ">", name: string): string
  matchesFilters(snippet: Pick<Snippet, "tags" | "pack" | "group">, query: Pick<ParsedQuery, "tags" | "packs" | "groups">): boolean
  TAG_COLORS: Record<string, string>
  tagColor(tag: string): string
  stripFences(raw: string): string
  /** Throws on garbage; prefer `diagnosePack` for user-facing errors */
  parsePacks(raw: string): ParsedPack[]
  diagnosePack(raw: string): PackDiagnosis
  /** Where a new prompt goes: last used → default → first unlocked → "Unsorted" */
  defaultPackFor(lastPack: string | null, names: string[], isLocked: (name: string) => boolean, defaultPack: string): string
  /** Whether pinning `ids` fits under `max`, counting only newly pinned rows */
  pinPlan(snippets: Pick<Snippet, "id" | "pinned">[], ids: Iterable<string>, max: number): { ok: boolean; already: number; toPin: number; room: number }
  /** Pin or unpin one snippet, stamping the pin order that Ctrl+1..5 follows */
  withPin<T extends Pick<Snippet, "pinned" | "pinnedAt">>(snippet: T, pinned: boolean, now?: number): T
  /** Shareable pack JSON; group only when set, never personal state */
  packToJson(name: string, prompts: Pick<Snippet, "title" | "text" | "tags" | "group">[]): { name: string; prompts: { title: string; text: string; tags: string[]; group?: string }[] }
  removeByIds<T extends { id: string }>(list: T[], ids: Iterable<string>): { kept: T[]; removed: Removed<T>[] }
  restoreRemoved<T extends { id: string }>(list: T[], removed: Removed<T>[]): T[]
  /** A copy of `list` in the manager's order; "custom" keeps the array order */
  sortPrompts<T extends Pick<Snippet, "title" | "uses" | "pinned">>(list: T[], orderBy: string): T[]
  /** Packs by name (every name in `packNames`, even empty) with their groups and prompts, in the given row order */
  packTree<T extends Pick<Snippet, "pack" | "group">>(snippets: T[], packNames: string[], defaultPack: string): PackNode<T>[]
  /** What a preview shows for {clipboard}: one line, cut at `max` (240), or "(clipboard is empty)" */
  clipboardPreview(clip: string | null | undefined, max?: number): string
  /** What a paste would produce, minus the fill-in form: config and built-ins expanded, the clipboard substituted, {field}s kept */
  expandForCopy(text: string, configValues: Record<string, string>, clip: string | null | undefined): string
  fmtHotkey(combo: string): string
}

export const C = (window as unknown as { PromptlineCore: PromptlineCore }).PromptlineCore
