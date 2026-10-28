export const meta = {
  name: 'fresh-eyes',
  description: 'Area-agnostic improvement review: agents choose their own areas, then deepen, challenge and rank them',
  whenToUse: 'An open-ended "what would you improve here, and how" review where the agents, not the asker, choose the areas',
  phases: [
    { title: 'Prepare', detail: 'unshallow and install once, record what runs here' },
    { title: 'Discover', detail: 'blind agents each choose where to begin and name their own areas' },
    { title: 'Merge', detail: 'one list of areas; gap rounds begin where nobody did' },
    { title: 'Deepen', detail: 'one agent per area: evidence, value, change, effort, record' },
    { title: 'Challenge', detail: 'one skeptic per proposal: evidence and novelty gate, worth advises' },
    { title: 'Report', detail: 'one ranked report for the maintainer' },
  ],
}

// The fresh-eyes skill's ready-made run (see SKILL.md). The prompts below carry
// references/brief.md's rules split by stage: change one, change both.

const opt = (k, d) => (args && args[k] != null ? args[k] : d)
const DISCOVERERS = opt('discoverers', 4)
const GAP_ROUNDS = opt('gapRounds', 2)
const MAX_AREAS = opt('maxAreas', 12)

phase('Prepare')
const env = await agent(`Get this checkout ready for read-only reviewers without changing any tracked file, then report. 1) If \`git rev-parse --is-shallow-repository\` prints true, run \`git fetch --unshallow\`. 2) If node_modules is missing, run \`npm ci\` (never npm install). 3) Report, in plain text under 200 words and starting with "Commit: <git rev-parse --short HEAD>": which of those steps worked; whether \`npm test\`, \`npx tsc -b --noEmit\`, \`npm run lint\` and \`cargo --version\` run here; whether docs/MARKETING.md exists; and whether you have a browser tool and web search. Fix nothing that fails; report it.`,
  { label: 'prepare', phase: 'Prepare', effort: 'low' })
const ENV = env || 'The preparation agent failed: check that a command runs before relying on its output.'

const OPEN = `You are looking at this repository with fresh eyes and licence to question anything about it: anything someone who cared about the project could change, at any scale, from why it exists to a single line.

Don't bring a checklist of review areas, and don't sort what you find into one. Work out what the areas are for this project from what you read and name them in your own words; an area earns its place by its evidence, not by being on a standard list. CLAUDE.md's advice to start from the backlog rather than another audit doesn't apply here: this is the "asked" case.`

const EVIDENCE = `Evidence is whatever another reader can check or dispute: something in the repository (a file and line, a commit, a doc passage, a command and its output), something outside it (a URL you opened in this run, with the date), or, for a judgment, the reasoning laid out so it can be argued with. A claim from memory is inferred, not observed; mark every claim observed or inferred. The repository is your evidence, not the limit of what you may propose. A point that would read the same on any other repository doesn't count.`

const RECORD = `The project has already decided, deferred or reviewed a lot; check against it. Read BACKLOG.md (deferred and shelved ideas, each with its reason), CLAUDE.md, the Standing decisions in .claude/skills/release/SKILL.md, the top of each file in docs/history/ along with RELEASE-AUDIT.md's "Decisions (the human's)" and every DECLINED or DECISION entry, and BEHAVIOR.md's section for any surface a proposal changes. docs/MARKETING.md holds the strategy decisions but is local-only: if it's missing, take CLAUDE.md's one-line summary of it as the decisions and mark anything it could touch "not checked against MARKETING.md". A point the record covers counts only with new evidence or an argument the record doesn't answer.`

const shared = port => `Several agents use this checkout at once, so don't change it: no edits, commits or pushes; no git checkout, switch, stash, reset or fetch (read old versions with \`git show <rev>:<path>\`); no npm install or ci; nothing that writes a tracked file (npm run shots or clip, cargo fmt without --check); no cargo build or test and no e2e suite. ${port ? `If you start the mock UI, run \`npx vite --port ${port} --strictPort\` and stop it when you're done.` : "Don't start a dev server."}

