/* ==========================================================================
   Draw Phase — declarations for the type check, and nothing else.

   tsconfig.json checks assets/*.js against these. Nothing here ships: the
   site still loads the plain scripts, with no build step in between.
   ========================================================================== */

/* Present when math.js is required from Node, absent in the browser. */
declare var module: { exports: unknown } | undefined;

/* One group as the maths sees it: how many are in the deck, and how many the
   hand must hold. Names are the page's business, not the probability's. */
interface Requirement {
  amt: number;
  min: number;
  max: number;
}

/* What math.js hands to the page, and to the tests in Node. */
interface DrawPhaseMathApi {
  comb(n: number, k: number): bigint;
  ratio(num: bigint, den: bigint): number;
  countPassingHands(groups: Requirement[], rest: number, hand: number): bigint;
  distribution(amt: number, deck: number, hand: number): number[];
  drawHand(groups: number[], rest: number, hand: number, random: () => number): number[];
}

declare var DrawPhaseMath: DrawPhaseMathApi;
