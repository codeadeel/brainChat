"""BIDS/OpenNeuro catalog discovery for ds005777."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

from .config import RAW_DIR, PROCESSED_DIR

RUN_RE = re.compile(r"_run-(\d+)_channels\.tsv$")

# Paper channel numbering (Peng et al. 2018, Fig. 2).
# The medial BA10 grid (C9-C16) was read directly from the figure (top row
# 16,15,14,13 left-to-right; bottom row 12,11,10,9 left-to-right, with the
# subject's left on the image's right, confirmed by the F3/C3 vs F8/Fp2
# landmark positions in the figure). Lateral channels follow the recording
# order in the SNIRF files (left PFC first, right S1 last).
PAPER_CHANNEL = {
    "S1-D1": 1, "S1-D3": 2, "S2-D1": 3, "S2-D2": 4, "S2-D3": 5, "S2-D4": 6,
    "S3-D2": 7, "S3-D4": 8,
    # medial BA10 (verified from the figure)
    "S4-D7": 9, "S5-D7": 10, "S5-D8": 11, "S6-D8": 12,
    "S4-D5": 13, "S5-D5": 14, "S5-D6": 15, "S6-D6": 16,
    # right S1
    "S7-D9": 17, "S7-D11": 18, "S8-D9": 19, "S8-D10": 20,
    "S8-D11": 21, "S8-D12": 22, "S9-D10": 23, "S9-D12": 24,
}
PAPER_BA10 = {10, 14, 15, 16}
SES_RE = re.compile(r"ses-([^/]+)$")


def _read_tsv(path: Path) -> list[dict[str, str]]:
    """Read a tab-delimited BIDS file into a list of row dictionaries."""
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def _num(value: str | None, default: float = 0.0) -> float:
    """Safely convert a string field to float, returning `default` on failure."""
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def normalize_event_type(raw: str) -> str:
    """Normalize the inconsistent event labels in this dataset."""
    s = re.sub(r"\s+", "", (raw or "")).lower()
    if s.endswith("vas7") or "vas7" in s:
        return "VAS7"
    if s.endswith("vas3") or "vas3" in s:
        return "VAS3"
    return (raw or "unknown").strip()


def parse_events(path: Path) -> list[dict[str, Any]]:
    """Parse an `*_events.tsv` file, normalizing VAS labels and flagging practice trials."""
    rows = _read_tsv(path)
    events: list[dict[str, Any]] = []
    for i, row in enumerate(rows):
        value = _num(row.get("value"), 0.0)
        events.append(
            {
                "index": i,
                "onset": round(_num(row.get("onset")), 4),
                "duration": round(_num(row.get("duration")), 4),
                "type": normalize_event_type(row.get("trial_type", "")),
                "value": value,
                "practice": value < 0,
                "raw_type": row.get("trial_type", ""),
            }
        )
    events.sort(key=lambda e: e["onset"])
    return events


def _optodes(path: Path) -> dict[str, dict[str, float]]:
    """Load 2D/3D optode coordinates keyed by source/detector name."""
    out: dict[str, dict[str, float]] = {}
    if not path.exists():
        return out
    for row in _read_tsv(path):
        out[row["name"]] = {
            "type": row.get("type", ""),
            "x": _num(row.get("x")),
            "y": _num(row.get("y")),
            "z": _num(row.get("z")),
        }
    return out


def assign_roi(x_mid: float, y_mid: float, short: bool) -> str:
    """Map an optode midpoint and separation flag to an anatomical ROI label."""
    if short:
        return "short"
    if x_mid <= -55 and y_mid >= 20:
        return "left_pfc"
    if x_mid >= 40 and -35 <= y_mid <= 45:
        return "right_s1"
    if abs(x_mid) <= 30 and y_mid >= 55:
        return "medial_ba10"
    return "other"


def parse_channels(channels_path: Path, optodes_path: Path) -> list[dict[str, Any]]:
    """Return one record per source-detector pair (33 for this dataset)."""
    opt = _optodes(optodes_path)
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for row in _read_tsv(channels_path):
        src, det = row.get("source", ""), row.get("detector", "")
        if not src or not det:
            continue
        key = (src, det)
        rec = pairs.setdefault(
            key,
            {
                "name": f"{src}-{det}",
                "source": src,
                "detector": det,
                "wavelengths": [],
                "types": [],
            },
        )
        wl = _num(row.get("wavelength_nominal"), 0)
        if wl:
            rec["wavelengths"].append(wl)
        rec["types"].append(row.get("type", ""))

    out: list[dict[str, Any]] = []
    for pair_index, ((src, det), rec) in enumerate(pairs.items()):
        s = opt.get(src, {})
        d = opt.get(det, {})
        x_mid = (s.get("x", 0.0) + d.get("x", 0.0)) / 2.0
        y_mid = (s.get("y", 0.0) + d.get("y", 0.0)) / 2.0
        dist = ((s.get("x", 0.0) - d.get("x", 0.0)) ** 2 + (s.get("y", 0.0) - d.get("y", 0.0)) ** 2 + (s.get("z", 0.0) - d.get("z", 0.0)) ** 2) ** 0.5
        short = dist < 15.0
        out.append(
            {
                **rec,
                "pair_index": pair_index,
                "paper_index": PAPER_CHANNEL.get(rec["name"]) if not short else None,
                "source_xy": [round(s.get("x", 0.0), 2), round(s.get("y", 0.0), 2)],
                "detector_xy": [round(d.get("x", 0.0), 2), round(d.get("y", 0.0), 2)],
                "x_mid": round(x_mid, 2),
                "y_mid": round(y_mid, 2),
                "separation_mm": round(dist, 2),
                "short": short,
                "roi": assign_roi(x_mid, y_mid, short),
            }
        )
    return out


def timepoint_for_run(run: str) -> str:
    """Map chronological BIDS run labels (`run-01`..`run-04`) to nominal dosing timepoints."""
    return {
        "run-01": "pre",
        "run-02": "30min",
        "run-03": "60min",
        "run-04": "90min",
    }.get(run, "extra")


def discover(raw_dir: Path = RAW_DIR) -> dict[str, Any]:
    """Scan the raw BIDS ds005777 tree and construct the complete subject/run catalog."""
    participants_path = raw_dir / "participants.tsv"
    if not participants_path.exists():
        raise FileNotFoundError(f"Dataset metadata not found at {participants_path}")

    participants: dict[str, dict[str, str]] = {}
    for row in _read_tsv(participants_path):
        participants[row["participant_id"]] = row

    subjects: dict[str, Any] = {}
    runs: dict[str, Any] = {}

    for subj_dir in sorted(p for p in raw_dir.glob("sub-*") if p.is_dir()):
        subject = subj_dir.name
        if subject not in participants:
            continue
        # The participant table names which visit received morphine; the other
        # visit is placebo.
        visits = {
            "V1": "morphine" if participants[subject].get("MORPHINE") == "V1" else "placebo",
            "V2": "morphine" if participants[subject].get("MORPHINE") == "V2" else "placebo",
        }
        subjects[subject] = {"subject": subject, "visits": visits, "sessions": {}}

        for ses_dir in sorted(p for p in subj_dir.glob("ses-*") if p.is_dir()):
            session = ses_dir.name
            visit = "V1" if session == "ses-1" else "V2"
            nirs_dir = ses_dir / "nirs"
            if not nirs_dir.exists():
                continue
            ch_paths = sorted(nirs_dir.glob("*_channels.tsv"))
            if not ch_paths:
                continue
            first_ch = ch_paths[0]
            prefix = first_ch.name[: -len("_run-01_channels.tsv")] if "_run-01_" in first_ch.name else None
            # Robust prefix extraction
            m = re.match(r"(.+)_task-[^_]+_run-\d+_channels\.tsv$", first_ch.name)
            prefix = m.group(1) if m else first_ch.name.split("_task-")[0]
            optodes_path = nirs_dir / f"{prefix}_optodes.tsv"
            channels = parse_channels(first_ch, optodes_path)
            condition = subjects[subject]["visits"][visit]

            session_runs = []
            for ch_path in ch_paths:
                mrun = RUN_RE.search(ch_path.name)
                if not mrun:
                    continue
                run = f"run-{int(mrun.group(1)):02d}"
                events_path = nirs_dir / ch_path.name.replace("_channels.tsv", "_events.tsv")
                snirf_path = nirs_dir / ch_path.name.replace("_channels.tsv", "_nirs.snirf")
                if not events_path.exists() or not snirf_path.exists():
                    continue
                run_id = f"{subject}_{session}_{run}"
                rec = {
                    "run_id": run_id,
                    "subject": subject,
                    "session": session,
                    "visit": visit,
                    "condition": condition,
                    "timepoint": timepoint_for_run(run),
                    "run": run,
                    "snirf_path": str(snirf_path.relative_to(raw_dir.parent.parent)),
                    "events_path": str(events_path.relative_to(raw_dir.parent.parent)),
                    "channels_path": str(ch_path.relative_to(raw_dir.parent.parent)),
                    "events": parse_events(events_path),
                    "channels": channels,
                }
                runs[run_id] = rec
                session_runs.append(run_id)

            subjects[subject]["sessions"][session] = {
                "session": session,
                "visit": visit,
                "condition": condition,
                "runs": sorted(session_runs),
                "channels": channels,
            }

    catalog = {
        "dataset": "ds005777",
        "name": "Electrical_Morphine_Placebo_2018",
        "sampling_frequency": 25.0,
        "subjects": subjects,
        "runs": runs,
        "rois": sorted({c["roi"] for r in runs.values() for c in r["channels"]}),
    }
    return catalog


def save_catalog(catalog: dict[str, Any], path: Path | None = None) -> Path:
    """Serialize `catalog` to JSON under `PROCESSED_DIR/catalog.json` or `path`."""
    path = path or (PROCESSED_DIR / "catalog.json")
    path.write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    return path


def load_catalog(refresh: bool = False) -> dict[str, Any]:
    """Load cached `catalog.json`, or rediscover raw BIDS files when missing or `refresh=True`."""
    path = PROCESSED_DIR / "catalog.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    catalog = discover()
    save_catalog(catalog, path)
    return catalog


def resolve_raw(rel_path: str) -> Path:
    """Resolve a path stored relative to DATA_DIR/raw."""
    from .config import DATA_DIR

    return (DATA_DIR / rel_path).resolve()


if __name__ == "__main__":
    cat = discover()
    save_catalog(cat)
    print(f"{len(cat['subjects'])} subjects, {len(cat['runs'])} runs")
    for rid, r in list(cat["runs"].items())[:3]:
        print(rid, r["condition"], r["timepoint"], len(r["events"]), len(r["channels"]))
