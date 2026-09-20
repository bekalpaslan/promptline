A #tag as a 16px pill: the tag's hue as text and as a 35% edge on a transparent ground, `radius-1`, 12px text.

The eight hues come from the app's core module (`tagColor`), keyed by tag name, tuned for dark surfaces and darkened 40% as text in the light theme. Tags are labels first: a resting pill has no fill. When the tag is a filter term in the query it renders `active`, with an 18% tint and a solid edge.

The consumer provides `tag` and, for clickable pills, `onClick(tag)`; the pill stops the click from reaching its row. Rows show at most three pills before folding the rest into a "+N" count.

Do not give a pill a shadow, a fill at rest, or a hue that is not one of the eight.
