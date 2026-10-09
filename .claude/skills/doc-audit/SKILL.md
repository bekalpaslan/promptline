---
name: doc-audit
description: Audit Promptline's documentation against the code and fix the drift. Use this whenever the user asks to audit, check, sweep, refresh or true up the docs, says the docs may be stale or "out of date", asks whether BEHAVIOR.md, README.md, CLAUDE.md, BACKLOG.md, the site or a skill still matches the code, or wants a pass before a release or after a big merge, even without the word audit. It checks every claim a doc makes that the code can confirm, fixes the doc (never the code) on a branch, one commit per doc, and reports what it changed and what it left for the human.
argument-hint: '[doc or area, e.g. "BEHAVIOR.md", "site", "since v0.2.20"; empty = everything]'
---

# Doc audit

The docs here are dense with checkable facts: file names, command names,
event names, settings keys, check counts, script flags, ports, default
hotkeys, release steps. Each one drifts the moment code moves and the doc
doesn't. This audit finds those claims, checks each against the code at
`HEAD`, and fixes the doc so it is true again.

**The code is the source of truth.** A doc that disagrees with the code is
the thing to fix. When the code looks wrong instead (the doc describes a
deliberate decision, with a *why*, that the code no longer honours), don't
change either: report it under *For the human* as a possible regression.

## Scope

`$ARGUMENTS` narrows it: a file (`BEHAVIOR.md`), an area (`site`,
`skills`), or a range (`since v0.2.20`: only claims touched by
`git diff v0.2.20..HEAD --stat` code changes, which is the fast pass before
a release). Empty means the whole inventory below.

## The inventory

What each doc claims, and what to check it against. Work down this list;
the hotspots are where drift has actually turned up.

| Doc | Claims to check | Against | Hotspots |
|---|---|---|---|
| `CLAUDE.md` | file layout and what each file holds; the checks and their count; npm scripts; ports; skills list; release steps, script names and flags; mock behaviour | `src-tauri/src/`, `.github/workflows/ci.yml`, `package.json` `scripts`, `.gitignore` (`!.claude/skills/…`), `scripts/*.mjs` arg parsing, `src/lib/dev-mock.ts` | check count said in more than one place; "the N project skills"; flags a script renamed |
| `BEHAVIOR.md` | per section: what a surface does, which command / event / setting / file carries it, the tests named | the code the section names; `generate_handler!` in `lib.rs`; `emit(`/`listen(` names; settings structs in Rust and `src/lib/prefs.ts`; test names in `tests/`, `e2e/`, `#[test]` | renamed commands and events; a *why* whose trap was since removed; test names cited that no longer exist |
| `README.md` | what the user sees and presses: hotkey, menus, labels, settings, install ids (winget `AlpaslanBek.Promptline`, Scoop bucket), data folder, known limitations, dev commands | UI strings in `src/manager/`, `src/popup/`; `tauri.conf.json`; `package.json`; `BEHAVIOR.md` | a limitation that's been fixed; a label renamed in the UI; `tests/readme-content.test.js` pins some lines, so read it before rewording the top |
| `BACKLOG.md` | which items are open, which shipped and in which version | `git log --oneline`, release notes (`gh release view vX.Y.Z`), the code | open items that already shipped; struck items without a version |
| `CONTRIBUTING.md`, `SECURITY.md` | commands to run, supported versions, how to report | `package.json`, latest tag | supported version line behind the latest release |
| `THIRD-PARTY-NOTICES.md` | the bundled dependencies and licences | `package.json` deps, `src-tauri/Cargo.toml`, fonts in `src/` | a dependency added or dropped since; the release skill asks for the entry before the bump, so check `package.json` and `Cargo.toml` deps against the file |
| `packs/TEMPLATE.md` | the pack file format | the pack parser in `ui/core.js` and `src-tauri/src/packs.rs` | fields the parser now accepts or rejects |
| `design/components/*/README.md` | props, variants, tokens | the component in `src/components/ui/`, `design/tokens.json` | variants added or removed |
| `site/` (`index.html`, `posts/*`) | features and screens described, the privacy note, the hotkey, prices ("free"), platform claims | the app; `site/sitemap.xml` lists every page; `tests/site-*.test.js` | a feature claim the app dropped; a page missing from the sitemap or the `Blog` JSON-LD |
| `.claude/skills/*/SKILL.md` | procedure steps, script names, flags | CLAUDE.md (the skills defer to it), their own `scripts/` | a step CLAUDE.md changed and the skill still repeats |
| `docs/architecture/*.json` | the map at `meta.repository.revision` | `git log <revision>..HEAD -- src-tauri/src src/` | report staleness only; refreshing is its own procedure in CLAUDE.md |

