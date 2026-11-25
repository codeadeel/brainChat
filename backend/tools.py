"""Typed tool registry exposed to the LLM.

The registry is deliberately small and capability-oriented: discovery, current
state, event analysis, quality/artefact checks, within-visit and between-condition
comparisons, evidence retrieval and view control. Every quantitative result is
computed here, never by the model.
"""
from __future__ import annotations

import json
from typing import Any

import numpy as np

from . import analysis, figures
from .config import ROI_ORDER
from .evidence import temp_figure_path

UNITS = "µM"
METHOD = (
    "SNIRF raw intensity -> optical density -> TDDR -> modified Beer-Lambert "
    "(DPF=6) -> nearest short-channel regression -> 0.01-0.2 Hz band-pass. "
    "Trial averages are baseline-corrected using the 5 s before stimulus onset."
)
CAVEATS = [
    "fNIRS measures haemodynamic changes, not direct neural firing.",
    "Results are replayed from recorded data, not live hardware.",
    "Group inference uses a small crossover sample (n≈12–14); between-condition effects are exploratory.",
]


class ToolContext:
    def __init__(self, session: Any, catalog: dict[str, Any]):
        self.session = session
        self.catalog = catalog

    @property
    def run_meta(self) -> dict[str, Any]:
        return self.catalog["runs"][self.session.run_id]

    def run_meta_for(self, run_id: str | None) -> dict[str, Any]:
        return self.catalog["runs"][run_id or self.session.run_id]


def _roi_channels(meta: dict[str, Any], roi: str | None) -> list[str]:
    return [
        c["name"]
        for c in meta["channels"]
        if roi is None or c["roi"] == roi
    ]


def _compact_analysis(res: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "status",
        "run_id",
        "subject",
        "condition",
        "timepoint",
        "event_type",
        "roi",
        "n_trials",
        "n_channels",
        "channels",
        "metrics",
        "excluded",
        "units",
    )
    out = {k: res.get(k) for k in keys if k in res}
    out["note"] = "Metrics are in µM; negative HbO = deactivation relative to pre-stimulus baseline."
    return out


def _compact_comparison(res: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "status",
        "scope",
        "subject",
        "condition",
        "timepoint",
        "event_type",
        "roi",
        "n_subjects",
        "n",
        "morphine_mean",
        "placebo_mean",
        "pre_mean",
        "post_mean",
        "difference",
        "within_condition",
        "per_subject",
    )
    return {k: res.get(k) for k in keys if k in res}


def _attach_fdr(res: dict[str, Any], scope: str, condition: str | None, timepoint: str, event_type: str, roi: str) -> None:
    """Attach the precomputed BH-FDR value so the model does not have to guess."""
    try:
        summary = analysis.load_group_summary()
        if not summary:
            return
        if scope == "within" and condition:
            fam = summary["within_condition"][condition][event_type][roi]["mean_7_10"][timepoint]
        else:
            fam = summary["between_condition"][event_type][roi]["mean_7_10"][timepoint]
        if res.get("difference") is not None:
            res["difference"]["p_fdr"] = fam.get("p_fdr")
    except Exception:
        return