What runs here, checked before you started:
${ENV}`

const AREA = {
  type: 'object',
  required: ['name', 'why', 'evidence', 'potential'],
  properties: {
    name: { type: 'string', description: 'your own name for the area' },
    why: { type: 'string', description: 'what you saw and why it has potential' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'each item marked observed or inferred' },
    potential: { type: 'integer', minimum: 1, maximum: 5, description: 'how much the project would gain, judged from the evidence' },
  },
}

const DISCOVERY = {
  type: 'object',
  required: ['began', 'understanding', 'yardstick', 'areas'],
  properties: {
    began: { type: 'string', description: 'where you began reading and why, one line' },
    understanding: { type: 'string', description: 'one paragraph: what this project is trying to achieve' },
    yardstick: {
      type: 'object',
      required: ['found', 'text'],
      properties: {
        found: { type: 'string', enum: ['stated', 'conflicting', 'not stated'] },
        text: { type: 'string', description: 'the quote with its source; or the conflict; or that none exists, and the yardstick you assume and why' },
      },
    },
    areas: { type: 'array', items: AREA },
  },
}

phase('Discover')
const found = (await parallel(Array.from({ length: DISCOVERERS }, (_, i) => () =>
  agent(`${OPEN}

${EVIDENCE}

${shared(5200 + i)}

Other agents are doing this same task independently; you won't see their work. Begin wherever you judge best, and say where (began).

1. Read until you can say in one paragraph what this project is trying to achieve (understanding).
2. Find where the project itself says what success means for it, and quote it with its source (yardstick). If it doesn't say, or says it in places that disagree, say so: that is a finding in its own right. Then state the yardstick you'll use as an explicit assumption.
3. Name the few areas (usually three to five) with the most potential, each in your own words, with evidence. Stop looking once more reading only adds evidence to areas you already have. Before you settle, look at the list as a whole: if every area is the same kind of thing or the same scale, say whether that's what the project shows or only where you looked, and look once more where you didn't. Nothing about the project is too large or too small to question.`,
    { label: `discover:${i + 1}`, phase: 'Discover', schema: DISCOVERY })
    .then(r => r && { agent: i + 1, ...r })))).filter(Boolean)
if (!found.length) return 'Every discovery agent failed; nothing to review.'
log(`${found.length} discoverer(s) named ${found.reduce((n, f) => n + f.areas.length, 0)} area(s)`)

const MERGED = {
  type: 'object',
  required: ['understanding', 'yardstick', 'disagreements', 'areas'],
  properties: {
    understanding: { type: 'string', description: "one paragraph reconciling the agents' understandings of what the project is trying to achieve" },
    yardstick: { type: 'string', description: 'whether the project states what success means for it, as the agents found it: quotes with sources, or that none did; and the yardsticks they assumed' },
    disagreements: { type: 'string', description: "where the agents' understandings or yardsticks disagree, and what that suggests; empty if they agree" },
    areas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'summary', 'evidence', 'potential', 'foundBy'],
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          potential: { type: 'integer', minimum: 1, maximum: 5 },
          foundBy: { type: 'array', items: { type: 'integer' }, description: 'the numbers of the agents that named it' },
        },
      },
    },
  },
}

phase('Merge')
let merged = await agent(`Several agents read this repository independently. Each wrote its understanding of the project, what it found about where the project says what success means for it, and the areas it would improve. Merge their work. Areas: one entry per distinct area (same underlying point = same area, whatever it was called), keeping every piece of evidence, listing the agents that named it, and giving the potential the evidence supports. Don't add, drop or judge areas. Then write one paragraph reconciling their understandings, summarise what they found about the yardstick, and say where they disagree. Work only from the material below; don't read the repository.

${JSON.stringify(found, null, 2)}`,
  { label: 'merge', phase: 'Merge', schema: MERGED })
if (!merged) {
  log('merge agent failed: going on with the unmerged lists')
  merged = {
    understanding: found.map(f => f.understanding).join('\n\n'),
    yardstick: found.map(f => `Agent ${f.agent} (${f.yardstick.found}): ${f.yardstick.text}`).join('\n'),
    disagreements: '',
    areas: Object.values(found.flatMap(f => f.areas.map(a => ({ name: a.name, summary: a.why, evidence: a.evidence, potential: a.potential, foundBy: [f.agent] })))
      .reduce((byName, a) => {
        const same = byName[a.name.toLowerCase()]
        if (same) { same.foundBy.push(...a.foundBy); same.evidence.push(...a.evidence) } else byName[a.name.toLowerCase()] = a
        return byName
      }, {})),
  }
}

const GAPS = { type: 'object', required: ['began', 'areas'], properties: { began: { type: 'string' }, areas: { type: 'array', items: AREA } } }
const gapAreas = []
const beganAt = found.map(f => f.began)
for (let round = 0; round < GAP_ROUNDS; round++) {
  const known = [...merged.areas, ...gapAreas].map(a => ({ name: a.name, summary: a.summary, evidence: a.evidence }))
  const gaps = await agent(`${OPEN}

