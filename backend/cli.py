"""Command line entry points for data preparation and serving."""
from __future__ import annotations

import argparse
import json
import sys

from . import analysis
from .catalog import discover, load_catalog, save_catalog
from .config import PROCESSED_DIR
from .preprocess import build_all


def cmd_catalog(_args) -> None:
    cat = discover()
    save_catalog(cat)
    print(f"{len(cat['subjects'])} subjects, {len(cat['runs'])} runs")
    for rid, r in list(cat["runs"].items())[:5]:
        print(f"  {rid}: {r['condition']} / {r['timepoint']} / {len(r['events'])} events")


def cmd_build(args) -> None:
    cat = load_catalog(refresh=args.refresh_catalog)
    print(f"catalog: {len(cat['subjects'])} subjects, {len(cat['runs'])} runs")
    results = build_all(
        subjects=args.subjects.split(",") if args.subjects else None,
        runs=args.runs.split(",") if args.runs else None,
        force=args.force,
        workers=args.workers,
    )
    errors = [r for r in results if r.get("status") == "error"]
    print(f"processed: {len(results) - len(errors)} ok, {len(errors)} errors")
    if not args.skip_group:
        print("building group summary…")
        summary = analysis.compute_group_summary()
        print(
            f"group summary: {summary['n_subjects']} subjects, "
            f"{len(summary['records'])} subject/condition/timepoint records"
        )
    if errors:
        for e in errors[:10]:
            print("ERROR", e, file=sys.stderr)
        raise SystemExit(1)


def cmd_group(_args) -> None:
    summary = analysis.compute_group_summary()
    print(json.dumps({k: summary[k] for k in ("generated_at", "n_subjects", "rois", "timepoints")}, indent=1))


def cmd_verify(args) -> None:
    cat = load_catalog()
    rid = args.run_id or sorted(cat["runs"])[0]
    data = analysis.load_run(rid)
    print(json.dumps({k: data["meta"][k] for k in ("run_id", "subject", "condition", "timepoint", "duration_s", "qc")}, indent=1))
    res = analysis.analyze_event(rid, "VAS7", "medial_ba10")
    print(json.dumps({k: res.get(k) for k in ("status", "n_trials", "n_channels", "metrics")}, indent=1))
    print(f"npz files: {len(list(PROCESSED_DIR.glob('sub-*.npz')))}")


def cmd_serve(args) -> None:
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m backend.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("catalog")
    p.set_defaults(func=cmd_catalog)

    p = sub.add_parser("build-cache")
    p.add_argument("--subjects", default=None, help="comma-separated subject ids")
    p.add_argument("--runs", default=None, help="comma-separated run ids")
    p.add_argument("--force", action="store_true")
    p.add_argument("--refresh-catalog", action="store_true")
    p.add_argument("--workers", type=int, default=None)
    p.add_argument("--skip-group", action="store_true")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("group")
    p.set_defaults(func=cmd_group)

    p = sub.add_parser("verify")
    p.add_argument("--run-id", default=None)
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("serve")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
