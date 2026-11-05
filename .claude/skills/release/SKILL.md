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
   or already merged, the tokens master added since it was shelved, any
   winget PR still open, and the optional notes draft.
3. [Before the bump](#1-before-the-bump): the work branch merged and
   checked, a clean tree, third-party notices, the notes file.
4. [Bump, push, build](#2-bump-push-build): the bump script, the signed
   build handed over in set words, a worktree when a build input is
   dirty, the files and signatures to verify before tagging.
5. [Tag, release, feed](#3-tag-release-feed): tag, `gh release create`
   with five assets, the released hash, the tag's CI, the feed with
   `--bundle-dir` and the exact url check.
6. [Package managers](#4-package-managers): winget with komac, Scoop
   with checkver.
7. [The post, the map, the report](#5-the-post-the-map-the-report): the
   X dry run handed over, the architecture map remap, the snapshot row,
   the report shape, cleanup.
8. [What past releases taught](#what-past-releases-taught).

Scripts in `scripts/`: `bump.cjs` (five places, patch step by default),
`remap-map.cjs` (the architecture map's line numbers to a commit),
`verify-updater-sig.cjs` (a build's `.sig` files as an installed copy reads
them).
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
- **Report:** the release URL, both asset names and sizes, the three
  copies, and the outcome of every workflow the push and the tag triggered.

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

Also in step 0: `gh pr list --repo microsoft/winget-pkgs --author "@me"
--search Promptline --state open --json number,title,labels`. An open PR
is the last release's update. `Needs-Author-Feedback`, `Needs-CLA`,
`Changes-Requested` or any `Validation-*` label except
`Validation-Completed` on it needs the maintainer; anything else is the
queue, and the next release's komac run goes ahead regardless.

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
  commit them, and build around them when they reach the binary (below).
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
   purpose and the build can run here. Otherwise hand it over with where,
   when, what must be ready first, what it asks for and how long it
   takes, in this shape (0.2.24's handover said only "your own PowerShell"
   and the user asked where and when):

   > The signed build is your step. **Where:** a PowerShell window of
   > your own, in the repo root `C:\Users\alpas\IdeaProjects\easypaste`
   > (the password prompt must stay out of this session). **When:** now;
   > it needs only the bump commit, which is pushed, and doesn't wait for
   > CI. **First:** log in to SimplySign Desktop with a fresh code from
   > your phone, and stay logged in until the build ends. It asks for the
   > updater key's password once and takes several minutes. Say "build
   > done" when it finishes.
   >
   > ```powershell
   > <the command from CLAUDE.md → Releasing step 3>
   > ```

   Then wait; meanwhile watch CI in the background (`gh run watch <id>
   --exit-status` as a background call), since the tag needs it.
3. **A dirty build input needs a clean worktree.** A binary that matches
   no commit can't be tagged honestly, so before the handover list what
   another session's changes touch:

   ```sh
   git status --short | grep -vE ' (\.claude/|docs/|site/|tests/|e2e/|\.github/|\.gitignore$|[^/]*\.md$)'
   ```

   Nothing printed means the checkout builds the bump commit exactly,
   whatever else is dirty, so build there: a worktree costs `npm ci` and a
   full Rust compile for nothing. Anything printed needs
   `git worktree add ..\promptline-X.Y.Z <bump commit>` and `npm ci` there.
   Make the directory part of the one line the user pastes, as
   `Set-Location <worktree> -ErrorAction Stop; <the build>`, because a
   separate `cd` can be skipped and the build then lands in the checkout.
   Remove the worktree after the feed step (`git worktree remove --force`;
   the Rust target inside is large).
4. When the user says the build is done, **verify before tagging**: the
   four files exist (`…-setup.exe`, `…_en-US.msi`, both with `.sig`
   beside them, timestamps after the bump). Missing from a worktree: look
   in the checkout's bundle folders. That build stands only if step 3's
   check prints nothing and no file under `src`, `ui` or `src-tauri/src`
   is newer than the bump commit; otherwise ask for it again in the
   worktree. No `.sig` means the build ran
   without the key; ask for it again. The feed can't be written without
   them and installed copies would refuse the update. Then
   `Get-AuthenticodeSignature` on both installers must read `Valid`, with
   `Open Source Developer Alpaslan Bek` as signer and a Certum timestamper;
   anything else means SimplySign Desktop wasn't logged in, so ask for the
   login and the build again. Then
   `node .claude/skills/release/scripts/verify-updater-sig.cjs` (with
   `--bundle-dir` for a worktree's build) must print `ok` twice: a `.sig`
   from the wrong key, or a file changed after signing, otherwise fails
   on every installed copy. The build also
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
- `gh release create` with both installers and three byte copies, made
  beside them in the bundle folders (`gh` can't rename on upload):
  `Promptline-setup.exe` (the site's Download button),
  `Promptline_X.Y.Z_x64-update.exe` and `Promptline_X.Y.Z_x64-update.msi`
  (the feed's urls, which is what counts "kept"). Confirm with
  `gh release view vX.Y.Z --json assets --jq '.assets[] | "\(.digest) \(.size) \(.name)"'`:
  five lines, each copy with its installer's digest. A copy that differs
  fails every update at the signature check.
- The tag triggers CI with the `installers` job, about ten minutes.
  Start watching it in the background right away (`gh run list --branch
  vX.Y.Z --limit 1` for the id) and report it with its artifact
  (`gh api repos/bekalpaslan/promptline/actions/runs/<id>/artifacts`).
- **The released hash, once.** `sha256sum
  <bundle>/nsis/Promptline_X.Y.Z_x64-setup.exe` must equal the digest the
  confirm line above printed: what's uploaded is the signed local build.
  Compare digests rather than download the file, which adds to the count
  (so does a `HEAD`, a few minutes later). komac and Scoop's checkver must
  agree with this hash. Keep it in the report.
- `node scripts/latest-json.mjs --notes <notes> --bundle-dir <bundle>`:
  `--bundle-dir` points at the worktree's `src-tauri/target/release/bundle`
  when the build came from one. Check the feed's urls against the release's
  asset list, never by fetching them: they are the `-update` copies, and a
  fetch counts as "kept":

  ```sh
  node -e 'const f=require("./site/latest.json"),a=JSON.parse(require("child_process").execSync("gh release view vX.Y.Z --json assets",{encoding:"utf8"})).assets.map(x=>x.name);for(const p of Object.values(f.platforms))console.log(p.url.includes("/vX.Y.Z/")&&a.includes(p.url.split("/").pop())?"ok":"MISSING",p.url)'
  ```

  Every line `ok`, then commit it alone as `Site: update feed for X.Y.Z`,
  push, `gh run list --workflow pages.yml --limit 1` for the Pages run,
  and `gh run watch <id> --exit-status`, with nothing piped after it: a
  pipe reports the last command's exit code, so a failed run reads as
  success. A failed or cancelled run leaves the old feed live, so
  `gh run rerun <id>` and watch again; a rerun lands on another runner,
  which is the cure for a stalled mirror. A feed run takes the WebP from
  the cache and installs nothing, and a miss installs only `cwebp`. Then poll
  the live feed (up to ten minutes of cache; 0.2.24 took about four). If
  the loop ends on the old version, look at Pages before going on:

  ```sh
  n=0; until [ "$(curl -s https://promptline.cc/latest.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')" = "X.Y.Z" ] || [ $n -ge 24 ]; do n=$((n+1)); sleep 30; done
  ```

## 4. Package managers

Both run from this machine with the maintainer's `gh` login. winget
needs only the release, so it can run while the feed is still
propagating; Scoop's checkver reads the version from the
live feed, so it waits for that.

- **winget.** `winget upgrade RussellBanks.Komac` first: the repository
  retires old manifest schemas, and komac's version sets the one it
  writes. Then `komac update AlpaslanBek.Promptline --version X.Y.Z --urls
  <versioned setup url> --release-notes-url <release page> --dry-run`
  with `$env:GITHUB_TOKEN = gh auth token` (komac's exe path is in
  CLAUDE.md), and read `ManifestVersion`: the upgrade doesn't promise a
  schema the repository still takes, so stop if it has retired that one.
  An `ERROR invalid_entry` naming WebView2 in the output didn't stop
  0.2.28. Then the same command with `--submit` instead.
  It opens one update PR from the maintainer's fork and copies the
  release's notes into the manifest. Check the hash:
  `gh pr diff <pr> --repo microsoft/winget-pkgs | grep InstallerSha256`
  must show the released one. An update PR waits for a moderator after
  validation too, so the policy bot's email saying so is normal (0.2.28):
  don't ping anyone. Nothing waits on it, and installed copies get the
  release through the feed meanwhile. Never clone winget-pkgs on Windows:
  its paths are too long for the checkout.
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
  field counts): `git diff --stat $(node -p
  "require('./docs/architecture/promptline.architecture.json').meta.repository.revision")..HEAD
  -- src-tauri/src src` shows what moved, and a test-only diff needs
  none. `node .claude/skills/release/scripts/remap-map.cjs
  <tagged commit>` shows every pointer's move; `--write` applies it. Fix
  any pointer flagged CHECK by hand, keep a box at three pointers with
  labels under 48 characters, then archify validate, deliver,
  visual-check (commands in CLAUDE.md → Architecture map), read the
  artifact URL once in the session, publish to it, commit the JSON
  alone, push. `--repo-root` is `git rev-parse --show-toplevel`, letter
  for letter: `C:/users/…` for `C:/Users/…` fails as `root-not-top-level`.
  The verdict on the viewports is `containment.status` in
  `promptline.architecture.visual-check.json`, beside the HTML.
- **The snapshot row.** `node scripts/snapshot.mjs` (with `--donations
  <n>` when the maintainer gives the number) prints one row of the
  MARKETING doc's Snapshot table. Put it in the report under a heading
  "Snapshot row for the MARKETING doc"; the maintainer pastes it into the
  local doc, and no number lands in the repo. The row's download cell is
  split by asset: the stable `Promptline-setup.exe` (the site's button,
  so it reads as site downloads), the versioned exe, the msi and, from
  0.2.28, kept, with the latest release's age in days. Kept is the two
  `-update` copies only the feed links, so it is the retention reading;
  `--releases` prints it against the site downloads of every release
  before it. The versioned count includes about seven per-release
  machinery fetches (komac's hash, Scoop's checkver, winget validation on
  each push, the maintainer's own copy), and the updater no longer adds
  to it from 0.2.28, so what stays above the floor is first installs
  through Scoop and winget. Re-estimate the floor from the first report
  after a release stayed latest five days or more: komac and a
  digest-reading checkver changed what it holds, and 0.2.28 stayed 0.1
  days. When the release before this one stayed under five days, say in
  the report that its kept can't be read. 0.2.28's kept reads 2 high
  (the lesson below).
- **Report**, in this order: release URL; a table of the five assets
  with sizes; a table of every workflow run the pushes and the tag
  triggered with its outcome; downstream state (Scoop commit, winget PR
  number and what happened to it, map republished); the snapshot row
  under its heading; the X command for the user; anything left in flight
  or skipped and why.
- Delete the merged `theme/<id>` branch (local and origin), the session's
  merged work branch, and the release worktree, if any.

## What past releases taught

- 0.2.29: the handover named a worktree and the build still ran in the
  checkout, where only `.gitignore`, `CLAUDE.md` and a skill were dirty, so
  the binary matched the commit and the worktree had been wasted. Hence
  the check in step 3. The feed's Site run stalled on `ffmpeg` for the
  second release running: 69 MB took 6 s on one runner, and three retries
  on another got 30 MB. Retrying on the same runner doesn't help, so the
  WebP are cached and CI encodes with `cwebp`. A `gh run watch … | tail`
  reported that failed run as success.
- 0.2.28: the first signed release. The url check still used `curl -I`
  and put 2 on "kept" within minutes: a `HEAD` counts as a download, a few
  minutes later, which is why a probe of one old asset looked harmless
  when read at once. Hence the asset-list check. A notes section called
  `### Install` above the closing one would have cut the feed's notes;
  `feedNotes` takes the last one now.
- After 0.2.27: the New-Package PR merged on 2026-11-04, 38 days after it
  opened, carrying 0.2.27 because every release had re-pushed it. The
  PR-update script went then
  (`git show 1b272dc:.claude/skills/release/scripts/winget-pr-update.cjs`
  has it, should a new package ever need one). The bot had rejected
  schema 1.10.0 on 2026-10-30, so the merged manifest is on 1.28.0.
  A dry run on 2026-11-05 showed komac 2.16.0 writing 1.12.0, which
  winget-pkgs still merges; komac 2.17.2 is the first with 1.28.0, but
  winget offered only 2.17.1 that day, hence reading the schema in step 4.
- 0.2.25: the work branch's merge ran inside a chained command with
  `-F -`, failed, and the chain went on, so the bump landed on master
  before the merge; the tag went on the merge commit the build ran from,
  and CI on the bump commit was cancelled as superseded. Hence the merge
  bullet before the bump and the tag named by the build, not the bump.
- 0.2.24: the shelved theme was a week behind master's tokens and failed
  the tokens test on merge (the shelf step above). The build handover
  lacked where and when, and the user had to ask.
- 0.2.18: the first build came from a tree carrying another session's
  uncommitted popup work; it was rebuilt in a worktree at the tagged
  commit. The first build also ran without the key (no `.sig`); check
  before tagging, not after.
- Cadence, an observation and not a rule: October 2026 shipped eight
  releases, roughly weekly, five of them carrying gesture behaviour. The
  one excess was three releases on 2026-10-03, three toasts to every
  installed copy in a day. No floor is set; a quiet release class (a feed
  flag that skips the toast) is deferred in BACKLOG.md.
