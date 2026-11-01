/* ==========================================================================
   Draw Phase — setups in and out: share links and the stored copy.

   Every setup that reaches the form comes through here, from a link or from
   storage alike, and leaves as a Setup that cannot throw on its way into the
   page. Kept apart from the DOM for the same reason as math.js: so that
   test/share.test.js can load it in Node and hold the link format to its
   promises, old links included.

   Loaded as a plain script by index.html, or required from Node. No build
   step and no dependencies either way.
   ========================================================================== */

// @ts-check

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DrawPhaseShare = api;
})(typeof self !== 'undefined' ? self : this, /** @returns {DrawPhaseShareApi} */ function () {
  'use strict';

  var MAX_GROUPS = 12;
  var NAME_MAX = 30;    /* matches the maxlength= on a group name */
  var MAX_SETUPS = 2;   /* A and B */

  /* Takes anything, since stored and shared setups are untrusted JSON.
     parseInt converts to a string first anyway, so String() changes nothing. */
  /** @param {unknown} value */
  function toInt(value) {
    var n = parseInt(String(value), 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  /* The stored copy was once left to walk unchecked into the page: one null
     group threw, and because the page wires its listeners after loading a
     setup, it came up inert with no way back — typing did nothing, and
     "Start over" was dead too, on that reload and every one after it.

     `raw` is any on purpose: it is parsed JSON, and checking it is this
     function's whole job. What comes out is a Setup. */
  /**
   * @param {any} raw
   * @returns {Setup | null}
   */
  function normaliseSetup(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.groups)) return null;
    return {
      deck: toInt(raw.deck),
      hand: toInt(raw.hand),
      groups: raw.groups.slice(0, MAX_GROUPS).map(/** @param {any} g */ function (g) {
        if (!g || typeof g !== 'object') g = {};
        return {
          name: typeof g.name === 'string' ? g.name.slice(0, NAME_MAX) : '',
          amt: toInt(g.amt),
          min: toInt(g.min),
          max: toInt(g.max)
        };
      })
    };
  }

  /* ----------------------------------------------------------------------
     Share links

     The token after #d= is base64url over JSON. One setup is
     { d, h, g: [[name, amt, min, max], ...] }, exactly as it always was, so a
     link to a single setup is unchanged and every link already shared keeps
     working. A comparison wraps two of those as { c: [A, B] }. Telling them
     apart by shape, rather than by a version number, is what lets the old
     links carry on without one.
     ---------------------------------------------------------------------- */

  /** @param {Setup} s */
  function toCompact(s) {
    return {
      d: s.deck,
      h: s.hand,
      g: s.groups.map(function (g) { return [g.name, g.amt, g.min, g.max]; })
    };
  }

  /**
   * @param {any} c
   * @returns {Setup | null}
   */
  function fromCompact(c) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.g)) return null;
    return normaliseSetup({
      deck: c.d,
      hand: c.h,
      groups: c.g.map(/** @param {any} g */ function (g) {
        if (!Array.isArray(g)) g = [];
        return { name: g[0], amt: g[1], min: g[2], max: g[3] };
      })
    });
  }

  /**
   * @param {Setup[]} setups
   * @returns {string}
   */
  function encodeLink(setups) {
    var body = setups.length > 1
      ? { c: setups.slice(0, MAX_SETUPS).map(toCompact) }
      : toCompact(setups[0]);
    var json = JSON.stringify(body);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* One or two setups, or null when nothing usable is in there. A comparison
     with one half broken still opens the half that survived. */
  /**
   * @param {string} token
   * @returns {Setup[] | null}
   */
  function decodeLink(token) {
    try {
      var b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var parsed = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!parsed || typeof parsed !== 'object') return null;
      var raw = Array.isArray(parsed.c) ? parsed.c.slice(0, MAX_SETUPS) : [parsed];
      return present(raw.map(fromCompact));
    } catch (e) { return null; }
  }

  /* ----------------------------------------------------------------------
     The stored copy

     Stored as { setups, active }. Before comparisons it was the bare setup,
     and a visitor's last session is still in that shape until they next
     change something, so it reads as a single setup.
     ---------------------------------------------------------------------- */

  /**
   * @param {Setup[]} setups
   * @param {number} active
   */
  function toStored(setups, active) {
    return { setups: setups.slice(0, MAX_SETUPS), active: active };
  }

  /**
   * @param {any} raw
   * @returns {Stored | null}
   */
  function fromStored(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.setups)) {
      var single = normaliseSetup(raw);
      return single ? { setups: [single], active: 0 } : null;
    }
    var setups = present(raw.setups.slice(0, MAX_SETUPS).map(normaliseSetup));
    if (!setups) return null;
    /* Only B can be active, and only when B survived. */
    return { setups: setups, active: raw.active === 1 && setups.length > 1 ? 1 : 0 };
  }

  /**
   * @param {(Setup | null)[]} list
   * @returns {Setup[] | null}
   */
  function present(list) {
    /** @type {Setup[]} */
    var kept = [];
    list.forEach(function (s) { if (s) kept.push(s); });
    return kept.length ? kept : null;
  }

  return {
    MAX_GROUPS: MAX_GROUPS,
    toInt: toInt,
    normaliseSetup: normaliseSetup,
    encodeLink: encodeLink,
    decodeLink: decodeLink,
    toStored: toStored,
    fromStored: fromStored
  };
});