Local-only docs (`docs/MARKETING.md`, `DESIGN.md`, `PRODUCT.md`,
`PITCH-SCRIPT.md`) are ignored by git. Check them only when the scope names
them; fix factual drift in place and say so, since nothing gets committed.

**Out of bounds:**

- `docs/history/*`: records of what was found and decided at the time.
  Don't correct them to today's code. The one check: test names that cite
  a finding id (`H1`, `BH3-1`) still point at an id that exists there.
- `site/latest.json`: written by the release step, never by hand.
- Code, tests, config. If a test pins wording you need to change, stop and
  ask; the test may be the decision.

## Procedure

1. **Branch.** `git switch -c chore/doc-audit-<yyyy-mm-dd>` off an
   up-to-date `master`. A dirty tree: say what's dirty and ask before
   going on (a phantom `src-tauri/Cargo.toml` LF diff is fine to
   `git checkout --`, per CLAUDE.md).
2. **Extract claims.** For each doc in scope, read it and list every
   checkable claim: a path, a symbol, a command or event name, a number,
   a default, a flag, a label, a URL inside the repo. Skip opinion and
   rationale; check only the facts the rationale rests on.
3. **Check each claim** with Grep and Read, at `HEAD`. Useful sweeps:
   - every path in backticks exists: extract `` `[\w./-]+\.(rs|ts|tsx|js|mjs|json|md|css|html)` `` and test each;
   - every command named is in `generate_handler!`;
   - every npm script named is in `package.json`;
   - every `file:line` reference still lands on the thing named.
   A claim that can only be checked by running the app (window focus,
   real paste, the hotkey) is *unverified*, not drift; list it, don't
   change it.
4. **Classify** each failure:
   - **Wrong**: the doc states something false (a renamed command, a
     count that's off, a fixed limitation still listed).
   - **Missing**: behaviour the code has and the doc's own scope says it
     should cover (a new setting in a section that lists the settings).
     Don't add docs for things the doc never meant to cover.
   - **Dead**: a reference to something gone (a file, a test, a step).
   - **Contradiction**: two docs disagree; the code decides which is
     right, and both get fixed.
5. **Fix** each Wrong, Missing, Dead and Contradiction in the doc, in its
   own voice: same density, same plain prose, `behaviour`, sentence case,
   no new headings unless the doc already structures that way. Smallest
   edit that makes it true; rewording for style is not this audit's job.
   `unix2dos` the files you touch, and only those.
6. **Check.** `npm test` (the readme and site content tests),
   `npm run lint`, and `npx tsc -b --noEmit` if you touched anything a
   test reads. Rust checks aren't needed for doc-only changes.
7. **Commit** one commit per doc, subject `Docs: <what was true again>`
   (e.g. `Docs: CLAUDE.md counts seven checks throughout`), body naming
   each drift and what the code says. Don't push or merge; that's the
   human's say-so.

For the whole inventory, fan the reading out: one read-only
general-purpose agent per row group (CLAUDE.md and skills; BEHAVIOR.md;
README, site and CONTRIBUTING/SECURITY; BACKLOG, notices, packs, design),
each told not to edit anything and to return findings in the report's
row shape. Do the fixes yourself afterwards; several findings land in the
same file and edits from parallel agents collide.

## The report

Lead with the counts, then:

| Doc | Line | Kind | Doc said | Code says (where) | Fixed |
|---|---|---|---|---|---|

then **Unverified** (claims only the running app can confirm), then
**For the human**: possible regressions (doc right, code wrong),
test-pinned wording, decisions a doc implies but nobody made, and the
architecture map's staleness. End with the branch name and the commits.
A clean audit says so in one line and lists what it checked.
