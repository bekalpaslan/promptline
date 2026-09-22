import { createContext, useContext } from "react"
import type { OrderBy, PackMeta, Snippet, SnippetEdit } from "@/lib/core"

export { DEFAULT_PACK, MAX_PINS } from "@/lib/library"

export interface Prefs {
  theme: string // "light" | "dark" (legacy "sand"/"sundown" map to dark)
  density: string
  scale: string
  font: string // id into FONTS (lib/prefs.ts)
}

/** Extras a delete can carry so Undo brings back everything it removed. */
export interface DeleteOpts {
  /** A pack's metadata (lock flag) to restore with its prompts (set_pack_locked); its file is re-created */
  pack?: PackMeta
}

/** A pack, or a group in one, selected in the sidebar and shown in the pane */
export interface LibraryFocus {
  pack: string
  group?: string
}

/**
 * What the pane beside the sidebar shows: a prompt in the editor (or the
 * empty state when none is open), or the overview of a pack or group that
 * was selected in the sidebar. The sidebar itself never goes away.
 */
export type View = { kind: "prompt" } | { kind: "overview"; focus: LibraryFocus }

// Groups are labels on prompts, scoped to a pack; this is their identity key
export const groupKey = (pack: string, group: string) => `${pack}\u0000${group}`

/** Which surface draws a rename field: the sidebar's row or the overview's heading */
export type Surface = "sidebar" | "overview" | "editor"
/** A pack name (or a groupKey) open for typing, on one surface */
export interface Renaming {
  name: string
  surface: Surface
  /** Just created under a placeholder name: committing the field is what announces it */
  fresh?: boolean
}

export interface ManagerApi {
  snippets: Snippet[]
  packMeta: PackMeta[]
  activeId: string | null
  selection: Set<string>
  hotkey: string
  prefs: Prefs
  view: View
  /** Show a pack's or a group's prompts in the pane; the prompt selection clears */
  openOverview(focus: LibraryFocus): void
  /** How the sidebar and the overview order prompts; persisted in localStorage */
  orderBy: OrderBy
  setOrderBy(order: OrderBy): void
  isLocked(name: string): boolean
  packNames(extra?: string): string[]
  allTags(): string[]
  /**
   * Replace the snippet list and persist it (save_snippets). Refused if the
   * library changed on disk since it was loaded (the popup wrote): the
   * manager then reloads, shows an error, and rejects — the caller's change
   * was not applied and must be redone. Pass an updater from any closure
   * that outlives its render (menu actions, Undo callbacks): it is applied
   * to the latest library, so edits made in between are not reverted.
   */
  persist(next: Snippet[] | ((current: Snippet[]) => Snippet[])): Promise<void>
  /** Save one prompt's editable fields by id, merged on disk (update_snippet). */
  updateSnippet(id: string, edit: SnippetEdit): Promise<void>
  /**
   * Pack metadata is written by intent, never as a list (a stale list
   * retired and re-created pack files): each of these is one read-modify-
   * write in Rust that answers with the registry, which replaces `packMeta`.
   */
  /** Lock or unlock a pack (set_pack_locked); a pack that is only a name on prompts gets metadata */
  setPackLocked(name: string, locked: boolean): Promise<void>
  /** Delete a pack: its prompts first, with Undo, then its metadata (delete_pack retires the file) */
  deletePack(name: string): Promise<void>
  /** Give a pack without a file one (add_pack_file), filled from the library; resolves with the path */
  addPackFile(name: string): Promise<string>
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
  /**
   * Create a draft prompt and open it; `into` overrides the default
   * pack/group, and that pack (and group) is unfolded in the sidebar so the
   * draft is in view wherever it was asked for.
   */
  newPrompt(into?: { pack: string; group?: string }): Promise<void>
  /**
   * The sidebar's folds: pack names and groupKeys that are closed. Owned
   * here so a rename from any surface carries them (`renamePack` does; the
   * menus' renameGroup calls `carryGroupFold`) and `newPrompt` can unfold.
   */
  folds: { packs: ReadonlySet<string>; groups: ReadonlySet<string> }
  togglePackFold(name: string): void
  toggleGroupFold(key: string): void
  foldAll(fold: boolean): void
  carryGroupFold(pack: string, from: string, to: string): void
  /**
   * The pack, or the group (a groupKey), whose name is open for typing,
   * and on which surface: the sidebar row and the overview heading share
   * one state so a New → Pack begun anywhere opens its name in the
   * overview it lands in.
   */
  renaming: Renaming | null
  setRenaming(next: Renaming | null): void
  renamingGroup: Renaming | null
  setRenamingGroup(next: Renaming | null): void
  /** Create a pack with its file (add_pack); `quiet` skips the "created" toast (the caller announces it later) */
  addPack(name: string, opts?: { quiet?: boolean }): Promise<void>
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
