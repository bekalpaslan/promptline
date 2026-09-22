A #tag as a 16px chip: the tag's hue as text on a faint tint of itself (12% in light, 16% in dark), no edge, `radius-1`, 11px text at normal weight. In the editor it is the 20px size, 12px text.

The eight hues come from the app's core module (`tagColor`), keyed by tag name, tuned for dark surfaces and darkened 40% as text in the light theme. Tags are labels first: a resting chip is only tinted. When the tag is a filter term in the query it renders `active`, with a deeper 26% tint and a solid edge — the edge is the state, so a resting chip never has one.

The consumer provides `tag` and, for clickable pills, `onClick(tag)`; the pill stops the click from reaching its row. Rows show at most three pills before folding the rest into a "+N" count.

Do not give a chip a shadow, an edge at rest, or a hue that is not one of the eight.
