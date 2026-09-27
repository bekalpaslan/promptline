const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// scripts/clip-encode.mjs is ESM; Node 22.12+ loads it through require()
const enc = require('../scripts/clip-encode.mjs');

const opts = { framesDir: 'F', outDir: 'O', palette: 'P.png' };

test('ffmpegCandidates orders FFMPEG, PATH, WinGet Links, Scoop shims, dropping unset ones', () => {
  const env = { FFMPEG: 'C:\\f\\ffmpeg.exe', LOCALAPPDATA: 'C:\\L', USERPROFILE: 'C:\\U' };
  assert.deepEqual(enc.ffmpegCandidates(env), [
    'C:\\f\\ffmpeg.exe',
    'ffmpeg',
    path.join('C:\\L', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    path.join('C:\\U', 'scoop', 'shims', 'ffmpeg.exe'),
  ]);
  assert.deepEqual(enc.ffmpegCandidates({}), ['ffmpeg']);
});

test('findFfmpeg returns the first candidate that probes true, else null', () => {
  const env = { FFMPEG: 'a', LOCALAPPDATA: 'L', USERPROFILE: 'U' };
  const candidates = enc.ffmpegCandidates(env);
  const found = enc.findFfmpeg(env, (c) => c === candidates[2]);
  assert.equal(found, candidates[2]);
  assert.equal(enc.findFfmpeg(env, () => false), null);
});

test('encodeArgs mp4: framerate, input, libx264, yuv420p, faststart, no audio, output path', () => {
  const args = enc.encodeArgs('dark', 'mp4', opts);
  assert.ok(args.includes('-framerate'));
  assert.ok(args.includes('15'));
  assert.ok(args.includes('-i'));
  assert.ok(args.includes(path.join('F', 'dark', '%04d.png')));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.includes('-an'));
  assert.equal(args.at(-1), path.join('O', 'clip-dark.mp4'));
});

test('encodeArgs webm: libvpx-vp9, constant quality (-b:v 0), output path', () => {
  const args = enc.encodeArgs('dark', 'webm', opts);
  assert.ok(args.includes('libvpx-vp9'));
  const i = args.indexOf('-b:v');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], '0');
  assert.equal(args.at(-1), path.join('O', 'clip-dark.webm'));
});

test('encodeArgs palette: -vf contains palettegen', () => {
  const args = enc.encodeArgs('light', 'palette', opts);
  const i = args.indexOf('-vf');
  assert.ok(i >= 0);
  assert.ok(args[i + 1].includes('palettegen'));
});

test('encodeArgs gif: palette as second input, -lavfi with paletteuse/fps/scale, looped, output path', () => {
  const args = enc.encodeArgs('light', 'gif', opts);
  const secondInputIndex = args.lastIndexOf('-i');
  assert.equal(args[secondInputIndex + 1], 'P.png');
  const i = args.indexOf('-lavfi');
  assert.ok(i >= 0);
  assert.ok(args[i + 1].includes('paletteuse'));
  assert.ok(args[i + 1].includes('fps=10'));
  assert.ok(args[i + 1].includes('scale=720:-1'));
  const li = args.indexOf('-loop');
  assert.ok(li >= 0);
  assert.equal(args[li + 1], '0');
  assert.equal(args.at(-1), path.join('O', 'clip-light.gif'));
});

test('encodeArgs throws on an unknown format', () => {
  assert.throws(() => enc.encodeArgs('light', 'avi', opts), /unknown format avi/);
});

test('MISSING names the winget install and npm run clip', () => {
  assert.ok(enc.MISSING.includes('winget install Gyan.FFmpeg'));
  assert.ok(enc.MISSING.includes('npm run clip'));
});
