# Promptline prompt packs

A pack is a set of prompts that travel together. Import one from
**Settings → Your library**: **Import from clipboard** (copy the JSON first)
or **Import from file…**; every import is reviewed prompt by prompt in a
checklist before anything is added. Export a single pack from its header's
menu in the sidebar (hover the pack, or right-click it), or from its row under
**Your library** (**Export to clipboard**); **Export library** there exports
everything.

Every pack also owns a file under
`%APPDATA%\io.github.bekalpaslan.promptline\packs\` that the app keeps
current: click a pack's row under **Your library** to see its path, copy it,
show it in the folder, or **Import from this file…** after something else
wrote to it. That file is the simplest way to share a pack or hand it to an
agent.

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

- `name` — the pack's name; the sidebar groups prompts under it, and its
  header's menu renames, locks, exports or deletes it
- `title` — short imperative name, unique within the pack
- `tags` — 1–3 lowercase tags per prompt (searchable, shown as colored pills)
- `group` — optional; a sub-heading within the pack (e.g. `"Debugging"`).
  Prompts without one are ungrouped. One pack per project with a group per
  practice is the intended shape for project packs
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

## Generating packs with AI

Don't write packs by hand — open **New → Generate pack with AI** in the
manager (the same dialog is a button under **Settings → Your library**). It
has two paths:

- **Chat — copy & paste**: type a topic, then follow the three steps —
  **Copy the instruction**, **Paste it into any AI chat, then copy its whole
  reply** (the **Import reply from clipboard** button reads it), and **Review
  & add**. The copied instruction already carries your topic, your existing
  tags, and the format rules.
- **Coding agent — writes the file**: for an agent that sits in a project
  (Claude Code, Codex or Cursor, for example). **Create the pack file & copy instructions**
  makes the file and puts an instruction naming its path on the clipboard;
  **Paste to your agent — the file reloads by itself** watches the file
  until the agent has written it (a Stop button and **Import from file…**
  cover an agent that took another route); then **Review & add** as before.
  There the topic is optional. Leave it empty and the agent surveys the
  project it is running in — contributor docs, roadmap, git log, build
  commands, workflow commands like `/gsd:next` — and writes one pack named
  after the project, with a group per daily practice (orientation,
  development, debugging, verification, review, documentation, housekeeping).
  Give a topic to narrow the pack to one area instead.

Duplicate title+text pairs are skipped on import, so re-importing an updated
pack only adds what's new.
