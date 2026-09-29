const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const load = () => import('../scripts/snapshot.mjs');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'snapshot.mjs');

const GRAPHQL = {
  data: { repository: { stargazerCount: 1, forkCount: 0, issues: { totalCount: 0 }, discussions: { totalCount: 0 } } },
};
// v0.2.16 comes first on purpose: latest is chosen by date, not by position.
const RELEASES = [
  {
    tag_name: 'v0.2.16',
    draft: false,
    prerelease: false,
    published_at: '2026-09-24T10:00:00Z',
    assets: [
      { name: 'Promptline-setup.exe', download_count: 1 },
      { name: 'Promptline_0.2.16_x64-setup.exe', download_count: 20 },
      { name: 'Promptline_0.2.16_x64_en-US.msi', download_count: 4 },
    ],
  },
  {
    tag_name: 'v0.2.17',
    draft: false,
    prerelease: false,
    published_at: '2026-09-27T10:00:00Z',
    assets: [
      { name: 'Promptline-setup.exe', download_count: 3 },
      { name: 'Promptline_0.2.17_x64-setup.exe', download_count: 11 },
      { name: 'Promptline_0.2.17_x64_en-US.msi', download_count: 1 },
    ],
  },
  {
    tag_name: 'v0.2.18',
    draft: true,
    prerelease: false,
    published_at: '2026-09-29T10:00:00Z',
    assets: [{ name: 'Promptline-setup.exe', download_count: 99 }],
  },
  {
    tag_name: 'v0.3.0-beta.1',
    draft: false,
    prerelease: true,
    published_at: '2026-09-28T10:00:00Z',
    assets: [],
  },
];
const VIEWS = {
  count: 2,
  uniques: 1,
  views: [
    { timestamp: '2026-09-16T00:00:00Z', count: 1, uniques: 1 },
    { timestamp: '2026-09-29T00:00:00Z', count: 1, uniques: 1 },
  ],
};
const CLONES = { count: 412, uniques: 126, clones: [] };
const REFERRERS = [];

const ROW = '| 2026-09-29 | 1 | 0 | 0 | 0 | v0.2.17: 15 | 40 | 2 (1) | 412 (126) | none | 0 |';

const write = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

