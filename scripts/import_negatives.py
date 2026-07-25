#!/usr/bin/env python3
"""
Import the "would not eat here" lists into negatives.json.

The saved lists gave 1,269 positives and nothing else, which made this a
one-class problem: the scorer could only count how often a cuisine appears and
call that taste. These 56 places are the missing half — and unlike implicit
signals such as taps, an explicit no carries no rank-position confound.

Deliberately mirrors import_lists.py: same CID identity, same title
normalisation, same CSV shape. Negatives have to be enriched with the same
field mask as positives or the two are not comparable, so they flow through the
same enrichment path afterwards.

The reason is the point. Each list is a different kind of no, in Nathan's own
terms:

  bad_quality   ate there, disliked the food          → first-hand verdict, the
                                                        only category based on
                                                        experience rather than
                                                        prediction
  pedestrian    knows he wouldn't eat there; the      → rejection of the
                mainstream default pick, big-chain-     mass-market/default
                adjacent, mid food                      choice, NOT of quality
  inauthentic   corporate, or missing the point       → character, not quality
  overpriced    the food quality does not warrant     → a value judgement about
                the price — explicitly NOT "this        quality-per-dollar, not
                cuisine shouldn't cost this much"       about the cuisine

Two of these are easy to encode wrongly:

  - `pedestrian` is not "bad". Miku and Sotto Sotto are on it alongside Moxies
    and Pickle Barrel — the common thread is being the obvious choice, not being
    poorly executed. A model told these are low-quality would learn to avoid
    good restaurants.
  - `overpriced` is about quality-per-dollar, not about which cuisines are
    allowed to be expensive. Encoding it as "expensive Indian is bad" would
    learn something both wrong and ugly.

Only bad_quality (11) comes from having eaten there. The other 45 are a-priori
judgements from surface cues, which is fine — the app also recommends from
surface cues — but it means a model fitted here learns to replicate Nathan's
filtering instincts, not food quality per se. Worth remembering before calling
any of it "taste".

Run once:  python3 scripts/import_negatives.py
"""

import csv
import glob
import json
import os
import re
import unicodedata
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data", "negative")
OUT = os.path.join(ROOT, "negatives.json")

# Filename -> reason slug. Matched on a normalised substring because the export
# filenames carry punctuation and emoji.
REASONS = {
    "just bad quality food": "bad_quality",
    "bad food": "bad_quality",
    "too pedestrian": "pedestrian",
    "pedestrian": "pedestrian",
    "too corporate": "inauthentic",
    "too expensive": "overpriced",
}

FEATURE_ID = re.compile(r"!1s(0x[0-9a-f]+):(0x[0-9a-f]+)")


def reason_for(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    cleaned = " ".join("".join(c if c.isalnum() or c.isspace() else " " for c in stem).split()).lower()
    for key, slug in REASONS.items():
        if cleaned.startswith(key):
            return slug
    raise SystemExit(f"unmapped negative list: {stem!r}")


def normalize_title(title):
    folded = unicodedata.normalize("NFKC", title).casefold()
    stripped = "".join(c if c.isalnum() or c.isspace() else " " for c in folded)
    return " ".join(stripped.split())


def main():
    paths = sorted(glob.glob(os.path.join(DATA, "*.csv")))
    if not paths:
        raise SystemExit(f"no CSVs in {DATA}")

    places = {}
    rows = 0

    for path in paths:
        reason = reason_for(path)
        with open(path, newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                title = (row.get("Title") or "").strip()
                if not title:
                    continue
                rows += 1
                url = (row.get("URL") or "").strip()
                match = FEATURE_ID.search(url)
                cid = match.group(2) if match else None
                # Same identity rule as the positives: CID when the URL carries
                # one, normalised title otherwise.
                key = cid or normalize_title(title)

                place = places.setdefault(
                    key,
                    {
                        "title": title,
                        "normalizedTitle": normalize_title(title),
                        "cid": cid,
                        "featureId": match.group(0)[3:] if match else None,
                        "url": url,
                        "reasons": [],
                        "note": (row.get("Note") or "").strip() or None,
                    },
                )
                if reason not in place["reasons"]:
                    place["reasons"].append(reason)

    out = sorted(places.values(), key=lambda p: p["normalizedTitle"])

    # Appearing on several lists is intensity, not duplication — Piano Piano is
    # on all four. Kept as a field so a model can weight it rather than as a
    # duplicated row, which would just skew the class balance.
    for p in out:
        p["strength"] = len(p["reasons"])

    # Precedence: the negative lists are more recent, so a place appearing in
    # both wins as a negative and must be dropped from the positives. Enforced
    # here rather than left to whoever builds the training set, because a place
    # silently present in both classes is the kind of thing that poisons a model
    # without ever failing loudly.
    conflicts = []
    seed_path = os.path.join(ROOT, "seed.json")
    if os.path.exists(seed_path):
        with open(seed_path, encoding="utf-8") as fh:
            seed = json.load(fh)
        saved = seed["places"] if isinstance(seed, dict) else seed
        by_key = {}
        for p in saved:
            by_key[p.get("cid") or normalize_title(p["title"])] = p["title"]
        for key, place in places.items():
            if key in by_key:
                place["supersedes"] = by_key[key]
                conflicts.append((place["title"], by_key[key]))

    counts = Counter(r for p in out for r in p["reasons"])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"places": out, "supersededTitles": [c[1] for c in conflicts]}, fh,
                  ensure_ascii=False, indent=2)

    print(f"{rows} rows -> {len(out)} unique places -> {os.path.relpath(OUT, ROOT)}")
    for reason, n in counts.most_common():
        print(f"  {reason:12} {n}")
    multi = [p for p in out if p["strength"] > 1]
    if multi:
        print(f"  on multiple lists: {', '.join(p['title'] for p in multi)}")
    missing = [p for p in out if not p["cid"]]
    print(f"  without a CID (title match only): {len(missing)}")
    if conflicts:
        print(f"  SUPERSEDES {len(conflicts)} saved place(s) — negative wins, more recent:")
        for neg, pos in conflicts:
            print(f"    {neg}  (was saved as {pos!r})")
    else:
        print("  no conflicts with the saved lists")


if __name__ == "__main__":
    main()
