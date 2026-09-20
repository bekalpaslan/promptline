The popup's list row: one prompt, its first line, up to three tag pills, a fill-in count and the Ctrl+digit slot it answers to.

Use it for any list where Enter acts on the selected item. The keyboard selection fills the row with `selection` and keeps `ink` text; mouse hover uses `hover`, never the selection colour, so a hover cannot be mistaken for the row Enter will paste. A pinned row shows the pin icon in `warn`. Rows are flat: no border, no shadow, `radius-2` corners, 8px horizontal padding.

The consumer provides the snippet (`entry.s`), match indices for title highlighting (`entry.indices`, or null), `derived` from `derive(snippet)`, and the handlers (`onPick`, `onMove`, `onLeave`, `onTag`). `compact` drops the first-line preview, `slot` renders the Ctrl+N kbd pair, `activeTags` fills the pills that are current filter terms.

Do not add a border or background to a resting row, and do not colour the selected row's text with the accent.