${EVIDENCE}

${shared(5250 + round)}

Other agents have already looked at this repository. Where they began: ${JSON.stringify(beganAt)}

What they found, with the evidence behind each:
${JSON.stringify(known, null, 2)}

Your job is what they missed. Begin somewhere none of them did, say where (began), and name any area with real potential that isn't already here, with evidence. Nothing about the project is too large or too small to question. Return an empty list if you find nothing new; don't restate or split existing areas.`,
    { label: `gaps:${round + 1}`, phase: 'Merge', schema: GAPS })
  if (!gaps) { log(`gap round ${round + 1}: agent failed`); break }
  if (!gaps.areas.length) { log(`gap round ${round + 1}: nothing new`); break }
  beganAt.push(gaps.began)
  gapAreas.push(...gaps.areas.map(a => ({ name: a.name, summary: a.why, evidence: a.evidence, potential: a.potential, foundBy: [], gap: round + 1 })))
  log(`gap round ${round + 1}: ${gaps.areas.length} new area(s)`)
}

// Every source (each discoverer, each gap round) gets its best area in before the rest fill by potential,
// so a cap never cuts what only one agent could see.
const pool = [...merged.areas, ...gapAreas].sort((x, y) => (y.potential || 0) - (x.potential || 0) || (y.foundBy || []).length - (x.foundBy || []).length)
if (!pool.length) return 'The agents found no areas to improve.'
const sourcesOf = a => (a.gap ? [`gap ${a.gap}`] : (a.foundBy || []).map(n => `agent ${n}`))
const picked = []
for (const src of [...new Set(pool.flatMap(sourcesOf))]) {
  const a = pool.find(x => !picked.includes(x) && sourcesOf(x).includes(src))
  if (a && picked.length < MAX_AREAS) picked.push(a)
}
for (const a of pool) if (picked.length < MAX_AREAS && !picked.includes(a)) picked.push(a)
const skipped = pool.filter(a => !picked.includes(a))
if (skipped.length) log(`deepening ${picked.length} of ${pool.length} areas; not deepened: ${skipped.map(a => a.name).join('; ')}`)

const PROPOSAL = {
  type: 'object',
  required: ['area', 'noChange', 'now', 'value', 'change', 'firstStep', 'effort', 'risk', 'decision', 'record', 'confidence', 'wouldChangeMind'],
  properties: {
    area: { type: 'string' },
    noChange: { type: 'boolean', description: 'true if on closer reading this area needs nothing; then say why in now, and write "none" in change, firstStep and risk' },
    now: { type: 'string', description: "what's true today, with evidence, each claim marked observed or inferred" },
    value: { type: 'string', description: 'what changing it moves toward the yardstick, and for whom' },
    change: { type: 'string', description: 'what you would do, specific enough to start on' },
    firstStep: { type: 'string', description: 'fits in one branch or one session: an edit, a decision, or a question to answer first' },
    effort: { type: 'string', enum: ['none', 'hours', 'a day', 'days', 'weeks'] },
    risk: { type: 'string', description: 'what it could break or close off, and what it trades away' },
    decision: { type: 'string', description: 'the call only the maintainer can make before work starts; empty if an agent could start now' },
    record: { type: 'string', description: 'what this touches in the record and what is new, or "none"' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    wouldChangeMind: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['stands', 'falls', 'cannot-check'] },
    reason: { type: 'string' },
    correction: { type: 'string', description: 'what the proposal should say instead, if it stands with a correction' },
  },
}
const CHALLENGE = { type: 'object', required: ['evidence', 'novelty', 'worth'], properties: { evidence: VERDICT, novelty: VERDICT, worth: VERDICT } }

const TESTS = `1. Evidence (a gate): re-check every cited fact against its source, the repository as it is now or the URL cited. falls if a fact is wrong or can't be found; cannot-check if you can't reach the source, saying what would settle it. An inference marked as one isn't refuted because it can't be proved; check that the reasoning holds.
2. Novelty (a gate): check the record and the code. falls if this is already done, already decided against, or deferred with a reason the proposal doesn't answer.
3. Worth (advice for the ranking, not a gate): weigh value against effort, and look for what the change would break or close off. Give your verdict and the strongest reason against.`

const context = `The project, as the discovery agents understood it: ${merged.understanding}