def _evidence(
    ctx: ToolContext,
    kind: str,
    title: str,
    summary: str,
    stats: dict[str, Any],
    figure_path,
    method: str = METHOD,
    caveats: list[str] | None = None,
    params: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return ctx.session.store.add(
        kind=kind,
        title=title,
        summary=summary,
        stats=stats,
        method=method,
        caveats=(caveats or []) + CAVEATS[:2],
        figure_path=figure_path,
        params=params,
        data=data,
    )


def find_runs(
    ctx: ToolContext,
    subject: str | None = None,
    condition: str | None = None,
    timepoint: str | None = None,
) -> dict[str, Any]:
    rows = []
    for rid, r in ctx.catalog["runs"].items():
        if subject and r["subject"] != subject:
            continue
        if condition and r["condition"] != condition:
            continue
        if timepoint and r["timepoint"] != timepoint:
            continue
        rows.append(
            {
                "run_id": rid,
                "subject": r["subject"],
                "session": r["session"],
                "condition": r["condition"],
                "timepoint": r["timepoint"],
                "n_events": len(r["events"]),
            }
        )
    rows.sort(key=lambda r: (r["subject"], r["condition"], r["timepoint"]))
    return {"status": "ok", "n": len(rows), "runs": rows}


def get_current_state(ctx: ToolContext) -> dict[str, Any]:
    s = ctx.session
    meta = ctx.run_meta_for(s.run_id)
    res = analysis.get_current_state(s.run_id, s.playhead, s.roi, s.selected_channels)
    res["status"] = "ok"
    idx = analysis.select_channels(meta, analysis.load_run(s.run_id), roi=s.roi, channels=s.selected_channels)
    start = max(0.0, s.playhead - 60.0)
    tmp = temp_figure_path()
    figures.signal_plot(
        analysis.load_run(s.run_id),
        idx,
        start,
        s.playhead,
        tmp,
        title=f"Live replay · {s.run_id} · {meta['condition']} · {meta['timepoint']}",
        playhead=s.playhead,
    )
    ev = _evidence(
        ctx,
        kind="current_state",
        title="Current replay window",
        summary=(
            f"At {s.playhead:.1f} s, mean ΔHbO over the {s.roi} ROI is "
            f"{res['hbo_uM']:+.3f} µM (HbR {res['hbr_uM']:+.3f} µM) in the last 10 s."
            if res.get("hbo_uM") is not None
            else "No usable channels at this playhead."
        ),
        stats={
            "playhead_s": res.get("playhead_s"),
            "hbo_uM": res.get("hbo_uM"),
            "hbr_uM": res.get("hbr_uM"),
            "hbo_slope_uM_per_s": res.get("hbo_slope_uM_per_s"),
            "last_event": res.get("last_event"),
            "seconds_since_last_event": res.get("seconds_since_last_event"),
            "quality": res.get("quality"),
        },
        figure_path=tmp,
        params={"run_id": s.run_id, "playhead_s": s.playhead, "roi": s.roi},
    )
    res["summary"] = ev["summary"]
    res["evidence"] = {"id": ev["id"], "title": ev["title"], "figure_url": ev["figure_url"]}
    res["ui_action"] = {
        "type": "set_view",
        "channels": _roi_channels(meta, s.roi),
        "start": start,
        "end": s.playhead,
        "tab": "monitor",
    }
    return res


def get_recent_events(ctx: ToolContext, window_s: float = 60.0) -> dict[str, Any]:
    res = analysis.get_recent_events(ctx.session.run_id, ctx.session.playhead, window_s)
    res["status"] = "ok"
    res["summary"] = (
        f"{res['n_vaspain_in_window']} noxious and {res['n_innocuous_in_window']} innocuous "
        f"stimuli within ±{window_s:.0f} s of the playhead."
    )
    return res


def analyze_event(
    ctx: ToolContext,
    event_type: str = "VAS7",
    roi: str | None = "medial_ba10",
    channels: list[str] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    rid = run_id or ctx.session.run_id
    res = analysis.analyze_event(rid, event_type, roi, channels)
    if res.get("status") != "ok":
        return _compact_analysis(res)
    meta = ctx.run_meta_for(rid)
    tmp = temp_figure_path()
    figures.hrf_plot(res, tmp)
    ev = _evidence(
        ctx,
        kind="event_response",
        title=f"{event_type} response · {res['condition']} · {res['timepoint']}",
        summary=(
            f"{res['n_trials']} {event_type} trials, {res['n_channels']} channels. "
            f"Mean ΔHbO 7–10 s = {res['metrics']['mean_7_10']:+.3f} µM "
            f"(p={res['metrics']['p']:.3f}); nadir 5–15 s = {res['metrics']['nadir_5_15']:+.3f} µM "
            f"at {res['metrics']['nadir_latency_s']:.1f} s."
        ),
        stats={
            "run_id": rid,
            "event_type": event_type,
            "roi": roi,
            "n_trials": res["n_trials"],
            "n_channels": res["n_channels"],
            "channels": res["channels"],
            "metrics": res["metrics"],
            "excluded": res["excluded"],
        },
        figure_path=tmp,
        params={"run_id": rid, "event_type": event_type, "roi": roi, "channels": channels},
        data={"time": res["time"], "hrf": res["hrf"], "sem": res["sem"]},
    )
    out = _compact_analysis(res)
    out["evidence"] = {"id": ev["id"], "title": ev["title"], "figure_url": ev["figure_url"]}
    out["ui_action"] = {
        "type": "set_view",
        "channels": res["channels"],
        "start": 0,
        "end": None,
        "tab": "monitor",
        "event_type": event_type,
    }
    return out


def get_quality(
    ctx: ToolContext,
    roi: str | None = "medial_ba10",
    channels: list[str] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    rid = run_id or ctx.session.run_id
    q = analysis.get_quality(rid, roi, channels)
    q["status"] = "ok"
    tmp = temp_figure_path()
    figures.qc_plot(q, tmp, title=f"Signal quality · {rid} · {roi or 'selected channels'}")
    ev = _evidence(
        ctx,
        kind="quality",
        title=f"Signal quality · {roi or 'selected channels'}",
        summary=(
            f"{q['n_good']}/{q['n_channels']} channels pass QC; median SCI "
            f"{q['median_sci']:.2f}." if q.get("median_sci") is not None else "No channels selected."
        ),
        stats={
            "run_id": rid,
            "roi": roi,
            "n_good": q["n_good"],
            "n_channels": q["n_channels"],
            "median_sci": q["median_sci"],
            "median_cv": q["median_cv"],
            "channels": q["channels"],
        },
        figure_path=tmp,
        method="SCI is the 690/830 cardiac-band correlation; motion is a robust derivative threshold; CV is intensity variability.",
        caveats=["Low SCI or high motion does not prove a channel is unusable, but it weakens interpretation."],
        params={"run_id": rid, "roi": roi, "channels": channels},
    )
    q["evidence"] = {"id": ev["id"], "title": ev["title"], "figure_url": ev["figure_url"]}
    return q


def assess_artifact(
    ctx: ToolContext,
    roi: str = "medial_ba10",
    window: list[float] | None = None,
    channels: list[str] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    rid = run_id or ctx.session.run_id
    win = tuple(window) if window else None
    res = analysis.assess_artifact(rid, roi, win, channels)
    res["status"] = "ok"
    data = analysis.load_run(rid)
    idx = analysis.select_channels(data["meta"], data, roi=roi, channels=channels, good_only=False)
    start, end = (win if win else (max(0, ctx.session.playhead - 60), ctx.session.playhead))
    tmp = temp_figure_path()
    figures.signal_plot(
        data,
        idx,
        start,
        end,
        tmp,
        title=f"Artefact check · {rid} · {roi}",
        playhead=ctx.session.playhead if start <= ctx.session.playhead <= end else None,
    )
    ev = _evidence(
        ctx,
        kind="artifact",
        title=f"Artefact check · {roi}",
        summary=f"{res['verdict'].capitalize()}. " + ("; ".join(res["reasons"]) if res["reasons"] else "No strong signature."),
        stats=res,
        figure_path=tmp,
        method="Checks motion fraction, median SCI, short-channel correlation and cardiac-band power in the selected window.",
        caveats=["Absence of an artefact signature is not proof of a neural source."],
        params={"run_id": rid, "roi": roi, "window": list(win) if win else None},
    )
    res["evidence"] = {"id": ev["id"], "title": ev["title"], "figure_url": ev["figure_url"]}
    res["ui_action"] = {"type": "set_view", "channels": [data["meta"]["channels"][i]["name"] for i in idx], "start": start, "end": end, "tab": "monitor"}
    return res


def compare_within_visit(
    ctx: ToolContext,
    timepoint: str = "90min",
    event_type: str = "VAS7",
    roi: str = "medial_ba10",
) -> dict[str, Any]:
    s = ctx.session
    meta = ctx.run_meta
    res = analysis.compare_within_visit(meta["subject"], meta["condition"], timepoint, event_type, roi)
    if res.get("status") != "ok":
        return res
    tmp = temp_figure_path()
    figures.two_hrf_plot(
        np.asarray(res["pre"]["time"]),
        np.asarray(res["pre"]["hrf"]),
        np.asarray(res["post"]["hrf"]),
        f"Pre-drug (n={res['pre']['n_trials']})",
        f"{timepoint} (n={res['post']['n_trials']})",
        tmp,
        title=f"{meta['subject']} · {meta['condition']} · {event_type} · {roi}",
        a_color="#9aa4b2",
        b_color=figures.MORPHINE if meta["condition"] == "morphine" else figures.PLACEBO,
    )
    ev = _evidence(
        ctx,
        kind="within_visit",
        title=f"{timepoint} vs pre · {meta['subject']} · {meta['condition']}",
        summary=(
            f"Mean ΔHbO 7–10 s changed by {res['difference']['mean_7_10_post_minus_pre']:+.3f} µM "
            f"(Welch p={res['difference']['welch_p']:.3f}; {res['pre']['n_trials']} vs {res['post']['n_trials']} trials)."
        ),
        stats=_compact_comparison(res) | {"pre": {k: res["pre"][k] for k in ("run_id", "n_trials", "n_channels", "metrics")}, "post": {k: res["post"][k] for k in ("run_id", "n_trials", "n_channels", "metrics")}},
        figure_path=tmp,
        params={"subject": meta["subject"], "condition": meta["condition"], "timepoint": timepoint, "event_type": event_type, "roi": roi},
        data={"time": res["pre"]["time"], "pre_hrf": res["pre"]["hrf"], "post_hrf": res["post"]["hrf"]},
    )
    out = _compact_comparison(res)
    out["evidence"] = {"id": ev["id"], "title": ev["title"], "figure_url": ev["figure_url"]}
    out["ui_action"] = {"type": "set_view", "channels": _roi_channels(ctx.run_meta, roi), "start": 0, "end": None, "tab": "compare"}
    return out


def compare_timepoints_group(
    ctx: ToolContext,
    condition: str = "morphine",
    timepoint: str = "90min",
    event_type: str = "VAS7",
    roi: str = "medial_ba10",
) -> dict[str, Any]:
    res = analysis.compare_timepoints_group(condition, timepoint, event_type, roi)
    if res.get("status") != "ok":
        return res
    _attach_fdr(res, "within", condition, timepoint, event_type, roi)
    tmp = temp_figure_path()
    figures.comparison_plot(
        np.asarray(res["time"]),
        np.asarray(res["pre_hrf_mean"]),
        np.asarray(res["post_hrf_mean"]),
        "Pre-drug",
        f"{timepoint} post",
        res["per_subject"],
        "pre",
        "post",
        tmp,
        title=f"Group · {condition} · {event_type} · {roi} · n={res['n_subjects']}",
        a_color="#9aa4b2",
        b_color=figures.MORPHINE if condition == "morphine" else figures.PLACEBO,
    )
    ev = _evidence(
        ctx,
        kind="group_timepoints",
        title=f"Group pre vs {timepoint} · {condition}",
        summary=(
            f"n={res['n_subjects']}; mean ΔHbO 7–10 s {res['pre_mean']:+.3f} → {res['post_mean']:+.3f} µM "
            f"(Δ {res['difference']['mean']:+.3f}, 95% CI {res['difference']['ci95']}, p={res['difference']['p']:.3f})."
        ),
        stats=_compact_comparison(res),
        figure_path=tmp,
        params={"condition": condition, "timepoint": timepoint, "event_type": event_type, "roi": roi},
        data={"time": res["time"], "pre_hrf": res["pre_hrf_mean"], "post_hrf": res["post_hrf_mean"]},
    )
    out = _compact_comparison(res)
    out["evidence"] = {"id": ev["id"], "title": ev["title"], "figure_url": ev["figure_url"]}
    out["ui_action"] = {"type": "set_view", "channels": _roi_channels(ctx.run_meta, roi), "start": 0, "end": None, "tab": "compare"}
    return out


def compare_conditions(
    ctx: ToolContext,
    timepoint: str = "90min",
    event_type: str = "VAS7",
    roi: str = "medial_ba10",
    subject: str | None = None,
) -> dict[str, Any]:
    res = analysis.compare_conditions(timepoint, event_type, roi, subject)
    if res.get("status") != "ok":
        return res
    _attach_fdr(res, "between", None, timepoint, event_type, roi)
    if res.get("scope") == "group":
        within = {}
        for cond in ("morphine", "placebo"):
            w = analysis.compare_timepoints_group(cond, timepoint, event_type, roi)
            if w.get("status") == "ok":
                within[cond] = dict(w["difference"])
                within[cond]["pre_mean"] = w["pre_mean"]
                within[cond]["post_mean"] = w["post_mean"]
        if within:
            res["within_condition"] = within
    tmp = temp_figure_path()
    if res.get("scope") == "group":
        figures.comparison_plot(
            np.asarray(res["time"]),
            np.asarray(res["morphine_hrf_mean"]),
            np.asarray(res["placebo_hrf_mean"]),
            "Morphine",
            "Placebo",
            res["per_subject"],
            "morphine",
            "placebo",
            tmp,
            title=f"Group · morphine vs placebo · {timepoint} · {event_type} · {roi} · n={res['n_subjects']}",
        )
        summary = (
            f"n={res['n_subjects']}; morphine {res['morphine_mean']:+.3f} vs placebo {res['placebo_mean']:+.3f} µM "
            f"(Δ {res['difference']['mean']:+.3f}, 95% CI {res['difference']['ci95']}, p={res['difference']['p']:.3f})."
        )
        ui_channels = _roi_channels(ctx.run_meta, roi)
    else:
        figures.two_hrf_plot(
            np.asarray(res["morphine"]["time"]),
            np.asarray(res["morphine"]["hrf"]),
            np.asarray(res["placebo"]["hrf"]),
            "Morphine",
            "Placebo",
            tmp,
            title=f"{subject} · morphine vs placebo · {timepoint} · {event_type} · {roi}",
        )
        summary = (
            f"Morphine {res['morphine']['metrics']['mean_7_10']:+.3f} vs placebo "
            f"{res['placebo']['metrics']['mean_7_10']:+.3f} µM (Welch p={res['difference']['welch_p']:.3f})."
        )
        ui_channels = _roi_channels(ctx.run_meta, roi)
    ev = _evidence(
        ctx,
        kind="condition_comparison",
        title=f"Morphine vs placebo · {timepoint} · {roi}",
        summary=summary,
        stats=_compact_comparison(res),
        figure_path=tmp,
        params={"timepoint": timepoint, "event_type": event_type, "roi": roi, "subject": subject},
        data=res,
        caveats=["Between-condition differences at a single timepoint are exploratory; check the pre-drug baseline and FDR."],
    )
    out = _compact_comparison(res)
    out["evidence"] = {"id": ev["id"], "title": ev["title"], "figure_url": ev["figure_url"]}
    out["ui_action"] = {"type": "set_view", "channels": ui_channels, "start": 0, "end": None, "tab": "compare"}
    return out


def get_evidence(ctx: ToolContext, evidence_id: str) -> dict[str, Any]:
    meta = ctx.session.store.get(evidence_id)
    if not meta:
        return {"status": "not_found", "evidence_id": evidence_id, "available": [m["id"] for m in ctx.session.store.all()]}
    return {"status": "ok", **meta}


def set_view(
    ctx: ToolContext,
    channels: list[str] | None = None,
    start: float | None = None,
    end: float | None = None,
    tab: str | None = None,
) -> dict[str, Any]:
    return {
        "status": "ok",
        "ui_action": {"type": "set_view", "channels": channels, "start": start, "end": end, "tab": tab},
    }


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "find_runs",
            "description": "Find recorded runs by subject, condition and/or timepoint. Conditions are 'morphine' or 'placebo'; timepoints are 'pre', '30min', '60min', '90min'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subject": {"type": "string", "description": "e.g. sub-002"},
                    "condition": {"type": "string", "enum": ["morphine", "placebo"]},
                    "timepoint": {"type": "string", "enum": ["pre", "30min", "60min", "90min", "extra"]},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_state",
            "description": "What the replayed brain is showing at the current playhead: recent HbO/HbR, slope, last stimulus, quality and motion. Use this for any 'right now' question.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_events",
            "description": "List stimuli near the current playhead. VAS7 = noxious, VAS3 = innocuous.",
            "parameters": {
                "type": "object",
                "properties": {"window_s": {"type": "number", "description": "Half-window in seconds (default 60)"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_event",
            "description": "Trial-average the HbO/HbR response to VAS7 (noxious) or VAS3 (innocuous) stimuli and compute peak/nadir, latency, n trials and statistics. Use for 'what happened when the stimulus was applied'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_type": {"type": "string", "enum": ["VAS7", "VAS3"]},
                    "roi": {"type": "string", "enum": ROI_ORDER},
                    "channels": {"type": "array", "items": {"type": "string"}, "description": "Optional explicit channel names; overrides roi."},
                    "run_id": {"type": "string", "description": "Optional run id; defaults to the current replay run."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_quality",
            "description": "Per-channel signal quality and artefact flags (SCI, CV, motion) for the current run or a specific ROI.",
            "parameters": {
                "type": "object",
                "properties": {
                    "roi": {"type": "string", "enum": ROI_ORDER},
                    "channels": {"type": "array", "items": {"type": "string"}},
                    "run_id": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_artifact",
            "description": "Assess whether a signal in a time window looks physiological or artefactual, using motion, SCI, short-channel correlation and cardiac-band power.",
            "parameters": {
                "type": "object",
                "properties": {
                    "roi": {"type": "string", "enum": ROI_ORDER},
                    "window": {"type": "array", "items": {"type": "number"}, "description": "[start, end] seconds in the run"},
                    "channels": {"type": "array", "items": {"type": "string"}},
                    "run_id": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_within_visit",
            "description": "Compare the current subject's pre-drug run with a post-drug run in the same visit (within-subject). Use for 'how did this subject change after morphine'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timepoint": {"type": "string", "enum": ["30min", "60min", "90min"]},
                    "event_type": {"type": "string", "enum": ["VAS7", "VAS3"]},
                    "roi": {"type": "string", "enum": ROI_ORDER},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_timepoints_group",
            "description": "Group-level paired comparison of a post-drug scan against pre-drug across all subjects for one condition. Use for 'how did the group change after morphine/placebo'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "condition": {"type": "string", "enum": ["morphine", "placebo"]},
                    "timepoint": {"type": "string", "enum": ["30min", "60min", "90min"]},
                    "event_type": {"type": "string", "enum": ["VAS7", "VAS3"]},
                    "roi": {"type": "string", "enum": ROI_ORDER},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_conditions",
            "description": "Compare morphine with placebo at a timepoint. Omit subject for the group paired comparison; provide subject for one participant. Use for 'how does this compare with placebo'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timepoint": {"type": "string", "enum": ["pre", "30min", "60min", "90min"]},
                    "event_type": {"type": "string", "enum": ["VAS7", "VAS3"]},
                    "roi": {"type": "string", "enum": ROI_ORDER},
                    "subject": {"type": "string", "description": "Optional subject id; omit for group comparison."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_evidence",
            "description": "Retrieve the full evidence card (figures, numbers, method, caveats) for an evidence ID such as E1. Use when the user asks to see or explain the evidence.",
            "parameters": {
                "type": "object",
                "properties": {"evidence_id": {"type": "string"}},
                "required": ["evidence_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_view",
            "description": "Change the visualisation: highlight channels, set a time window, or switch tab. Use when the user asks to show/highlight something.",
            "parameters": {
                "type": "object",
                "properties": {
                    "channels": {"type": "array", "items": {"type": "string"}},
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "tab": {"type": "string", "enum": ["monitor", "compare"]},
                },
            },
        },
    },
]


TOOL_FUNCS = {
    "find_runs": find_runs,
    "get_current_state": get_current_state,
    "get_recent_events": get_recent_events,
    "analyze_event": analyze_event,
    "get_quality": get_quality,
    "assess_artifact": assess_artifact,
    "compare_within_visit": compare_within_visit,
    "compare_timepoints_group": compare_timepoints_group,
    "compare_conditions": compare_conditions,
    "get_evidence": get_evidence,
    "set_view": set_view,
}


def execute_tool(name: str, args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    fn = TOOL_FUNCS.get(name)
    if fn is None:
        return {"status": "error", "error": f"Unknown tool: {name}", "available": sorted(TOOL_FUNCS)}
    try:
        return fn(ctx, **args)
    except TypeError as exc:
        return {"status": "error", "error": f"Bad arguments for {name}: {exc}"}
    except Exception as exc:
        return {"status": "error", "error": f"{type(exc).__name__}: {exc}"}
