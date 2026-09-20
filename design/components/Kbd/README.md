A keyboard key as the popup draws it: 16px tall, `mono` at 11px, a `line` edge, `radius-1`, `ink-3` text on `surface-0`.

Every key the UI names is a `Kbd`, never plain text like "Ctrl+Enter": hint bars, Ctrl+digit slots on rows, the digits in the Tab action panel, and the "last used" badge on a remembered fill-in value. Keys sit in a hint as key then label, with a 4px gap, and hints wrap between themselves rather than splitting a key from its label.

The consumer provides the key label as children. The wider `UiKbd` export is shadcn's kit component this one is built on, for surfaces outside the popup.

Do not put a shadow on a key, and do not render modifier combinations as one key: "Ctrl" and "1" are two.
