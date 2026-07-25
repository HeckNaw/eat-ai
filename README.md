# chudly.ai

A personal food assistant. One user. Opens on a phone, asks four questions,
returns picks from the 1,269 saved places and from places never saved.

See [ARCHITECTURE.md](ARCHITECTURE.md) for why it works the way it does.

## Run it locally

```bash
npm install
cp .env.example .env     # paste the Google key into GOOGLE_MAPS_API_KEY
npm run dev              # http://localhost:5173
```

Leave `APP_PASSCODE` empty locally and the API routes stay open.

`npm run dev` regenerates `public/places.json` and `public/taste.json` from
`labelled.json` first, so editing the data pipeline needs no extra step.

**Geolocation needs a secure context.** `localhost` counts as secure, so plain
http works — but only on localhost, *not* on `http://192.168.x.x`. To test on a
phone before deploying, tunnel it:

```bash
npx localtunnel --port 5173     # or: cloudflared tunnel --url http://localhost:5173
```

## Deploy it

Vercel, free tier, hosting cost $0. Three steps.

### 1. Import the repo

```bash
npm i -g vercel
vercel login
vercel link          # accept the Vite defaults: build `npm run build`, output `dist`
```

Or import `HeckNaw/chudly-ai` from the Vercel dashboard — it detects Vite on its
own. Both routes give the same result; the CLI is faster if you're already here.

### 2. Set the two environment variables

```bash
vercel env add GOOGLE_MAPS_API_KEY production   # paste the key
vercel env add APP_PASSCODE production          # invent one; you type it once per device
```

Add them to `preview` too if you want preview deployments to work.

**`APP_PASSCODE` is not optional in production.** A Vercel URL is public, and
every `/api` call spends real Google quota. Without it, anyone who finds the URL
can run searches on your bill. With it set, `/api/discover` and `/api/geocode`
return 401 before touching Google.

What it does *not* protect: `public/places.json` is a static asset and stays
readable by anyone with the URL. The saved restaurant list isn't the secret —
the spend is. `robots.txt` and a `noindex` meta keep the URL out of search.

### 3. Ship

```bash
vercel --prod
```

Then open the URL on your phone and **Share → Add to Home Screen**. The manifest
and icons are already in place, so it launches full-screen with no browser
chrome and its own icon.

## Harden the Google key

Do this once, in [console.cloud.google.com](https://console.cloud.google.com).
The key now lives only in a Vercel function, so referrer restrictions don't
apply — these two do:

1. **Credentials → the key → API restrictions →** *Places API (New)* only. A
   leaked key then buys nothing but the API you already budgeted for.
2. **IAM & Admin → Quotas →** set a hard daily cap on Places requests. A ceiling,
   not a billing alert: a runaway loop becomes impossible rather than merely
   visible after the fact.

## What it costs to run

| | |
|---|---|
| Enrichment, already paid | 1,237 Text Search Enterprise calls · **$8.96**, one time |
| Discovery — one call per *Feed me* | Nearby Search, own SKU, 1,000 free/month · **$0** |
| Address lookup — one call per search | Text Search with a 4-field mask, cheapest tier · **$0** |
| Anthropic | **$0** — nothing calls a model at query time |
| Vercel | **$0** — free tier |

Ongoing cost is $0 unless you press *Feed me* more than about 30 times a day,
every day. "See more" is free until the fetched pool of 20 runs dry.

The only genuinely recurring cost is the domain, if you want `chudly.ai` rather
than `chudly-ai.vercel.app`. `.ai` domains run roughly US$70–110/year — an order
of magnitude more than the app itself. The Vercel subdomain is free and works
identically once it's on your home screen, where you never see the URL again.

To attach a domain you do buy: **Vercel → project → Settings → Domains**, add it,
and point the registrar's nameservers or A record where Vercel says.

## Rebuilding the data

```bash
npm run enrich     # Places API — costs money, already done, needs --force to redo
npm run label      # cuisine + attribute labelling, free, runs in Claude Code
npm run derive     # taste.json statistics + the browser payload
npm run icons      # regenerate the home-screen PNGs
```

`npm run build` runs the browser-payload step itself, so a deploy never ships
stale `places.json`.
