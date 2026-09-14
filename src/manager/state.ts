import { createContext, useContext } from "react"
import type { PackMeta, Snippet, SnippetEdit } from "@/lib/core"

export { DEFAULT_PACK, MAX_PINS } from "@/lib/library"

export interface Prefs {
  theme: string // "light" | "dark" (legacy "sand"/"sundown" map to dark)
  density: string
  scale: string
  font: string // id into FONTS (lib/prefs.ts)
}

/** Extras a delete can carry so Undo brings back everything it removed. */
export interface DeleteOpts {
  /** A pack's metadata (lock flag) to restore with its prompts; its file is re-created */
  pack?: PackMeta
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
  /** Rename a pack on its metadata and every prompt, atomically in Rust (rename_pack). */
  renamePack(from: string, to: string): Promise<void>
  /**
   * Remove prompts and offer Undo in the status bar. Both the delete and the
   * restore read the *latest* library, never a render's snapshot, so Undo
   * can't duplicate what it puts back. Clears selection/active if they were
   * among the removed. Resolves with the number removed.
   */
  deleteWithUndo(ids: Iterable<string>, label: string, opts?: DeleteOpts): Promise<number>
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
  /**
   * Where the editor parks its pending autosave so a quit request can
   * flush it: set while a save is scheduled, cleared when it lands.
   */
  pendingFlush: { current: (() => Promise<void>) | null }
}

export const ManagerCtx = createContext<ManagerApi | null>(null)
export const useManager = (): ManagerApi => {
  const api = useContext(ManagerCtx)
  if (!api) throw new Error("useManager must be used inside <ManagerCtx.Provider>")
  return api
}
