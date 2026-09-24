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
export type SnippetPatch = Partial<Pick<Snippet, "pinned">>

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

/** The sidebar's closed packs (names) and groups (groupKeys) */
export interface Folds {
  packs: ReadonlySet<string>
  groups: ReadonlySet<string>
}

/**
 * One row of the sidebar's tree as drawn. `key` is what the roving focus
 * remembers and what the row's data-key carries; `parent` is the key Left
 * moves to.
 */
export type TreeRow =
  | { key: string; kind: "pack"; name: string; count: number; level: 1; expanded: boolean; hasChildren: boolean; parent?: undefined }
  | { key: string; kind: "group"; pack: string; group: string; count: number; level: 2; expanded: boolean; hasChildren: boolean; parent: string }
  | { key: string; kind: "prompt"; id: string; level: 1 | 2 | 3; parent?: string }

/** Characters of one kind that render as nothing or reorder what is shown, and how many */
export interface HiddenFound {
  kind: "tag" | "bidi" | "control" | "invisible"
  count: number
}

/** One prompt of an import under review: where it goes, whether the library has it, what it hides, whether it is ticked */
export interface ImportRow extends ParsedPrompt {
  packName: string
  dupe: boolean
  hidden: HiddenFound[]
  include: boolean
}

/** The modifier flags and key of a keydown, as the hotkey recorder reads them */
export type HotkeyEvent = Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "key">

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

