const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const load = () => import('../scripts/post-x.mjs');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'post-x.mjs');

const NOTES =
  "Promptline now updates itself, and new installs start on a hotkey that doesn't collide with paste. " +
  'Builds on [v0.2.16](https://github.com/bekalpaslan/promptline/releases/tag/v0.2.16).\n\n' +
  '### Updates\n\n- **This is the last version you install by hand.**\n\n### Install\n\n`setup.exe`.\n';

// ---- postText -----------------------------------------------------------

test('postText is the lead paragraph without "Builds on", then the version and release page', async () => {
  const { postText } = await load();
  assert.equal(
    postText({ version: '0.2.17', notes: NOTES }),
    "Promptline now updates itself, and new installs start on a hotkey that doesn't collide with paste.\n\n" +
      'Promptline 0.2.17: https://github.com/bekalpaslan/promptline/releases/tag/v0.2.17',
  );
});

test('postText links the tag page, never latest', async () => {
  const { postText } = await load();
  const text = postText({ version: '1.2.3', notes: 'Lead.\n' });
  assert.ok(text.includes('/releases/tag/v1.2.3'), text);
  assert.ok(!text.includes('latest'), text);
});

test('leadSentence unwraps markdown links, joins wrapped lines and ignores CRLF', async () => {
  const { leadSentence } = await load();
  const md = 'See [the site](https://promptline.cc) for\r\nmore. Builds on [v0.1.0](x).\r\n\r\n### Later\r\n';
  assert.equal(leadSentence(md), 'See the site for more.');
});

test('postText throws on an empty lead or a bad version', async () => {
  const { postText } = await load();
  assert.throws(() => postText({ version: '0.2.17', notes: '\n\n' }));
  assert.throws(() => postText({ version: 'v0.2.17', notes: 'Lead.' }));
});

// ---- postLength ---------------------------------------------------------

test('postLength counts a url as 23 and Latin text as 1 per character', async () => {
  const { postLength } = await load();
  assert.equal(postLength('Hello'), 5);
  assert.equal(postLength('Out: https://github.com/bekalpaslan/promptline/releases/tag/v0.2.17'), 5 + 23);
  assert.equal(postLength('a https://x.co b https://example.com/very/long/path/indeed'), 5 + 46);
});

test('postLength counts CJK and emoji as 2, and typographic punctuation as 1', async () => {
  const { postLength } = await load();
  assert.equal(postLength('日本語'), 6);
  assert.equal(postLength('🚀'), 2);
  assert.equal(postLength('“quoted” – dash'), 15);
});

// ---- OAuth 1.0a ---------------------------------------------------------

