---
name: release
description: Push master and ship a Promptline release end to end, the maintainer's way. Use this whenever the user says release, ship, cut a version, tag, publish, "push and release", or asks to get the month's theme out, even without the word release. It checks the shelf for a monthly theme first, then follows CLAUDE.md → Releasing with the standing decisions below, hands the two human-only steps (signed build, X post) over as exact commands, and reports the release URL, assets and every workflow outcome.
argument-hint: [version or "patch"]
---

# Release

CLAUDE.md → Releasing is the procedure and stays the source; this skill
adds the standing decisions the maintainer repeats, the two steps only a
human can run, the shelf check for the monthly theme, and what the last
releases taught. Read the Releasing section first, every time; it changes.

## Standing decisions

- **Version.** The current one is in `package.json`; bump the patch step
  unless told otherwise. `scripts/bump.cjs` (in this skill) edits the five
  places and keeps line endings; one commit titled `Bump to X.Y.Z`.
- **Previous release.** `gh release list` gives the latest tag. Link it in
  the lead sentence and copy the notes format from `gh release view <tag>`.
- **What changed.** `git log <tag>..master` and the BEHAVIOR.md diff over
  that range are the sources; the current tracker in `docs/history/`
  holds resolutions worded for a reader. Anything that moves data, changes
  a default, or changes the on-disk format gets its own bullet; so does
  any change to what the app sends over the network, or "nothing changes"
  when a security bullet might make a reader wonder.
- **Overlap the waits.** The signed build may start as soon as the bump
  commit exists; only the tag waits for green CI (`gh run list --branch
  master --limit 3` for the id, `gh run watch <id> --exit-status`).
- **If CI fails:** fix, re-push and continue without asking, unless the
  fix changes behaviour; then stop and report.
- **Skip repo chores** not listed here, however tempting.
- **Report:** the release URL, both asset names and sizes, the stable-named
  copy, and the outcome of every workflow the push and the tag triggered.

## 0. The shelf

Promptline ships one theme a month (BEHAVIOR.md → Theming; the
`monthly-theme` skill builds them). Before anything else:

```sh
git fetch origin
git branch -r --list 'origin/theme/*'
git diff --diff-filter=A --name-only <latest tag>..origin/master -- 'design/*.tokens.json'
```

