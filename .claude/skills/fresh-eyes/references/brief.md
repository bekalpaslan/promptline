Look at this repository with fresh eyes and licence to question anything about it: anything someone who cared about the project could change, at any scale, from why it exists to a single line. Find where it would gain most from change, and say how you'd change it.

Don't start from categories. Don't bring a checklist of review areas, and don't sort what you find into one. Work out what the areas are for this project from what you read and name them in your own words; an area earns its place by its evidence, not by being on a standard list. CLAUDE.md's advice to start from the backlog rather than another audit doesn't apply here: this is the "asked" case, and the backlog is something you check against afterwards (step 3), not a place to start.

1. **Understand, and find the yardstick.** Read until you can say in one paragraph what this project is trying to achieve. Then find where the project itself says what success means for it, and quote it with its source. If it doesn't say, or says it in places that disagree, that is a finding in its own right; state the yardstick you'll use instead as an explicit assumption. Everything you rank in step 5 is measured against it.

2. **Find the areas**: the few (usually three to five) with the most potential, each named in your own words, with the evidence that led you there. Stop looking once more reading only adds evidence to areas you already have. Before you settle, look at the list as a whole: if every area is the same kind of thing or the same scale, say whether that's what the project shows or only where you looked, and look once more where you didn't. Nothing about the project is too large or too small to question.

3. **Check against what's already been decided**, now and not before. Read BACKLOG.md (deferred and shelved ideas, each with its reason), CLAUDE.md, the *Standing decisions* in `.claude/skills/release/SKILL.md`, the top of each file in `docs/history/` along with RELEASE-AUDIT.md's *Decisions (the human's)* and every DECLINED or DECISION entry, and BEHAVIOR.md's section for any surface you'd change. `docs/MARKETING.md` holds the strategy decisions but is local-only: if it's missing, say so, take CLAUDE.md's one-line summary of it as the decisions, and mark anything it could touch "not checked against MARKETING.md". A point the record already covers counts only with new evidence or an argument the record doesn't answer: cite the record and say what's new. Concluding that something looks wrong but isn't is a useful result; keep it.

4. **For each area**:
   - *Now*: what's true today, with evidence, each claim marked observed or inferred.
   - *Value*: what changing it moves toward the yardstick, and for whom.
   - *Change*: what you'd do, specific enough to start on, and a first step that fits in one branch or one session: an edit, a decision, or a question to answer first.
   - *Effort*: hours, a day, days or weeks.
   - *Risk*: what it could break or close off, and what it trades away.
   - *Needs from the maintainer*: the call only they can make before work starts, or "nothing: an agent can start".
   - *Record*: what it touches in the record and what's new, or "none".
   - *Confidence*, and what would change your mind.

5. **Report** in your reply, not a file. Open with the yardstick (and whether the project states one), then the areas ranked by value against effort, one line each, and which you'd do first and why. Then the detail per area; then *Decisions for the maintainer*, each a question with the options and your pick; then *Checked and found fine*.

**Evidence** is whatever another reader can check or dispute: something in the repository (a file and line, a commit, a doc passage, a command and its output), something outside it (a URL you opened in this run, with the date), or, for a judgment, the reasoning laid out so it can be argued with. A claim from memory is inferred, not observed. The repository is your evidence, not the limit of what you may propose. A proposal that would read the same on any other repository doesn't count, and three well-evidenced areas beat ten thin ones.

**Rules**: read-only means the tracked tree: no edits, commits or pushes, and nothing that rewrites tracked files (`npm run shots`, `npm run clip`, `cargo fmt` without `--check`; on Windows, any cargo build rewrites `src-tauri/Cargo.toml`). Installing (`npm ci`, never `npm install`) and `git fetch` are fine; if `git rev-parse --is-shallow-repository` prints `true`, run `git fetch --unshallow` before you read history. Check a command runs here before you lean on its output; where it can't, the claim comes from reading and is inferred.
