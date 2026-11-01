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

/* A whole setup as the page holds it: the deck, the hand, and each group
   with its name. Shared by app.js and share.js. */
interface Group {
  name: string;
  amt: number;
  min: number;
  max: number;
}

interface Setup {
  deck: number;
  hand: number;
  groups: Group[];
}

/* What is kept in local storage: one setup, or two being compared, and which
   of them was on screen. */
interface Stored {
  setups: Setup[];
  active: number;
}

/* What share.js hands to the page, and to the tests in Node. */
interface DrawPhaseShareApi {
  MAX_GROUPS: number;
  toInt(value: unknown): number;
  normaliseSetup(raw: unknown): Setup | null;
  encodeLink(setups: Setup[]): string;
  decodeLink(token: string): Setup[] | null;
  toStored(setups: Setup[], active: number): Stored;
  fromStored(raw: unknown): Stored | null;
}

declare var DrawPhaseShare: DrawPhaseShareApi;
