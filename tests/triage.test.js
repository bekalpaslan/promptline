const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '.claude', 'skills', 'dependabot', 'scripts', 'triage.cjs');

// The dependabot skill dismisses alerts on this script's table, so a `gh`
// that can't be run must never read as "nothing open". An empty PATH is
// the cheapest way to make every command it shells out to fail.
test('triage says "could not read" and exits 1 when gh cannot be run, never "none"', () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
  env.PATH = '';
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Open Dependabot PRs: could not read \(/);
  assert.match(r.stdout, /Open alerts: could not read \(/);
  assert.match(r.stdout, /Dependabot branches with no open PR: could not read \(/);
  assert.doesNotMatch(r.stdout, /: none/);
});
