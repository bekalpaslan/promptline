const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const load = () => import('../scripts/latest-json.mjs');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'latest-json.mjs');

// ---- buildFeed --------------------------------------------------------

test('buildFeed with both signatures uses the installer-specific keys and versioned urls', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({
    version: '0.2.17',
    notes: 'Notes.',
    pubDate: '2026-10-01T12:00:00.000Z',
    signatures: { nsis: 'sig-nsis\n', msi: 'sig-msi\n' },
  });
  assert.deepEqual(feed, {
    version: '0.2.17',
    notes: 'Notes.',
    pub_date: '2026-10-01T12:00:00.000Z',
    platforms: {
      'windows-x86_64-nsis': {
        signature: 'sig-nsis',
        url: 'https://github.com/bekalpaslan/promptline/releases/download/v0.2.17/Promptline_0.2.17_x64-setup.exe',
      },
      'windows-x86_64-msi': {
        signature: 'sig-msi',
        url: 'https://github.com/bekalpaslan/promptline/releases/download/v0.2.17/Promptline_0.2.17_x64_en-US.msi',
      },
    },
  });
});

test('buildFeed urls are versioned, never latest/download', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({
    version: '0.2.17',
    notes: '',
    pubDate: '2026-10-01T12:00:00.000Z',
    signatures: { nsis: 'sig' },
  });
  for (const p of Object.values(feed.platforms)) {
    assert.ok(!p.url.includes('latest/download'), p.url);
    assert.ok(p.url.includes('/releases/download/v0.2.17/'), p.url);
  }
});

test('buildFeed with only nsis omits the msi key', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({
    version: '0.2.17',
    notes: '',
    pubDate: '2026-10-01T12:00:00.000Z',
    signatures: { nsis: 'sig' },
  });
  assert.deepEqual(Object.keys(feed.platforms), ['windows-x86_64-nsis']);
});

test('buildFeed throws when signatures.nsis is missing or empty', async () => {
  const { buildFeed } = await load();
  assert.throws(() => buildFeed({ version: '0.2.17', notes: '', pubDate: 'x', signatures: {} }));
  assert.throws(() => buildFeed({ version: '0.2.17', notes: '', pubDate: 'x', signatures: { nsis: '   ' } }));
});

test('buildFeed throws when the version is not X.Y.Z or X.Y.Z-pre', async () => {
  const { buildFeed } = await load();
  assert.throws(() => buildFeed({ version: 'v0.2.17', notes: '', pubDate: 'x', signatures: { nsis: 'sig' } }));
  assert.throws(() => buildFeed({ version: '0.2', notes: '', pubDate: 'x', signatures: { nsis: 'sig' } }));
  // a pre-release suffix is allowed
  const { buildFeed: bf } = await load();
  assert.doesNotThrow(() => bf({ version: '0.3.0-pre.1', notes: '', pubDate: 'x', signatures: { nsis: 'sig' } }));
});

test('buildFeed echoes version and pub_date verbatim', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({ version: '1.2.3', notes: 'n', pubDate: '2026-01-01T00:00:00.000Z', signatures: { nsis: 'sig' } });
  assert.equal(feed.version, '1.2.3');
  assert.equal(feed.pub_date, '2026-01-01T00:00:00.000Z');
});

test('buildFeed baseUrl override is used verbatim, with only the given keys', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({
    version: '9.9.9',
    notes: '',
    pubDate: 'x',
    signatures: { nsis: 'sig' },
    baseUrl: 'http://127.0.0.1:8765/',
  });
  assert.deepEqual(Object.keys(feed.platforms), ['windows-x86_64-nsis']);
  assert.equal(feed.platforms['windows-x86_64-nsis'].url, 'http://127.0.0.1:8765/Promptline_9.9.9_x64-setup.exe');
});

// ---- feedNotes ----------------------------------------------------------

test('feedNotes drops ### Install and everything after it', async () => {
  const { feedNotes } = await load();
  const md = 'Lead sentence.\n\n### Changes\n- a thing\n\n### Install\n\n`setup.exe`. SmartScreen warns.\n';
  const notes = feedNotes(md);
  assert.ok(notes.includes('Lead sentence.'));
  assert.ok(notes.includes('### Changes'));
  assert.ok(!notes.includes('### Install'));
  assert.ok(!notes.includes('SmartScreen'));
  assert.equal(notes, notes.trim());
});

// ---- assetNames -----------------------------------------------------------

test('assetNames names the nsis and msi installers for a version', async () => {
  const { assetNames } = await load();
  assert.deepEqual(assetNames('0.2.17'), {
    nsis: 'Promptline_0.2.17_x64-setup.exe',
    msi: 'Promptline_0.2.17_x64_en-US.msi',
  });
});

// ---- CLI --------------------------------------------------------------

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latest-json-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI writes the expected feed from a temp bundle dir', () => {
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, 'nsis'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'msi'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nsis', 'Promptline_9.9.9_x64-setup.exe.sig'), 'nsis-sig\n');
    fs.writeFileSync(path.join(dir, 'msi', 'Promptline_9.9.9_x64_en-US.msi.sig'), 'msi-sig\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'Lead.\n\n### Install\nignored\n');
    const out = path.join(dir, 'latest.json');

    const result = spawnSync(process.execPath, [
      SCRIPT,
      '--version', '9.9.9',
      '--notes', path.join(dir, 'notes.md'),
      '--bundle-dir', dir,
      '--out', out,
      '--pub-date', '2026-10-01T12:00:00.000Z',
    ]);

    assert.equal(result.status, 0, result.stderr.toString());
    const written = fs.readFileSync(out, 'utf8');
    assert.ok(written.endsWith('\n'));
    const feed = JSON.parse(written);
    assert.equal(feed.version, '9.9.9');
    assert.equal(feed.notes, 'Lead.');
    assert.deepEqual(Object.keys(feed.platforms), ['windows-x86_64-nsis', 'windows-x86_64-msi']);
    assert.equal(feed.platforms['windows-x86_64-nsis'].signature, 'nsis-sig');
  });
});

test('CLI exits non-zero and names the missing file when the msi .sig is absent', () => {
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, 'nsis'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nsis', 'Promptline_9.9.9_x64-setup.exe.sig'), 'nsis-sig\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'Lead.\n');
    const out = path.join(dir, 'latest.json');

    const result = spawnSync(process.execPath, [
      SCRIPT,
      '--version', '9.9.9',
      '--notes', path.join(dir, 'notes.md'),
      '--bundle-dir', dir,
      '--out', out,
    ]);

    assert.notEqual(result.status, 0);
    const stderr = result.stderr.toString();
    assert.ok(stderr.includes('missing'));
    assert.ok(stderr.includes('x64_en-US.msi.sig'));
    assert.ok(!fs.existsSync(out));
  });
});
