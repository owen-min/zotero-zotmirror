#!/usr/bin/env python3
"""Build installable .xpi package from src/ into build/."""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
BUILD = os.path.join(ROOT, "build")
os.makedirs(BUILD, exist_ok=True)

with open(os.path.join(SRC, "manifest.json"), "r", encoding="utf-8") as f:
    manifest = json.load(f)

version = manifest["version"]
out_xpi = os.path.join(BUILD, f"zotmirror-{version}.xpi")

with zipfile.ZipFile(out_xpi, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _dirs, files in os.walk(SRC):
        for fname in sorted(files):
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, SRC).replace(os.sep, "/")
            zf.write(full_path, rel_path)

with zipfile.ZipFile(out_xpi, "r") as zf:
    bad = zf.testzip()
    if bad is not None:
        raise RuntimeError(f"Corrupt ZIP entry: {bad}")

print(f"Built {out_xpi} ({os.path.getsize(out_xpi)} bytes)")
