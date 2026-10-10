// One look for every menu in both windows: the manager's context menus and
// the popup's action panel. Grey on hover, the bar only on the item the
// keyboard is on (the bar means "selected", never "under the pointer").
export const MENU_PANEL = "rounded-xl border border-border bg-popover p-2 shadow-(--shadow-pop)"
export const MENU_ITEM =
  "flex h-[30px] w-full cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-left text-ui text-foreground outline-none disabled:cursor-default disabled:opacity-50"
// The keyboard's mark: a 1.5 px Focus bar at the left edge, and no fill.
// Only in the popup, and only once an arrow key has moved the selection
// since the summon (App's `navigated`): a popup that has just opened
// shows no bar, though its first row is selected, and the bar appears on
// the first ↓ or ↑. Everywhere else the mark went (the user's call,
// 2026-10-10: the bar read as a glow on the real screen): the sidebar's
// open prompt and shown pack or group carry nothing, and a menu's or the
// action panel's keyboard item is the hover grey. It sat over the
// Selection tint until 2026-10-10; the tint alone, a dark blue-teal in
// dark mode, had read as a stray green row, and with the bar the tint
// said the same thing twice. 1.5 px, down from 2: a hair thinner was
// the ask once the tint was gone.
export const SELECTED_BAR = "shadow-[inset_1.5px_0_0_var(--focus)]"
// A menu item that is focused rather than selected: the hover grey (it
// was the bar too, until the bar left the menus)
export const FOCUS_FILL = "focus-visible:bg-hover"
