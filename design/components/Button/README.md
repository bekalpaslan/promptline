The one button, in six variants and five sizes.

`default` is the primary action and there is at most one per surface: Paste, Apply, Import. It fills with `btn-primary` and sets `on-btn-primary` text, ink on paper, never a hue. `outline` and `secondary` are the ordinary actions; `ghost` is for toolbars and icon buttons; `destructive` rests as `danger` text on `danger-soft` and only fills on hover; `link` is inline text in `accent`.

Sizes: `default` is 28px (`control-h`), `sm` 24px, `xs` 20px, `lg` 32px; `compact` is the manager's text-button idiom with auto height. Icon-only buttons use `icon`, `icon-sm`, `icon-xs`, `icon-lg`.

The consumer provides children (sentence-case text and an optional Remixicon at 14px) and the usual button props. Keyboard focus draws the 2px `focus` ring; a mouse click does not.

Do not use `default` for more than one action on a surface, and do not tint any variant with the accent.
