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

Everything is static — no build step, no dependencies, no Actions workflow
needed.

**1. Push the files.** Put the contents of this folder at the *root* of the
branch you publish from (`main` or `gh-pages`), not inside a subfolder:

```
index.html
404.html
favicon.ico
site.webmanifest
robots.txt
sitemap.xml
CNAME
.nojekyll
assets/
```

**2. Turn on Pages.** Repo → Settings → Pages → Source: *Deploy from a branch*,
then pick your branch and the `/ (root)` folder.

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

- `CNAME` — the custom domain. One line, no protocol, no trailing slash.
- `.nojekyll` — stops Pages running the files through Jekyll.
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
point even on a 60-card deck. Results are verified against brute-force
enumeration of the full hand space.

Theme and saved setups live under the `drawphase.*` local storage keys.

## Licence

GPL-3.0, inherited from the original project. See `LICENSE.md`.

---

Created by Reizu.
