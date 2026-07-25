# Foodlists — architecture

A personal food assistant. Single user. Opens on a phone, asks a few
objectively-filtering questions, and returns picks drawn from both the saved
lists and from places never saved — using the saved lists to work out what
Nathan likes.

## Design rules

1. **Facts are computed, judgment is derived from data.** Distance, opening
   hours, and dedup are arithmetic. Taste is a statistical comparison against
   all 1,340 saved places. No hand-authored thresholds anywhere — no
   `rating > 4.6`, because some favourites are low-rated and a rule like that
   would rank them down.

   **All 1,340 places carry equal weight.** Might try, Must try, Hidden Gems and
   Good eats are provenance, not a quality hierarchy — every one is somewhere
   Nathan decided was worth eating at, and an unvisited place may well be better
   than a visited one. There is no tried/untried axis and no per-place state to
   maintain, which is why the app needs no database at all.
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
seed.json                 1,340 places · CID identity · list provenance   ✅ done
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
taste.json                distributions over all 1,340, weighted equally
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

Derived from all 1,340 saved places, weighted equally:

- cuisine frequency distribution — the primary signal
- cuisine-family rollup, for softer matching
- attribute frequencies from the labelling pass
- geographic clusters — the neighbourhoods worth searching in

**Not** scoring inputs, though still stored for display:

- rating — the distribution is too tight to discriminate (mean 4.40, sd 0.28,
  249 of 266 at 4.0★+), and weighting it would push down exactly the low-rated
  favourites that motivated rule 1
- review count — no obscurity preference is visible in the data
- price level — missing for 46% of saved places and 75% of off-list candidates

## Runtime, every query

```
1. QUESTIONS      when · how far · craving (multi, optional)
2. LOCATION       browser geolocation, manual entry as fallback
3. CANDIDATES     on-list:  filter labelled.json locally      → 0 calls
                  off-list: one Nearby Search                 → 1 call
4. HARD FILTERS   open at target time · within radius ·
                  operational · not already saved (off-list only)
5. SCORE          every candidate vs taste.json — same function both sources
6. SELECT         greedy diversity so five picks aren't five ramen shops
7. RENDER         two labelled sections, up to 5 each, "see more" under both
```

### Results: two sections, up to 5 + 5

On-list and off-list picks are never blended into one ranked list. Blending
would require a weight for "Nathan already saved this", and no principled value
for it exists — set it high and discovery never fires, set it low and the 1,340
deliberately-saved places get ignored. So the sections are explicit:

```
FROM YOUR LIST        up to 5     ← somewhere you saved
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
| **New to you** | **$0** until the fetched pool is exhausted | 20 candidates = 4 pages |

`includedPrimaryTypes` accepts many cuisines in a **single** call — verified
live with seven types in one request — so a multi-cuisine craving is still one
call, not one per cuisine. That call returns 20 candidates while only 5 are
shown, so the first three "see more" taps paginate a pool already paid for.
Only when it runs dry does the app widen the radius, and it says so first.

Over-fetch once, paginate free.

### The questions

Four questions, all with defaults, so the common case is a single tap.

| Question | Type | Options | Filters on |
|---|---|---|---|
| Sweet or savoury | single | savoury · sweet | cuisine `mode` |
| When | single | now · in an hour · pick a time | `openingHours` at target time |
| How far | single | walking (1km) · 5km · 10km · anywhere | haversine from location |
| Craving | **multi**, optional | family chips, each expanding to its styles | `cuisines[]` |

Four fixed radius options, no free-text entry — nobody thinks about how far
they will travel for dinner in units precise enough to type.

"Tonight" was cut for being unfilterable — a time picker replaces it.

**Sweet or savoury comes first** because it reshapes everything after it: the
chip set, the discovery types, and the results. It is deliberately a two-state
toggle with no "either" — an escape hatch there would mix bakeries back into
dinner, which is the exact noise the split exists to remove, and flipping the
toggle is one tap. Bakery, dessert, coffee and
bubble tea are 30% of the saved places — a real interest that answers a
different question than "what's for dinner", so it gets its own axis rather than
being mixed in or buried.

Each cuisine carries a `mode` in the lexicon: `savoury`, `sweet`, `both`
(bakeries and cafés, which sell savoury food too) or `retail` (groceries,
butchers — shown only when explicitly asked for). A `both` cuisine is
**matchable** in savoury mode but not **promoted** as a savoury chip: a Lebanese
bakery selling manakish should turn up in a savoury search, while offering
"Bakery" as a top suggestion at 7pm is noise.

**Craving is multi-select and hierarchical.** Chips are families; tapping one
expands to the styles inside it, so "Chinese" can mean all of it or narrow to
Cantonese, Dim Sum, Hot Pot, Hakka, Taiwanese or Sichuan. The tree is not
authored — every lexicon entry already carries a `family`, and the counts come
from the saved places:

```
Chinese (252)      Chinese 179 · Cantonese 27 · Hot Pot 13 · Hakka 11 ·
                   Dim Sum 9 · Taiwanese 6 · Sichuan 6 · Shanghainese 1
