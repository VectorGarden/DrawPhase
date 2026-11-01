#!/usr/bin/env node
/* ==========================================================================
   Draw Phase — checks on share links and the stored copy.

       node test/share.test.js

   A link is a promise that outlives the code that made it. Links shared
   before comparisons existed are in chats and posts already, so the format
   for one setup has to stay byte for byte what it was, and those links have
   to keep opening. A comparison adds a second shape beside it, not instead
   of it.

   The other half is what comes in. Links and storage are untrusted, and
   anything they hold must come out as a setup the page can render, or as
   nothing at all — never as something that throws on its way into the form.
   ========================================================================== */

'use strict';

var share = require('../assets/share.js');

var failures = [];
var checks = 0;

function ok(condition, label, detail) {
  checks++;
  if (!condition) failures.push(label + (detail ? '\n      ' + detail : ''));
}

function same(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(a === e, label, 'expected ' + e + '\n      got      ' + a);
}

function report(name) {
  console.log('  ✓ ' + name);
}

/* Raw base64url over any JSON value, for building links by hand. */
function token(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* A one-line setup from rows of [name, amt, min, max], the way the page
   always described one. */
function setup(deck, hand, rows) {
  return {
    deck: deck, hand: hand,
    groups: rows.map(function (r) { return { name: r[0], amt: r[1] }; }),
    lines: [rows.map(function (r) { return { min: r[2], max: r[3] }; })]
  };
}

/* The same setup as it was stored before either/or lines: needs on the groups. */
function oldShape(s) {
  return {
    deck: s.deck, hand: s.hand,
    groups: s.groups.map(function (g, i) {
      return { name: g.name, amt: g.amt, min: s.lines[0][i].min, max: s.lines[0][i].max };
    })
  };
}

var A = setup(40, 5, [['Starters', 12, 1, 5], ['Hand traps', 9, 1, 5]]);
var B = setup(40, 5, [['Starters', 13, 1, 5], ['Hand traps', 8, 1, 5]]);

/* A with a second line: no hand trap needed if you open two starters. */
var EITHER = {
  deck: 40, hand: 5,
  groups: A.groups,
  lines: [A.lines[0], [{ min: 2, max: 5 }, { min: 0, max: 5 }]]
};

/* --------------------------------------------------------------------------
   1. One setup: the format links have always used
   -------------------------------------------------------------------------- */

(function () {
  /* The encoder as it stood before comparisons, verbatim apart from Buffer
     standing in for btoa. A single setup must still come out identical. */
  function legacyEncode(s) {
    s = oldShape(s);
    return token({
      d: s.deck,
      h: s.hand,
      g: s.groups.map(function (g) { return [g.name, g.amt, g.min, g.max]; })
    });
  }

  ok(share.encodeLink([A]) === legacyEncode(A),
     'a single setup should encode exactly as links always have',
     share.encodeLink([A]) + ' vs ' + legacyEncode(A));
  same(share.decodeLink(legacyEncode(A)), [A], 'a link made before comparisons should still open');
  same(share.decodeLink(share.encodeLink([A])), [A], 'a single setup should survive a round trip');

  var named = setup(40, 5, [['Ash Blossom & Joyous Spring ✿', 3, 1, 3]]);
  same(share.decodeLink(share.encodeLink([named])), [named], 'non-ASCII names should survive a round trip');

  var token1 = share.encodeLink([A]);
  ok(/^[A-Za-z0-9_-]+$/.test(token1), 'a token should be URL-safe, with no padding', token1);

  report('one setup encodes as it always did, and old links still open');
})();

/* --------------------------------------------------------------------------
   2. Two setups
   -------------------------------------------------------------------------- */

(function () {
  same(share.decodeLink(share.encodeLink([A, B])), [A, B], 'a comparison should survive a round trip, in order');
  same(share.decodeLink(share.encodeLink([B, A])), [B, A], 'B should not swap places with A');

  var three = token({ c: [A, B, A].map(function (s) {
    s = oldShape(s);
    return { d: s.deck, h: s.hand, g: s.groups.map(function (g) { return [g.name, g.amt, g.min, g.max]; }) };
  }) });
  same(share.decodeLink(three), [A, B], 'a comparison should hold at most two setups');

  var halfBroken = token({ c: [null, { d: 40, h: 5, g: [['Starters', 12, 1, 5], ['Hand traps', 9, 1, 5]] }] });
  same(share.decodeLink(halfBroken), [A], 'a comparison with one half broken should open the half that survived');

  report('two setups round-trip, in order, and a broken half is dropped');
})();

/* --------------------------------------------------------------------------
   2b. Either/or lines
   -------------------------------------------------------------------------- */

(function () {
  same(share.decodeLink(share.encodeLink([EITHER])), [EITHER], 'either/or lines should survive a round trip');
  same(share.decodeLink(share.encodeLink([EITHER, B])), [EITHER, B], 'lines should survive inside a comparison');

  var g = JSON.parse(Buffer.from(share.encodeLink([EITHER]).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  same(g.g, [['Starters', 12, 1, 5], ['Hand traps', 9, 1, 5]], 'the first line should still be carried in g');
  same(g.l, [[[2, 5], [0, 5]]], 'only the lines after the first should go in l');

  var four = { deck: 40, hand: 5, groups: A.groups, lines: [] };
  for (var i = 0; i < 6; i++) four.lines.push([{ min: i % 2, max: 5 }, { min: 1, max: 5 }]);
  ok(share.decodeLink(share.encodeLink([four]))[0].lines.length === share.MAX_LINES,
     'a setup should keep at most ' + share.MAX_LINES + ' lines');

  /* Lines that arrive short, long or broken still get a need per group. */
  var ragged = token({ d: 40, h: 5, g: [['Starters', 12, 1, 5], ['Hand traps', 9, 1, 5]], l: [[[2, 5]], 'x', [[0, 1], [0, 1], [9, 9]]] });
  var out = share.decodeLink(ragged)[0];
  same(out.lines, [
    [{ min: 1, max: 5 }, { min: 1, max: 5 }],
    [{ min: 2, max: 5 }, { min: 0, max: 0 }],
    [{ min: 0, max: 0 }, { min: 0, max: 0 }],
    [{ min: 0, max: 1 }, { min: 0, max: 1 }]
  ], 'ragged lines should be squared up to one need per group');

  report('either/or lines round-trip, and only the extra lines change the link');
})();

/* --------------------------------------------------------------------------
   3. Whatever comes in, something renderable or nothing
   -------------------------------------------------------------------------- */

(function () {
  var junk = {
    'an empty token': '',
    'characters outside base64': '!!!***',
    'base64 that is not JSON': Buffer.from('not json').toString('base64'),
    'JSON null': token(null),
    'a bare number': token(7),
    'a string': token('hello'),
    'no groups': token({ d: 40, h: 5 }),
    'an empty comparison': token({ c: [] }),
    'a comparison of nothing usable': token({ c: [null, 4, 'x', { d: 1 }] })
  };
  Object.keys(junk).forEach(function (what) {
    var out;
    try { out = share.decodeLink(junk[what]); } catch (e) { out = 'threw ' + e.message; }
    ok(out === null, 'decoding ' + what + ' should give nothing', JSON.stringify(out));
  });

  var long = new Array(41).join('x');
  var messy = token({
    d: '60', h: -3,
    g: [null, ['Engine', '15', 2.7, 'six'], 'nonsense', [long, 3, 1, 3]]
      .concat(new Array(20).fill(['Filler', 1, 0, 1]))
  });
  var out = share.decodeLink(messy);
  ok(out && out.length === 1, 'a messy link should still open as one setup', JSON.stringify(out));
  var s = out[0];
  ok(s.deck === 60 && s.hand === 0, 'numbers should be read as non-negative integers', s.deck + ' / ' + s.hand);
  ok(s.groups.length === share.MAX_GROUPS, 'groups should be capped at ' + share.MAX_GROUPS, String(s.groups.length));
  same([s.groups[0], s.lines[0][0]], [{ name: '', amt: 0 }, { min: 0, max: 0 }], 'a null group should become an empty one');
  same([s.groups[1], s.lines[0][1]], [{ name: 'Engine', amt: 15 }, { min: 2, max: 0 }], 'a group of strings should be read as numbers');
  ok(s.lines.length === 1 && s.lines[0].length === s.groups.length, 'the line should hold a need for every group'
     , JSON.stringify(s.lines));
  ok(s.groups[3].name.length === 30, 'a long name should be cut to 30 characters', String(s.groups[3].name.length));

  report('junk opens as nothing, and messy setups are cleaned up rather than thrown on');
})();

/* --------------------------------------------------------------------------
   4. The stored copy
   -------------------------------------------------------------------------- */

(function () {
  /* What a returning visitor has saved from before comparisons: the bare
     setup, with its needs on the groups as they were then. */
  same(share.fromStored(oldShape(A)), { setups: [A], active: 0 }, 'a setup saved before comparisons should load as one setup');
  same(share.fromStored({ setups: [oldShape(A), oldShape(B)], active: 1 }), { setups: [A, B], active: 1 },
       'a comparison saved before either/or lines should load as two one-line setups');
  same(share.fromStored(share.toStored([EITHER], 0)), { setups: [EITHER], active: 0 },
       'a setup with either/or lines should round-trip through storage');

  var stored = JSON.parse(JSON.stringify(share.toStored([A, B], 1)));
  same(share.fromStored(stored), { setups: [A, B], active: 1 }, 'a saved comparison should come back with B on screen');
  same(share.fromStored(share.toStored([A], 0)), { setups: [A], active: 0 }, 'a saved single setup should round-trip');

  same(share.fromStored({ setups: [A, null], active: 1 }), { setups: [A], active: 0 },
       'B on screen but broken should fall back to A');
  same(share.fromStored({ setups: [A, B], active: 7 }), { setups: [A, B], active: 0 },
       'an unknown active setup should fall back to A');
  same(share.fromStored({ setups: [A, B], active: '1' }), { setups: [A, B], active: 0 },
       'only the number 1 should select B');
  same(share.fromStored({ setups: [A, B, B], active: 0 }).setups.length, 2, 'storage should hold at most two setups');

  [null, 4, 'x', [], {}, { setups: [] }, { setups: [null, 3] }].forEach(function (raw) {
    var out;
    try { out = share.fromStored(raw); } catch (e) { out = 'threw ' + e.message; }
    ok(out === null, 'stored ' + JSON.stringify(raw) + ' should give nothing', JSON.stringify(out));
  });

  report('storage reads the old shape and the new, and falls back rather than breaking');
})();

/* -------------------------------------------------------------------------- */

console.log('');
if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks failed:\n');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log(checks + ' checks passed.');
