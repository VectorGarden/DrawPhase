/* ==========================================================================
   Draw Phase — Yu-Gi-Oh! opening hand odds
   Exact multivariate hypergeometric odds, computed with BigInt so the
   numbers stay honest even on a 60 card deck.
   ========================================================================== */

(function () {
  'use strict';

  var THEME_KEY = 'drawphase.theme';
  var STATE_KEY = 'drawphase.state';
  var MAX_GROUPS = 12;
  var MAX_DECK = 200;   /* matches the max= on #deck-size */
  var MAX_HAND = 60;    /* matches the max= on #hand-size */
  var SPINES = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];

  var DEFAULTS = {
    deck: 40,
    hand: 5,
    groups: [
      { name: 'Starters', amt: 12, min: 1, max: 5 },
      { name: 'Hand traps', amt: 9, min: 1, max: 5 }
    ]
  };

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

  var state = null;
  var lastShown = 0;
  var lastSignature = null;
  var deals = 0;
  var hits = 0;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var el = {};
  ['deck-size', 'hand-size', 'groups', 'rest-amt', 'rest-max', 'add-group', 'reset',
   'odds-value', 'odds-figure', 'odds-fill', 'odds-plain', 'hand-strip', 'deal',
   'deal-tally', 'breakdown', 'copy-link', 'copy-summary', 'share-status',
   'theme-toggle', 'meta-theme-color', 'examples', 'examples-toggle', 'group-template',
   'group-status']
    .forEach(function (id) {
      el[id] = document.getElementById(id);
    });

  var oddsCard = document.querySelector('.odds-card');

  /* ======================================================================
     Storage helpers — every call is wrapped, private mode must not break us
     ====================================================================== */

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* nothing to do */ }
  }

  /* ======================================================================
     Theme
     ====================================================================== */

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

  /* ======================================================================
     Reading the form
     ====================================================================== */

  function toInt(value) {
    var n = parseInt(value, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function readState() {
    var groups = [];
    Array.prototype.forEach.call(el.groups.querySelectorAll('.group'), function (node) {
      groups.push({
        name: node.querySelector('.g-name').value,
        amt: toInt(node.querySelector('.g-amt').value),
        min: toInt(node.querySelector('.g-min').value),
        max: toInt(node.querySelector('.g-max').value)
      });
    });
    return {
      deck: toInt(el['deck-size'].value),
      hand: toInt(el['hand-size'].value),
      groups: groups
    };
  }

  function groupLabel(group, index) {
    return group.name.trim() || 'Group ' + (index + 1);
  }

  function spineFor(index) {
    return 'var(' + SPINES[index % SPINES.length] + ')';
  }

  /* ======================================================================
     Validation
     ====================================================================== */

  function validate(s) {
    var problems = [];
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
    Array.prototype.forEach.call(el.groups.querySelectorAll('.group'), function (node, i) {
      var body = node.querySelector('.group-body');
      if (body && state.groups[i]) body.setAttribute('aria-label', groupLabel(state.groups[i], i));
    });
  }

  function paintFlags(check) {
    el['deck-size'].classList.toggle('invalid', check.flags.deck);
    el['hand-size'].classList.toggle('invalid', check.flags.hand);
    Array.prototype.forEach.call(el.groups.querySelectorAll('.group'), function (node, i) {
      var f = check.flags.groups[i] || {};
      node.querySelector('.g-amt').classList.toggle('invalid', !!f.amt);
      node.querySelector('.g-min').classList.toggle('invalid', !!f.min);
      node.querySelector('.g-max').classList.toggle('invalid', !!f.max);
    });
  }

  /* ======================================================================
     Presentation helpers
     ====================================================================== */

  function tone(p) {
    if (p < 0.30) return 'var(--bad)';
    if (p < 0.70) return 'var(--warn)';
    return 'var(--good)';
  }

  function trim(x) {
    if (x >= 100) return String(Math.round(x));
    if (x >= 10) return x.toFixed(0);
    return x.toFixed(1).replace(/\.0$/, '');
  }

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

  var animFrame = null;

  function stopAnimation() {
    if (animFrame !== null) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
  }

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

  function buildGroup(data, index) {
    var node = el['group-template'].content.firstElementChild.cloneNode(true);
    node.style.setProperty('--spine', spineFor(index));
    node.querySelector('.g-name').value = data.name || '';
    node.querySelector('.g-amt').value = data.amt;
    node.querySelector('.g-min').value = data.min;
    node.querySelector('.g-max').value = data.max;

    /* The template's labels carry no `for`, and the group rows are clones, so
       there is no id to point at until one is minted here. Without this every
       field falls back to its own value for a name — a screen reader reads the
       row as "12, edit / 1, edit / 5, edit", and both name fields announce as
       "Starters" off the shared placeholder. */
    var uid = 'grp' + (++groupSeq);
    FIELDS.forEach(function (sel) {
      var input = node.querySelector(sel);
      var label = input.parentNode.querySelector('label');
      input.id = uid + sel.replace('.g-', '-');
      if (label) label.setAttribute('for', input.id);
    });
    /* Named on the body rather than the <li> so the list keeps its item
       semantics; it tells you which group the four fields belong to. */
    node.querySelector('.group-body').setAttribute('role', 'group');

    node.querySelector('.btn-remove').addEventListener('click', function () {
      /* Work out where to land before the node goes: removing it drops focus
         to the body, and the next Tab then restarts from the top of the
         document, which loses a keyboard user their place entirely. */
      var rows = Array.prototype.slice.call(el.groups.querySelectorAll('.group'));
      var at = rows.indexOf(node);
      var neighbour = rows[at + 1] || rows[at - 1];

      node.remove();
      renumber();
      update();

      /* The neighbour's own remove button, unless removing left one group and
         disabled it — then the button that is still worth pressing. */
      var landing = neighbour && !neighbour.querySelector('.btn-remove').disabled
        ? neighbour.querySelector('.btn-remove')
        : (el['add-group'].disabled ? null : el['add-group']);
      if (landing) landing.focus();

      announce('Group removed.');
    });
    return node;
  }

  function announce(what) {
    if (!el['group-status']) return;
    var count = el.groups.querySelectorAll('.group').length;
    el['group-status'].textContent = what + ' ' + count + (count === 1 ? ' group' : ' groups') +
      (count >= MAX_GROUPS ? ', the maximum.' : '.');
  }

  function renumber() {
    var nodes = el.groups.querySelectorAll('.group');
    Array.prototype.forEach.call(nodes, function (node, i) {
      node.style.setProperty('--spine', spineFor(i));
      node.querySelector('.btn-remove').disabled = nodes.length <= 1;
    });
    el['add-group'].disabled = nodes.length >= MAX_GROUPS;
  }

  function renderGroups(groups) {
    el.groups.innerHTML = '';
    groups.forEach(function (g, i) { el.groups.appendChild(buildGroup(g, i)); });
    renumber();
  }

  /* ======================================================================
     The main update pass
     ====================================================================== */

  function update() {
    state = readState();

    var check = validate(state);
    paintFlags(check);
    nameGroups();

    var rest = state.deck - check.assigned;
    var restMax = state.hand - check.required;
    el['rest-amt'].textContent = rest;
    el['rest-amt'].classList.toggle('bad', rest < 0);
    el['rest-max'].textContent = restMax < 0 ? '\u2212' + Math.abs(restMax) : restMax;
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
      renderHand(null);
      lastShown = 0;
      save();
      return;
    }

    oddsCard.classList.remove('is-error');

    var groups = state.groups.map(function (g) {
      return { amt: g.amt, min: g.min, max: Math.min(g.max, g.amt, state.hand) };
    });

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
    renderHand(null);
    save();
  }

  /* ======================================================================
     Per-group breakdown
     ====================================================================== */

  /* Which slice of the distribution to draw. The old code took k = 0..6 flat,
     so any hand of seven or more cut the chart off mid-curve — and a group
     asking for eight showed no highlighted bar at all, which reads as "this
     never happens". Trim only where the probability is too small to see, and
     never trim across the range the user actually asked for. */
  function sparkRange(dist, lo, hi) {
    var EPS = 0.0005;
    var first = 0;
    var last = dist.length - 1;
    while (first < last && first < lo && dist[first] < EPS) first++;
    while (last > first && last > hi && dist[last] < EPS) last--;
    return { first: first, last: last };
  }

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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ======================================================================
     Deal a test hand
     ====================================================================== */

  /* Everything that moves the odds, and nothing that does not — group names
     are deliberately absent. */
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
  function describeHand(cards) {
    var counts = {};
    var others = 0;
    cards.forEach(function (c) {
      if (!c) { others++; return; }
      counts[c.index] = (counts[c.index] || 0) + 1;
    });
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
     on the error path too) can't spin up a runaway number of nodes. */
  function renderHand(cards) {
    var size = Math.min(state ? state.hand : 5, MAX_HAND);
    var html = '';
    for (var i = 0; i < size; i++) {
      if (cards && cards[i]) {
        var c = cards[i];
        html += '<span class="hand-card filled dealt" style="--spine:' + spineFor(c.index) + '">' +
                escapeHtml(c.label) + '</span>';
      } else if (cards) {
        html += '<span class="hand-card dealt"></span>';
      } else {
        html += '<span class="hand-card"></span>';
      }
    }
    var strip = el['hand-strip'];
    strip.classList.toggle('tight', size > 24);
    strip.innerHTML = html;

    /* Empty slots really are decoration, so they stay hidden. A dealt hand is
       information, and the whole strip is one picture of it — hence a single
       described image rather than a run of cryptic two-letter chips. */
    if (cards) {
      strip.removeAttribute('aria-hidden');
      strip.setAttribute('role', 'img');
      strip.setAttribute('aria-label', 'Hand dealt: ' + describeHand(cards) + '.');
    } else {
      strip.setAttribute('aria-hidden', 'true');
      strip.removeAttribute('role');
      strip.removeAttribute('aria-label');
    }
  }

  function deal() {
    if (oddsCard.classList.contains('is-error')) return;

    var pile = [];
    state.groups.forEach(function (g, i) {
      for (var n = 0; n < g.amt; n++) pile.push(i);
    });
    var rest = state.deck - state.groups.reduce(function (sum, g) { return sum + g.amt; }, 0);
    for (var n = 0; n < rest; n++) pile.push(-1);

    /* Partial Fisher-Yates: only the cards we actually draw */
    var drawn = [];
    for (var i = 0; i < state.hand && pile.length; i++) {
      var j = i + Math.floor(Math.random() * (pile.length - i));
      var tmp = pile[i]; pile[i] = pile[j]; pile[j] = tmp;
      drawn.push(pile[i]);
    }

    var counts = state.groups.map(function () { return 0; });
    drawn.forEach(function (g) { if (g >= 0) counts[g]++; });

    var pass = state.groups.every(function (g, i) {
      return counts[i] >= g.min && counts[i] <= Math.min(g.max, g.amt, state.hand);
    });

    var cards = drawn.slice().sort(function (a, b) { return (a < 0 ? 99 : a) - (b < 0 ? 99 : b); })
      .map(function (g) {
        if (g < 0) return null;
        var name = groupLabel(state.groups[g], g);
        return { index: g, label: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || String(g + 1) };
      });

    renderHand(cards);

    deals++;
    if (pass) hits++;
    var rate = ((hits / deals) * 100).toFixed(1);
    el['deal-tally'].innerHTML = '<span class="' + (pass ? 'hit' : 'miss') + '">' +
      (pass ? 'Hit' : 'Miss') + '</span> · ' + hits + ' of ' + deals + ' dealt (' + rate + '%)' +
      /* Announced with the result, so pressing Deal says what turned up
         instead of only whether it counted. Visually this stays compact. */
      '<span class="sr-only"> — drew ' + escapeHtml(describeHand(cards)) + '.</span>';
  }

  /* ======================================================================
     Persistence and sharing
     ====================================================================== */

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      writeStore(STATE_KEY, JSON.stringify(state));
    }, 250);
  }

  function encodeState(s) {
    var compact = {
      d: s.deck,
      h: s.hand,
      g: s.groups.map(function (g) { return [g.name, g.amt, g.min, g.max]; })
    };
    var json = JSON.stringify(compact);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeState(token) {
    try {
      var b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var parsed = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!parsed || !Array.isArray(parsed.g)) return null;
      return {
        deck: toInt(parsed.d),
        hand: toInt(parsed.h),
        groups: parsed.g.slice(0, MAX_GROUPS).map(function (g) {
          return { name: String(g[0] || '').slice(0, 30), amt: toInt(g[1]), min: toInt(g[2]), max: toInt(g[3]) };
        })
      };
    } catch (e) { return null; }
  }

  function flash(message) {
    el['share-status'].textContent = message;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(function () { el['share-status'].textContent = ''; }, 2600);
  }

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

  function summaryText() {
    var lines = [];
    /* Read the computed figure, not the headline element: that text is a
       tween for 300ms after every edit, and it is the placeholder dash
       whenever the setup does not add up. */
    lines.push(oddsCard.classList.contains('is-error')
      ? 'Opening hand odds — this setup does not add up yet.'
      : 'Opening hand odds — ' + lastShown.toFixed(2) + '%');
    lines.push('Deck of ' + state.deck + ', drawing ' + state.hand + '.');
    state.groups.forEach(function (g, i) {
      lines.push('• ' + groupLabel(g, i) + ': ' + g.amt + ' in deck, want ' + g.min + '–' + g.max + ' in hand.');
    });
    return lines.join('\n');
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function loadState(s) {
    el['deck-size'].value = s.deck;
    el['hand-size'].value = s.hand;
    renderGroups(s.groups.length ? s.groups : DEFAULTS.groups);
    syncChips();
    update();
  }

  function syncChips() {
    document.querySelectorAll('.chip[data-deck]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(el['deck-size'].value === chip.dataset.deck));
    });
    document.querySelectorAll('.chip[data-hand]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(el['hand-size'].value === chip.dataset.hand));
    });
  }

  function init() {
    initTheme();

    var initial = null;
    var hash = window.location.hash;
    if (hash.indexOf('#d=') === 0) initial = decodeState(hash.slice(3));
    if (!initial) {
      var stored = readStore(STATE_KEY);
      if (stored) { try { initial = JSON.parse(stored); } catch (e) { initial = null; } }
    }
    if (!initial || typeof initial.deck !== 'number' || !Array.isArray(initial.groups)) {
      initial = DEFAULTS;
    }

    loadState(initial);

    /* Any edit anywhere in the form recalculates */
    document.addEventListener('input', function (e) {
      if (e.target.matches('#deck-size, #hand-size, .g-name, .g-amt, .g-min, .g-max')) {
        syncChips();
        update();
      }
    });

    document.querySelectorAll('.chip').forEach(function (chip) {
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
      var added = el.groups.lastElementChild.querySelector('.g-name');
      if (added) added.focus();
      update();
      announce('Group added.');
    });

    el.reset.addEventListener('click', function () {
      if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
      loadState(DEFAULTS);
      resetTally();   /* "Start over" means the dealt hands go too, even when
                         the numbers happen to already match the defaults. */
      flash('Back to the starting setup.');
    });

    el.deal.addEventListener('click', function () {
      deal();
    });

    el['copy-link'].addEventListener('click', function () {
      var url = window.location.origin === 'null' || !window.location.origin
        ? window.location.href.split('#')[0]
        : window.location.origin + window.location.pathname;
      copyText(url + '#d=' + encodeState(state), 'Link copied.');
    });

    el['copy-summary'].addEventListener('click', function () {
      copyText(summaryText(), 'Results copied.');
    });

    el['examples-toggle'].addEventListener('click', function () {
      var open = el['examples-toggle'].getAttribute('aria-expanded') === 'true';
      el['examples-toggle'].setAttribute('aria-expanded', String(!open));
      el.examples.hidden = open;
    });

    document.querySelectorAll('[data-example]').forEach(function (button) {
      button.addEventListener('click', function () {
        loadState(EXAMPLES[button.dataset.example]);
        document.getElementById('deck-setup').scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    });

    window.addEventListener('hashchange', function () {
      var next = window.location.hash.indexOf('#d=') === 0 ? decodeState(window.location.hash.slice(3)) : null;
      if (next) loadState(next);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
