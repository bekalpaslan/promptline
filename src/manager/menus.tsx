import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { C, type Snippet } from "@/lib/core"
import { DEFAULT_PACK, MAX_PINS, useManager } from "./state"
import { useCtxMenu, type CtxItem } from "./ctx-menu"
import { say, sayErr, sayUndo } from "./status"

// Groups are labels on prompts, scoped to a pack; this is their identity key
export const groupKey = (pack: string, group: string) => `${pack}\u0000${group}`

/**
 * The three-dot and right-click menus on packs, groups and prompts, with
 * the inline-rename state they drive and the delete-group dialog. One hook
 * for the sidebar and the library view, so the two surfaces offer the same
 * actions and can't drift. The surface renders `element` once and draws
 * the rename inputs from `renaming` / `renamingGroup`.
 */
export function useLibraryMenus(opts: {
  /** Before a "New group…" creates its first prompt: the sidebar unfolds the pack */
  onNewGroup?: (pack: string) => void
  /** Keyboard reorder, where the surface has rows to move between */
  moveRow?: (id: string, dir: -1 | 1) => void
} = {}) {
  const m = useManager()
  const ctx = useCtxMenu()
  const { moveRow } = opts
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null) // a groupKey
  const [deleteGroupAsk, setDeleteGroupAsk] = useState<{ pack: string; group: string; count: number } | null>(null)

  // ---- Pack operations ----
  // One Rust step: metadata and prompts together, or the reconciler in
  // between conjures a second pack under one of the two names
  const renamePack = async (name: string, next: string) => {
    setRenaming(null)
    if (!next || next === name) return
    if (m.packNames().includes(next)) {
      sayErr(`Pack "${next}" already exists`)
      return
    }
    await m.renamePack(name, next).then(() => say(`Renamed to "${next}"`), () => {})
  }

  const packToJson = (name: string) =>
    C.packToJson(name, m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name))

  // ---- Group operations: a group is a label, so these rewrite the prompts that carry it ----
  const renameGroup = async (pack: string, group: string, next: string) => {
    setRenamingGroup(null)
    if (!next || next === group) return
    const merging = m.snippets.some((s) => (s.pack || DEFAULT_PACK) === pack && s.group === next)
    const ids = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === pack && s.group === group).map((s) => s.id)
    await m.persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, group: next } : s)))
    if (merging) {
      // Merging is deliberate (BEHAVIOR.md) but the two groups can't be
      // told apart afterwards, so offer to split them again
      sayUndo(`Merged "${group}" into "${next}"`, () => {
        void m.persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, group } : s))).then(() => say("Restored"))
      })
    } else say(`Renamed to "${next}"`)
  }

  const deleteGroup = async (pack: string, group: string) => {
    setDeleteGroupAsk(null)
    const ids = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === pack && s.group === group).map((s) => s.id)
    await m.deleteWithUndo(ids, `Deleted group "${group}" (${ids.length} prompts)`)
  }

  const openGroupCtx = (x: number, y: number, pack: string, group: string, count: number) => {
    // A group has no lock of its own, but deleting it deletes prompts, so it
    // honours the pack's lock like "Delete pack…" does
    const locked = m.isLocked(pack)
    ctx.open(x, y, [
      { kind: "header", text: `${pack} › ${group}` },
      { kind: "item", label: "Rename group", run: () => setRenamingGroup(groupKey(pack, group)) },
      {
        kind: "item",
        label: "Ungroup prompts",
        run: () => {
          // A label is cheap to put back: remember which prompts carried it
          const ids = m.snippets
            .filter((s) => (s.pack || DEFAULT_PACK) === pack && s.group === group)
            .map((s) => s.id)
          void m
            .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, group: "" } : s)))
            .then(() =>
              sayUndo(`Ungrouped ${count} prompt${count === 1 ? "" : "s"} from "${group}"`, () => {
                void m
                  .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, group } : s)))
                  .then(() => say("Restored"))
              })
            )
        },
      },
      { kind: "sep" },
      {
        kind: "item",
        label: locked ? "Delete (locked)" : "Delete group…",
        danger: true,
        disabled: locked,
        hint: locked ? "Unlock the pack first (its header menu → Unlock)" : undefined,
        run: () => setDeleteGroupAsk({ pack, group, count }),
      },
    ])
  }

  // Undo restores the prompts and the pack's metadata (its lock flag); the
  // file was retired to packs/deleted/ and a fresh one is made
  const deletePack = async (name: string) => {
    const ids = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name).map((s) => s.id)
    const pack = m.packMeta.find((p) => p.name === name) ?? { name, locked: false }
    // Prompts first: while any prompt still names the pack, the reconciler
    // would put its metadata straight back
    await m.deleteWithUndo(ids, `Deleted pack "${name}" (${ids.length} prompt${ids.length === 1 ? "" : "s"})`, { pack })
    await m.persistPacks(m.packMeta.filter((p) => p.name !== name))
  }

  // File actions for file-backed packs; non-backed packs get an upgrade action
  const packFileItems = (name: string): CtxItem[] => {
    const meta = m.packMeta.find((p) => p.name === name)
    if (!meta?.path) {
      return [
        {
          kind: "item",
          label: "Give this pack a file…",
          run: () => {
            void (async () => {
              try {
                const path = await invoke<string>("create_pack_file", { name })
                const next = meta
                  ? m.packMeta.map((p) => (p.name === name ? { ...p, path } : p))
                  : [...m.packMeta, { name, locked: false, path }]
                await m.persistPacks(next)
                await m.persist([...m.snippets]) // triggers the sync that fills the fresh file
                say(`"${name}" now has a file`)
              } catch (e) {
                sayErr(`Couldn't create a file for "${name}": ${e}`)
              }
            })()
          },
        },
      ]
    }
    return [
      {
        kind: "item",
        label: "Copy file path",
        run: () => {
          void invoke("set_clipboard_text", { text: meta.path }).then(() => say("Path copied"))
        },
      },
      { kind: "item", label: "Show in folder", run: () => void invoke("show_in_folder", { path: meta.path }) },
    ]
  }

  const openPackCtx = (x: number, y: number, name: string, count: number) => {
    const locked = m.isLocked(name)
    ctx.open(x, y, [
      { kind: "header", text: name },
      { kind: "item", label: "Rename", run: () => setRenaming(name) },
      {
        kind: "item",
        label: locked ? "Unlock" : "Lock",
        run: () => {
          const existing = m.packMeta.find((p) => p.name === name)
          const next = existing
            ? m.packMeta.map((p) => (p.name === name ? { ...p, locked: !p.locked } : p))
            : [...m.packMeta, { name, locked: true }]
          void m.persistPacks(next).then(() => say(locked ? `Pack "${name}" unlocked` : `Pack "${name}" locked`))
        },
      },
      {
        kind: "item",
        label: "Export pack",
        run: () => {
          void invoke("set_clipboard_text", { text: JSON.stringify(packToJson(name), null, 2) }).then(() =>
            say(`Pack "${name}" copied to clipboard`)
          )
        },
      },
      ...packFileItems(name),
      { kind: "sep" },
      {
        // A group is a label, so it starts life on a prompt: this creates a
        // draft in the group and opens it in the editor
        kind: "item",
        label: locked ? "New group (locked)" : "New group…",
        disabled: locked,
        hint: locked ? "Unlock the pack first (this menu → Unlock)" : undefined,
        run: () => {
          ctx.open(x, y, [
            { kind: "header", text: `New group in ${name}` },
            {
              kind: "input",
              placeholder: "Group name — Enter creates a first prompt in it",
              onSubmit: (g) => {
                if (!g) return
                opts.onNewGroup?.(name)
                void m.newPrompt({ pack: name, group: g })
              },
            },
          ])
          return "keep"
        },
      },
      {
        kind: "item",
        label: locked ? "Delete (locked)" : "Delete pack…",
        danger: true,
        disabled: locked,
        hint: locked ? "Unlock the pack first (this menu → Unlock)" : undefined,
        confirm: count ? `Really delete ${count} prompts?` : "Really delete pack?",
        run: () => void deletePack(name),
      },
      { kind: "sep" },
      {
        kind: "item",
        label: "New pack…",
        run: () => {
          ctx.open(x, y, [
            { kind: "header", text: "New pack" },
            { kind: "input", placeholder: "Pack name — Enter to create", onSubmit: (n) => void m.addPack(n) },
          ])
          return "keep"
        },
      },
    ])
  }

  // ---- Multi-select context menu ----
  // Takes the target ids explicitly: the caller may have just replaced the
  // selection, and reading m.selection here would still see the old one
  // (stale render) — showing the previous prompt's menu.
  const openRowCtx = (x: number, y: number, idSet: Set<string>) => {
    const ids = [...idSet]
    const n = ids.length
    // Unpin when everything selected is pinned; otherwise pin the rest
    const selected = m.snippets.filter((s) => ids.includes(s.id))
    const allPinned = selected.length > 0 && selected.every((s) => s.pinned)
    const items: CtxItem[] = [
      {
        kind: "header",
        text: n === 1 ? m.snippets.find((s) => s.id === ids[0])?.title || "1 prompt" : `${n} prompts`,
      },
      // The keyboard's drag: one row at a time, where the surface has rows
      ...(n === 1 && moveRow
        ? ([
            { kind: "item", label: "Move up", hint: "Alt+Up on the row", run: () => moveRow(ids[0], -1) },
            { kind: "item", label: "Move down", hint: "Alt+Down on the row", run: () => moveRow(ids[0], 1) },
          ] as CtxItem[])
        : []),
      {
        kind: "item",
        label: allPinned ? (n === 1 ? "Unpin" : `Unpin ${n}`) : n === 1 ? "Pin" : `Pin ${n}`,
        run: () => {
          if (allPinned) {
            void m
              .persist(m.snippets.map((s) => (ids.includes(s.id) ? C.withPin(s, false) : s)))
              .then(() => say(n === 1 ? "Unpinned" : `Unpinned ${n}`))
            return
          }
          // Rows in the selection that are already pinned take no new slot
          const plan = C.pinPlan(m.snippets, ids, MAX_PINS)
          if (!plan.ok) {
            sayErr(
              `Max ${MAX_PINS} pins — ${plan.already} already pinned, so you can pin ${plan.room === 0 ? "no" : plan.room} more`
            )
            return
          }
          void m
            .persist(m.snippets.map((s) => (ids.includes(s.id) ? C.withPin(s, true) : s)))
            .then(() => say(plan.toPin === 1 ? "Pinned" : `Pinned ${plan.toPin}`))
        },
      },
      { kind: "header", text: "Move to" },
    ]
    // One submenu per pack: hovering lists its groups (a group lives in a
    // pack, so moving into one moves across packs too); clicking the pack
    // itself moves there ungrouped
    const homePack = selected[0]?.pack || DEFAULT_PACK
    const groupsOf = (pk: string) =>
      [...new Set(m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === pk && s.group).map((s) => s.group))].sort(
        (a, b) => a.localeCompare(b)
      )
    const moveTo = (pk: string, g: string) =>
      void m
        .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, pack: pk, group: g } : s)))
        .then(() => say(g ? `Moved ${n} to "${pk}" › "${g}"` : `Moved ${n} to "${pk}"`))
    for (const p of m.packNames()) {
      const locked = m.isLocked(p)
      const gs = groupsOf(p)
      items.push({
        kind: "submenu",
        label: (locked ? "🔒 " : "") + p,
        disabled: locked,
        hint: locked ? "Locked — unlock it from its header menu" : undefined,
        run: () => moveTo(p, ""),
        items: [
          { kind: "header", text: p },
          { kind: "item", label: "No group", run: () => moveTo(p, "") },
          ...gs.map((g): CtxItem => ({ kind: "item", label: g, run: () => moveTo(p, g) })),
          { kind: "sep" },
          {
            kind: "item",
            label: "New group…",
            run: () => {
              ctx.open(x, y, [
                { kind: "header", text: `New group in ${p}` },
                { kind: "input", placeholder: "Group name — Enter to move", onSubmit: (g) => g && moveTo(p, g) },
              ])
              return "keep"
            },
          },
        ],
      })
    }
    if (selected.some((s) => s.group))
      items.push({ kind: "item", label: "Ungroup", run: () => moveTo(homePack, "") })
    items.push(
      { kind: "sep" },
      {
        kind: "item",
        label: "Add tag…",
        run: () => {
          ctx.open(x, y, [
            { kind: "header", text: `Add tag to ${n} prompt${n === 1 ? "" : "s"}` },
            {
              kind: "input",
              placeholder: "Tag name — Enter to add",
              onSubmit: (raw) => {
                const tag = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "")
                if (!tag) return
                void m
                  .persist(
                    m.snippets.map((s) =>
                      ids.includes(s.id) && !(s.tags || []).includes(tag)
                        ? { ...s, tags: [...(s.tags || []), tag] }
                        : s
                    )
                  )
                  .then(() => say(`Tagged ${n} with #${tag}`))
              },
            },
          ])
          return "keep"
        },
      },
      {
        kind: "item",
        label: "Export selection",
        run: () => {
          const pack = C.packToJson(
            "Selection",
            ids.map((id) => m.snippets.find((s) => s.id === id)).filter((s): s is Snippet => !!s)
          )
          void invoke("set_clipboard_text", { text: JSON.stringify(pack, null, 2) }).then(() =>
            say(`Copied ${n} prompts to clipboard`)
          )
        },
      },
      { kind: "sep" },
      {
        kind: "item",
        label: `Delete ${n} prompt${n === 1 ? "" : "s"}…`,
        danger: true,
        confirm: `Really delete ${n} prompt${n === 1 ? "" : "s"}?`,
        run: () => void m.deleteWithUndo(ids, `Deleted ${n} prompts`),
      }
    )
    ctx.open(x, y, items)
  }

  const element = (
    <>
      {ctx.element}
      {/* Deleting a group deletes its prompts — a real dialog, not an armed menu item */}
      <Dialog open={deleteGroupAsk !== null} onOpenChange={(v) => !v && setDeleteGroupAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">Delete group "{deleteGroupAsk?.group}"?</DialogTitle>
            <DialogDescription>
              This deletes {deleteGroupAsk?.count === 1 ? "the 1 prompt" : `all ${deleteGroupAsk?.count ?? 0} prompts`} in
              it from "{deleteGroupAsk?.pack}". To keep the prompts, choose Ungroup instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setDeleteGroupAsk(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteGroupAsk && void deleteGroup(deleteGroupAsk.pack, deleteGroupAsk.group)}
            >
              Delete {deleteGroupAsk?.count ?? 0} prompt{deleteGroupAsk?.count === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return {
    element,
    renaming,
    setRenaming,
    renamingGroup,
    setRenamingGroup,
    renamePack,
    renameGroup,
    openPackCtx,
    openGroupCtx,
    openRowCtx,
  }
}
