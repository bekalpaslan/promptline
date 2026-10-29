---
name: release
description: Push master and ship a Promptline release end to end, the maintainer's way. Use this whenever the user says release, ship, cut a version, tag, publish, "push and release", or asks to get the month's theme out, even without the word release. It checks the shelf for a monthly theme first, then follows CLAUDE.md → Releasing with the standing decisions below, hands the two human-only steps (signed build, X post) over as exact commands, and reports the release URL, assets and every workflow outcome.
argument-hint: '[version or "patch"]'
---

# Release

CLAUDE.md → Releasing is the procedure and stays the source; this skill
adds the standing decisions the maintainer repeats, the two steps only a
human can run, the shelf check for the monthly theme, and what the last
releases taught. Read the Releasing section first, every time; it changes.

## Contents

1. [Standing decisions](#standing-decisions): version, previous release,
   sources for the notes, overlapped waits, the CI failure path, what to
   skip, the report.
2. [The shelf](#0-the-shelf): the month's theme, on a `theme/<id>` branch
   or already merged, the tokens master added since it was shelved, the
   winget PR's state, and the optional notes draft.
3. [Before the bump](#1-before-the-bump): the work branch merged and
   checked, a clean tree, third-party notices, the notes file.
4. [Bump, push, build](#2-bump-push-build): the bump script, the signed
   build handed over in set words, a worktree when the tree is dirty,
   the four files to verify before tagging.
5. [Tag, release, feed](#3-tag-release-feed): tag, `gh release create`
   with three assets, the released hash (three steps use it), the tag's
   CI, the feed with `--bundle-dir` and the exact url check.
6. [Package managers](#4-package-managers): winget with komac or the
   PR-update script, Scoop with checkver.
7. [The post, the map, the report](#5-the-post-the-map-the-report): the
   X dry run handed over, the architecture map remap, the snapshot row,
   the report shape, cleanup.
8. [What past releases taught](#what-past-releases-taught).

Scripts in `scripts/`: `bump.cjs` (five places, patch step by default),
`winget-pr-update.cjs` (move an unmerged winget PR to a version, no
clone), `remap-map.cjs` (the architecture map's line numbers to a commit).
The feed and the X post use the repo's own `scripts/latest-json.mjs` and
`scripts/post-x.mjs`.

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
  when a security bullet might make a reader wonder. No bullet for a
  commit that fixes or reworks something introduced since the last tag
  (the user never saw the first version; describe the end state once),
  and none for docs, tests, skills or screenshots alone.
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
- **A shelved theme is behind master.** Master keeps adding tokens after
  the theme was shelved (0.2.24: Clay was shelved on 2026-10-10, the
  panel tokens landed the same week, and the merged theme failed
  `tests/tokens.test.js` with "MAP names a missing token"). Right after
  the merge, `npm test` first, and
  `git diff $(git merge-base master origin/theme/<id>)..master -- design/tokens.json`
  lists what was added. Give the theme's file each new token in the
  position Indigo's file has it, with values by the token's own rule in
  its `usage` (a `panel-head` equals the theme's `surface-raised`, a
  `panel-body` its `control`, a `panel-edge` its `line` or transparent
  by whether the theme draws lines around panels), then `npm run tokens`
  and commit it alone as `<Theme>: the tokens added since it was shelved`.
- Nothing on the shelf: say so in one line before continuing. Whether to
  release without the month's theme is the user's call, but don't block
  on it unless they asked for the theme release specifically.

Also in step 0, so the package-manager step is known before it comes:
`gh pr list --repo microsoft/winget-pkgs --author "@me" --search
Promptline --state open --json number,title`. An open "New package" PR
(#441945 since 0.2.17) means the package is still unmerged upstream and
komac can't update it; the PR-update script will (step 4).
`Validation-Completed` and `Azure-Pipeline-Passed` labels with no
moderator merge are the queue, not a problem: moderators take
New-Package PRs by creation date, and on 2026-10-29 369 older ready PRs
were ahead of ours, a queue measured in weeks. How many are still ahead:

```sh
gh api -X GET search/issues -f q='repo:microsoft/winget-pkgs is:pr is:open label:New-Package label:Validation-Completed -label:Needs-Author-Feedback -label:Needs-Attention -label:Blocking-Issue -label:Needs-CLA -label:Changes-Requested -label:Moderator-Approved -label:Validation-Domain -label:Validation-Executable-Error created:<2026-09-27' --jq .total_count
```

(369 on 2026-10-29.) Never open a second PR or change the publisher id:
re-pushing the one PR each release costs nothing and keeps the eventual
merge at the current version.

If `docs/RELEASE-NOTES-next.md` exists, it is the draft of the notes;
start from it and delete it in the bump commit.

## 1. Before the bump

- Merge the session's work branch into master first, as a command of its
  own: `git merge --no-ff <branch> -m "Merge branch '<branch>'"` (`git
  merge` takes its message from `-m` or a real file; it has no stdin
  form). Then `git log --oneline -3` on master must show the merge before
  the bump runs. The tag can only sit on the bump if nothing lands after
  it: in 0.2.25 the merge failed inside a chained command, the chain went
  on, the bump landed first, and the tag had to move to the merge commit.
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
   lives in their password manager. Check first that the shell has no
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; if it does, the user set it on
   purpose and the build can run here. Otherwise hand it over with all
   four facts, in this shape (0.2.24's handover said only "your own
   PowerShell" and the user asked where and when):

   > The signed build is your step. **Where:** a PowerShell window of
   > your own, in the repo root `C:\Users\alpas\IdeaProjects\easypaste`
   > (the password prompt must stay out of this session). **When:** now;
   > it needs only the bump commit, which is pushed, and doesn't wait for
   > CI. It asks for the updater key's password once and takes several
   > minutes. Say "build done" when it finishes.
   >
   > ```powershell
   > <the command from CLAUDE.md → Releasing step 3>
   > ```

   Then wait; meanwhile watch CI in the background (`gh run watch <id>
   --exit-status` as a background call), since the tag needs it.
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
   them and installed copies would refuse the update. The build also
   rewrites `src-tauri/Cargo.toml` as LF, which `git status` shows as a
   modification with no content lines: when
   `git diff --ignore-cr-at-eol -- src-tauri/Cargo.toml` prints nothing,
   `git checkout -- src-tauri/Cargo.toml`, so the tree is clean for the
   tag and the feed commit.

## 3. Tag, release, feed

Steps 4 to 6 of CLAUDE.md → Releasing, with these details:

- Tag the commit HEAD was at when the build ran: the bump commit when
  nothing landed after it, otherwise the later one (a merge that came
  late, the worktree's checkout). CI must be green on that commit, not on
  an earlier one; `gh run list --branch master --limit 3` names the
  commit of each run.
- `gh release create` with both installers and a copy of the setup exe
  named `Promptline-setup.exe` (the site's Download button). Confirm with
  `gh release view vX.Y.Z --json assets --jq '.assets[] | "\(.name) \(.size)"'`.
- The tag triggers CI with the `installers` job, about ten minutes.
  Start watching it in the background right away (`gh run list --branch
  vX.Y.Z --limit 1` for the id) and report it with its artifact
  (`gh api repos/bekalpaslan/promptline/actions/runs/<id>/artifacts`).
- **The released hash, once.** Right after the release exists:

  ```sh
  curl -sL -o /tmp/released-setup.exe https://github.com/bekalpaslan/promptline/releases/download/vX.Y.Z/Promptline_X.Y.Z_x64-setup.exe
  sha256sum /tmp/released-setup.exe <bundle>/nsis/Promptline_X.Y.Z_x64-setup.exe
  ```

  The two must match (a code-signed installer would differ, and then
  the released one is the truth). Three steps use this hash: this
  comparison, the winget PR-update script, and Scoop's manifest (which
  checkver computes itself and must agree). Keep it in the report.
- `node scripts/latest-json.mjs --notes <notes> --bundle-dir <bundle>`:
  `--bundle-dir` points at the worktree's `src-tauri/target/release/bundle`
  when the build came from one. Check the feed's own urls, not every
  `https://` in the file (the notes field holds the previous release's
  link, and a grep over the file "finds" it with the notes' text glued
  on and reports a 404 that isn't one, 0.2.24):

  ```sh
  for u in $(node -e 'for (const p of Object.values(require("./site/latest.json").platforms)) console.log(p.url)'); do printf "%s %s\n" "$(curl -sIL -o /dev/null -w '%{http_code}' "$u")" "$u"; done
  ```

  Every line 200, then commit it alone as `Site: update feed for X.Y.Z`,
  push, `gh run list --workflow pages.yml --limit 1` for the Pages run,
  `gh run watch <id>`, and poll until the live feed shows the version
  (up to ten minutes of cache; 0.2.24 took about four):

  ```sh
  until [ "$(curl -s https://promptline.cc/latest.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')" = "X.Y.Z" ]; do sleep 30; done
  ```

## 4. Package managers

Both run from this machine with the maintainer's `gh` login. winget
needs only the release and the released hash, so it can run while the
feed is still propagating; Scoop's checkver reads the version from the
live feed, so it waits for that.

- **winget.** Step 0 said which case this is. The package merged
  upstream: `komac update AlpaslanBek.Promptline --version X.Y.Z --urls
  <versioned setup url> --release-notes-url <release page> --submit` with
  `$env:GITHUB_TOKEN = gh auth token` (komac's exe path is in CLAUDE.md).
  The first package PR still open (since 0.2.17; komac would answer
  "does not exist in microsoft/winget-pkgs"): move it to the
  new version, from Bash, with
  `GITHUB_TOKEN=$(gh auth token) node .claude/skills/release/scripts/winget-pr-update.cjs <pr> X.Y.Z <sha256> <YYYY-MM-DD>`.
  It pushes one commit to the PR branch and retitles the PR; validation
  reruns by itself. One PR carrying the latest version beats two queued
  ones: a second PR would start at the back of a queue measured in weeks
  (step 0 has the position check and the 2026-10-29 count), while
  re-pushing this one costs nothing. Nothing waits on it. Never clone
  winget-pkgs on Windows: its paths are too long for the checkout.
- **Scoop.** `checkver.ps1 -App promptline -Dir ..\scoop-bucket\bucket
  -Update` once the live feed shows the version (it reads the version
  from the feed), then commit and push the bucket.

## 5. The post, the map, the report

- **X is the human's step** (the keys live in their password manager).
  Run the dry run, show the text, and hand over the command with the
  notes path: `node scripts/post-x.mjs --notes <notes>`, with where and
  when as for the build (their own PowerShell with the four `X_*`
  variables set; any time after the live feed shows the version). If the
  lead sentence doesn't read as a post, write a `--text` file instead.
  The notes file lives in the session's scratchpad, which a later
  session doesn't have; if the post happens later, regenerate it from
  the release itself and point `--notes` at that:
  `gh release view vX.Y.Z --json body --jq .body > notes-X.Y.Z.md`.
- **The architecture map** needs a refresh when windows, commands, events
  or storage changed since its `meta.repository.revision` (a config
  field counts). `node .claude/skills/release/scripts/remap-map.cjs
  <tagged commit>` shows every pointer's move; `--write` applies it. Fix
  any pointer flagged CHECK by hand, keep a box at three pointers with
  labels under 48 characters, then archify validate, deliver,
  visual-check (commands in CLAUDE.md → Architecture map), read the
  artifact URL once in the session, publish to it, commit the JSON
  alone, push.
- **The snapshot row.** `node scripts/snapshot.mjs` (with `--donations
  <n>` when the maintainer gives the number) prints one row of the
  MARKETING doc's Snapshot table. Put it in the report under a heading
  "Snapshot row for the MARKETING doc"; the maintainer pastes it into the
  local doc, and no number lands in the repo. The row's download cell is
  split by asset: the stable `Promptline-setup.exe` (the site's button,
  so it reads as site downloads), the versioned exe and the msi, with the
  latest release's age in days. The versioned count includes about seven
  per-release machinery fetches (komac's hash, Scoop's checkver, winget
  validation on each push, the maintainer's own copy), so retention
  reads versioned(N+1) minus that floor, against stable(N).
- **Report**, in this order: release URL; a table of the three assets
  with sizes; a table of every workflow run the pushes and the tag
  triggered with its outcome; downstream state (Scoop commit, winget PR
  number and what happened to it, map republished); the snapshot row
  under its heading; the X command for the user; anything left in flight
  or skipped and why.
- Delete the merged `theme/<id>` branch (local and origin), the session's
  merged work branch, and the release worktree, if any.

## What past releases taught

- 0.2.25: the work branch's merge ran inside a chained command with
  `-F -`, failed, and the chain went on, so the bump landed on master
  before the merge; the tag went on the merge commit the build ran from,
  and CI on the bump commit was cancelled as superseded. Hence the merge
  bullet before the bump and the tag named by the build, not the bump.
- 0.2.24: the shelved theme was a week behind master's tokens and failed
  the tokens test on merge (the shelf step above). A grep for `https://`
  over `site/latest.json` reported a 404 from the notes field's link.
  The build handover lacked where and when, and the user had to ask. The
  winget PR from 0.2.17 was still open.
- 0.2.18: the first build came from a tree carrying another session's
  uncommitted popup work; it was rebuilt in a worktree at the tagged
  commit. The first build also ran without the key (no `.sig`); check
  before tagging, not after.
- 0.2.17: the winget PR passed validation and sat for a week waiting for a
  moderator; komac can't update a package that isn't merged, hence the
  PR-update script. A month later it was still queued behind 369 older
  New-Package PRs (step 0).
- Cadence, an observation and not a rule: October 2026 shipped eight
  releases, roughly weekly, five of them carrying gesture behaviour. The
  one excess was three releases on 2026-10-03, three toasts to every
  installed copy in a day. No floor is set; a quiet release class (a feed
  flag that skips the toast) is deferred in BACKLOG.md.
