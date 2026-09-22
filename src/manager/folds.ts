import { useCallback, useMemo, useState } from "react"
import { groupKey } from "./state"

// The sidebar's folds, held by the manager rather than the sidebar: a rename
// from the overview has to carry them, and a prompt created from the
// overview has to unfold the pack it lands in, so every surface's actions
// go through one owner. Keyed by name (pack name, groupKey) and persisted
// in localStorage under the keys the sidebar always used.

const PACKS_KEY = "collapsedPacks"
const GROUPS_KEY = "collapsedGroups"

function load(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]") as string[])
  } catch {
    return new Set()
  }
}
const store = (key: string, set: Set<string>) => localStorage.setItem(key, JSON.stringify([...set]))

// The popup keeps its own folds under the same shape and reads them when it
// next loads, so a rename carries those too
function rekeyStored(storageKey: string, map: (k: string) => string) {
  try {
    const cur = JSON.parse(localStorage.getItem(storageKey) || "[]") as string[]
    localStorage.setItem(storageKey, JSON.stringify(cur.map(map)))
  } catch {
    /* unreadable: nothing to carry */
  }
}
const rekey = (set: Set<string>, map: (k: string) => string) => new Set([...set].map(map))

export function useFolds() {
  const [packs, setPacksState] = useState(() => load(PACKS_KEY))
  const [groups, setGroupsState] = useState(() => load(GROUPS_KEY))
  const setPacks = useCallback((next: Set<string>) => {
    setPacksState(next)
    store(PACKS_KEY, next)
  }, [])
  const setGroups = useCallback((next: Set<string>) => {
    setGroupsState(next)
    store(GROUPS_KEY, next)
  }, [])

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }
  const togglePackFold = useCallback((name: string) => setPacks(toggle(packs, name)), [packs, setPacks])
  const toggleGroupFold = useCallback((key: string) => setGroups(toggle(groups, key)), [groups, setGroups])
  const setAll = useCallback(
    (nextPacks: Set<string>, nextGroups: Set<string>) => {
      setPacks(nextPacks)
      setGroups(nextGroups)
    },
    [setPacks, setGroups]
  )
  // Something is about to land inside: open the pack, and the group in it
  const unfold = useCallback(
    (pack: string, group?: string) => {
      if (packs.has(pack)) setPacks(toggle(packs, pack))
      if (group && groups.has(groupKey(pack, group))) setGroups(toggle(groups, groupKey(pack, group)))
    },
    [packs, groups, setPacks, setGroups]
  )
  const carryPackFolds = useCallback(
    (from: string, to: string) => {
      const packMap = (k: string) => (k === from ? to : k)
      const groupMap = (k: string) => (k.startsWith(`${from}\u0000`) ? `${to}\u0000${k.slice(from.length + 1)}` : k)
      setPacks(rekey(packs, packMap))
      setGroups(rekey(groups, groupMap))
      rekeyStored("popupCollapsedPacks", packMap)
      rekeyStored("popupCollapsedGroups", groupMap)
    },
    [packs, groups, setPacks, setGroups]
  )
  const carryGroupFold = useCallback(
    (pack: string, from: string, to: string) => {
      const map = (k: string) => (k === groupKey(pack, from) ? groupKey(pack, to) : k)
      setGroups(rekey(groups, map))
      rekeyStored("popupCollapsedGroups", map)
    },
    [groups, setGroups]
  )

  return useMemo(
    () => ({ folds: { packs, groups }, togglePackFold, toggleGroupFold, setAll, unfold, carryPackFolds, carryGroupFold }),
    [packs, groups, togglePackFold, toggleGroupFold, setAll, unfold, carryPackFolds, carryGroupFold]
  )
}
