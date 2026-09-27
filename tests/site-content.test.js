const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', 'site', 'index.html');
const read = () => fs.readFileSync(SITE, 'utf8').replace(/\r\n/g, '\n');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m),
  );
}

// What a sighted visitor reads: no <head>, scripts, styles, icons, comments or attributes (alt and aria-label included)
function visibleText(html) {
  return decode(
    html
      .replace(/<head[\s\S]*?<\/head>/i, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

const count = (text, phrase) => text.toLowerCase().split(phrase.toLowerCase()).length - 1;

// The markup from `open` to the first </section> after it. If `open` isn't
// itself the start of a <section> tag, widen to the enclosing <section>.
function section(html, open) {
  const i = html.indexOf(open);
  assert.ok(i >= 0, `missing ${open}`);
  const start = html.slice(i, i + 8) === '<section' ? i : html.lastIndexOf('<section', i);
  assert.ok(start >= 0, `no enclosing <section> for ${open}`);
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}

test('visibleText drops head, script, style, svg, comments and attributes, and decodes entities', () => {
  const html = '<head><title>prompt manager</title></head><body><img alt="prompt manager"><p>A prompt&nbsp;manager</p><script>"prompt manager"</script></body>';
  assert.equal(count(visibleText(html), 'prompt manager'), 1);
});

test('the hero h1 reads "Copy the error. Hit the hotkey. Paste a real prompt."', () => {
  const hero = section(read(), '<section class="wrap hero">');
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(hero);
  assert.ok(h1, 'missing hero <h1>');
  assert.equal(visibleText(h1[1]), 'Copy the error. Hit the hotkey. Paste a real prompt.');
});

test('the hero has a three-item <ul class="pitch"> in pitch order before the .cta', () => {
  const html = read();
  const hero = section(html, '<section class="wrap hero">');
  const pitchMatch = /<ul class="pitch">([\s\S]*?)<\/ul>/.exec(hero);
  assert.ok(pitchMatch, 'missing <ul class="pitch">');
  const items = [...pitchMatch[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => visibleText(m[1]));
  assert.equal(items.length, 3);
  assert.match(items[0], /hotkey/i);
  assert.ok(items[0].includes('Ctrl Alt V'), 'li 1 should name the hotkey Ctrl Alt V');
  assert.match(items[1], /JSON/);
  assert.match(items[1], /Claude Code/);
  assert.ok(items[2].startsWith('No telemetry'), 'li 3 should start with "No telemetry"');
  assert.ok(items[2].includes('at startup and once a day'), 'li 3 should say when the update check runs');
  assert.ok(items[2].includes('off in a click'), 'li 3 should say the check is off in a click');
  assert.ok(hero.indexOf('<h1') < hero.indexOf('<ul class="pitch">'), 'h1 must come before the pitch');
  assert.ok(hero.indexOf('<ul class="pitch">') < hero.indexOf('class="cta"'), 'the pitch must come before Download');
});

test('the trust strip agrees with the hero privacy line', () => {
  const trust = section(read(), '<section class="wrap trust">');
  const text = visibleText(trust);
  assert.match(text, /at startup and once a day/i);
  assert.ok(text.includes('off in a click'));
});

test('"people who talk to AI all day" appears nowhere in site/index.html', () => {
  assert.equal(count(read(), 'people who talk to AI all day'), 0);
});

test('the <title> still carries "your prompt vocabulary, one hotkey away"', () => {
  const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(read());
  assert.ok(titleMatch);
  assert.ok(titleMatch[1].includes('your prompt vocabulary, one hotkey away'));
});
