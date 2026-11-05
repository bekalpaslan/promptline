const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const load = () => import('../scripts/latest-json.mjs');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'latest-json.mjs');

// A .sig as `tauri build` writes it: base64 of minisign's four lines
const sig = (version, label = 'key', comment = `timestamp:1\tfile:app.exe\tversion:${version}`) =>
  Buffer.from(`untrusted comment: signature from tauri secret key\n${label}\ntrusted comment: ${comment}\nglobal\n`).toString('base64');

// ---- buildFeed --------------------------------------------------------

test('buildFeed with both signatures uses the installer-specific keys and versioned urls', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({
    version: '0.2.17',
    notes: 'Notes.',
    pubDate: '2026-10-01T12:00:00.000Z',
    signatures: { nsis: `${sig('0.2.17', 'nsis')}\n`, msi: `${sig('0.2.17', 'msi')}\n` },
  });
  assert.deepEqual(feed, {
    version: '0.2.17',
    notes: 'Notes.',
    pub_date: '2026-10-01T12:00:00.000Z',
    platforms: {
      'windows-x86_64-nsis': {
        signature: sig('0.2.17', 'nsis'),
        url: 'https://github.com/bekalpaslan/promptline/releases/download/v0.2.17/Promptline_0.2.17_x64-setup.exe',
      },
      'windows-x86_64-msi': {
        signature: sig('0.2.17', 'msi'),
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
    signatures: { nsis: sig('0.2.17') },
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
    signatures: { nsis: sig('0.2.17') },
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
  assert.throws(() => buildFeed({ version: 'v0.2.17', notes: '', pubDate: 'x', signatures: { nsis: sig('v0.2.17') } }));
  assert.throws(() => buildFeed({ version: '0.2', notes: '', pubDate: 'x', signatures: { nsis: sig('0.2') } }));
  // a pre-release suffix is allowed
  const { buildFeed: bf } = await load();
  assert.doesNotThrow(() => bf({ version: '0.3.0-pre.1', notes: '', pubDate: 'x', signatures: { nsis: sig('0.3.0-pre.1') } }));
});

test('buildFeed echoes version and pub_date verbatim', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({ version: '1.2.3', notes: 'n', pubDate: '2026-01-01T00:00:00.000Z', signatures: { nsis: sig('1.2.3') } });
  assert.equal(feed.version, '1.2.3');
  assert.equal(feed.pub_date, '2026-01-01T00:00:00.000Z');
});

test('buildFeed baseUrl override is used verbatim, with only the given keys', async () => {
  const { buildFeed } = await load();
  const feed = buildFeed({
    version: '9.9.9',
    notes: '',
    pubDate: 'x',
    signatures: { nsis: sig('9.9.9') },
    baseUrl: 'http://127.0.0.1:8765/',
  });
  assert.deepEqual(Object.keys(feed.platforms), ['windows-x86_64-nsis']);
  assert.equal(feed.platforms['windows-x86_64-nsis'].url, 'http://127.0.0.1:8765/Promptline_9.9.9_x64-setup.exe');
});

// ---- the signed version (fresh-eyes 2026-11-02, P1d) --------------------

test('signedVersion reads the version out of the trusted comment', async () => {
  const { signedVersion } = await load();
  assert.equal(signedVersion(sig('1.2.3')), '1.2.3');
  assert.equal(signedVersion(`${sig('1.2.3')}\n`), '1.2.3');
  assert.equal(signedVersion(sig('', 'key', 'timestamp:1\tfile:app.exe')), null);
  // A file named like the field is not the field
  assert.equal(signedVersion(sig('', 'key', 'timestamp:1\tfile:app-version:2.exe')), null);
  assert.equal(signedVersion('not a signature'), null);
});

test('buildFeed refuses a signature that names no version, as 0.2.17 to 0.2.25 did', async () => {
  const { buildFeed } = await load();
  const legacy = sig('', 'key', 'timestamp:1\tfile:app.exe');
  const input = { version: '1.2.3', notes: '', pubDate: 'x' };
  assert.throws(() => buildFeed({ ...input, signatures: { nsis: legacy } }), /nsis signature names no version/);
  assert.throws(() => buildFeed({ ...input, signatures: { nsis: sig('1.2.3'), msi: legacy } }), /msi signature names no version/);
});

test('buildFeed refuses a signature made for another version', async () => {
  const { buildFeed } = await load();
  assert.throws(
    () => buildFeed({ version: '1.2.3', notes: '', pubDate: 'x', signatures: { nsis: sig('1.2.2') } }),
    /names version 1\.2\.2, not 1\.2\.3/,
  );
});

test('every signature in the published feed names its version', async () => {
  const { signedVersion } = await load();
  const feed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'latest.json'), 'utf8'));
  for (const [key, platform] of Object.entries(feed.platforms)) {
    assert.equal(signedVersion(platform.signature), feed.version, key);
  }
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
    fs.writeFileSync(path.join(dir, 'nsis', 'Promptline_9.9.9_x64-setup.exe.sig'), `${sig('9.9.9', 'nsis')}\n`);
    fs.writeFileSync(path.join(dir, 'msi', 'Promptline_9.9.9_x64_en-US.msi.sig'), `${sig('9.9.9', 'msi')}\n`);
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
    assert.equal(feed.platforms['windows-x86_64-nsis'].signature, sig('9.9.9', 'nsis'));
  });
});

test('CLI reads notes written by PowerShell 5.1 redirection (UTF-16 LE with BOM)', () => {
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, 'nsis'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'msi'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nsis', 'Promptline_9.9.9_x64-setup.exe.sig'), `${sig('9.9.9', 'nsis')}\n`);
    fs.writeFileSync(path.join(dir, 'msi', 'Promptline_9.9.9_x64_en-US.msi.sig'), `${sig('9.9.9', 'msi')}\n`);
    fs.writeFileSync(
      path.join(dir, 'notes.md'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Lead.\r\n\r\n### Changes\r\n- a\r\n\r\n### Install\r\nignored\r\n', 'utf16le')]),
    );
    const out = path.join(dir, 'latest.json');
    const result = spawnSync(process.execPath, [SCRIPT, '--version', '9.9.9', '--notes', path.join(dir, 'notes.md'), '--bundle-dir', dir, '--out', out]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).notes, 'Lead.\n\n### Changes\n- a');
  });
});

test('CLI exits non-zero and writes nothing when a .sig names no version', () => {
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, 'nsis'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'msi'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nsis', 'Promptline_9.9.9_x64-setup.exe.sig'), `${sig('9.9.9')}\n`);
    fs.writeFileSync(path.join(dir, 'msi', 'Promptline_9.9.9_x64_en-US.msi.sig'), `${sig('', 'key', 'timestamp:1\tfile:app.msi')}\n`);
    fs.writeFileSync(path.join(dir, 'notes.md'), 'Lead.\n');
    const out = path.join(dir, 'latest.json');

    const result = spawnSync(process.execPath, [SCRIPT, '--version', '9.9.9', '--notes', path.join(dir, 'notes.md'), '--bundle-dir', dir, '--out', out]);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.toString().includes('--app-version 9.9.9'));
    assert.ok(!fs.existsSync(out));
  });
});

test('CLI exits non-zero and names the missing file when the msi .sig is absent', () => {
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, 'nsis'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nsis', 'Promptline_9.9.9_x64-setup.exe.sig'), `${sig('9.9.9', 'nsis')}\n`);
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
