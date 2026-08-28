#!/usr/bin/env node
/* ==========================================================================
   Draw Phase — checks on the odds themselves.

       node test/odds.test.js

   No dependencies and no test framework, to match the rest of the repo.

   A wrong probability here looks exactly like a right one: it is a plausible
   percentage either way, and no amount of reading a diff will tell you which
   you are looking at. That is the whole reason this file exists.

   The main oracle deliberately does not share any reasoning with the code it
   checks. It builds a real deck, enumerates every hand that can be drawn from
   it, and counts the ones that pass — no binomial coefficients involved. If
   countPassingHands and a literal headcount of every possible hand agree, the
   formula is right.
   ========================================================================== */

'use strict';

var maths = require('../assets/math.js');
var comb = maths.comb;
var countPassingHands = maths.countPassingHands;
var distribution = maths.distribution;
var ratio = maths.ratio;

var failures = [];
var checks = 0;

function ok(condition, label, detail) {
  checks++;
  if (!condition) failures.push(label + (detail ? '\n      ' + detail : ''));
}

function eq(actual, expected, label) {
  ok(actual === expected, label, 'expected ' + expected + ', got ' + actual);
}

function report(name) {
  var failedHere = failures.length;
  return function () {
    var bad = failures.length - failedHere;
    console.log('  ' + (bad ? '✘' : '✓') + ' ' + name);
  };
}

/* --------------------------------------------------------------------------
   The oracle: enumerate every hand, count the ones that pass.
   -------------------------------------------------------------------------- */

/* deck is an array of group indices, -1 meaning "everything else". */
function countByEnumeration(deck, hand, groups) {
  var n = deck.length;
  var indices = [];
  var passing = 0;

  function satisfied(pick) {
    var counts = groups.map(function () { return 0; });
    for (var i = 0; i < pick.length; i++) {
      var tag = deck[pick[i]];
      if (tag >= 0) counts[tag]++;
    }
    return groups.every(function (g, i) {
      return counts[i] >= g.min && counts[i] <= g.max;
    });
  }

  (function choose(start, depth) {
    if (depth === hand) {
      if (satisfied(indices)) passing++;
      return;
    }
    for (var i = start; i <= n - (hand - depth); i++) {
      indices.push(i);
      choose(i + 1, depth + 1);
      indices.pop();
    }
  })(0, 0);

  return BigInt(passing);
}

function buildDeck(groups, rest) {
  var deck = [];
  groups.forEach(function (g, i) {
    for (var n = 0; n < g.amt; n++) deck.push(i);
  });
  for (var n = 0; n < rest; n++) deck.push(-1);
  return deck;
}

/* A tiny deterministic PRNG, so a failure can be reproduced exactly. */
function makeRandom(seed) {
  var s = seed;
  return function (n) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
}

/* --------------------------------------------------------------------------
   1. Against a literal headcount of every possible hand
   -------------------------------------------------------------------------- */

(function () {
  var done = report('every hand enumerated, 400 random configurations');
  var rnd = makeRandom(20260828);

  for (var t = 0; t < 400; t++) {
    /* Small enough that enumerating C(deck, hand) hands stays quick. */
    var groupCount = 1 + rnd(3);
    var groups = [];
    var assigned = 0;
    for (var i = 0; i < groupCount; i++) {
      var amt = 1 + rnd(4);
      assigned += amt;
      groups.push({ amt: amt, min: 0, max: amt });
    }
    var rest = rnd(6);
    var deckSize = assigned + rest;
    var hand = 1 + rnd(Math.min(deckSize, 5));

    groups.forEach(function (g) {
      g.min = rnd(Math.min(g.amt, hand) + 1);
      g.max = Math.min(g.amt, g.min + rnd(3));
    });

    var deck = buildDeck(groups, rest);
    var expected = countByEnumeration(deck, hand, groups);
    var actual = countPassingHands(groups, rest, hand);

    ok(actual === expected, 'enumeration mismatch',
       JSON.stringify({ deck: deckSize, hand: hand, rest: rest, groups: groups }) +
       '\n      expected ' + expected + ', got ' + actual);
  }
  done();
})();

/* --------------------------------------------------------------------------
   2. Against values worked out by hand
   -------------------------------------------------------------------------- */

