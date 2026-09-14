import { createContext, useContext } from "react"
import type { PackMeta, Snippet, SnippetEdit } from "@/lib/core"

export const DEFAULT_PACK = "My prompts"
export const MAX_PINS = 5

export interface Prefs {
  theme: string // "light" | "dark" (legacy "sand"/"sundown" map to dark)
  density: string
  scale: string
  font: string // id into FONTS (lib/prefs.ts)
}

export interface ManagerApi {
  snippets: Snippet[]
  packMeta: PackMeta[]
  activeId: string | null
  selection: Set<string>
  hotkey: string
  prefs: Prefs
  isLocked(name: string): boolean
  packNames(extra?: string): string[]
  allTags(): string[]
  /**
   * Replace the snippet list and persist it (save_snippets). Refused if the
   * library changed on disk since it was loaded (the popup wrote): the
   * manager then reloads, shows an error, and rejects — the caller's change
   * was not applied and must be redone.
   */
  persist(next: Snippet[]): Promise<void>
  /** Save one prompt's editable fields by id, merged on disk (update_snippet). */
  updateSnippet(id: string, edit: SnippetEdit): Promise<void>
  /** Replace pack metadata and persist it (save_packs). */
  persistPacks(next: PackMeta[]): Promise<void>
  /**
   * Remove prompts and offer Undo in the status bar. Both the delete and the
   * restore read the *latest* library, never a render's snapshot, so Undo
   * can't duplicate what it puts back. Clears selection/active if they were
   * among the removed. Resolves with the number removed.
   */
  deleteWithUndo(ids: Iterable<string>, label: string): Promise<number>
  select(id: string | null): void
  setSelection(sel: Set<string>, anchor?: string | null): void
  selectionAnchor: string | null
  /** Create a draft prompt and open it; `into` overrides the default pack/group. */
  newPrompt(into?: { pack: string; group?: string }): Promise<void>
  addPack(name: string): Promise<void>
  savePrefs(next: Partial<Prefs>): Promise<void>
  setHotkey(hotkey: string): void
  openGenerate(): void
  settingsOpen: boolean
  showSettings(open: boolean): void
}

export const ManagerCtx = createContext<ManagerApi>(null!)
export const useManager = () => useContext(ManagerCtx)
