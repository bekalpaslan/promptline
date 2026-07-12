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
  uses: number
  pinned: boolean
  fieldValues: Record<string, string>
  configValues: Record<string, string>
}

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
}

export interface FuzzyResult {
  score: number
  indices: number[]
}

export interface PackDiagnosis {
  ok: boolean
  message?: string
  packs?: { name: string; prompts: { title: string; text: string; tags: string[] }[] }[]
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
  fmtHotkey(combo: string): string
}

export const C = (window as unknown as { PromptlineCore: PromptlineCore }).PromptlineCore
