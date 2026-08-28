# Draw Phase

A hypergeometric draw calculator for Yu-Gi-Oh! deck building. Set your deck
size, name the groups of cards that matter, and it tells you how often your
opening hand delivers.

Live at **[calc.reizu.dev](https://calc.reizu.dev)**.

A ground-up rewrite of the archived [yugioh.party](https://www.yugioh.party/)
calculator by Rustywolf & Bilaterus. The maths does the same job; everything
around it is new.

## What it does

- **Exact odds, not estimates.** Multivariate hypergeometric probability over
  every card group at once, so a hand only counts when it satisfies *all* of
  your requirements simultaneously.
- **Dark and light themes.** Follows your system on first visit, remembers your
  choice after that, and applies before first paint so there is no flash.
- **Per-group breakdown.** Each group's own odds plus a sparkline of how often
  you draw exactly 0, 1, 2 … copies.
- **Deal a test hand.** Draws a real random hand and keeps a running hit rate,
  which converges on the exact figure.
- **Shareable setups.** "Copy link to this setup" encodes everything in the URL.
  Your last setup is also restored from local storage.
- **Two worked examples** you can load with one click.
- Plain-language readout, keyboard accessible, responsive, and respects
  `prefers-reduced-motion`.

## Deploying to GitHub Pages

Everything is static — no build step and no dependencies. Publishing is done
by `.github/workflows/ci.yml`, which deploys to Pages after the tests pass on
`main`. Nothing reaches the live site that has not been checked first.

**1. Push the files.** Put the contents of this folder at the *root* of the
branch you publish from, not inside a subfolder:

```
index.html
404.html
favicon.ico
site.webmanifest
robots.txt
sitemap.xml
CNAME
assets/
```

The workflow copies exactly that list into the artifact it publishes, and
fails if any of it is missing. Everything else in the repository — this file,
the licence, `test/` — stays out of the artifact and off the live domain.
Deploying from a branch used to publish the lot.

**2. Turn on Pages.** Repo → Settings → Pages → Source: *GitHub Actions*.
There is no branch or folder to pick; the workflow decides what ships. Leave
the custom domain set to `calc.reizu.dev` — it lives in this setting, and
`CNAME` travels in the artifact to match.

**3. Set the custom domain.** In the same screen, enter `calc.reizu.dev` and
save. GitHub reads the `CNAME` file already included here, so this should match
straight away.

**4. DNS.** You already have the record, but for reference it should be:

| Type | Host | Value |
|------|------|-------|
| CNAME | `calc` | `<your-username>.github.io` |

**5. Tick "Enforce HTTPS"** once the certificate finishes provisioning. This can
take up to an hour after DNS resolves; the checkbox stays greyed out until then.

### Files that matter for hosting

- `CNAME` — the custom domain. One line, no protocol, no trailing slash. Kept
  in the published artifact so the domain survives a deploy.
- `404.html` — Pages serves this for any missing path. Its styles are inlined
  on purpose, because it can be served from any URL depth and relative links
  would break.
- `robots.txt` / `sitemap.xml` — both reference `calc.reizu.dev`.
- `assets/og-image.png` — the Discord/Twitter preview card. The `og:` tags in
  `index.html` point at it with an absolute URL.

If you ever move domains, update `CNAME`, the `canonical`/`og:url`/`og:image`
tags in `index.html`, `robots.txt`, and `sitemap.xml`. Nothing else is
domain-dependent; every asset path is relative.

## Can two domains point at this?

Not to one repo. GitHub's docs are explicit that the `CNAME` file can hold only
one domain, and that a domain must be unique across all GitHub Pages sites. You
can point a second DNS record at `<username>.github.io`, but GitHub won't issue
a TLS certificate for it, so it fails on HTTPS.

Two ways around it:

1. **Redirect at your DNS/CDN.** If the domain is on Cloudflare (proxied), a
   single Redirect Rule sends the second domain to `calc.reizu.dev`. Cleanest
   option, no extra repo.
2. **A one-page redirect repo.** A second Pages repo whose only job is to
   bounce to the real one. Because the redirect is served from that repo's own
   configured domain, HTTPS works properly. Forward the `#d=...` share token
   along with the redirect so shared setups survive the hop.

Either way, keep one domain canonical and redirect the other rather than
serving the site at both — duplicate content, split analytics, and the
`canonical` tag can only point one way.

## Running it locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Every path is relative, so it works from `file://`, from a custom domain, and
from a project subpath (`user.github.io/repo/`) without changes.

## Tests

The probability lives in `assets/math.js`, apart from the page, so it can be
loaded outside a browser and checked:

```bash
node test/odds.test.js
node test/deal.test.js
```

No dependencies and no test framework, same as the rest of the repo. A wrong
probability looks exactly like a right one — it is a plausible percentage
either way — so the main check shares no reasoning with the code it tests: it
builds a real deck, enumerates every hand that can be drawn from it, and
counts the ones that pass, with no binomial coefficients involved. The rest
covers values worked out by hand, invariants that must hold for any input, and
a ceiling on how long the twelve-group worst case may take, which is what
stops the memoisation quietly regressing.

`deal.test.js` does the same job for "Deal a test hand". A biased shuffle
would not look broken — the hands would stay plausible and the tally would
still converge, just on the wrong figure, leaving the page apparently
disagreeing with its own arithmetic. So the sample is compared against the
exact distribution with a chi-square over every possible hand composition,
from a seeded generator so the result is fixed rather than merely likely. Its
last section runs three broken shuffles through the identical check and
insists they are rejected, so the test re-earns its power on every run.

GitHub Actions runs both suites on every push and pull request, and the
deploy job on `main` waits for them. A failing check means the live site keeps
the last good version rather than taking the new one.

## How the maths works

Your deck is a finite pile and each card drawn is gone from it, so the odds
shift with every draw — the hypergeometric case rather than the binomial one.

For groups with sizes `n₁ … n_k` and a deck of `N`, the number of `h`-card hands
that draw exactly `c₁ … c_k` copies is:

```
C(n₁,c₁) × C(n₂,c₂) × … × C(rest, h − Σcᵢ)
```

The calculator sums that over every combination inside your min/max ranges and
divides by `C(N,h)`. All of it runs in `BigInt`, so nothing is lost to floating
point even on a 60-card deck. Results are checked against a straight
enumeration of the full hand space by `test/odds.test.js`.

Theme and saved setups live under the `drawphase.*` local storage keys.

## Licence

GPL-3.0, inherited from the original project. See `LICENSE.md`.

---

Created by Reizu.