The yardstick: ${merged.yardstick}`

const deepen = (a, _, i) => agent(`${OPEN}

${EVIDENCE}

${RECORD}

${shared(5300 + i)}

${context}

Go deep on one area another agent named. Verify what it saw, check the area against the record, then work out what you'd change and measure its value against the yardstick. If on closer reading it needs nothing, say so (noChange) and why; that's a useful result.

${JSON.stringify({ name: a.name, summary: a.summary, evidence: a.evidence }, null, 2)}`,
  { label: `deepen:${a.name}`, phase: 'Deepen', schema: PROPOSAL })

const challenge = (p, a, i) => p && (p.noChange ? { proposal: p, cleared: true } :
  agent(`${EVIDENCE}

${RECORD}

${shared(5400 + i)}

${context}

Try to refute this proposal on three separate tests, judging each on its own. Answer falls only with a concrete reason, and give it; a judgment you'd make differently counts only if you can say why.
${TESTS}

${JSON.stringify(p, null, 2)}`,
    { label: `challenge:${a.name}`, phase: 'Challenge', schema: CHALLENGE })
    .then(c => {
      const v = c || {}
      const gates = [v.evidence, v.novelty].filter(x => x && x.verdict === 'falls')
      return {
        proposal: p,
        stands: gates.length === 0,
        reasons: gates.map(x => x.reason),
        contested: v.worth && v.worth.verdict === 'falls' ? v.worth.reason : '',
        unchecked: !c || [v.evidence, v.novelty, v.worth].some(x => !x || x.verdict === 'cannot-check'),
        corrections: [v.evidence, v.novelty, v.worth].map(x => x && x.correction).filter(Boolean),
      }
    }))

const results = await pipeline(picked, deepen, challenge)
const failed = picked.filter((_, i) => !results[i]).map(a => a.name)
if (failed.length) log(`deepen or challenge failed for: ${failed.join('; ')}`)
const cleared = results.filter(r => r && r.cleared)
const judged = results.filter(r => r && !r.cleared)
const kept = judged.filter(r => r.stands)
const dropped = judged.filter(r => !r.stands)
log(`${kept.length} proposal(s) stand, ${dropped.length} fell, ${cleared.length} found fine on closer reading`)

const material = {
  scope: ENV,
  understanding: merged.understanding,
  yardstick: merged.yardstick,
  disagreements: merged.disagreements,
  proposals: kept.map(r => ({ ...r.proposal, contested: r.contested, unchecked: r.unchecked, corrections: r.corrections })),
  checkedAndFine: cleared.map(r => ({ area: r.proposal.area, why: r.proposal.now })),
  dropped: dropped.map(r => ({ area: r.proposal.area, reasons: r.reasons })),
  notDeepened: [
    ...skipped.map(a => ({ name: a.name, summary: a.summary, why: 'over the cap' })),
    ...failed.map(name => ({ name, why: 'its agent failed' })),
  ],
}

phase('Report')
const report = await agent(`You are writing the report of a review in which agents chose their own areas to improve in this repository, went deep on each, and had each proposal challenged. Work only from the material below; don't read or change the repository, and don't add proposals of your own. Write Markdown for the project's maintainer, in the shape of docs/history/RELEASE-AUDIT.md:

1. Scope: the commit read, and what could and couldn't run (from scope).
2. The yardstick: whether the project states what success means for it, quoted with sources, or that it doesn't, and what the agents assumed instead. Then the project in one paragraph, and where the agents disagreed.
3. Which proposal to do first, and why.
4. A summary table: id (P1, P2…), area, status (TODO, or DECISION when it needs a call from the maintainer), effort, confidence.
5. Decisions for you: each proposal with a decision, framed as the question to answer, with the options and the agents' pick.
6. Proposals, ranked by value against effort: a heading per id, then Status / Now (with evidence) / Value / Change and first step / Effort / Risk / Record / Confidence, any correction a skeptic made, "Contested:" with the reason when the worth test went against it, and "Unverified" when a test couldn't be checked.
7. Checked and found fine, one line each.
8. Dropped, one line each with why; then not deepened, one line each.

${JSON.stringify(material, null, 2)}`,
  { label: 'report', phase: 'Report' })

return report || `The report agent failed. Raw material:\n\n${JSON.stringify(material, null, 2)}`
