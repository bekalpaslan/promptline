The popup's list row: one prompt, its first line, one tag chip (the rest folded into +N), a fill-in count and the Ctrl+digit slot it answers to. The chips sit at the end of the first-line preview, on its baseline, so the title keeps the row's full width; in `compact` rows, which have no preview, they follow the title.

Use it for any list where Enter acts on the selected item. The keyboard selection fills the row with `selection` and keeps `ink` text; mouse hover uses `hover`, never the selection colour, so a hover cannot be mistaken for the row Enter will paste. The icon slot holds one icon: a hollow clipboard when the row would paste an empty clipboard, else the pin in `warn` for a pinned row (not under the popup's Pinned heading, which already says it), else the prompt's kind. Rows are flat: no border, no shadow, `radius-2` corners, 8px horizontal padding.

The consumer provides the snippet (`entry.s`), match indices for title highlighting (`entry.indices`, or null), `derived` from `derive(snippet)`, and the handlers (`onPick`, `onMove`, `onLeave`, `onTag`). `compact` drops the first-line preview, `slot` renders the Ctrl+1 pair on the first slot and the digit alone on the rows under it, `activeTags` fills the pills that are current filter terms.

Do not add a border or background to a resting row, and do not colour the selected row's text with the accent.
