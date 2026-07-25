#!/usr/bin/env python3
"""
One-time import of Google Maps saved-list CSV exports into a single dataset.

Reads every *.csv in data/, resolves each row to a stable identity (the Google
Maps feature ID embedded in the URL), merges rows that appear in more than one
list, and writes seed.json.

Run once:  python3 scripts/import_lists.py
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
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "seed.json")

# Filename (minus emoji/extension) -> list slug.
#
# Provenance only — which of the four lists a place was saved to. NOT a quality
# hierarchy and not a ranking input. Every one of the 1,340 places is somewhere
# Nathan decided was worth eating at, so they all carry equal weight as taste
# signal; the list name is kept for display, nothing more.
#
# Order is used solely for merge precedence when the same place appears twice:
# the later entry wins as the more recent state, not the better one.
LIST_ORDER = ["might_try", "hidden_gem", "must_try", "good_eats"]

LIST_TO_SLUG = {
    "might try": "might_try",
    "must try": "must_try",
    "good eats": "good_eats",
    "hidden gems": "hidden_gem",
}

# !1s<hex>:<hex> — the second hex is the CID, unique per physical place.
FEATURE_ID = re.compile(r"!1s(0x[0-9a-f]+):(0x[0-9a-f]+)")


def list_name(path):
    """'Hidden Gems 🤫.csv' -> 'hidden gems'"""
    stem = os.path.splitext(os.path.basename(path))[0]
    # Drop anything that isn't a letter, digit or space (emoji, ‼️, etc).
    cleaned = "".join(c for c in stem if c.isalnum() or c.isspace())
    return " ".join(cleaned.split()).lower()


def normalize_title(title):
    """
    Fold case, width and punctuation so 'Dave's' and 'Dave’s' compare equal.
    Only used for grouping search queries; the display title is kept separately
    and identity comes from the CID.
    """
    folded = unicodedata.normalize("NFKC", title).casefold()
    stripped = "".join(c if c.isalnum() or c.isspace() else " " for c in folded)
    return " ".join(stripped.split())


def parse_identity(url):
    """Return (cid, feature_id) from a Maps URL, or (None, None) if absent."""
    if not url:
        return None, None
    m = FEATURE_ID.search(url)
    if not m:
        return None, None
    return m.group(2), f"{m.group(1)}:{m.group(2)}"


def main():
    paths = sorted(glob.glob(os.path.join(DATA, "*.csv")))
    if not paths:
        raise SystemExit(f"No CSVs found in {DATA}")

    places = {}          # key -> record
    key_of_title = {}    # normalized title -> key, for rows with no feature ID
    stats = Counter()
    unresolved = []

    for path in paths:
        lname = list_name(path)
        slug = LIST_TO_SLUG.get(lname)
        if slug is None:
            raise SystemExit(f"Unmapped list name {lname!r} from {path}")

        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                title = (row.get("Title") or "").strip()
                if not title:
                    continue  # export has a blank leading row per file

                stats["rows"] += 1
                url = (row.get("URL") or "").strip()
                note = (row.get("Note") or "").strip()
                cid, feature_id = parse_identity(url)
                norm = normalize_title(title)

                if cid:
                    key = f"cid:{cid}"
                else:
                    # No feature ID: fall back to title identity so the row
                    # still merges with itself across lists.
                    key = f"title:{norm}"
                    unresolved.append(title)
                    stats["no_feature_id"] += 1
                key_of_title.setdefault(norm, key)

                existing = places.get(key)
                if existing is None:
                    places[key] = {
                        "id": key,
                        "cid": cid,
                        "featureId": feature_id,
                        "title": title,
                        "normalizedTitle": norm,
                        "mapsUrl": url,
                        "list": slug,
                        "sourceLists": [slug],
                        "notes": [note] if note else [],
                        # Filled in by the enrichment pass.
                        "enriched": False,
                    }
                    continue

                stats["merged"] += 1
                if slug not in existing["sourceLists"]:
                    existing["sourceLists"].append(slug)
                # Later list wins as the more recent state, not the better one.
                if LIST_ORDER.index(slug) > LIST_ORDER.index(existing["list"]):
                    existing["list"] = slug
                if note and note not in existing["notes"]:
                    existing["notes"].append(note)

    records = list(places.values())
    for r in records:
        r["sourceLists"].sort(key=LIST_ORDER.index)

    records.sort(key=lambda r: r["normalizedTitle"])

    payload = {
        "source": "Google Maps saved lists export",
        "listFiles": [os.path.basename(p) for p in paths],
        "listOrder": LIST_ORDER,
        "count": len(records),
        "places": records,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    by_list = Counter(r["list"] for r in records)
    multi = [r for r in records if len(r["sourceLists"]) > 1]

    print(f"rows read:        {stats['rows']}")
    print(f"unique places:    {len(records)}")
    print(f"merges:           {stats['merged']}")
    print(f"rows w/o cid:     {stats['no_feature_id']}")
    print()
    print("resolved list:")
    for s in LIST_ORDER:
        print(f"  {s:12} {by_list[s]:4}")
    print()
    print(f"in >1 list:       {len(multi)}")
    print()
    print("sample merges:")
    for r in multi[:12]:
        print(f"  {r['title'][:44]:44} {' + '.join(r['sourceLists'])} -> {r['list']}")
    if unresolved:
        print(f"\n{len(unresolved)} rows had no feature ID (title-matched instead):")
        for t in unresolved[:10]:
            print(f"  {t}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
