#!/usr/bin/env python3
"""Scan the data/ directory for CSV files and write data/manifest.json."""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")


def main():
    csv_files = sorted(
        f for f in os.listdir(DATA_DIR)
        if f.lower().endswith(".csv") and os.path.isfile(os.path.join(DATA_DIR, f))
    )

    manifest_path = os.path.join(DATA_DIR, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(csv_files, f, indent=2)
        f.write("\n")

    print(f"Wrote {manifest_path}: {csv_files}")


if __name__ == "__main__":
    main()