// One look for every menu in both windows: the manager's context menus and
// the popup's action panel. Grey on hover, the accent only on the item the
// keyboard is on (the accent means "selected", never "under the pointer").
export const MENU_PANEL = "rounded-xl border border-border bg-popover p-2 shadow-(--shadow-pop)"
export const MENU_ITEM =
  "flex h-[30px] w-full cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-left text-ui text-foreground outline-none disabled:cursor-default disabled:opacity-50"
