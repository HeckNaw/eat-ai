# Foodlists — architecture

A personal food assistant. Single user. Opens on a phone, asks a few
objectively-filtering questions, and returns picks drawn from both the saved
lists and from places never saved — using the saved lists to work out what
Nathan likes.

## Design rules

1. **Facts are computed, judgment is derived from data.** Distance, opening
   hours, and dedup are arithmetic. Taste is a statistical comparison against
   the 267 `good_eats` places. No hand-authored thresholds anywhere — no
   `rating > 4.6`, because Dav's Hotspot and Chrisly Cafe are low-rated
   favourites and a rule like that would rank them down.
2. **Questions must be objectively filterable.** Each one maps to a hard
   filter over real fields. "Who are you with" was cut for failing this.
3. **The LLM runs once, at build time.** It converts text (names, editorial
   summaries) into structured fields. Nothing calls a model at query time, so
   there is no Anthropic key and no recurring AI cost.
4. **On-list and off-list candidates are scored by the same function**, so they
   compete fairly instead of one being privileged by construction.

## Data, built once

```
data/*.csv                Google Maps export (4 lists, 1,343 rows)
   │  scripts/import_lists.py
   ▼
seed.json                 1,340 places · CID identity · status · tier      ✅ done
   │  scripts/enrich.mjs                       ← Places API, ~1,237 calls
   ▼
enriched.json             + placeId, coords, types, rating, reviewCount,
                            priceLevel, openingHours, summary, businessStatus
   │  scripts/label.mjs                        ← Claude Code, one-time, free
   ▼
labelled.json             + cuisine (granular), attributes[]
lexicon.json                keyword → cuisine map, reused for off-list places
   │  scripts/derive.mjs                       ← pure statistics
   ▼
taste.json                distributions computed from the 267 good_eats
```

### Why the labelling pass exists

Google's taxonomy tops out at cuisine *family* and is often empty:

| Place | Google `types` | In the name |
|---|---|---|
| Chengdu Spicy Chinese Cuisine | `chinese_restaurant` | Sichuan |
| Ama Ko Momo | `restaurant` | Nepali |
| +84 | `coffee_shop` | Vietnamese |
| SUYA CITY express | `restaurant` | West African |

250 of 1,340 titles state their cuisine using a crude keyword list; a model
reading all of them finds far more. Editorial summaries carry venue character
too — *unassuming*, *cash-only*, *compact*, *housemade* — which is likely where
the appeal of the low-rated favourites actually lives.

`lexicon.json` is the by-product that matters: `momo → Nepali`,
`nihari → Pakistani`, `chengdu → Sichuan`. Cuisine words repeat, so the same
dictionary labels **off-list** candidates at query time for free. No per-query
model call, even for places never saved.

### taste.json — computed, not authored

Derived from the 267 `good_eats` only (`hidden_gem` sits in the wishlist tier —
the label goes stale as places get popularised):

- cuisine frequency distribution
- rating distribution (mean, spread) — so low-rated favourites shift it rather
  than being penalised
- review-count distribution — captures the under-reviewed preference without
  hardcoding a cutoff
- price-level distribution, over the ~52% of places that have one
- attribute frequencies from the labelling pass
- geographic clusters — where he actually eats

## Runtime, every query

```
1. QUESTIONS      when · how far · list-only / new / either
2. LOCATION       browser geolocation, manual entry as fallback
3. CANDIDATES     on-list:  filter labelled.json locally      → 0 calls
                  off-list: Nearby Search × top cuisines      → 3–5 calls
4. HARD FILTERS   open at target time · within radius ·
                  operational · not already saved (off-list only)
5. SCORE          every candidate vs taste.json — same function both sources
6. SELECT         greedy diversity so five picks aren't five ramen shops
7. RENDER         two labelled sections, up to 5 each, "see more" under both
```

### Results: two sections, up to 5 + 5

On-list and off-list picks are never blended into one ranked list. Blending
would require a weight for "Nathan already saved this", and no principled value
for it exists — set it high and discovery never fires, set it low and the 1,073
deliberately-saved places get ignored. So the sections are explicit:

```
FROM YOUR LIST        up to 5     ← already vetted
   [ see more ]
NEW TO YOU            up to 5     ← never saved
   [ see more ]
```

"Up to" is literal: if only two places pass the filters, two are shown. No
padding with results that failed a hard filter.

### "See more" — free most of the time

The two buttons have very different costs, and the design exploits that:

| | cost | depth |
|---|---|---|
| **From your list** | **$0** — already in memory | every place that passed, however many |
| **New to you** | **$0** until the fetched pool is exhausted | ~80 candidates ≈ 16 pages |

The initial discovery call already fetches up to 20 results per cuisine across
3–5 cuisines — roughly 80 candidates — while showing only 5. So the first dozen
or more "see more" taps just paginate a pool already paid for. Only when that
pool runs dry does the app widen the radius or query further cuisines, and it
says so before spending a call.

