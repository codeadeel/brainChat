"""Download the ds005777 fNIRS dataset from the public OpenNeuro S3 mirror.

Usage:
  python scripts/download_data.py --dest ../data/raw
  python scripts/download_data.py --dest ../data/raw --subjects sub-002,sub-005
"""
from __future__ import annotations

import argparse
import concurrent.futures
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

S3 = "https://s3.amazonaws.com/openneuro.org"
PREFIX = "ds005777/"
KEEP_SUFFIXES = (
    ".snirf",
    "_events.tsv",
    "_events.json",
    "_channels.tsv",
    "_nirs.json",
    "_optodes.tsv",
    "_optodes.json",
    "_coordsystem.json",
    "_sessions.tsv",
)
KEEP_ROOT = ("participants.tsv", "participants.json", "dataset_description.json", "README.txt", "CHANGES")


def list_keys() -> list[tuple[str, int]]:
    """List all S3 object keys and byte sizes under the OpenNeuro `ds005777` prefix."""
    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    url = f"{S3}?list-type=2&prefix={PREFIX}&max-keys=1000"
    with urllib.request.urlopen(url, timeout=60) as response:
        root = ET.fromstring(response.read())
    out = []
    for item in root.findall("s3:Contents", ns):
        key = item.findtext("s3:Key", default="", namespaces=ns)
        size = int(item.findtext("s3:Size", default="0", namespaces=ns))
        if key:
            out.append((key, size))
    return out


def wanted(key: str, subjects: set[str] | None) -> bool:
    """Return True if `key` is a required fNIRS/BIDS file matching the subject filter."""
    tail = key.rsplit("/", 1)[-1]
    if tail in KEEP_ROOT:
        return True
    if subjects:
        parts = key.split("/")
        if len(parts) > 2 and parts[1] not in subjects:
            return False
    return key.endswith(KEEP_SUFFIXES)


def download(key: str, dest: Path) -> tuple[str, int, str | None]:
    """Download one S3 object atomically to `dest / key`, skipping non-empty existing files."""
    target = dest / key
    if target.exists() and target.stat().st_size > 0:
        return key, target.stat().st_size, None
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        urllib.request.urlretrieve(f"{S3}/{key}", tmp)
        tmp.replace(target)
        return key, target.stat().st_size, None
    except Exception as exc:
        if tmp.exists():
            tmp.unlink()
        return key, 0, f"{type(exc).__name__}: {exc}"


def main() -> None:
    """Parse CLI options and download OpenNeuro ds005777 files in parallel."""
    default_dest = str(Path(os.getenv("DATA_DIR", "../data")) / "raw")
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", default=default_dest, help="destination directory (contains ds005777/)")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--subjects", default=None, help="comma-separated subject ids")
    args = parser.parse_args()

    dest = Path(args.dest).resolve()
    subjects = set(args.subjects.split(",")) if args.subjects else None
    print(f"listing s3://openneuro.org/{PREFIX} …")
    keys = [(k, s) for k, s in list_keys() if wanted(k, subjects)]
    total = sum(s for _, s in keys)
    print(f"{len(keys)} files, {total / 1e9:.2f} GB -> {dest}")
    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(download, key, dest): key for key, _ in keys}
        for i, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            key, size, err = fut.result()
            if err:
                errors.append((key, err))
                print(f"[{i}/{len(keys)}] FAILED {key}: {err}", file=sys.stderr)
            elif i % 10 == 0 or i == len(keys):
                print(f"[{i}/{len(keys)}] {key} ({size / 1e6:.1f} MB)")
    if errors:
        print(f"{len(errors)} failures", file=sys.stderr)
        raise SystemExit(1)
    print("done")


if __name__ == "__main__":
    main()