// The worked example from X's "Creating a signature" page, with its published
// signature; the same page's header ordering.
const DOCS_VECTOR = {
  method: 'POST',
  url: 'https://api.twitter.com/1.1/statuses/update.json',
  credentials: {
    apiKey: 'xvz1evFS4wEEPTGEFPHBog',
    apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  },
  params: { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
  nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
  timestamp: 1318622958,
};

test('oauthHeader reproduces the signature from the X docs example', async () => {
  const { oauthHeader } = await load();
  const header = oauthHeader(DOCS_VECTOR);
  assert.ok(header.startsWith('OAuth '), header);
  assert.ok(header.includes('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"'), header);
  assert.ok(header.includes('oauth_signature_method="HMAC-SHA1"'), header);
  assert.ok(header.includes('oauth_version="1.0"'), header);
  // body params sign the request but are not in the header
  assert.ok(!header.includes('status='), header);
});

test('oauthHeader picks a fresh nonce and the current time when none are given', async () => {
  const { oauthHeader } = await load();
  const { nonce: _n, timestamp: _t, ...rest } = DOCS_VECTOR;
  const a = oauthHeader(rest);
  const b = oauthHeader(rest);
  assert.notEqual(a, b);
  const ts = Number(/oauth_timestamp="(\d+)"/.exec(a)[1]);
  assert.ok(Math.abs(ts - Date.now() / 1000) < 60);
});

test('percentEncode is RFC 3986: !*() and the space are escaped, unreserved chars are not', async () => {
  const { percentEncode } = await load();
  assert.equal(percentEncode("Ladies + Gentlemen!*()'"), 'Ladies%20%2B%20Gentlemen%21%2A%28%29%27');
  assert.equal(percentEncode('a-b_c.d~e'), 'a-b_c.d~e');
});

test('credentialsFromEnv names every missing variable', async () => {
  const { credentialsFromEnv } = await load();
  assert.throws(() => credentialsFromEnv({ X_API_KEY: 'k' }), /X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET/);
  assert.deepEqual(
    credentialsFromEnv({ X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_SECRET: 'ts' }),
    { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' },
  );
});

// ---- CLI ----------------------------------------------------------------

async function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-x-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const NO_CREDENTIALS = { ...process.env };
for (const n of ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']) delete NO_CREDENTIALS[n];

test('CLI --dry-run prints the post and its length, needs no credentials and touches no network', async () => {
  await withTmp((dir) => {
    fs.writeFileSync(path.join(dir, 'notes.md'), NOTES);
    const result = spawnSync(process.execPath, [SCRIPT, '--version', '9.9.9', '--notes', path.join(dir, 'notes.md'), '--dry-run'], {
      env: NO_CREDENTIALS,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const out = result.stdout;
    assert.ok(out.includes('Promptline 9.9.9: https://github.com/bekalpaslan/promptline/releases/tag/v9.9.9'), out);
    assert.ok(out.includes('(141 of 280 characters)'), out);
  });
});

test('CLI reads notes written by PowerShell 5.1 redirection (UTF-16 LE with BOM)', async () => {
  await withTmp((dir) => {
    fs.writeFileSync(path.join(dir, 'notes.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(NOTES.replace(/\n/g, '\r\n'), 'utf16le')]));
    const result = spawnSync(process.execPath, [SCRIPT, '--version', '9.9.9', '--notes', path.join(dir, 'notes.md'), '--dry-run'], {
      env: NO_CREDENTIALS,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('(141 of 280 characters)'), result.stdout);
    assert.ok(!result.stdout.includes('\0'), result.stdout);
  });
});

test('CLI --text posts that file verbatim and refuses one over the limit', async () => {
  await withTmp((dir) => {
    fs.writeFileSync(path.join(dir, 'short.txt'), 'A short post.\r\n');
    const ok = spawnSync(process.execPath, [SCRIPT, '--version', '9.9.9', '--text', path.join(dir, 'short.txt'), '--dry-run'], {
      env: NO_CREDENTIALS,
      encoding: 'utf8',
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(ok.stdout.startsWith('A short post.\n\n(13 of 280'), ok.stdout);

    fs.writeFileSync(path.join(dir, 'long.txt'), 'x'.repeat(281));
    const long = spawnSync(process.execPath, [SCRIPT, '--version', '9.9.9', '--text', path.join(dir, 'long.txt'), '--dry-run'], {
      env: NO_CREDENTIALS,
      encoding: 'utf8',
    });
    assert.notEqual(long.status, 0);
    assert.ok(long.stderr.includes('too long by 1'), long.stderr);
  });
});

test('CLI without credentials exits non-zero, naming them, before any request', async () => {
  await withTmp((dir) => {
    fs.writeFileSync(path.join(dir, 'notes.md'), NOTES);
    const result = spawnSync(process.execPath, [SCRIPT, '--version', '9.9.9', '--notes', path.join(dir, 'notes.md')], {
      env: NO_CREDENTIALS,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('X_API_KEY'), result.stderr);
  });
});

// A local stand-in for GitHub and X: the release page and the posts endpoint
function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        resolve(await fn(base));
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

// The server tests run the CLI asynchronously: a spawnSync would block the
// event loop the server needs to answer the child, and both would wait forever
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const CREDENTIALS = { ...process.env, X_API_KEY: 'key', X_API_SECRET: 'secret', X_ACCESS_TOKEN: 'token', X_ACCESS_SECRET: 'ts' };

test('CLI posts the text as JSON with an OAuth header once the release page answers 200', async () => {
  const seen = [];
  await withServer(
    (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        if (req.url === '/releases/tag/v9.9.9') return res.writeHead(200).end('release');
        if (req.url === '/2/tweets') {
          res.writeHead(201, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ data: { id: '1234567890', text: JSON.parse(body).text } }));
        }
        res.writeHead(404).end();
      });
    },
    (base) =>
      withTmp(async (dir) => {
        fs.writeFileSync(path.join(dir, 'notes.md'), NOTES);
        const result = await run(
          ['--version', '9.9.9', '--notes', path.join(dir, 'notes.md'), '--release-url', `${base}/releases/tag/v9.9.9`, '--api-url', `${base}/2/tweets`],
          CREDENTIALS,
        );
        assert.equal(result.status, 0, result.stderr);
        assert.ok(result.stdout.includes('posted https://x.com/i/web/status/1234567890'), result.stdout);
        assert.deepEqual(seen.map((r) => [r.method, r.url]), [['GET', '/releases/tag/v9.9.9'], ['POST', '/2/tweets']]);
        const post = seen[1];
        assert.ok(post.auth.startsWith('OAuth oauth_consumer_key="key"'), post.auth);
        assert.ok(post.auth.includes('oauth_token="token"'), post.auth);
        assert.ok(post.auth.includes('oauth_signature="'), post.auth);
        assert.deepEqual(Object.keys(JSON.parse(post.body)), ['text']);
        assert.ok(JSON.parse(post.body).text.endsWith('/releases/tag/v9.9.9'));
      }),
  );
});

test('CLI does not post when the release page is missing', async () => {
  const seen = [];
  await withServer(
    (req, res) => {
      seen.push(req.url);
      res.writeHead(404).end();
    },
    (base) =>
      withTmp(async (dir) => {
        fs.writeFileSync(path.join(dir, 'notes.md'), NOTES);
        const result = await run(
          ['--version', '9.9.9', '--notes', path.join(dir, 'notes.md'), '--release-url', `${base}/releases/tag/v9.9.9`, '--api-url', `${base}/2/tweets`],
          CREDENTIALS,
        );
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes('404'), result.stderr);
        assert.ok(result.stderr.includes('step 5'), result.stderr);
        assert.deepEqual(seen, ['/releases/tag/v9.9.9']);
      }),
  );
});

test('CLI reports a non-201 answer from X with its body and exits non-zero', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/releases/tag/v9.9.9') return res.writeHead(200).end();
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ title: 'Forbidden', detail: 'read-only token' }));
    },
    (base) =>
      withTmp(async (dir) => {
        fs.writeFileSync(path.join(dir, 'notes.md'), NOTES);
        const result = await run(
          ['--version', '9.9.9', '--notes', path.join(dir, 'notes.md'), '--release-url', `${base}/releases/tag/v9.9.9`, '--api-url', `${base}/2/tweets`],
          CREDENTIALS,
        );
        assert.notEqual(result.status, 0);
        const stderr = result.stderr;
        assert.ok(stderr.includes('403'), stderr);
        assert.ok(stderr.includes('read-only token'), stderr);
      }),
  );
});
