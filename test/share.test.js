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

var A = {
  deck: 40, hand: 5,
  groups: [
    { name: 'Starters', amt: 12, min: 1, max: 5 },
    { name: 'Hand traps', amt: 9, min: 1, max: 5 }
  ]
};
var B = {
  deck: 40, hand: 5,
  groups: [
    { name: 'Starters', amt: 13, min: 1, max: 5 },
    { name: 'Hand traps', amt: 8, min: 1, max: 5 }
  ]
};

/* --------------------------------------------------------------------------
   1. One setup: the format links have always used
   -------------------------------------------------------------------------- */

(function () {
  /* The encoder as it stood before comparisons, verbatim apart from Buffer
     standing in for btoa. A single setup must still come out identical. */
  function legacyEncode(s) {
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

  var named = { deck: 40, hand: 5, groups: [{ name: 'Ash Blossom & Joyous Spring ✿', amt: 3, min: 1, max: 3 }] };
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
    return { d: s.deck, h: s.hand, g: s.groups.map(function (g) { return [g.name, g.amt, g.min, g.max]; }) };
  }) });
  same(share.decodeLink(three), [A, B], 'a comparison should hold at most two setups');

  var halfBroken = token({ c: [null, { d: 40, h: 5, g: [['Starters', 12, 1, 5], ['Hand traps', 9, 1, 5]] }] });
  same(share.decodeLink(halfBroken), [A], 'a comparison with one half broken should open the half that survived');

  report('two setups round-trip, in order, and a broken half is dropped');
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
  same(s.groups[0], { name: '', amt: 0, min: 0, max: 0 }, 'a null group should become an empty one');
  same(s.groups[1], { name: 'Engine', amt: 15, min: 2, max: 0 }, 'a group of strings should be read as numbers');
  ok(s.groups[3].name.length === 30, 'a long name should be cut to 30 characters', String(s.groups[3].name.length));

  report('junk opens as nothing, and messy setups are cleaned up rather than thrown on');
})();

/* --------------------------------------------------------------------------
   4. The stored copy
   -------------------------------------------------------------------------- */

(function () {
  /* What a returning visitor has saved from before comparisons: the bare setup. */
  same(share.fromStored(A), { setups: [A], active: 0 }, 'a setup saved before comparisons should load as one setup');

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