(function () {
  var done = report('known values');

  eq(comb(40, 5), 658008n, 'C(40,5)');
  eq(comb(60, 30), 118264581564861424n, 'C(60,30) exact in BigInt');
  eq(comb(5, 0), 1n, 'C(n,0)');
  eq(comb(5, 5), 1n, 'C(n,n)');
  eq(comb(3, 4), 0n, 'k > n');
  eq(comb(5, -1), 0n, 'negative k');
  eq(comb(-1, 0), 0n, 'negative n');

  /* At least one of 3 copies in a 5 card hand from 40, by the complement:
     C(40,5) - C(37,5). */
  eq(countPassingHands([{ amt: 3, min: 1, max: 3 }], 37, 5),
     comb(40, 5) - comb(37, 5), 'at least one of three');

  /* The site's own default: 12 starters and 9 hand traps, at least one of
     each, from 40 drawing 5. Worked out independently as 401445/658008. */
  eq(countPassingHands([{ amt: 12, min: 1, max: 5 }, { amt: 9, min: 1, max: 5 }], 19, 5),
     401445n, 'two group default setup');
  ok(Math.abs(ratio(401445n, 658008n) - 0.610091366670314) < 1e-12,
     'two group default setup as a ratio');

  done();
})();

/* --------------------------------------------------------------------------
   3. Invariants that must hold for any input
   -------------------------------------------------------------------------- */

(function () {
  var done = report('invariants');
  var rnd = makeRandom(99991);

  for (var t = 0; t < 200; t++) {
    var groupCount = 1 + rnd(5);
    var groups = [];
    var assigned = 0;
    for (var i = 0; i < groupCount; i++) {
      var amt = 1 + rnd(8);
      assigned += amt;
      groups.push({ amt: amt, min: 0, max: amt });
    }
    var rest = rnd(20);
    var deck = assigned + rest;
    var hand = 1 + rnd(Math.min(deck, 10));

    /* Constrain nothing and every hand qualifies, so the count must come back
       as the total number of hands. */
    ok(countPassingHands(groups, rest, hand) === comb(deck, hand),
       'unconstrained groups should total C(deck, hand)',
       'deck ' + deck + ', hand ' + hand);

    /* Asking for more copies than exist can never be satisfied. */
    var impossible = groups.map(function (g, i) {
      return i === 0 ? { amt: g.amt, min: g.amt + 1, max: g.amt + 1 } : g;
    });
    ok(countPassingHands(impossible, rest, hand) === 0n,
       'more copies than the deck holds should be impossible');

    /* Every hand lands on exactly one value of k, so the distribution of a
       single group is a probability distribution. */
    var dist = distribution(groups[0].amt, deck, hand);
    var sum = dist.reduce(function (a, b) { return a + b; }, 0);
    ok(Math.abs(sum - 1) < 1e-9, 'distribution should sum to 1',
       'summed to ' + sum + ' for amt ' + groups[0].amt + ', deck ' + deck + ', hand ' + hand);
    ok(dist.every(function (p) { return p >= 0 && p <= 1; }),
       'distribution entries should be probabilities');
  }
  done();
})();

/* --------------------------------------------------------------------------
   4. The walk stays memoised

   countPassingHands used to carry a product down the recursion, which made
   every path look distinct and cost roughly 14x more per group added: seven
   groups on a large hand took 46 seconds, and twelve never finished. The
   memoised version is instant, so a generous ceiling still catches a
   regression without being flaky on a slow machine.
   -------------------------------------------------------------------------- */

(function () {
  var done = report('twelve groups on a sixty card hand stays fast');

  var groups = [];
  for (var i = 0; i < 12; i++) groups.push({ amt: 16, min: 0, max: 60 });

  var started = process.hrtime.bigint();
  var result = countPassingHands(groups, 8, 60);
  var ms = Number(process.hrtime.bigint() - started) / 1e6;

  ok(result > 0n, 'should produce a count');
  ok(ms < 2000, 'should finish well inside two seconds', 'took ' + ms.toFixed(1) + 'ms');
  done();
})();

/* -------------------------------------------------------------------------- */

console.log('');
if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks failed:\n');
  failures.slice(0, 20).forEach(function (f) { console.log('  - ' + f); });
  if (failures.length > 20) console.log('  ... and ' + (failures.length - 20) + ' more');
  process.exit(1);
}
console.log(checks + ' checks passed.');