Over-fetch once, paginate free.

### The questions

| Question | Options | Filters on |
|---|---|---|
| When | now · in an hour · tonight · tomorrow | `openingHours` at target time |
| How far | <1km · <5km · <10km · 10km+ · type your answer | haversine from location |
| Price | $ · $$ · $$$+ · doesn't matter | `priceLevel`, with inference (below) |
| Source | from my list · something new · either | `status` presence |

Free-text distance is parsed for units and for time ("20 min" → ~10km at city
driving speed), and the interpreted radius is echoed back so it can be corrected.

### Price, and the 48% that don't have one

Google has no `priceLevel` for roughly half the saved places, and the gap is
not random — it is systematically the small independents that dominate the
lists. A naive price filter would therefore discard the favourites it should be
surfacing.

Three-part handling:

1. **Known price** — filter on `priceLevel` directly.
2. **Unknown price** — the labelling pass estimates a band from the name and
   editorial summary, which carry strong signal for this: *compact*,
   *counter-service*, *cash-only*, *takeaway*, *shop* all read cheap. Stored as
   `priceEstimate` with a confidence, kept strictly separate from the real field.
3. **Never silently dropped** — a pick that passed on an estimate is labelled
   "price unconfirmed" in the UI, so an estimate is never presented as fact.

Observed distribution across the probe sample was `INEXPENSIVE` and `MODERATE`
only, with no `EXPENSIVE` at all — so the `$$$+` bucket will likely return
little from the saved lists and lean on off-list discovery.

### Opening hours

`regularOpeningHours.periods` is a weekly recurring schedule, fetched once and
stored. Open-at-time is computed locally against the place's `utcOffsetMinutes`.
Must handle:

- overnight periods (opens 18:00, closes 02:00)
- places that close before the target time — "closing in 15 minutes" is not a
  usable recommendation, so a configurable buffer applies
- missing hours (~20% of small places) — surfaced as "hours unknown" rather
  than silently dropped or silently included

This is why hours are fetched at enrichment and never per query. A design where
each "what's open" tap hits the API would be the expensive mistake.

### Location privacy

Geolocation is requested only after an explanation of why it's needed, on a
user action rather than page load — a cold browser permission prompt gets
denied. Denial falls back to manual entry (neighbourhood or postal code); it
never dead-ends.

## Off-list discovery

Nearby Search, narrowed to the top cuisines from `taste.json` via
`includedPrimaryTypes`, with `rankPreference: DISTANCE`.

The default prominence ranking is actively wrong here: 20 prominent restaurants
downtown are the chains and patio spots that years of saving nothing has
already rejected. Narrow calls return relevant results instead of generic ones.

Exclusion is exact — Places returns `placeId`, and after enrichment every saved
place has one, so "something new" genuinely means new. Without enrichment this
would be fuzzy name matching, and discovery would keep re-suggesting places
already sitting in Might try.

Candidates are labelled through `lexicon.json`, scored by the same function as
on-list places, and cached by (rounded location, cuisine, day) so repeat
queries in the same neighbourhood cost nothing.

## Cost

| | |
|---|---|
| Enrichment, one-time | 1,237 calls · $9.00, or **$0** split across the month boundary |
| Discovery, ongoing | ~120 calls/month vs 1,000 free — **$0** |
| Anthropic | **$0** — labelling runs in Claude Code |
| Hosting | **$0** — Vercel free tier |

Text Search **Enterprise** at $35/1,000 with 1,000 free per month. Enterprise is
required, not chosen: rating, review count, price and hours are all in that tier.

## Stack

Vite + React + TypeScript, deployed to Vercel, installed to the home screen as
a PWA. `labelled.json` in compact form is ~143KB — it ships to the browser, so
all on-list filtering is local and instant with zero network calls.

The Google key never reaches the browser. Discovery goes through one Vercel
serverless function that holds it server-side.

## Deliberately excluded

- **Per-query LLM calls.** Ranking 80 candidates against 267 examples is a
  statistical problem. Adding a model buys better prose and fuzzy-intent
  parsing, neither of which is wanted right now. The hook stays available.
- **Conversation.** Explicitly not needed.
- **Embeddings.** Would need a second provider for "same vibe" matching. The
  labelling pass covers most of the gap at zero recurring cost.
- **Multi-user.** Single user by design: no auth, no cold start, no per-user
  cost.
- **A derived prose profile.** Nice for showing "here's what I think you like",
  not needed to serve a query.

## Known gaps

- `priceLevel` is missing for ~48% of places, and systematically for the small
  independents that dominate the lists. Price is an optional filter, never a
  primary signal.
- ~10% of places may be closed permanently (2 of 10 in one probe sample).
  Filtered on `businessStatus`, but the lists themselves go stale.
- Off-list places whose names reveal nothing ("Dav's Hotspot") get no cuisine
  label from the lexicon and fall back to structured fields only.
- No visit history and no dates in the export, so recency weighting starts from
  first use rather than being backfillable.
