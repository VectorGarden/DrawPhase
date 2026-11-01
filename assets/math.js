/* ==========================================================================
   Draw Phase — the probability, kept apart from the page.

   Exact multivariate hypergeometric odds in BigInt, so nothing is lost to
   floating point even on a 60 card deck. Nothing in here touches the DOM:
   that is what lets test/odds.test.js load it in Node and check the numbers
   against a straight enumeration of every possible hand.

   Loaded as a plain script by index.html, or required from Node. No build
   step and no dependencies either way. The JSDoc is checked by tsc against
   types/globals.d.ts, where DrawPhaseMathApi is the shape exported here.
   ========================================================================== */

// @ts-check

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DrawPhaseMath = api;
})(typeof self !== 'undefined' ? self : this, /** @returns {DrawPhaseMathApi} */ function () {
  'use strict';

  /** @type {Record<string, bigint>} */
  var combCache = Object.create(null);

  /**
   * @param {number} n
   * @param {number} k
   * @returns {bigint}
   */
  function comb(n, k) {
    if (k < 0 || n < 0 || k > n) return 0n;
    if (k === 0 || k === n) return 1n;
    if (k > n - k) k = n - k;
    var key = n + ':' + k;
    if (combCache[key] !== undefined) return combCache[key];
    var result = 1n;
    var bn = BigInt(n);
    for (var i = 1; i <= k; i++) {
      result = result * (bn - BigInt(i - 1)) / BigInt(i);
    }
    combCache[key] = result;
    return result;
  }

  var SCALE = 1000000000000n; /* 1e12 — plenty for a percentage */

  /**
   * @param {bigint} num
   * @param {bigint} den
   */
  function ratio(num, den) {
    if (den === 0n || num === 0n) return 0;
    return Number(num * SCALE / den) / 1e12;
  }

  /* Number of hands that satisfy every group at once.

     The tail of the walk depends only on which group we are on and how many
     cards are already spoken for, never on the product carried into it, so the
     factor is pulled out and each (group, drawn) pair is computed once. Without
     that the walk visits every combination in turn — roughly fourteen times more
     work per group added, which locks the tab up somewhere around eight groups
     on a large hand. Memoised it is a few hundred states at worst. */
  /**
   * @param {Requirement[]} groups
   * @param {number} rest
   * @param {number} hand
   * @returns {bigint}
   */
  function countPassingHands(groups, rest, hand) {
    /** @type {Record<number, bigint>[]} */
    var memo = [];
    for (var m = 0; m < groups.length; m++) memo.push(Object.create(null));

    /**
     * @param {number} i
     * @param {number} drawn
     * @returns {bigint}
     */
    function walk(i, drawn) {
      if (i === groups.length) {
        return comb(rest, hand - drawn);
      }
      var cached = memo[i][drawn];
      if (cached !== undefined) return cached;

      var g = groups[i];
      var lo = Math.max(0, g.min);
      var hi = Math.min(g.max, g.amt, hand - drawn);
      var total = 0n;
      for (var k = lo; k <= hi; k++) {
        var c = comb(g.amt, k);
        if (c === 0n) continue;
        total += c * walk(i + 1, drawn + k);
      }
      memo[i][drawn] = total;
      return total;
    }
    return walk(0, 0);
  }

  /* Number of hands that meet at least one of several lines.

     Each line is a min and max per group, all over the same cards. Counted
     by inclusion and exclusion: add each line's hands, take away those two
     lines share, add back those three share, and so on. Hands that meet a
     set of lines at once are the ones inside every line's range for every
     group, which is a single line of its own: the largest of their minimums
     and the smallest of their maximums. So each term is one exact count from
     countPassingHands, and a term whose range is empty is skipped, since no
     hand can be in it. Four lines make fifteen terms at most. */
  /**
   * @param {number[]} amts
   * @param {Need[][]} lines   lines[l][g], the need for group g on line l
   * @param {number} rest
   * @param {number} hand
   * @returns {bigint}
   */
  function countPassingAny(amts, lines, rest, hand) {
    var total = 0n;
    for (var mask = 1; mask < (1 << lines.length); mask++) {
      /** @type {Requirement[]} */
      var groups = [];
      var empty = false;
      for (var g = 0; g < amts.length && !empty; g++) {
        var lo = 0;
        var hi = Infinity;
        for (var l = 0; l < lines.length; l++) {
          if (!(mask & (1 << l))) continue;
          lo = Math.max(lo, lines[l][g].min);
          hi = Math.min(hi, lines[l][g].max);
        }
        if (lo > hi) empty = true;
        groups.push({ amt: amts[g], min: lo, max: hi });
      }
      if (empty) continue;
      var count = countPassingHands(groups, rest, hand);
      total += bitCount(mask) % 2 ? count : -count;
    }
    return total;
  }

  /** @param {number} mask */
  function bitCount(mask) {
    var n = 0;
    for (; mask; mask >>= 1) n += mask & 1;
    return n;
  }

  /* P(exactly k copies of one group), k = 0 .. min(amt, hand) */
  /**
   * @param {number} amt
   * @param {number} deck
   * @param {number} hand
   */
  function distribution(amt, deck, hand) {
    var den = comb(deck, hand);
    var out = [];
    var top = Math.min(amt, hand);
    for (var k = 0; k <= top; k++) {
      out.push(ratio(comb(amt, k) * comb(deck - amt, hand - k), den));
    }
    return out;
  }

  /* One hand drawn from a pile of group tags, -1 standing for everything else.

     Partial Fisher-Yates: at each step the card at i is swapped in from a
     uniform pick over the cards not yet taken, which makes the first `hand`
     entries a uniform sample without replacement. `random` is injectable so a
     test can drive it deterministically; deal() passes Math.random.

     The loop guards on i < pile.length as well as the hand size. The version
     this came from guarded on the pile merely being non-empty, which would
     have pushed undefined for every card past the end of the deck had a hand
     larger than the deck ever reached it. Validation stops that today, so it
     was latent rather than live, but the bound belongs here. */
  /**
   * @param {number[]} groups
   * @param {number} rest
   * @param {number} hand
   * @param {() => number} random
   */
  function drawHand(groups, rest, hand, random) {
    /** @type {number[]} */
    var pile = [];
    for (var g = 0; g < groups.length; g++) {
      for (var n = 0; n < groups[g]; n++) pile.push(g);
    }
    for (var r = 0; r < rest; r++) pile.push(-1);

    /** @type {number[]} */
    var drawn = [];
    for (var i = 0; i < hand && i < pile.length; i++) {
      var j = i + Math.floor(random() * (pile.length - i));
      var tmp = pile[i]; pile[i] = pile[j]; pile[j] = tmp;
      drawn.push(pile[i]);
    }
    return drawn;
  }

  return {
    comb: comb,
    ratio: ratio,
    countPassingHands: countPassingHands,
    countPassingAny: countPassingAny,
    distribution: distribution,
    drawHand: drawHand
  };
});
