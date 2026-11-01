/* ==========================================================================
   Draw Phase — Yu-Gi-Oh! opening hand odds
   Exact multivariate hypergeometric odds, computed with BigInt so the
   numbers stay honest even on a 60 card deck.

   Plain JavaScript, no build step. The JSDoc is checked by tsc (see
   tsconfig.json), so a type here is a claim CI holds the code to.
   ========================================================================== */

// @ts-check

(function () {
  'use strict';

  /* Group and Setup are shared with share.js, so they live in
     types/globals.d.ts. These are the page's own. */
  /**
   * @typedef {{ amt: boolean, min: boolean, max: boolean }} GroupFlags
   * @typedef {{
   *   ok: boolean,
   *   problems: string[],
   *   flags: { deck: boolean, hand: boolean, groups: GroupFlags[] },
   *   assigned: number,
   *   required: number
   * }} Check
   * A dealt card, or null for one from everything else:
   * @typedef {{ index: number, label: string } | null} Card
   * @typedef {{ order: number[], cards: Card[], extra: number }} Shuffle
   */

  var THEME_KEY = 'drawphase.theme';
  var STATE_KEY = 'drawphase.state';
  var MAX_DECK = 200;   /* matches the max= on #deck-size */
  var MAX_HAND = 60;    /* matches the max= on #hand-size */
  var LETTERS = ['A', 'B'];
  var SPINES = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];

  /** @type {Setup} */
  var DEFAULTS = {
    deck: 40,
    hand: 5,
    groups: [
      { name: 'Starters', amt: 12, min: 1, max: 5 },
      { name: 'Hand traps', amt: 9, min: 1, max: 5 }
    ]
  };

  /** @type {Record<string, Setup>} */
  var EXAMPLES = {
    allure: {
      deck: 40, hand: 5,
      groups: [
        { name: 'Allure of Darkness', amt: 1, min: 1, max: 1 },
        { name: 'DARK monsters', amt: 10, min: 1, max: 4 }
      ]
    },
    ravine: {
      deck: 40, hand: 5,
      groups: [
        { name: 'Ravine + Terraforming', amt: 5, min: 1, max: 5 },
        { name: 'Dux or Phalanx', amt: 6, min: 1, max: 5 }
      ]
    }
  };

  /* Replaced by the first update(), and by every one after it. Starting on
     the defaults rather than null means it is never missing, and nothing
     reads it before that first update anyway. */
  /** @type {Setup} */
  var state = DEFAULTS;
  /* Every setup in play: just the one, or A and B while comparing. The form
     edits setups[active], and update() writes the form back into it, so the
     one on screen is always current and the other is as it was left. */
  /** @type {Setup[]} */
  var setups = [DEFAULTS];
  var active = 0;
  var lastShown = 0;
  /** @type {string | null} */
  var lastSignature = null;
  var deals = 0;
  var hits = 0;
  /** @type {Shuffle | null} */
  var dealt = null;   /* the last shuffle, while its hand is on show */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Every element the script touches, by id, and what kind of element it is.
     The two allowed to be missing are typed as possibly null and checked
     where they are used; the rest are in index.html, and the page cannot
     work without them. */
  /**
   * @typedef {{
   *   'deck-size': HTMLInputElement, 'hand-size': HTMLInputElement,
   *   groups: HTMLOListElement, 'rest-amt': HTMLElement, 'rest-max': HTMLElement,
   *   'add-group': HTMLButtonElement, reset: HTMLButtonElement,
   *   'odds-value': HTMLElement, 'odds-figure': HTMLElement, 'odds-fill': HTMLElement,
   *   'odds-plain': HTMLElement, 'hand-strip': HTMLElement, deal: HTMLButtonElement,
   *   'draw-extra': HTMLButtonElement, 'deal-tally': HTMLElement, 'deal-extra': HTMLElement,
   *   breakdown: HTMLElement, 'copy-link': HTMLButtonElement,
   *   'copy-summary': HTMLButtonElement, 'share-status': HTMLElement,
   *   'theme-toggle': HTMLButtonElement, 'meta-theme-color': HTMLMetaElement | null,
   *   examples: HTMLElement, 'examples-toggle': HTMLButtonElement,
   *   'group-template': HTMLTemplateElement, 'group-status': HTMLElement | null,
   *   'odds-eyebrow': HTMLElement, compare: HTMLElement,
   *   'compare-start': HTMLButtonElement, 'compare-tabs': HTMLElement,
   *   'compare-delta': HTMLElement, 'compare-stop': HTMLButtonElement
   * }} Elements
   */

  /** @type {Record<string, HTMLElement | null>} */
  var found = {};
  /** @type {(keyof Elements)[]} */
  ([
    'deck-size', 'hand-size', 'groups', 'rest-amt', 'rest-max', 'add-group', 'reset',
    'odds-value', 'odds-figure', 'odds-fill', 'odds-plain', 'hand-strip', 'deal',
    'draw-extra', 'deal-tally', 'deal-extra', 'breakdown', 'copy-link', 'copy-summary', 'share-status',
    'theme-toggle', 'meta-theme-color', 'examples', 'examples-toggle', 'group-template',
    'group-status', 'odds-eyebrow', 'compare', 'compare-start', 'compare-tabs',
    'compare-delta', 'compare-stop'
  ]).forEach(function (id) {
    found[id] = document.getElementById(id);
  });
  var el = /** @type {Elements} */ (/** @type {unknown} */ (found));

  var oddsCard = /** @type {HTMLElement} */ (document.querySelector('.odds-card'));

  /* querySelector only knows it found an Element. These say what kind, for
     the selectors this page owns, so the casts live in one place. */

  /**
   * @param {ParentNode} root
   * @param {string} selector
   * @returns {HTMLElement[]}
   */
  function all(root, selector) {
    return Array.prototype.slice.call(root.querySelectorAll(selector));
  }

  /**
   * @param {ParentNode} root
   * @param {string} selector
   */
  function field(root, selector) {
    return /** @type {HTMLInputElement} */ (root.querySelector(selector));
  }

  /**
   * @param {ParentNode} root
   * @param {string} selector
   */
  function button(root, selector) {
    return /** @type {HTMLButtonElement} */ (root.querySelector(selector));
  }

  /* ======================================================================
     Storage helpers — every call is wrapped, private mode must not break us
     ====================================================================== */

  /** @param {string} key */
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  /**
   * @param {string} key
   * @param {string} value
   */
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* nothing to do */ }
  }

  /* ======================================================================
     Theme
     ====================================================================== */

  /** @param {string} theme */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var next = theme === 'dark' ? 'light' : 'dark';
    el['theme-toggle'].setAttribute('aria-label', 'Switch to ' + next + ' mode');
    el['theme-toggle'].setAttribute('title', 'Switch to ' + next + ' mode');
    if (el['meta-theme-color']) {
      el['meta-theme-color'].setAttribute('content', theme === 'dark' ? '#0D0F16' : '#EFF1F7');
    }
  }

  function initTheme() {
    var saved = readStore(THEME_KEY);
    var theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(theme);

    el['theme-toggle'].addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      writeStore(THEME_KEY, next);
    });

    /* Follow the system only while the visitor hasn't made their own choice */
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    /** @param {MediaQueryListEvent} e */
    var onChange = function (e) {
      if (!readStore(THEME_KEY)) applyTheme(e.matches ? 'light' : 'dark');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ======================================================================
     Maths
     ====================================================================== */

  /* Lives in assets/math.js so it can be loaded by Node and checked against a
     straight enumeration of every possible hand — see test/odds.test.js. */
  var maths = window.DrawPhaseMath;
  var comb = maths.comb;
  var ratio = maths.ratio;
  var countPassingHands = maths.countPassingHands;
  var distribution = maths.distribution;
  var drawHand = maths.drawHand;

  /* Links and the stored copy live in assets/share.js, for the same reason,
     and are checked by test/share.test.js. */
  var share = window.DrawPhaseShare;
  var toInt = share.toInt;
  var MAX_GROUPS = share.MAX_GROUPS;

  /* ======================================================================
     Reading the form
     ====================================================================== */

  /** @returns {Setup} */
  function readState() {
    /** @type {Group[]} */
    var groups = [];
    all(el.groups, '.group').forEach(function (node) {
      groups.push({
        name: field(node, '.g-name').value,
        amt: toInt(field(node, '.g-amt').value),
        min: toInt(field(node, '.g-min').value),
        max: toInt(field(node, '.g-max').value)
      });
    });
    return {
      deck: toInt(el['deck-size'].value),
      hand: toInt(el['hand-size'].value),
      groups: groups
    };
  }

  /**
   * @param {Group} group
   * @param {number} index
   */
  function groupLabel(group, index) {
    return group.name.trim() || 'Group ' + (index + 1);
  }

  /** @param {number} index */
  function spineFor(index) {
    return 'var(' + SPINES[index % SPINES.length] + ')';
  }

  /* ======================================================================
     Validation
     ====================================================================== */

  /**
   * @param {Setup} s
   * @returns {Check}
   */
  function validate(s) {
    /** @type {string[]} */
    var problems = [];
    /** @type {Check['flags']} */
    var flags = { deck: false, hand: false, groups: [] };
    s.groups.forEach(function () { flags.groups.push({ amt: false, min: false, max: false }); });

    var assigned = s.groups.reduce(function (sum, g) { return sum + g.amt; }, 0);
    var required = s.groups.reduce(function (sum, g) { return sum + g.min; }, 0);

    if (s.deck < 1) {
      problems.push('Set a deck size to get started.');
      flags.deck = true;
    }
    if (s.hand < 1) {
      problems.push('You need to draw at least one card.');
      flags.hand = true;
    }
    if (s.deck > MAX_DECK) {
      problems.push('This tops out at a ' + MAX_DECK + ' card deck.');
      flags.deck = true;
    }
    if (s.hand > MAX_HAND) {
      problems.push('This tops out at ' + MAX_HAND + ' cards drawn.');
      flags.hand = true;
    }
    if (s.deck >= 1 && s.deck <= MAX_DECK && s.hand > s.deck) {
      problems.push('You are drawing ' + s.hand + ' cards from a deck of ' + s.deck + '.');
      flags.hand = true;
    }
    if (assigned > s.deck && s.deck >= 1) {
      problems.push('Your groups add up to ' + assigned + ' cards, but the deck only holds ' + s.deck + '.');
      s.groups.forEach(function (g, i) { if (g.amt > 0) flags.groups[i].amt = true; });
    }
    s.groups.forEach(function (g, i) {
      if (g.min > g.max) {
        problems.push('“' + escapeHtml(groupLabel(g, i)) + '” asks for at least ' + g.min + ' but no more than ' + g.max + '.');
        flags.groups[i].min = true;
        flags.groups[i].max = true;
      }
      if (g.min > g.amt) {
        problems.push('“' + escapeHtml(groupLabel(g, i)) + '” asks for ' + g.min + ' cards but only ' + g.amt + ' are in the deck.');
        flags.groups[i].min = true;
      }
    });
    if (required > s.hand && s.hand >= 1) {
      problems.push('You are asking for ' + required + ' specific cards but only drawing ' + s.hand + '.');
      s.groups.forEach(function (g, i) { if (g.min > 0) flags.groups[i].min = true; });
    }

    return { ok: problems.length === 0, problems: problems, flags: flags, assigned: assigned, required: required };
  }

  /* One pass, driven by the state we just read, so a rename is reflected the
     moment it is typed. */
  function nameGroups() {
    all(el.groups, '.group').forEach(function (node, i) {
      var body = node.querySelector('.group-body');
      if (body && state.groups[i]) body.setAttribute('aria-label', groupLabel(state.groups[i], i));
    });
  }

  /** @param {Check} check */
  function paintFlags(check) {
    el['deck-size'].classList.toggle('invalid', check.flags.deck);
    el['hand-size'].classList.toggle('invalid', check.flags.hand);
    all(el.groups, '.group').forEach(function (node, i) {
      var f = check.flags.groups[i] || { amt: false, min: false, max: false };
      field(node, '.g-amt').classList.toggle('invalid', f.amt);
      field(node, '.g-min').classList.toggle('invalid', f.min);
      field(node, '.g-max').classList.toggle('invalid', f.max);
    });
  }

  /* ======================================================================
     Presentation helpers
     ====================================================================== */

  /** @param {number} p */
  function tone(p) {
    if (p < 0.30) return 'var(--bad)';
    if (p < 0.70) return 'var(--warn)';
    return 'var(--good)';
  }

  /** @param {number} x */
  function trim(x) {
    if (x >= 100) return String(Math.round(x));
    if (x >= 10) return x.toFixed(0);
    return x.toFixed(1).replace(/\.0$/, '');
  }

  /** @param {number} p */
  function plainLanguage(p) {
    if (p <= 0) return 'No hand in this deck can meet those requirements.';
    if (p >= 0.99995) return 'Every possible opening hand meets these requirements.';
    /* Rounding reaches the ends of the scale long before p does, and both
       "20 of every 20" beside a miss rate and "1 in 900 — near 0 of every 20"
       read as contradictions. */
    var inTwenty = Math.round(p * 20);
    if (p >= 0.5) {
      return 'You open it in <strong>' + Math.min(19, inTwenty) + ' of every 20 duels</strong>, and miss roughly 1 hand in ' + trim(1 / (1 - p)) + '.';
    }
    var line = 'About <strong>1 in ' + trim(1 / p) + '</strong> opening hands';
    return inTwenty > 0 ? line + ' — near ' + inTwenty + ' of every 20 duels.' : line + '.';
  }

  /** @type {number | null} */
  var animFrame = null;

  function stopAnimation() {
    if (animFrame !== null) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
  }

  /**
   * @param {number} from
   * @param {number} to
   */
  function animateNumber(from, to) {
    stopAnimation();
    /* requestAnimationFrame does not fire while the tab is hidden, so the
       headline sat on a stale figure — bar and prose already updated — until
       something brought the tab to the front. Opening a shared link in a
       background tab is the ordinary way to hit that. */
    if (reduceMotion || document.hidden || Math.abs(to - from) < 0.01) {
      el['odds-value'].textContent = to.toFixed(2);
      return;
    }
    var start = performance.now();
    var span = 300;
    /** @param {number} now */
    function step(now) {
      var t = Math.min(1, (now - start) / span);
      var eased = 1 - Math.pow(1 - t, 3);
      el['odds-value'].textContent = (from + (to - from) * eased).toFixed(2);
      animFrame = t < 1 ? requestAnimationFrame(step) : null;
    }
    animFrame = requestAnimationFrame(step);
  }

  /* ======================================================================
     Rendering the groups
     ====================================================================== */

  var FIELDS = ['.g-name', '.g-amt', '.g-min', '.g-max'];
  var groupSeq = 0;

  /**
   * @param {Group} data
   * @param {number} index
   */
  function buildGroup(data, index) {
    var node = /** @type {HTMLLIElement} */ (
      /** @type {Element} */ (el['group-template'].content.firstElementChild).cloneNode(true));
    node.style.setProperty('--spine', spineFor(index));
    field(node, '.g-name').value = data.name || '';
    field(node, '.g-amt').value = String(data.amt);
    field(node, '.g-min').value = String(data.min);
    field(node, '.g-max').value = String(data.max);

    /* The template's labels carry no `for`, and the group rows are clones, so
       there is no id to point at until one is minted here. Without this every
       field falls back to its own value for a name — a screen reader reads the
       row as "12, edit / 1, edit / 5, edit", and both name fields announce as
       "Starters" off the shared placeholder. */
    var uid = 'grp' + (++groupSeq);
    FIELDS.forEach(function (sel) {
      var input = field(node, sel);
      var label = input.parentElement && input.parentElement.querySelector('label');
      input.id = uid + sel.replace('.g-', '-');
      if (label) label.setAttribute('for', input.id);
    });
    /* Named on the body rather than the <li> so the list keeps its item
       semantics; it tells you which group the four fields belong to. */
    /** @type {Element} */ (node.querySelector('.group-body')).setAttribute('role', 'group');

    button(node, '.btn-remove').addEventListener('click', function () {
      /* Work out where to land before the node goes: removing it drops focus
         to the body, and the next Tab then restarts from the top of the
         document, which loses a keyboard user their place entirely. */
      var rows = all(el.groups, '.group');
      var at = rows.indexOf(node);
      var neighbour = rows[at + 1] || rows[at - 1];

      node.remove();
      renumber();
      update();

      /* The neighbour's own remove button, unless removing left one group and
         disabled it — then the button that is still worth pressing. */
      var landing = neighbour && !button(neighbour, '.btn-remove').disabled
        ? button(neighbour, '.btn-remove')
        : (el['add-group'].disabled ? null : el['add-group']);
      if (landing) landing.focus();

      announce('Group removed.');
    });
    return node;
  }

  /** @param {string} what */
  function announce(what) {
    if (!el['group-status']) return;
    var count = el.groups.querySelectorAll('.group').length;
    el['group-status'].textContent = what + ' ' + count + (count === 1 ? ' group' : ' groups') +
      (count >= MAX_GROUPS ? ', the maximum.' : '.');
  }

  function renumber() {
    var nodes = all(el.groups, '.group');
    nodes.forEach(function (node, i) {
      node.style.setProperty('--spine', spineFor(i));
      button(node, '.btn-remove').disabled = nodes.length <= 1;
    });
    el['add-group'].disabled = nodes.length >= MAX_GROUPS;
  }

  /** @param {Group[]} groups */
  function renderGroups(groups) {
    el.groups.innerHTML = '';
    groups.forEach(function (g, i) { el.groups.appendChild(buildGroup(g, i)); });
    renumber();
  }

  /* ======================================================================
     The main update pass
     ====================================================================== */

  /* What the maths needs from a setup. A maximum is capped by the copies
     there are and by the hand, since neither can be exceeded anyway. */
  /** @param {Setup} s */
  function requirements(s) {
    return s.groups.map(function (g) {
      return { amt: g.amt, min: g.min, max: Math.min(g.max, g.amt, s.hand) };
    });
  }

  /* The chance a setup opens, or null when it does not add up. */
  /**
   * @param {Setup} s
   * @returns {number | null}
   */
  function oddsOf(s) {
    var check = validate(s);
    if (!check.ok) return null;
    return ratio(countPassingHands(requirements(s), s.deck - check.assigned, s.hand), comb(s.deck, s.hand));
  }

  function update() {
    state = readState();
    setups[active] = state;

    var check = validate(state);
    paintFlags(check);
    nameGroups();

    var rest = state.deck - check.assigned;
    var restMax = state.hand - check.required;
    el['rest-amt'].textContent = String(rest);
    el['rest-amt'].classList.toggle('bad', rest < 0);
    el['rest-max'].textContent = restMax < 0 ? '\u2212' + Math.abs(restMax) : String(restMax);
    el['rest-max'].classList.toggle('bad', restMax < 0);

    /* The tally is a running sample of these exact odds, so it only goes stale
       when the numbers move. Renaming a group used to throw away a hundred
       dealt hands for a change that cannot alter the result. */
    var signature = tallySignature(state);
    if (signature !== lastSignature) resetTally();
    lastSignature = signature;

    if (!check.ok) {
      oddsCard.classList.add('is-error');
      stopAnimation();
      el['odds-value'].textContent = '—';
      el['odds-figure'].style.setProperty('--odds-color', 'var(--bad)');
      el['odds-fill'].style.width = '0%';
      el['odds-plain'].innerHTML = check.problems[0];
      el['breakdown'].innerHTML = '';
      clearDeal();
      lastShown = 0;
      renderCompare(null);
      save();
      return;
    }

    oddsCard.classList.remove('is-error');

    var groups = requirements(state);

    var passing = countPassingHands(groups, rest, state.hand);
    var p = ratio(passing, comb(state.deck, state.hand));
    var pct = p * 100;

    var colour = tone(p);
    el['odds-figure'].style.setProperty('--odds-color', colour);
    el['odds-fill'].style.setProperty('--odds-color', colour);
    el['odds-fill'].style.width = Math.max(p * 100, p > 0 ? 1.5 : 0) + '%';
    el['odds-plain'].innerHTML = plainLanguage(p);

    animateNumber(lastShown, pct);
    lastShown = pct;

    renderBreakdown(state, groups);
    clearDeal();
    renderCompare(p);
    save();
  }

  /* ======================================================================
     Comparing two setups
     ====================================================================== */

  /* The page is about the setup on screen; this is the one place both are
     shown, and the difference between them. `onScreen` is the figure update()
     already worked out, so only the other setup is computed here. */
  /** @param {number | null} onScreen */
  function renderCompare(onScreen) {
    var comparing = setups.length > 1;
    el['compare-start'].hidden = comparing;
    el['compare-tabs'].hidden = !comparing;
    el.compare.classList.toggle('is-comparing', comparing);
    el['odds-eyebrow'].textContent = comparing
      ? 'Chance to open setup ' + LETTERS[active]
      : 'Chance to open this hand';
    el['copy-link'].textContent = comparing ? 'Copy link to both setups' : 'Copy link to this setup';
    if (!comparing) return;

    var odds = setups.map(function (s, i) { return i === active ? onScreen : oddsOf(s); });

    all(el['compare-tabs'], '.compare-tab').forEach(function (tab) {
      var i = Number(tab.dataset.setup);
      var p = odds[i];
      tab.setAttribute('aria-pressed', String(i === active));
      /** @type {HTMLElement} */ (tab.querySelector('.ct-odds')).textContent =
        p === null ? '—' : (p * 100).toFixed(2) + '%';
    });

    el['compare-stop'].textContent = 'Keep only ' + LETTERS[active];
    el['compare-delta'].className = 'compare-delta';
    el['compare-delta'].innerHTML = compareLine(odds);
    var a = odds[0], b = odds[1];
    if (a !== null && b !== null && Math.abs(b - a) >= 0.00005) {
      el['compare-delta'].classList.add(b > a ? 'up' : 'down');
    }
  }

  /* B against A, in percentage points: the gap between two chances, which is
     not the same thing as one being some percent better than the other. */
  /** @param {(number | null)[]} odds */
  function compareLine(odds) {
    var a = odds[0], b = odds[1];
    if (a === null || b === null) {
      return 'Setup ' + (a === null ? 'A' : 'B') + ' does not add up yet, so there is nothing to compare.';
    }
    var gap = (b - a) * 100;
    if (Math.abs(gap) < 0.005) return 'A and B open equally often.';
    return 'B opens <strong>' + Math.abs(gap).toFixed(2) + ' percentage points ' +
      (gap > 0 ? 'more' : 'less') + '</strong> often than A.';
  }

  /** @param {string} message */
  function say(message) {
    if (el['group-status']) el['group-status'].textContent = message;
  }

  /* Show setup `index` in the form. The one being left is already saved in
     setups, since every edit writes it back. */
  /** @param {number} index */
  function showSetup(index) {
    if (index === active || !setups[index]) return;
    active = index;
    loadState(setups[active]);
  }

  /* B starts as a copy of what is on screen: the question is nearly always
     "what if I change one thing", so the one thing is all that is left to do. */
  function startComparing() {
    var copy = JSON.parse(JSON.stringify(state));
    setups = [state, copy];
    active = 1;
    loadState(setups[1]);
    say('Comparing. Now editing setup B, a copy of A.');
  }

  /* Keeps the setup on screen and drops the other. */
  function stopComparing() {
    var kept = LETTERS[active];
    setups = [state];
    active = 0;
    update();
    say('Stopped comparing. Kept setup ' + kept + '.');
  }

  /* ======================================================================
     Per-group breakdown
     ====================================================================== */

  /* Which slice of the distribution to draw. The old code took k = 0..6 flat,
     so any hand of seven or more cut the chart off mid-curve — and a group
     asking for eight showed no highlighted bar at all, which reads as "this
     never happens". Trim only where the probability is too small to see, and
     never trim across the range the user actually asked for. */
  /**
   * @param {number[]} dist
   * @param {number} lo
   * @param {number} hi
   */
  function sparkRange(dist, lo, hi) {
    var EPS = 0.0005;
    var first = 0;
    var last = dist.length - 1;
    while (first < last && first < lo && dist[first] < EPS) first++;
    while (last > first && last > hi && dist[last] < EPS) last--;
    return { first: first, last: last };
  }

  /**
   * @param {Setup} s
   * @param {Requirement[]} groups
   */
  function renderBreakdown(s, groups) {
    if (!groups.length) { el.breakdown.innerHTML = ''; return; }
    var den = comb(s.deck, s.hand);
    var html = '<p class="bd-title">Each group on its own</p>';

    groups.forEach(function (g, i) {
      var dist = distribution(g.amt, s.deck, s.hand);
      var own = 0n;
      for (var k = g.min; k <= Math.min(g.max, g.amt, s.hand); k++) {
        own += comb(g.amt, k) * comb(s.deck - g.amt, s.hand - k);
      }
      var p = ratio(own, den);
      var peak = Math.max.apply(null, dist) || 1;
      var span = sparkRange(dist, g.min, g.max);
      var bars = '';
      for (var b = span.first; b <= span.last; b++) {
        var v = dist[b];
        var h = Math.max(8, Math.round((v / peak) * 100));
        var inRange = b >= g.min && b <= g.max;
        bars += '<span class="bd-bar' + (inRange ? ' in-range' : '') + '" style="height:' + h + '%" title="' +
                b + ' in hand: ' + (v * 100).toFixed(1) + '%"></span>';
      }
      var wide = span.last - span.first >= 12 ? ' wide' : '';

      html += '<div class="bd-row" style="--spine:' + spineFor(i) + '">' +
                '<span class="bd-dot"></span>' +
                '<span class="bd-name">' + escapeHtml(groupLabel(s.groups[i], i)) + '</span>' +
                '<span class="bd-spark' + wide + '">' + bars + '</span>' +
                '<span class="bd-val">' + (p * 100).toFixed(1) + '%</span>' +
              '</div>';
    });

    el.breakdown.innerHTML = html;
  }

  /** @type {Record<string, string>} */
  var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** @param {unknown} str */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) { return ENTITIES[c]; });
  }

  /* ======================================================================
     Deal a test hand
     ====================================================================== */

  /* Everything that moves the odds, and nothing that does not — group names
     are deliberately absent. */
  /** @param {Setup} s */
  function tallySignature(s) {
    return s.deck + '/' + s.hand + '/' + s.groups.map(function (g) {
      return g.amt + ':' + g.min + ':' + g.max;
    }).join(',');
  }

  function resetTally() {
    deals = 0;
    hits = 0;
    el['deal-tally'].innerHTML = '';
  }

  /* What the strip is showing, in words. Two-letter chips coloured by group
     are meaningless read aloud one by one, so the hand is summarised by what
     it actually contains. */
  /** @param {Card[]} cards */
  function describeHand(cards) {
    /** @type {Record<number, number>} */
    var counts = {};
    var others = 0;
    cards.forEach(function (c) {
      if (!c) { others++; return; }
      counts[c.index] = (counts[c.index] || 0) + 1;
    });
    /** @type {string[]} */
    var parts = [];
    state.groups.forEach(function (g, i) {
      if (counts[i]) parts.push(counts[i] + ' ' + groupLabel(g, i));
    });
    if (others) parts.push(others + ' from everything else');
    return parts.join(', ');
  }

  /* Every card dealt gets a slot. Twelve used to be the ceiling, so a larger
     hand showed only the front of a sorted list — hiding whichever groups sort
     last, even though the hit/miss tally had already counted them. MAX_HAND is
     the bound now: a valid hand never exceeds it, and an invalid one (this runs
     on the error path too) can't spin up a runaway number of nodes.

     Extra cards follow the opening hand behind a divider, in the order they
     were drawn. Only cards from `fresh` onwards play the flip, so drawing one
     more does not re-deal the whole strip in front of you. A dealt strip is
     sized by its cards, which the deck bounds; MAX_HAND guards the rest. */
  /**
   * @param {Card[] | null} cards
   * @param {number} opening
   * @param {number} fresh
   */
  function renderHand(cards, opening, fresh) {
    var size = cards ? cards.length : Math.min(state.hand, MAX_HAND);
    var html = '';
    for (var i = 0; i < size; i++) {
      if (cards && i === opening) html += '<span class="hand-sep" aria-hidden="true"></span>';
      var cls = 'hand-card' + (cards && i >= opening ? ' extra' : '') + (cards && i >= fresh ? ' dealt' : '');
      var c = cards ? cards[i] : null;
      if (c) {
        html += '<span class="' + cls + ' filled" style="--spine:' + spineFor(c.index) + '">' +
                escapeHtml(c.label) + '</span>';
      } else {
        html += '<span class="' + cls + '"></span>';
      }
    }
    var strip = el['hand-strip'];
    strip.classList.toggle('tight', size > 24);
    strip.innerHTML = html;

    /* Empty slots really are decoration, so they stay hidden. A dealt hand is
       information, and the whole strip is one picture of it — hence a single
       described image rather than a run of cryptic two-letter chips. */
    if (cards) {
      var label = 'Hand dealt: ' + describeHand(cards.slice(0, opening)) + '.';
      if (size > opening) label += ' Then drew ' + describeHand(cards.slice(opening)) + '.';
      strip.removeAttribute('aria-hidden');
      strip.setAttribute('role', 'img');
      strip.setAttribute('aria-label', label);
    } else {
      strip.setAttribute('aria-hidden', 'true');
      strip.removeAttribute('role');
      strip.removeAttribute('aria-label');
    }
  }

  /**
   * @param {number} g
   * @returns {Card}
   */
  function toCard(g) {
    if (g < 0) return null;
    var name = groupLabel(state.groups[g], g);
    return { index: g, label: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || String(g + 1) };
  }

  /* Whether a run of drawn tags meets every group's requirement. A maximum
     at or above the hand size is how "no upper limit" gets written, so it
     stays unlimited once extra cards take the count past the hand. */
  /** @param {number[]} tags */
  function meets(tags) {
    var counts = state.groups.map(function () { return 0; });
    tags.forEach(function (g) { if (g >= 0) counts[g]++; });
    return state.groups.every(function (g, i) {
      var cap = g.max >= state.hand ? Infinity : g.max;
      return counts[i] >= g.min && counts[i] <= cap;
    });
  }

  /* The hand goes, and the shuffle behind it with it. Runs on every edit,
     since an extra card drawn from the old setup's deck means nothing in the
     new one. The tally is left alone: resetTally decides when that goes. */
  function clearDeal() {
    dealt = null;
    el['draw-extra'].hidden = true;
    el['deal-extra'].innerHTML = '';
    renderHand(null, 0, 0);
  }

  function deal() {
    if (oddsCard.classList.contains('is-error')) return;

    /* The whole deck is shuffled, not just the hand, so extra cards come off
       the top of the same shuffle. The first `hand` cards of a full partial
       Fisher-Yates are exactly the sample a hand-sized one would give. */
    var rest = state.deck - state.groups.reduce(function (sum, g) { return sum + g.amt; }, 0);
    var order = drawHand(
      state.groups.map(function (g) { return g.amt; }),
      rest,
      state.deck,
      Math.random
    );
    var drawn = order.slice(0, state.hand);
    var pass = meets(drawn);

    var cards = drawn.slice().sort(function (a, b) { return (a < 0 ? 99 : a) - (b < 0 ? 99 : b); })
      .map(toCard);

    dealt = { order: order, cards: cards, extra: 0 };
    renderHand(cards, state.hand, 0);
    el['deal-extra'].innerHTML = '';
    el['draw-extra'].hidden = false;
    el['draw-extra'].disabled = order.length <= state.hand;

    deals++;
    if (pass) hits++;
    var rate = ((hits / deals) * 100).toFixed(1);
    el['deal-tally'].innerHTML = '<span class="' + (pass ? 'hit' : 'miss') + '">' +
      (pass ? 'Hit' : 'Miss') + '</span> · ' + hits + ' of ' + deals + ' dealt (' + rate + '%)' +
      /* Announced with the result, so pressing Deal says what turned up
         instead of only whether it counted. Visually this stays compact. */
      '<span class="sr-only"> — drew ' + escapeHtml(describeHand(cards)) + '.</span>';
  }

  /* One more card off the shuffle. Reported on its own line and never added
     to the tally, which samples the opening hand the headline odds are for. */
  function drawExtra() {
    if (!dealt) return;
    var next = state.hand + dealt.extra;
    if (next >= dealt.order.length) return;

    dealt.extra++;
    var card = toCard(dealt.order[next]);
    dealt.cards.push(card);
    renderHand(dealt.cards, state.hand, dealt.cards.length - 1);

    var pass = meets(dealt.order.slice(0, next + 1));
    el['deal-extra'].innerHTML = 'With ' + dealt.extra + ' extra card' + (dealt.extra === 1 ? '' : 's') +
      ': <span class="' + (pass ? 'hit' : 'miss') + '">' + (pass ? 'Hit' : 'Miss') + '</span>' +
      '<span class="sr-only"> — drew ' + escapeHtml(describeHand([card])) + '.</span>';

    /* The deck has run out. Focus would be stranded on a disabled button, so
       it goes back to Deal, the one thing still worth pressing. */
    if (next + 1 >= dealt.order.length) {
      el['draw-extra'].disabled = true;
      el['deal-extra'].innerHTML += ' · that was the last card';
      el.deal.focus();
    }
  }

  /* ======================================================================
     Persistence and sharing
     ====================================================================== */

  /** @type {number | undefined} */
  var saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      writeStore(STATE_KEY, JSON.stringify(share.toStored(setups, active)));
    }, 250);
  }

  /* Puts a set of setups on the page, from a link, storage or the defaults,
     opening on `index`. */
  /**
   * @param {Setup[]} list
   * @param {number} index
   */
  function loadSetups(list, index) {
    setups = list.slice();
    active = index;
    loadState(setups[active]);
  }

  /** @type {number | undefined} */
  var flashTimer;

  /** @param {string} message */
  function flash(message) {
    el['share-status'].textContent = message;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el['share-status'].textContent = ''; }, 2600);
  }

  /**
   * @param {string} text
   * @param {string} okMessage
   */
  function copyText(text, okMessage) {
    var done = function () { flash(okMessage); };
    var fallback = function () {
      var field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { flash('Copying is blocked here — select the text by hand.'); }
      document.body.removeChild(field);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /** @param {Setup} s */
  function setupLines(s) {
    var lines = ['Deck of ' + s.deck + ', drawing ' + s.hand + '.'];
    s.groups.forEach(function (g, i) {
      lines.push('• ' + groupLabel(g, i) + ': ' + g.amt + ' in deck, want ' + g.min + '–' + g.max + ' in hand.');
    });
    return lines;
  }

  function summaryText() {
    if (setups.length > 1) return compareSummary();
    var lines = [];
    /* Read the computed figure, not the headline element: that text is a
       tween for 300ms after every edit, and it is the placeholder dash
       whenever the setup does not add up. */
    lines.push(oddsCard.classList.contains('is-error')
      ? 'Opening hand odds — this setup does not add up yet.'
      : 'Opening hand odds — ' + lastShown.toFixed(2) + '%');
    return lines.concat(setupLines(state)).join('\n');
  }

  function compareSummary() {
    var odds = setups.map(oddsOf);
    /** @param {number | null} p */
    var figure = function (p) { return p === null ? 'does not add up yet' : (p * 100).toFixed(2) + '%'; };
    var lines = ['Opening hand odds — A ' + figure(odds[0]) + ', B ' + figure(odds[1]) + '.'];
    lines.push(compareLine(odds).replace(/<[^>]+>/g, ''));
    setups.forEach(function (s, i) {
      lines.push('', 'Setup ' + LETTERS[i] + ' — ' + figure(odds[i]));
      lines = lines.concat(setupLines(s));
    });
    return lines.join('\n');
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  /** @param {Setup} s */
  function loadState(s) {
    el['deck-size'].value = String(s.deck);
    el['hand-size'].value = String(s.hand);
    renderGroups(s.groups.length ? s.groups : DEFAULTS.groups);
    syncChips();
    update();
  }

  function syncChips() {
    all(document, '.chip[data-deck]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(el['deck-size'].value === chip.dataset.deck));
    });
    all(document, '.chip[data-hand]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(el['hand-size'].value === chip.dataset.hand));
    });
  }

  function init() {
    initTheme();

    /** @type {Stored | null} */
    var initial = null;
    var hash = window.location.hash;
    var linked = hash.indexOf('#d=') === 0 ? share.decodeLink(hash.slice(3)) : null;
    if (linked) initial = { setups: linked, active: 0 };
    if (!initial) {
      var stored = readStore(STATE_KEY);
      if (stored) {
        try { initial = share.fromStored(JSON.parse(stored)); } catch (e) { initial = null; }
      }
    }
    if (!initial) initial = { setups: [DEFAULTS], active: 0 };

    /* Every listener below this line is attached after loadState, so a setup
       that throws here would cost the page its wiring entirely. Falling back
       is worth more than honouring a setup we cannot render; the defaults get
       saved over the bad value on the way through, so it does not come back. */
    try {
      loadSetups(initial.setups, initial.active);
    } catch (e) {
      loadSetups([DEFAULTS], 0);
    }

    /* Any edit anywhere in the form recalculates */
    document.addEventListener('input', function (e) {
      if (e.target instanceof Element && e.target.matches('#deck-size, #hand-size, .g-name, .g-amt, .g-min, .g-max')) {
        syncChips();
        update();
      }
    });

    all(document, '.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (chip.dataset.deck) el['deck-size'].value = chip.dataset.deck;
        if (chip.dataset.hand) el['hand-size'].value = chip.dataset.hand;
        syncChips();
        update();
      });
    });

    el['add-group'].addEventListener('click', function () {
      var count = el.groups.querySelectorAll('.group').length;
      if (count >= MAX_GROUPS) return;
      el.groups.appendChild(buildGroup({ name: '', amt: 3, min: 1, max: 3 }, count));
      renumber();
      var last = el.groups.lastElementChild;
      var added = last && last.querySelector('.g-name');
      if (added instanceof HTMLElement) added.focus();
      update();
      announce('Group added.');
    });

    el.reset.addEventListener('click', function () {
      if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
      loadSetups([DEFAULTS], 0);   /* a comparison goes too */
      resetTally();   /* "Start over" means the dealt hands go too, even when
                         the numbers happen to already match the defaults. */
      flash('Back to the starting setup.');
    });

    el.deal.addEventListener('click', function () {
      deal();
    });

    el['draw-extra'].addEventListener('click', function () {
      drawExtra();
    });

    el['compare-start'].addEventListener('click', function () {
      startComparing();
    });

    el['compare-stop'].addEventListener('click', function () {
      stopComparing();
      el['compare-start'].focus();   /* the button that was pressed is now hidden */
    });

    all(el['compare-tabs'], '.compare-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        showSetup(Number(tab.dataset.setup));
      });
    });

    el['copy-link'].addEventListener('click', function () {
      var url = window.location.origin === 'null' || !window.location.origin
        ? window.location.href.split('#')[0]
        : window.location.origin + window.location.pathname;
      copyText(url + '#d=' + share.encodeLink(setups), 'Link copied.');
    });

    el['copy-summary'].addEventListener('click', function () {
      copyText(summaryText(), 'Results copied.');
    });

    el['examples-toggle'].addEventListener('click', function () {
      var open = el['examples-toggle'].getAttribute('aria-expanded') === 'true';
      el['examples-toggle'].setAttribute('aria-expanded', String(!open));
      el.examples.hidden = open;
    });

    all(document, '[data-example]').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var example = trigger.dataset.example && EXAMPLES[trigger.dataset.example];
        if (!example) return;
        loadState(example);
        var setup = document.getElementById('deck-setup');
        if (setup) setup.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    });

    window.addEventListener('hashchange', function () {
      var next = window.location.hash.indexOf('#d=') === 0 ? share.decodeLink(window.location.hash.slice(3)) : null;
      if (next) loadSetups(next, 0);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