- A `theme/<id>` branch on origin is a shelved theme: merge it into master
  (`git merge --no-ff origin/theme/<id>`), run the seven checks, push,
  and delete the branch after the release. Its
  `design/<id>.release-notes.md` is the Themes section of the notes, and
  the lead sentence pitches it ("…and from here on a new theme every
  month" was 0.2.18's; later ones name the theme and the month).
- A tokens file added since the last tag on master is a theme already
  merged: same notes treatment.
- Nothing on the shelf: say so in one line before continuing. Whether to
  release without the month's theme is the user's call, but don't block
  on it unless they asked for the theme release specifically.

If `docs/RELEASE-NOTES-next.md` exists, it is the draft of the notes;
start from it and delete it in the bump commit.

## 1. Before the bump

- Check the working tree: `git status --short`. Modified files that this
  session didn't make belong to another session (it happens). Never
  commit them, and don't build from a tree that has them (below).
- Shipping a new font or other bundled third-party work? It needs its
  entry in THIRD-PARTY-NOTICES.md before the bump; that is part of the
  release, not a chore.
- Write the notes file in the scratchpad (`notes-X.Y.Z.md`), in the
  format of the last release: lead sentence with the link, `###` sections
  in the user's terms, the fixed Install block with the version filled in.

## 2. Bump, push, build

1. `node .claude/skills/release/scripts/bump.cjs` (or with the version),
   `unix2dos` the five files, commit `Bump to X.Y.Z`, push master. Note
   the CI run id.
2. **The signed build is the human's step**: the updater key's password
   lives in their password manager. Hand over the exact command from
   CLAUDE.md → Releasing step 3 and wait. Check first that the shell has
   no `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; if it does, the user set it
   on purpose and the build can run here.
3. **A dirty tree needs a clean worktree.** If the checkout has another
   session's changes, the build must not come from it: a binary that
   matches no commit can't be tagged honestly. Create
   `git worktree add ..\promptline-X.Y.Z <bump commit>`, run `npm ci`
   there, and have the user build in it. Remove the worktree after the
   feed step (`git worktree remove --force`; the Rust target inside is
   large).
4. When the user says the build is done, **verify before tagging**: the
   four files exist (`…-setup.exe`, `…_en-US.msi`, both with `.sig`
   beside them, timestamps after the bump). No `.sig` means the build ran
   without the key; ask for it again. The feed can't be written without
   them and installed copies would refuse the update.

## 3. Tag, release, feed

Steps 4 to 6 of CLAUDE.md → Releasing, with these details:

- Tag the commit the build was made from, which is the bump commit (or
  the later commit the worktree checked out). CI must be green on it.
- `gh release create` with both installers and a copy of the setup exe
  named `Promptline-setup.exe` (the site's Download button). Confirm with
  `gh release view vX.Y.Z --json assets --jq '.assets[] | "\(.name) \(.size)"'`.
- The tag triggers CI with the `installers` job; watch it to the end for
  the report (it takes longer than the checks).
- `node scripts/latest-json.mjs --notes <notes> --bundle-dir <bundle>`:
  `--bundle-dir` points at the worktree's `src-tauri/target/release/bundle`
  when the build came from one. curl every url in the feed for 200
  before committing it alone as `Site: update feed for X.Y.Z`; wait for
  the Pages run and poll `https://promptline.cc/latest.json` until it
  shows the version (up to ten minutes of cache).
- Download the released setup exe and compare its sha256 with the local
  build's: the package managers hash the released file.

## 4. Package managers

Both run from this machine with the maintainer's `gh` login.

- **winget.** `komac update AlpaslanBek.Promptline --version X.Y.Z --urls
  <versioned setup url> --release-notes-url <release page> --submit` with
  `$env:GITHUB_TOKEN = gh auth token` (komac's exe path is in CLAUDE.md).
  If komac answers "does not exist in microsoft/winget-pkgs", the first
  package PR is still unmerged: find it (`gh pr list --repo
  microsoft/winget-pkgs --author "@me" --search Promptline --state open`)
  and move it to the new version with
  `node .claude/skills/release/scripts/winget-pr-update.cjs <pr> X.Y.Z <sha256>`.
  One PR carrying the latest version beats two queued ones; the
  moderators merge it in hours or days and nothing waits on it. Never
  clone winget-pkgs on Windows: its paths are too long for the checkout.
- **Scoop.** `checkver.ps1 -App promptline -Dir ..\scoop-bucket\bucket
  -Update` once the live feed shows the version (it reads the version
  from the feed), then commit and push the bucket.

## 5. The post, the map, the report

- **X is the human's step** (the keys live in their password manager).
  Run the dry run, show the text, and hand over the command with the
  notes path: `node scripts/post-x.mjs --notes <notes>`. If the lead
  sentence doesn't read as a post, write a `--text` file instead.
- **The architecture map** needs a refresh when windows, commands, events
  or storage changed since its `meta.repository.revision` (a config
  field counts). `node .claude/skills/release/scripts/remap-map.cjs
  <tagged commit>` shows every pointer's move; `--write` applies it. Fix
  any pointer flagged CHECK by hand, keep a box at three pointers with
  labels under 48 characters, then archify validate, deliver,
  visual-check (commands in CLAUDE.md → Architecture map), read the
  artifact URL once in the session, publish to it, commit the JSON
  alone, push.
- **Report**, in this order: release URL; a table of the three assets
  with sizes; a table of every workflow run the pushes and the tag
  triggered with its outcome; downstream state (Scoop commit, winget PR
  number and what happened to it, map republished); the X command for
  the user; anything left in flight or skipped and why.
- Delete the merged `theme/<id>` branch (local and origin) and the
  release worktree, if any.

## What past releases taught

- 0.2.18: the first build came from a tree carrying another session's
  uncommitted popup work; it was rebuilt in a worktree at the tagged
  commit. The first build also ran without the key (no `.sig`); check
  before tagging, not after.
- 0.2.17: the winget PR passed validation and sat for a week waiting for a
  moderator; komac can't update a package that isn't merged, hence the
  PR-update script.
- Any `cargo` run rewrites `src-tauri/Cargo.toml` as LF; `git checkout --
  src-tauri/Cargo.toml` when that is the only diff.
- `npm install` of a new dependency rewrites the lockfile and drops
  optional-peer entries CI's npm 10 needs; rebuild the lock from `HEAD`
  plus the new entries (CLAUDE.md → Housekeeping) before the bump.
