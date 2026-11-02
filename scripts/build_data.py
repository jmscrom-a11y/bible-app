#!/usr/bin/env python3
"""Download public-domain Bibles from getbible.net v2 and split them into
per-book JSON files the web app can lazy-load, plus a shared book manifest.

Translations (both public domain):
  - kjv     : King James Version (English, 1769)
  - korean  : 개역성경 (Korean Revised Version 1952/1961, from Wikisource)

Output layout (under public/data/):
  books.json              -> [{nr, ko, en, chapters}]  (shared manifest, 66 entries)
  <trans>/<nr>.json       -> {nr, name, chapters:[{chapter, verses:[{v, t}]}]}

Run once:  python3 scripts/build_data.py
Re-running overwrites the data; the manifest book names come from whichever
translation is listed first in TRANSLATIONS (korean) for the Korean label and
kjv for the English label.
"""
from __future__ import annotations

import json
import pathlib
import sys
import urllib.request

BASE = "https://api.getbible.net/v2"
TRANSLATIONS = ["kjv", "korean"]
OUT = pathlib.Path(__file__).resolve().parents[1] / "public" / "data"

# Canonical English book names by 1-based number, so the manifest has stable
# English labels regardless of a translation's own naming.
EN_NAMES = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
    "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
    "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
    "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
    "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
]


def fetch(url: str) -> dict:
    print(f"  GET {url}")
    # getbible.net 403s the default Python UA; present a browser-like one.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def slim_book(book: dict) -> dict:
    """Keep only what the reader needs: nr, name, and compact verses {v,t}."""
    chapters = []
    for ch in book["chapters"]:
        verses = [{"v": v["verse"], "t": v["text"].strip()} for v in ch["verses"]]
        chapters.append({"chapter": ch["chapter"], "verses": verses})
    return {"nr": book["nr"], "name": book["name"], "chapters": chapters}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ko_names: dict[int, str] = {}
    chapter_counts: dict[int, int] = {}

    for trans in TRANSLATIONS:
        print(f"[{trans}] downloading full bible...")
        data = fetch(f"{BASE}/{trans}.json")
        tdir = OUT / trans
        tdir.mkdir(exist_ok=True)
        for book in data["books"]:
            nr = book["nr"]
            slim = slim_book(book)
            (tdir / f"{nr}.json").write_text(
                json.dumps(slim, ensure_ascii=False, separators=(",", ":"))
            )
            chapter_counts[nr] = len(slim["chapters"])
            if trans == "korean":
                ko_names[nr] = book["name"]
        print(f"[{trans}] wrote {len(data['books'])} books -> {tdir}")

    manifest = []
    for nr in range(1, 67):
        manifest.append({
            "nr": nr,
            "ko": ko_names.get(nr, EN_NAMES[nr - 1]),
            "en": EN_NAMES[nr - 1],
            "chapters": chapter_counts.get(nr, 0),
            "testament": "OT" if nr <= 39 else "NT",
        })
    (OUT / "books.json").write_text(json.dumps(manifest, ensure_ascii=False))
    print(f"wrote manifest -> {OUT / 'books.json'} ({len(manifest)} books)")
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