// Hand-written against ui/core.js. tests/interface.test.js parses the member
// names out of this block and checks them against the module's exports, so
// a renamed or added export fails `npm test` instead of both windows at
// runtime; the signatures themselves are still by hand (audit M14). Keep one
// member per line, name first.
interface PromptlineCore {
  /** The built-in placeholder names: clipboard, date, time */
  RESERVED: readonly string[]
  /** Lowercase letters, digits and `_`, never starting with a digit */
  isValidParam(name: string): boolean
  tokenize(text: string): TokenPart[]
  customFields(text: string): string[]
  /** Another copy of a field with its own value: the next free `<stem>_<n>`, from 2 */
  nextCopyName(name: string, text: string): string
  dropNumberedCopies(names: Iterable<string>): string[]
  removeParamToken(text: string, name: string): string
  configNames(text: string): string[]
  expandConfig(text: string, values?: Record<string, string>): string
  downgradeUnsetConfig(text: string): string
  requiredInputs(snippet: Pick<Snippet, "text" | "configValues">): string[]
  /** Substitute runtime {field} values literally (safe for `$` patterns) */
  fillFields(text: string, values?: Record<string, string>): string
  /** {date} and {time} from `now` (the clock when omitted) */
  expandBuiltins(text: string, now?: Date): string
  fuzzyScore(query: string, target: string): FuzzyResult | null
  /** How well a prompt body answers a query: contiguous, or every word a word-prefix. Lower is better; null is no match. */
  bodyScore(query: string, text: string): { score: number } | null
  /** The title "+ New" gives a draft; with an empty body and no uses it is swept at startup */
  DRAFT_TITLE: "New prompt"
  /** An untouched "+ New" draft: the manager's to finish, never the popup's to paste */
  isEmptyDraft(snippet: Pick<Snippet, "title" | "text" | "uses">): boolean
  /** The popup's list order: filters, then pins/uses or title>tag>body fuzzy tiers */
  rankSnippets(query: string, snippets: Snippet[]): { s: Snippet; indices: number[] | null }[]
  /** The Ctrl+1..5 slots: the first `max` (5) ranked entries that are on screen; drafts never */
  slotEntries<E extends { s: Pick<Snippet, "id" | "title" | "text" | "uses"> }>(ranked: E[], visibleIds: Iterable<string>, max?: number): E[]
  /** Title split into code-point runs marked hit/miss from UTF-16 match indices */
  highlightSegments(title: string, indices: number[] | null): { text: string; hit: boolean }[]
  parseQuery(raw: string): ParsedQuery
  /** `@name`, or `@"two words"` when the name has whitespace */
  filterTerm(prefix: "#" | "@" | ">", name: string): string
  matchesFilters(snippet: Pick<Snippet, "tags" | "pack" | "group">, query: Pick<ParsedQuery, "tags" | "packs" | "groups">): boolean
  /** The sidebar filter: filter terms, then every free-text word in title, tags, pack, group or body */
  matchesQuery(snippet: Pick<Snippet, "title" | "text" | "tags" | "pack" | "group">, query: ParsedQuery): boolean
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
  /** Pack names A–Z, or in the `arranged` order (the registry's) with any other after it A–Z */
  orderPacks(names: string[], arranged: string[] | null): string[]
  /** `order` with `name` moved before `target`, or after it when `after` */
  movePack(order: string[], name: string, target: string, after: boolean): string[]
  /** `list` (in display order) with `group` swapped past its neighbour in `pack`; null at the edge */
  moveGroup<T extends Pick<Snippet, "pack" | "group">>(list: T[], pack: string, group: string, dir: -1 | 1, defaultPack: string): T[] | null
  /** Packs in `packNames` order (every one, even empty; others after by name) with their groups and prompts, in the given row order */
  packTree<T extends Pick<Snippet, "pack" | "group">>(snippets: T[], packNames: string[], defaultPack: string): PackNode<T>[]
  /** A group's identity: its pack and its label */
  groupKey(pack: string, group: string): string
  /** The library in the order the sidebar draws it (sorted, by pack when grouped); "custom" is the array itself */
  displayOrder<T extends Pick<Snippet, "title" | "uses" | "pinned" | "pack" | "group">>(snippets: T[], orderBy: OrderBy, grouped: boolean, packNames: string[], defaultPack: string): T[]
  /** Every row of the grouped sidebar in order, folds applied (a search holds them all open) */
  treeRows(tree: PackNode<Pick<Snippet, "id">>[], folds: Folds, searching: boolean): TreeRow[]
  /** `base`, then `base 2`, `base 3`, … : the first not in `taken`, case-insensitively */
  freeName(base: string, taken: string[]): string
  /** The groups in a pack, each once, A–Z */
  groupsIn(snippets: Pick<Snippet, "pack" | "group">[], pack: string, defaultPack: string): string[]
  /** Every tag in the library, most used first */
  tagsByCount(snippets: Pick<Snippet, "tags">[]): string[]
  /** An import's review rows: a prompt the library already has (same title and text) is a dupe, unticked; one with hidden characters starts unticked too */
  importRows(packs: ParsedPack[], library: Pick<Snippet, "title" | "text">[]): ImportRow[]
  /** The ticked rows as prompts to add, renamed into `targetName` when given, minus those bound for a locked pack */
  curateImport(rows: ImportRow[], isLocked: (pack: string) => boolean, targetName?: string): { prompts: Pick<Snippet, "title" | "text" | "tags" | "pack" | "group">[]; skippedLocked: number }
  /** Tag characters, bidi controls, control characters and invisibles in `text`, by kind; [] when there are none */
  hiddenChars(text: string | null | undefined): HiddenFound[]
  /** "14 tag characters and 2 direction controls" */
  describeHidden(found: HiddenFound[]): string
  /** A keydown's key in the hotkey vocabulary (" " is "space"), or null for one the parser has no name for */
  hotkeyKeyName(key: string | undefined): string | null
  /** The combination a keydown stands for ("ctrl+shift+v"), or null: no key, a modifier alone, no modifier, or an unnameable key */
  hotkeyFromEvent(e: HotkeyEvent): string | null
  /** What a preview shows for {clipboard}: one line, cut at `max` (240), or "(clipboard is empty)" */
  clipboardPreview(clip: string | null | undefined, max?: number): string
  /** What a paste would produce, minus the fill-in form: config and built-ins expanded, the clipboard substituted, {field}s kept */
  expandForCopy(text: string, configValues: Record<string, string>, clip: string | null | undefined, now?: Date): string
  /** Ctrl+N's pre-filled title: the first line, cut at a word boundary within `max` (40); "" when empty */
  titleFromClipboard(text: string | null | undefined, max?: number): string
  /** A tag as stored: lowercase, nothing outside [a-z0-9_-] */
  normalizeTag(raw: string): string
  /** "1 prompt", "2 prompts"; pass the plural for an irregular word */
  plural(n: number, word: string, pluralWord?: string): string
  resolveTheme(pref: string | null | undefined, systemDark: boolean): "light" | "dark"
  fmtHotkey(combo: string): string
}

export const C = (window as unknown as { PromptlineCore: PromptlineCore }).PromptlineCore
