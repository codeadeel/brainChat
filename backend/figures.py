"""Publication-style figures for evidence cards (matplotlib, headless)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HBO = "#d94a4a"
HBR = "#2563eb"
PAIN = "#d94a4a"
INNOCUOUS = "#2f855a"
MORPHINE = "#7c5cbf"
PLACEBO = "#0f766e"
FG = "#11253d"
BG = "#ffffff"
GRID = "#e7edf5"

plt.rcParams.update(
    {
        "figure.facecolor": BG,
        "savefig.facecolor": BG,
        "axes.facecolor": BG,
        "axes.edgecolor": GRID,
        "axes.labelcolor": FG,
        "text.color": FG,
        "xtick.color": "#5b6f86",
        "ytick.color": "#5b6f86",
        "grid.color": GRID,
        "font.size": 10,
        "axes.titlesize": 11,
        "legend.frameon": False,
    }
)


def _style(ax):
    """Apply shared clinical grid, spine removal, and zero-baseline styling to `ax`."""
    ax.grid(True, alpha=0.35, linewidth=0.6)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.axhline(0, color="#cbd5e1", linewidth=0.9)


def hrf_plot(result: dict[str, Any], out_path: Path, title: str | None = None) -> Path:
    """Render a stimulus-locked ΔHbO HRF mean ± SEM plot with stimulus and metric windows."""
    t = np.asarray(result["time"])
    hrf = np.asarray(result["hrf"])
    sem = np.asarray(result.get("sem") or np.zeros_like(hrf))
    fig, ax = plt.subplots(figsize=(8.4, 3.7), dpi=150)
    _style(ax)
    ax.axvspan(0, 5, color=PAIN, alpha=0.10, label="Stimulus (5 s)")
    ax.axvspan(7, 10, color="#c27c0e", alpha=0.08, label="Metric 7–10 s")
    ax.fill_between(t, hrf - sem, hrf + sem, color=HBO, alpha=0.18, linewidth=0)
    ax.plot(t, hrf, color=HBO, linewidth=1.8, label="ΔHbO mean ± SEM")
    metrics = result.get("metrics", {})
    if metrics.get("nadir_latency_s") is not None:
        ax.scatter(
            [metrics["nadir_latency_s"]],
            [metrics.get("nadir_5_15", 0)],
            color="#c27c0e",
            zorder=5,
            s=28,
            label="Nadir",
        )
    ax.set_xlim(-5, 25)
    ax.set_xlabel("Time from stimulus onset (s)")
    ax.set_ylabel("ΔHbO (µM)")
    cond = result.get("condition", "")
    tp = result.get("timepoint", "")
    ev = result.get("event_type", "")
    roi = result.get("roi", "")
    ax.set_title(
        title
        or f"{result.get('run_id','')} · {cond} · {tp} · {ev} · {roi}",
        loc="left",
    )
    ax.legend(loc="upper right", fontsize=8, ncol=2)
    note = f"n={result.get('n_trials','?')} trials · {result.get('n_channels','?')} channels"
    fig.text(0.01, 0.01, note, color="#5b6f86", fontsize=8)
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


def two_hrf_plot(
    t: np.ndarray,
    a: np.ndarray,
    b: np.ndarray,
    a_label: str,
    b_label: str,
    out_path: Path,
    title: str,
    a_color: str = MORPHINE,
    b_color: str = PLACEBO,
    a_sem: np.ndarray | None = None,
    b_sem: np.ndarray | None = None,
) -> Path:
    """Render a paired two-curve HRF comparison plot (e.g. post vs pre or morphine vs placebo)."""
    fig, ax = plt.subplots(figsize=(8.4, 3.7), dpi=150)
    _style(ax)
    ax.axvspan(0, 5, color=PAIN, alpha=0.12)
    if a_sem is not None:
        ax.fill_between(t, np.asarray(a) - a_sem, np.asarray(a) + a_sem, color=a_color, alpha=0.15, linewidth=0)
    if b_sem is not None:
        ax.fill_between(t, np.asarray(b) - b_sem, np.asarray(b) + b_sem, color=b_color, alpha=0.15, linewidth=0)
    ax.plot(t, a, color=a_color, linewidth=1.9, label=a_label)
    ax.plot(t, b, color=b_color, linewidth=1.9, label=b_label)
    ax.set_xlim(-5, 25)
    ax.set_xlabel("Time from stimulus onset (s)")
    ax.set_ylabel("ΔHbO (µM)")
    ax.set_title(title, loc="left")
    ax.legend(loc="upper right", fontsize=9)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


def paired_bar_plot(
    rows: list[dict[str, Any]],
    out_path: Path,
    title: str,
    a_label: str = "Morphine",
    b_label: str = "Placebo",
    a_color: str = MORPHINE,
    b_color: str = PLACEBO,
) -> Path:
    """Render a subject-paired scatter plot connecting condition A and B responses."""
    pairs = [
        (r["subject"], r["morphine"], r["placebo"])
        for r in rows
        if r.get("morphine") is not None and r.get("placebo") is not None
    ]
    fig, ax = plt.subplots(figsize=(7.6, 4.0), dpi=150)
    _style(ax)
    xs = np.arange(len(pairs))
    a = [p[1] for p in pairs]
    b = [p[2] for p in pairs]
    for i, (_, av, bv) in enumerate(pairs):
        ax.plot([i - 0.16, i + 0.16], [av, bv], color="#9aa4b2", linewidth=0.8, alpha=0.6)
    ax.scatter(xs - 0.16, a, color=a_color, s=28, label=a_label, zorder=4)
    ax.scatter(xs + 0.16, b, color=b_color, s=28, label=b_label, zorder=4)
    ax.set_xticks(xs)
    ax.set_xticklabels([p[0] for p in pairs], rotation=45, ha="right", fontsize=8)
    ax.set_ylabel("ΔHbO 7–10 s (µM)")
    ax.set_title(title, loc="left")
    ax.legend(loc="upper right", fontsize=9)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


def comparison_plot(
    t: np.ndarray,
    a: np.ndarray,
    b: np.ndarray,
    a_label: str,
    b_label: str,
    rows: list[dict[str, Any]],
    key_a: str,
    key_b: str,
    out_path: Path,
    title: str,
    a_color: str = MORPHINE,
    b_color: str = PLACEBO,
) -> Path:
    """Render a side-by-side HRF average and paired subject dot-plot comparison."""
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(11.2, 3.9), dpi=150, gridspec_kw={"width_ratios": [1.55, 1]}
    )
    _style(ax1)
    ax1.axvspan(0, 5, color=PAIN, alpha=0.12)
    ax1.plot(t, a, color=a_color, linewidth=1.9, label=a_label)
    ax1.plot(t, b, color=b_color, linewidth=1.9, label=b_label)
    ax1.set_xlim(-5, 25)
    ax1.set_xlabel("Time from stimulus onset (s)")
    ax1.set_ylabel("ΔHbO (µM)")
    ax1.set_title("Trial-averaged response", loc="left")
    ax1.legend(loc="upper right", fontsize=8)

    _style(ax2)
    pairs = [
        (r["subject"], r[key_a], r[key_b])
        for r in rows
        if r.get(key_a) is not None and r.get(key_b) is not None
    ]
    xs = np.arange(len(pairs))
    for i, (_, av, bv) in enumerate(pairs):
        ax2.plot([i, i], [av, bv], color="#9aa4b2", linewidth=0.7, alpha=0.55)
    ax2.scatter(xs, [p[1] for p in pairs], color=a_color, s=24, label=a_label, zorder=4)
    ax2.scatter(xs, [p[2] for p in pairs], color=b_color, s=24, label=b_label, zorder=4)
    ax2.set_xticks(xs)
    ax2.set_xticklabels([p[0].replace("sub-", "") for p in pairs], rotation=90, fontsize=6)
    ax2.set_ylabel("ΔHbO 7–10 s (µM)")
    ax2.set_title("Subject-level values", loc="left")
    ax2.legend(loc="upper right", fontsize=8)
    fig.suptitle(title, x=0.01, ha="left", fontsize=11)
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


def signal_plot(
    data: dict[str, Any],
    channels: list[int],
    start: float,
    end: float,
    out_path: Path,
    title: str,
    playhead: float | None = None,
) -> Path:
    """Render a continuous HbO/HbR time-window figure with stimulus shading and playhead."""
    meta = data["meta"]
    t = np.asarray(data["time_ds"])
    fs_ds = meta["display_fs"]
    i0, i1 = int(max(0, start) * fs_ds), int(min(t[-1], end) * fs_ds)
    fig, ax = plt.subplots(figsize=(9.0, 3.9), dpi=150)
    _style(ax)
    hbo = np.nanmean(data["hbo_ds"][channels][:, i0:i1], axis=0)
    hbr = np.nanmean(data["hbr_ds"][channels][:, i0:i1], axis=0)
    tt = t[i0:i1]
    ax.plot(tt, hbo, color=HBO, linewidth=1.4, label="HbO (channel mean)")
    ax.plot(tt, hbr, color=HBR, linewidth=1.4, label="HbR (channel mean)")
    for ev in meta["events"]:
        if start <= ev["onset"] <= end:
            color = PAIN if ev["type"] == "VAS7" else INNOCUOUS
            ax.axvspan(ev["onset"], ev["onset"] + ev.get("duration", 5), color=color, alpha=0.16)
    if playhead is not None and start <= playhead <= end:
        ax.axvline(playhead, color=FG, linewidth=1.0, linestyle="--", alpha=0.8)
    ax.set_xlim(start, end)
    ax.set_xlabel("Time in run (s)")
    ax.set_ylabel("ΔHbO / ΔHbR (µM)")
    ax.set_title(title, loc="left")
    ax.legend(loc="upper right", fontsize=8)
    names = ", ".join(meta["channels"][i]["name"] for i in channels[:6])
    fig.text(0.01, 0.01, f"channels: {names}{'…' if len(channels) > 6 else ''}", color="#5b6f86", fontsize=8)
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


def qc_plot(quality: dict[str, Any], out_path: Path, title: str) -> Path:
    """Render a per-channel Scalp Coupling Index (SCI) bar chart against the 0.70 threshold."""
    rows = quality["channels"]
    names = [r["name"] for r in rows]
    sci = [r["sci"] if r["sci"] is not None else 0 for r in rows]
    colors = [HBO if not r["good"] else "#54a24b" for r in rows]
    fig, ax = plt.subplots(figsize=(9.2, 3.4), dpi=150)
    _style(ax)
    ax.bar(range(len(rows)), sci, color=colors, alpha=0.9, width=0.8)
    ax.axhline(0.7, color="#c27c0e", linestyle="--", linewidth=1, label="SCI 0.70 threshold")
    ax.set_xticks(range(len(rows)))
    ax.set_xticklabels(names, rotation=90, fontsize=6)
    ax.set_ylim(0, 1)
    ax.set_ylabel("Scalp coupling index")
    ax.set_title(title, loc="left")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)
    return out_path
