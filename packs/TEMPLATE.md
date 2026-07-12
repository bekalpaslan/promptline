# Promptline prompt packs

A pack is a set of prompts that travel together — import one via
**Settings → Your library → Import pack** (copy the JSON, click the button,
confirm the preview). Export a single pack from **Settings → Packs**, or the
whole library from **Your library**.

## Format

```json
{
  "name": "Rust + Tauri",
  "prompts": [
    {
      "title": "Root cause first",
      "tags": ["debug", "rust"],
      "text": "Here's the error:\n\n{clipboard}\n\nFind the root cause before proposing any fix."
    }
  ]
}
```

- `name` — the pack's name; shown in the sidebar's "Group by pack" view and
  manageable under Settings → Packs
- `title` — short imperative name, unique within the pack
- `tags` — 1–3 lowercase tags per prompt (searchable, shown as colored pills)
- `text` — the prompt body

Also accepted on import: an array of pack objects (a full library export), and
the legacy flat array format `[{title, text, category}]` (category becomes a tag).

## Placeholders in `text`

| Token | Expands to |
|---|---|
| `{clipboard}` | user's clipboard at paste time |
| `{date}` / `{time}` | current date / time |
| any other `{lowercase_word}` | runtime fill-in field — asked before pasting (pre-filled with the last value) |
| `{{lowercase_word}}` | config parameter — user saves a value once (editor → Advanced options), pastes silently |

Config parameters are personal: exports ship the template with values empty, so
each user sets their own (e.g. `{{standing_instructions}}`) after importing.

## Generating packs with Claude

Don't write packs by hand — in **Settings → Generate a pack with Claude**,
type a topic, click **1 · Copy prompt for Claude**, paste it into Claude, then
click **2 · Import Claude's reply** on its response. The copied instruction
already carries your topic, your existing tags, and the format rules.

Duplicate title+text pairs are skipped on import, so re-importing an updated
pack only adds what's new.