function fixtureDir({ traffic = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
  write(dir, 'graphql.json', GRAPHQL);
  write(dir, 'releases.json', RELEASES);
  if (traffic) {
    write(dir, 'views.json', VIEWS);
    write(dir, 'clones.json', CLONES);
    write(dir, 'referrers.json', REFERRERS);
  }
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

// A fake gh: records the args (after `api`) and answers from the fixtures.
function fakeGh({ trafficFails = false, graphqlFails = false } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const first = args[0];
    if (first === 'graphql') {
      if (graphqlFails) throw new Error('gh: HTTP 502 Bad Gateway');
      return GRAPHQL;
    }
    if (first.includes('/traffic/')) {
      if (trafficFails) throw new Error('gh: HTTP 403 Must have push access');
      if (first.endsWith('/traffic/views')) return VIEWS;
      if (first.endsWith('/traffic/clones')) return CLONES;
      if (first.endsWith('/traffic/popular/referrers')) return REFERRERS;
    }
    if (first === 'repos/bekalpaslan/promptline/releases') return [RELEASES];
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { gh, calls };
}

// ---- summarizeReleases --------------------------------------------------

test('summarizeReleases skips drafts, sums every asset and picks latest by date', async () => {
  const { summarizeReleases } = await load();
  const s = summarizeReleases(RELEASES);
  assert.equal(s.total, 40);
  assert.deepEqual(s.latest, {
    tag: 'v0.2.17',
    publishedAt: '2026-09-27T10:00:00Z',
    downloads: 15,
    assets: [
      { name: 'Promptline-setup.exe', downloads: 3 },
      { name: 'Promptline_0.2.17_x64-setup.exe', downloads: 11 },
      { name: 'Promptline_0.2.17_x64_en-US.msi', downloads: 1 },
    ],
  });
});

test('summarizeReleases counts a release with no assets as 0 and never picks a prerelease as latest', async () => {
  const { summarizeReleases } = await load();
  const s = summarizeReleases([
    { tag_name: 'v0.3.0-beta.1', draft: false, prerelease: true, published_at: '2026-09-28T10:00:00Z', assets: [] },
    { tag_name: 'v0.1.0', draft: false, prerelease: false, published_at: '2026-08-01T10:00:00Z', assets: [] },
  ]);
  assert.equal(s.total, 0);
  assert.equal(s.latest.tag, 'v0.1.0');
  assert.equal(s.latest.downloads, 0);
});

test('summarizeReleases with no releases is total 0 and no latest', async () => {
  const { summarizeReleases } = await load();
  assert.deepEqual(summarizeReleases([]), { total: 0, latest: null });
});

// ---- summarizeTraffic ---------------------------------------------------

test('summarizeTraffic reads counts and uniques, the window dates, and sorts referrers by count then name', async () => {
  const { summarizeTraffic } = await load();
  const t = summarizeTraffic({
    views: VIEWS,
    clones: CLONES,
    referrers: [
      { referrer: 'github.com', count: 4, uniques: 2 },
      { referrer: 'news.ycombinator.com', count: 9, uniques: 6 },
      { referrer: 'a.example', count: 4, uniques: 1 },
    ],
  });
  assert.equal(t.views, 2);
  assert.equal(t.viewsUniques, 1);
  assert.equal(t.clones, 412);
  assert.equal(t.clonesUniques, 126);
  assert.equal(t.windowStart, '2026-09-16');
  assert.equal(t.windowEnd, '2026-09-29');
  assert.deepEqual(
    t.referrers.map((r) => r.referrer),
    ['news.ycombinator.com', 'a.example', 'github.com'],
  );
});

test('summarizeTraffic gives null, not 0, for a null input (403)', async () => {
  const { summarizeTraffic } = await load();
  const t = summarizeTraffic({ views: null, clones: null, referrers: null });
  assert.equal(t.views, null);
  assert.equal(t.viewsUniques, null);
  assert.equal(t.clones, null);
  assert.equal(t.clonesUniques, null);
  assert.equal(t.referrers, null);
  assert.equal(t.windowStart, null);
});

// ---- formatReferrers ----------------------------------------------------

test('formatReferrers prints none for an empty list and n/a for a missing one', async () => {
  const { formatReferrers } = await load();
  assert.equal(formatReferrers([]), 'none');
  assert.equal(formatReferrers(null), 'n/a');
});

test('formatReferrers prints name count/uniques, at most five', async () => {
  const { formatReferrers } = await load();
  assert.equal(
    formatReferrers([
      { referrer: 'news.ycombinator.com', count: 9, uniques: 6 },
      { referrer: 'github.com', count: 4, uniques: 2 },
    ]),
    'news.ycombinator.com 9/6, github.com 4/2',
  );
  const seven = Array.from({ length: 7 }, (_, i) => ({ referrer: `r${i}`, count: 1, uniques: 1 }));
  assert.equal(formatReferrers(seven).split(', ').length, 5);
});

// ---- formatRow / HEADER / buildSnapshot ---------------------------------

const SNAPSHOT = {
  date: '2026-09-29',
  stars: 1,
  forks: 0,
  openIssues: 0,
  discussions: 0,
  latest: { tag: 'v0.2.17', downloads: 15 },
  totalDownloads: 40,
  views: 2,
  viewsUniques: 1,
  clones: 412,
  clonesUniques: 126,
  referrers: [],
  donations: '0',
};

test('formatRow prints the exact row for a fixed snapshot', async () => {
  const { formatRow } = await load();
  assert.equal(formatRow(SNAPSHOT), ROW);
});

test('formatRow escapes a pipe inside a referrer name', async () => {
  const { formatRow } = await load();
  const row = formatRow({ ...SNAPSHOT, referrers: [{ referrer: 'a|b.example', count: 2, uniques: 1 }] });
  assert.ok(row.includes('a\\|b.example 2/1'), row);
});

test('formatRow prints n/a for missing traffic and none for no latest release', async () => {
  const { formatRow } = await load();
  const row = formatRow({
    ...SNAPSHOT,
    latest: null,
    views: null,
    viewsUniques: null,
    clones: null,
    clonesUniques: null,
    referrers: null,
  });
  assert.equal(row, '| 2026-09-29 | 1 | 0 | 0 | 0 | none | 40 | n/a | n/a | n/a | 0 |');
});

test('HEADER is the two header lines of the Snapshot table', async () => {
  const { HEADER } = await load();
  assert.equal(
    HEADER,
    '| Date | Stars | Forks | Open issues | Discussions | Latest release: downloads | All releases: downloads | Views 14d (unique) | Clones 14d (unique) | Top referrers | Donations |\n' +
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
});

test('buildSnapshot maps the raw collection into the row input and defaults donations to ?', async () => {
  const { buildSnapshot, formatRow, collect } = await load();
  const raw = await collect({ gh: fakeGh().gh });
  const s = buildSnapshot(raw, { date: '2026-09-29', donations: '0' });
  assert.equal(formatRow(s), ROW);
  assert.equal(buildSnapshot(raw, { date: '2026-09-29' }).donations, '?');
});

// ---- collect ------------------------------------------------------------

test('collect asks gh for graphql, the paginated releases and the three traffic paths', async () => {
  const { collect } = await load();
  const { gh, calls } = fakeGh();
  const raw = await collect({ gh });
  const firsts = calls.map((c) => c[0]);
  assert.ok(firsts.includes('graphql'), firsts.join());
  const rel = calls.find((c) => c[0] === 'repos/bekalpaslan/promptline/releases');
  assert.ok(rel.includes('--paginate') && rel.includes('--slurp'), rel.join(' '));
  for (const p of ['traffic/views', 'traffic/clones', 'traffic/popular/referrers']) {
    assert.ok(firsts.includes(`repos/bekalpaslan/promptline/${p}`), p);
  }
  const gql = calls.find((c) => c[0] === 'graphql');
  assert.ok(gql.includes('owner=bekalpaslan') && gql.includes('name=promptline'), gql.join(' '));
  assert.equal(raw.stars, 1);
  assert.equal(raw.releases.length, 4, 'pages are flattened');
});

test('collect gives null traffic, without throwing, when gh answers HTTP 403', async () => {
  const { collect } = await load();
  const raw = await collect({ gh: fakeGh({ trafficFails: true }).gh });
  assert.equal(raw.views, null);
  assert.equal(raw.clones, null);
  assert.equal(raw.referrers, null);
  assert.equal(raw.stars, 1);
});

test('collect rejects when the graphql call fails', async () => {
  const { collect } = await load();
  await assert.rejects(collect({ gh: fakeGh({ graphqlFails: true }).gh }), /502/);
});

// ---- CLI ----------------------------------------------------------------

test('CLI with --fixture prints the row, the latest-release detail and the traffic window', () => {
  const dir = fixtureDir();
  try {
    const r = run(['--fixture', dir, '--date', '2026-09-29', '--donations', '0']);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split(/\r?\n/);
    assert.equal(lines[0], ROW);
    const detail = lines.find((l) => l.startsWith('latest v0.2.17'));
    assert.ok(detail, r.stdout);
    assert.ok(detail.includes('(2026-09-27)'), detail);
    assert.ok(detail.includes('Promptline-setup.exe 3'), detail);
    assert.ok(detail.includes('Promptline_0.2.17_x64-setup.exe 11'), detail);
    assert.ok(detail.includes('Promptline_0.2.17_x64_en-US.msi 1'), detail);
    assert.ok(r.stdout.includes('2026-09-16..2026-09-29'), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI with a missing traffic file prints n/a cells like a 403', () => {
  const dir = fixtureDir({ traffic: false });
  try {
    const r = run(['--fixture', dir, '--date', '2026-09-29', '--donations', '0']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.split(/\r?\n/)[0], '| 2026-09-29 | 1 | 0 | 0 | 0 | v0.2.17: 15 | 40 | n/a | n/a | n/a | 0 |');
    assert.ok(r.stdout.includes('needs push access'), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --header prints the table header before the row', () => {
  const dir = fixtureDir();
  try {
    const r = run(['--fixture', dir, '--date', '2026-09-29', '--donations', '0', '--header']);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split(/\r?\n/);
    assert.ok(lines[0].startsWith('| Date | Stars |'), lines[0]);
    assert.equal(lines[1], '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    assert.equal(lines[2], ROW);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --json prints the raw collected object as JSON', () => {
  const dir = fixtureDir();
  try {
    const r = run(['--fixture', dir, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const raw = JSON.parse(r.stdout);
    assert.equal(raw.stars, 1);
    assert.equal(raw.views.count, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects a --repo that is not owner/name with a snapshot: message', () => {
  const r = run(['--repo', 'nope']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith('snapshot:'), r.stderr);
});
