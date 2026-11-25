"""FastAPI server: catalog, replay data, group stats, evidence, SSE chat."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy.signal import lfilter
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, ORJSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analysis, pipeline_viz
from .agent import FnirsAgent
from .catalog import load_catalog
from .config import (
    APP_DIR,
    ARTIFACTS_DIR,
    DATA_DIR,
    FRONTEND_DIST,
    LLM_BASE_URL,
    LLM_MODEL,
    ROI_LABELS,
    TIMEPOINT_LABELS,
)

app = FastAPI(title="Chat With My Brain", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CATALOG = load_catalog(allow_empty=True)
AGENT = FnirsAgent()


def _refresh_if_needed() -> None:
    """Reload catalog once processed data appears after container startup."""
    global CATALOG
    if CATALOG["runs"]:
        return
    loaded = load_catalog(allow_empty=True)
    if loaded["runs"]:
        CATALOG = loaded
        AGENT.catalog = loaded
        AGENT.sessions.catalog = loaded


@app.get("/api/health")
def health() -> dict[str, Any]:
    """Return runtime health status, dataset counts, and configured LLM metadata."""
    _refresh_if_needed()
    return {
        "status": "ok" if CATALOG["runs"] else "needs_data",
        "dataset": "ds005777",
        "n_subjects": len(CATALOG["subjects"]),
        "n_runs": len(CATALOG["runs"]),
        "n_processed": len(list((DATA_DIR / "processed").glob("sub-*.npz"))),
        "llm_model": LLM_MODEL,
        "llm_base_url": LLM_BASE_URL,
    }


@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    """Return subject, visit, session, run, ROI, and group summary metadata."""
    _refresh_if_needed()
    sessions = {}
    for sub in CATALOG["subjects"].values():
        for ses in sub["sessions"].values():
            sessions[ses["session"]] = {
                "session": ses["session"],
                "visit": ses["visit"],
                "condition": ses["condition"],
                "channels": ses["channels"],
            }
    runs = {
        rid: {
            "run_id": rid,
            "subject": r["subject"],
            "session": r["session"],
            "condition": r["condition"],
            "timepoint": r["timepoint"],
            "run": r["run"],
            "n_events": len(r["events"]),
        }
        for rid, r in CATALOG["runs"].items()
    }
    group = analysis.load_group_summary()
    return {
        "dataset": CATALOG["name"],
        "n_subjects": len(CATALOG["subjects"]),
        "subjects": sorted(CATALOG["subjects"]),
        "visits": {
            s: {
                "visits": CATALOG["subjects"][s]["visits"],
                "sessions": {
                    ses: {"condition": v["condition"], "visit": v["visit"], "runs": v["runs"]}
                    for ses, v in CATALOG["subjects"][s]["sessions"].items()
                },
            }
            for s in sorted(CATALOG["subjects"])
        },
        "sessions": sessions,
        "runs": runs,
        "roi_labels": ROI_LABELS,
        "timepoint_labels": TIMEPOINT_LABELS,
        "group_available": group is not None,
        "group_generated_at": group.get("generated_at") if group else None,
    }


@app.get("/api/run/{run_id}")
def run_data(
    run_id: str,
    channels: str | None = Query(default=None, description="comma-separated channel names"),
    roi: str | None = Query(default="medial_ba10"),
    all: bool = Query(default=False),
    rate: float = Query(default=10.0),
    start: float | None = Query(default=None),
    end: float | None = Query(default=None),
) -> Any:
    """Serve display-centered HbO/HbR traces, optode metadata, and event timing for `run_id`."""
    if run_id not in CATALOG["runs"]:
        raise HTTPException(status_code=404, detail=f"Unknown run {run_id}")
    data = analysis.load_run(run_id)
    meta = data["meta"]
    names = [c["name"] for c in meta["channels"]]
    sess_meta = (
        CATALOG.get("subjects", {})
        .get(meta["subject"], {})
        .get("sessions", {})
        .get(meta["session"], {})
        .get("channels", [])
    )
    coord_by_name = {c["name"]: c for c in sess_meta}
    roi_idx = [i for i, c in enumerate(meta["channels"]) if c["roi"] == roi]
    roi_idx = [i for i in roi_idx if bool(data["good"][i])] or roi_idx
    if all:
        idx = list(range(len(names)))
    elif channels:
        req = [c.strip() for c in channels.split(",") if c.strip()]
        idx = [names.index(c) for c in req if c in names]
    else:
        idx = roi_idx
    if not idx:
        idx = list(range(len(names)))

    use_native = rate >= 20
    t = data["time"] if use_native else data["time_ds"]
    hbo = (data["hbo"] if use_native else data["hbo_ds"]).copy()
    hbr = (data["hbr"] if use_native else data["hbr_ds"]).copy()
    fs = float(meta["fs"]) if use_native else float(meta["display_fs"])
    # The monitor shows change from the resting baseline (first 20 s), not the
    # arbitrary raw concentration offset. Analysis has its own epoch baseline.
    b1 = min(hbo.shape[-1], int(round(20 * fs)))
    if b1 > 1:
        hbo -= np.nanmean(hbo[:, :b1], axis=1, keepdims=True)
        hbr -= np.nanmean(hbr[:, :b1], axis=1, keepdims=True)
    # Display-only drift removal: a causal high-pass with a 30 s time constant
    # keeps the monitor centred without the edge transient of a centred filter.
    # The 5–15 s evoked response is well above this cutoff; analysis uses the
    # cached (unmodified) data.
    tau = 30.0
    alpha = 1.0 - np.exp(-1.0 / (fs * tau))
    for arr in (hbo, hbr):
        zi = (arr[:, 0] * (1.0 - alpha))[:, None]
        base, _ = lfilter([alpha], [1.0, alpha - 1.0], arr, axis=-1, zi=zi)
        arr -= base
    i0 = 0 if start is None else max(0, int(round(start * fs)))
    i1 = len(t) if end is None else min(len(t), int(round(end * fs)))
    tt = np.asarray(t[i0:i1], dtype=float)

    def clean(arr: np.ndarray) -> list[float | None]:
        """Round finite samples to 4 decimals and replace non-finite entries with `None`."""
        return [None if not math.isfinite(float(v)) else round(float(v), 4) for v in arr]

    payload = {
        "run_id": run_id,
        "meta": {
            "run_id": run_id,
            "subject": meta["subject"],
            "session": meta["session"],
            "condition": meta["condition"],
            "timepoint": meta["timepoint"],
            "run": meta["run"],
            "fs": float(meta["fs"]),
            "duration_s": meta["duration_s"],
            "qc": meta["qc"],
            "processing_seconds": meta.get("processing_seconds"),
            "baseline_corrected": True,
            "display_baseline": "30 s causal high-pass (display only)",
        },
        "time": clean(tt),
        "sample_rate": fs,
        "channels": [
            {
                **{k: meta["channels"][i].get(k) for k in ("name", "source", "detector", "paper_index", "roi", "short", "x_mid", "y_mid", "separation_mm", "sci", "cv", "motion_frac", "cardiac_ratio", "good", "flags")},
                "source_xy": coord_by_name.get(meta["channels"][i]["name"], {}).get("source_xy"),
                "detector_xy": coord_by_name.get(meta["channels"][i]["name"], {}).get("detector_xy"),
                "paper_index": coord_by_name.get(meta["channels"][i]["name"], {}).get("paper_index"),
            }
            for i in idx
        ],
        "all_channels": [
            {
                **{k: c.get(k) for k in ("name", "source", "detector", "paper_index", "roi", "short", "x_mid", "y_mid", "separation_mm", "sci", "cv", "motion_frac", "cardiac_ratio", "good", "flags")},
                "source_xy": coord_by_name.get(c["name"], {}).get("source_xy"),
                "detector_xy": coord_by_name.get(c["name"], {}).get("detector_xy"),
                "paper_index": coord_by_name.get(c["name"], {}).get("paper_index"),
            }
            for c in meta["channels"]
        ],
        "hbo": [clean(hbo[i, i0:i1]) for i in idx],
        "hbr": [clean(hbr[i, i0:i1]) for i in idx],
        "events": meta["events"],
        "default_channels": [names[i] for i in roi_idx],
    }
    return ORJSONResponse(payload)


@app.get("/api/pipeline/{run_id}")
def pipeline_stages(
    run_id: str,
    channel: str | None = Query(default=None),
) -> Any:
    """Return intermediate waveforms, PSDs, and parameters across all 7 preprocessing stages."""
    if run_id not in CATALOG["runs"]:
        raise HTTPException(status_code=404, detail=f"Unknown run {run_id}")
    return ORJSONResponse(pipeline_viz.get_pipeline_stages(run_id, channel))


@app.get("/api/group")
def group() -> Any:
    """Return the precomputed group crossover statistical summary."""
    summary = analysis.load_group_summary()
    if summary is None:
        raise HTTPException(status_code=404, detail="Group summary has not been built yet.")
    return ORJSONResponse(summary)


@app.get("/api/evidence/{session_id}/{evidence_id}")
def evidence_meta(session_id: str, evidence_id: str) -> Any:
    """Return stored JSON metadata for a session evidence card (`[E#]`)."""
    path = ARTIFACTS_DIR / session_id / f"{evidence_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Evidence not found")
    return ORJSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.get("/api/evidence/{session_id}/{evidence_id}/figure")
def evidence_figure(session_id: str, evidence_id: str) -> FileResponse:
    """Serve the rendered PNG figure associated with an evidence card."""
    path = ARTIFACTS_DIR / session_id / f"{evidence_id}.png"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Figure not found")
    return FileResponse(path, media_type="image/png", filename=f"{evidence_id}.png")


class ChatRequest(BaseModel):
    """Request payload for grounded `/api/chat` SSE queries."""

    session_id: str | None = None
    run_id: str
    playhead: float = Field(default=0.0, ge=0.0)
    message: str = Field(min_length=1, max_length=4000)
    roi: str | None = "medial_ba10"
    channels: list[str] | None = None


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Stream grounded LLM tool calls, evidence cards, and answers via SSE."""
    if req.run_id not in CATALOG["runs"]:
        raise HTTPException(status_code=404, detail=f"Unknown run {req.run_id}")
    session = AGENT.sessions.get(
        req.session_id, req.run_id, req.playhead, req.roi or "medial_ba10", req.channels
    )
    AGENT.sessions.prune()
    return StreamingResponse(
        AGENT.chat(session, req.message.strip()),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        """Serve built static files or fall back to `index.html` for SPA routing."""
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
