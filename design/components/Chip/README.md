Every small label in the app — #tags, {placeholders}, the {N} and +N badges, add-suggestions, the sidebar's search scope, the import badges — is this one chip. Its whole look is the `chipVariants` table in `src/components/prompt-bits.tsx`; no call site styles a chip itself, so changing the table changes every chip in both windows.

`tone` says what the chip is: `neutral` (a plain label), `muted` (a count or note), `tag` (a #tag's hue, via `hue`; `active` fills it), `builtin` / `field` / `config` / `bad` (the four placeholder kinds), `warn` (the fill-in count), `primary` (a pack). `size` says where it sits: `sm` is 16px with 11px text at normal weight on a line exactly that tall, in a row or card; `md` is 20px with 12px medium text, level with an input in the editor; `inline` sits inside wrapping text and breaks with it. Chips are tinted grounds, never outlines: an edge marks a state (an active tag filter) and nothing else.

`add` turns a chip into a suggestion: a + segment behind a full-height divider, muted until hovered. `onRemove` puts an inline × after the label. `onClick` makes the chip a button; without it the chip is plain text, so it can sit inside another button.

A key cap is not a chip (that is Kbd), and a filled-in value in a preview is the prompt's own text on a tint, not a chip.