Caribbean (190)    Caribbean 85 · Jamaican 80 · Trinidadian / Guyanese 25
Japanese (171)     Japanese 105 · Sushi 43 · Ramen 23
South Asian (162)  Indian 103 · South Indian 18 · Nepali/Tibetan 15 ·
                   Pakistani 8 · Afghan 7 · Sri Lankan 7 · Bangladeshi 4
```

Selecting nothing means no cuisine constraint — in which case discovery still
narrows to the top cuisines for the chosen mode rather than running
unrestricted, because an unrestricted search downtown returns franchises.

Matching uses `cuisines[]` (every match) rather than the primary label, so a
craving for Lebanese still finds a place whose primary label is Bakery.

There is no source question: results **always** show both sections (see below),
which removes a tap and makes the split explicit rather than hidden.

Defaults are `now · <5km · anything`, so a query is one button press unless
tonight is unusual. The questions exist for narrowing, not as a toll gate.

### Price is not a filter

Dropped from the UI. `priceLevel` is missing for 46% of saved places and **75%
of off-list candidates** (5 of 20 in a live discovery test), and the gap is not
random — it is systematically the small independents that dominate the lists. A
price filter would discard the favourites it should be surfacing.

The labelling pass can estimate a band from summary vocabulary
(*counter-service*, *takeaway*, *upscale*), but in practice it only fired for 34
places, because places without a price usually lack a summary too.

`priceLevel` and `priceEstimate` are still stored and still available to the
scorer as a weak signal where present. They just never gate a result.

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
| Discovery, ongoing | 1 call per query · own SKU with 1,000 free/month — **$0** |
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

### Deployment shape

```
api/discover.js   ┐ Vercel function entries — every file under api/ becomes its
api/geocode.js    │ own function, so these are thin wrappers and nothing else
api/auth.js       ┘
lib/discover.mjs  ┐ the actual handlers, deliberately NOT under api/ — a shared
lib/geocode.mjs   │ module there would be deployed as a function with no default
lib/auth.mjs      ┘ export. Imported by both the wrappers and the dev middleware.
```

`vite.config.ts` mounts the same three handlers as dev middleware, so `npm run
dev` and production are one code path rather than two.

`vercel.json` exists for exactly one reason: `scripts/lib/labeller.mjs` reads
`lexicon.json` at runtime through a path computed from `import.meta.url`, which
static tracing can miss. `includeFiles` pins it into the function bundle instead
of trusting the trace.

### The gate

A Vercel URL is public and every `/api` call spends Google quota, so
`APP_PASSCODE` guards the two Places routes — 401 before any outbound request.
`/api/auth` exists so the client can learn whether it's unlocked without
spending a call; it touches no external API.

The gate protects the **spend**, not the data: `public/places.json` is a static
asset and stays readable to anyone with the URL. That's an accepted trade — the
saved restaurant list is not sensitive, and hiding it would mean serving 123KB
through a function on every cold load. `robots.txt` and `noindex` keep the URL
out of search results.

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
