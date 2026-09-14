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

/** A removed item and the index it sat at, for Undo */
export interface Removed<T> {
  item: T
  index: number
}

export interface FuzzyResult {
  score: number
  indices: number[]
}

export interface PackDiagnosis {
  ok: boolean
  message?: string
  packs?: { name: string; prompts: { title: string; text: string; tags: string[]; group: string }[] }[]
}

interface PromptlineCore {
  tokenize(text: string): TokenPart[]
  customFields(text: string): string[]
  configNames(text: string): string[]
  expandConfig(text: string, values?: Record<string, string>): string
  downgradeUnsetConfig(text: string): string
  requiredInputs(snippet: Pick<Snippet, "text" | "configValues">): string[]
  expandBuiltins(text: string): string
  fuzzyScore(query: string, target: string): FuzzyResult | null
  parseQuery(raw: string): ParsedQuery
  matchesFilters(snippet: Snippet, query: ParsedQuery): boolean
  TAG_COLORS: string[]
  tagColor(tag: string): string
  stripFences(raw: string): string
  parsePacks(raw: string): unknown
  diagnosePack(raw: string): PackDiagnosis
  removeByIds<T extends { id: string }>(list: T[], ids: Iterable<string>): { kept: T[]; removed: Removed<T>[] }
  restoreRemoved<T extends { id: string }>(list: T[], removed: Removed<T>[]): T[]
  fmtHotkey(combo: string): string
}

export const C = (window as unknown as { PromptlineCore: PromptlineCore }).PromptlineCore
