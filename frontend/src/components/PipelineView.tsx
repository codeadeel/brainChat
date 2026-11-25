import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { getPipeline } from "../api";
import { roiLabel } from "../labels";
import type { PipelineData } from "../types";

type StageId =
  | "raw"
  | "od"
  | "tddr"
  | "mbll"
  | "short_channel"
  | "bandpass"
  | "epoch";

const STAGES: { id: StageId; step: string; title: string; short: string; takeaway: string }[] = [
  {
    id: "raw",
    step: "1",
    title: "Raw Light Intensity",
    short: "Raw Intensity",
    takeaway: "Detector light levels at 690 nm and 830 nm before any transformation.",
  },
  {
    id: "od",
    step: "2",
    title: "Optical Density + Cardiac QC",
    short: "Optical Density",
    takeaway: "Log-normalised light absorption (ΔOD); ~1 Hz heartbeat proves optode–scalp coupling.",
  },
  {
    id: "tddr",
    step: "3",
    title: "Motion Correction (TDDR)",
    short: "Motion Repair",
    takeaway: "Robust derivative weighting suppresses sudden head-motion spikes while preserving slow waves.",
  },
  {
    id: "mbll",
    step: "4",
    title: "Modified Beer–Lambert Law",
    short: "Beer–Lambert",
    takeaway: "Converts 690/830 nm ΔOD into oxygenated (HbO) and deoxygenated (HbR) haemoglobin (µM).",
  },
  {
    id: "short_channel",
    step: "5",
    title: "Short-Channel Regression",
    short: "Scalp Removal",
    takeaway: "Subtracts superficial scalp blood flow measured by the nearest 8 mm short-separation channel.",
  },
  {
    id: "bandpass",
    step: "6",
    title: "Band-Pass Filter (0.01–0.2 Hz)",
    short: "Band-Pass",
    takeaway: "Removes slow scanner drift (<0.01 Hz) and cardiac/respiratory pulse (>0.2 Hz).",
  },
  {
    id: "epoch",
    step: "7",
    title: "Stimulus-Locked Trial Average",
    short: "Trial HRF",
    takeaway: "Aligns all stimuli (−5…+25 s) to reveal the evoked haemodynamic response to pain vs safe.",
  },
];

const STAGE_GLOSSARY: Record<StageId, { term: string; desc: string }[]> = {
  raw: [
    { term: "AU", desc: "Arbitrary Units — raw photon counts reaching the detector" },
    { term: "690 / 830 nm", desc: "Two near-infrared wavelengths sensitive to HbR vs HbO" },
    { term: "CV", desc: "Coefficient of Variation (σ/μ); >15% flags unstable contact" },
  ],
  od: [
    { term: "ΔOD", desc: "Optical Density change — log light absorption vs resting I₀" },
    { term: "SCI", desc: "Scalp Coupling Index — 690 vs 830 nm heartbeat correlation (≥0.70 good)" },
    { term: "PSD", desc: "Power Spectral Density — signal power by frequency (Hz = cycles/s)" },
  ],
  tddr: [
    { term: "TDDR", desc: "Temporal Derivative Distribution Repair — down-weights sudden motion jumps" },
    { term: "d(t)", desc: "First derivative (sample-to-sample step) used to spot sharp spikes" },
    { term: "MAD", desc: "Median Absolute Deviation — outlier-resistant spread estimate" },
  ],
  mbll: [
    { term: "MBLL", desc: "Modified Beer–Lambert Law — converts absorption into µM haemoglobin" },
    { term: "DPF", desc: "Differential Pathlength Factor (6.0× accounts for tissue scattering)" },
    { term: "HbO / HbR", desc: "Oxygenated & deoxygenated haemoglobin concentration changes (µM)" },
  ],
  short_channel: [
    { term: "Short (8 mm)", desc: "Shallow channel sampling only scalp skin (~4 mm deep), not brain" },
    { term: "β₁", desc: "Regression weight removing superficial scalp signal from the 30 mm channel" },
  ],
  bandpass: [
    { term: "Butterworth₄", desc: "4th-order zero-phase filter (no timing shift) keeping 0.01–0.20 Hz" },
    { term: "Passband", desc: "Retains slow brain waves (5–100 s); cuts drift & ~1 Hz pulse" },
  ],
  epoch: [
    { term: "HRF", desc: "Haemodynamic Response Function — trial-averaged blood-flow curve" },
    { term: "Nadir", desc: "Lowest dip (5–15 s) reflecting medial BA10 deactivation to pain" },
  ],
};

function PlotPane({
  traces,
  layout,
  height = 310,
}: {
  traces: any[];
  layout: Record<string, unknown>;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    Plotly.react(
      ref.current,
      traces,
      {
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        font: { color: "#374151", size: 11, family: "Inter, system-ui, sans-serif" },
        height,
        margin: { l: 56, r: 18, t: 30, b: 36 },
        legend: { orientation: "h", y: 1.14, x: 0, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
        xaxis: { gridcolor: "#f1f5f9", zeroline: false },
        yaxis: { gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
        ...layout,
      },
      { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: true },
    );
  }, [traces, layout, height]);
  useEffect(() => () => { if (ref.current) Plotly.purge(ref.current); }, []);
  return <div className="chart" style={{ height }} ref={ref} />;
}

/** Interactive 7-stage signal processing explorer displaying live equations, waveforms, and Welch PSDs. */
export default function PipelineView({
  runId,
  initialChannel,
  onAsk,
}: {
  runId: string;
  initialChannel?: string;
  onAsk?: (prompt: string) => void;
}) {
  const [channel, setChannel] = useState<string>(initialChannel || "S5-D5");
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<StageId>("raw");
  const [showCompare, setShowCompare] = useState(true);
  const [zoomMode, setZoomMode] = useState<"full" | "60s" | "15s">("60s");
  const [autoStep, setAutoStep] = useState(false);
  const [showMath, setShowMath] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPipeline(runId, channel)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, channel]);

  useEffect(() => {
    if (!autoStep) return;
    const id = window.setInterval(() => {
      setStage((cur) => {
        const idx = STAGES.findIndex((s) => s.id === cur);
        return STAGES[(idx + 1) % STAGES.length].id;
      });
    }, 3500);
    return () => window.clearInterval(id);
  }, [autoStep]);

  const stageMath = useMemo(() => {
    if (!data) return null;
    const st = data.stages;
    const fmtInt = (v?: number) => (v != null ? Math.round(v).toLocaleString() : "—");
    if (stage === "raw") {
      return {
        formula: "CV = σ(I) / μ(I)",
        terms: `I₀(690) = ${fmtInt(st.raw.i0_690)} AU · I₀(830) = ${fmtInt(st.raw.i0_830)} AU · CV = ${(st.raw.cv * 100).toFixed(2)}% (keep ≤ 15%)`,
      };
    }
    if (stage === "od") {
      return {
        formula: "ΔOD(t, λ) = −ln( I(t, λ) / I₀(λ) )  ·  SCI = ρ( OD₆₉₀[0.8–2.5 Hz], OD₈₃₀[0.8–2.5 Hz] )",
        terms: `SCI = ${st.od.sci.toFixed(3)} (threshold ≥ 0.70) · cardiac peak ≈ 1.0 Hz`,
      };
    }
    if (stage === "tddr") {
      return {
        formula: "d(t) = ΔOD(t) − ΔOD(t−1)  ·  w(t) = Tukey( d(t) / σ_robust )  ·  ΔOD′ = ∫ w(t)·d(t)",
        terms: `Spike gate |d| > 8·1.4826·MAD · flagged samples = ${(st.tddr.motion_frac * 100).toFixed(2)}% · intervals = ${st.tddr.motion_intervals.length}`,
      };
    }
    if (stage === "mbll") {
      return {
        formula: "[ΔHbO, ΔHbR]ᵀ = (ε(λ) · L · DPF)⁻¹ · ΔOD′(t, λ)",
        terms: `λ = {690, 830} nm · L = ${st.mbll.separation_mm ?? 30} mm · DPF = ${st.mbll.dpf.toFixed(1)} · output in µM`,
      };
    }
    if (stage === "short_channel") {
      return {
        formula: "y_clean(t) = y_long(t) − β₁ · x_short(t)   [fit with drift: y ~ β₁·x_short + a₀ + a₁t + a₂t²]",
        terms: `Nearest short = ${st.short_channel.short_name ?? "none"} · β₁ = ${st.short_channel.beta?.toFixed(3) ?? "—"} · r = ${st.short_channel.corr_before.toFixed(2)} · −${st.short_channel.removed_pct.toFixed(1)}% variance`,
      };
    }
    if (stage === "bandpass") {
      return {
        formula: "H(s) = Butterworth₄( f_low = 0.01 Hz, f_high = 0.20 Hz )  ·  zero-phase sosfiltfilt",
        terms: `f_s = 25.0 Hz · blocks slow drift (<0.01 Hz) and cardiac pulse (>0.8 Hz)`,
      };
    }
    return {
      formula: "HRF(τ) = (1 / N) · Σᵢ [ x(tᵢ + τ) − mean(x[tᵢ−5, tᵢ]) ],   τ ∈ [−5, +25] s",
      terms: `N_VAS7 = ${st.epoch.n_vas7}, N_VAS3 = ${st.epoch.n_vas3} · mean[7–10 s] = ${st.epoch.mean_7_10 != null ? `${st.epoch.mean_7_10 >= 0 ? "+" : ""}${st.epoch.mean_7_10.toFixed(3)}` : "—"} µM · nadir = ${st.epoch.nadir_5_15 != null ? `${st.epoch.nadir_5_15.toFixed(3)} µM @ ${st.epoch.nadir_latency_s}s` : "—"}`,
    };
  }, [data, stage]);

  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const stageMeta = STAGES[stageIndex];

  const xRange = useMemo(() => {
    if (!data?.time.length) return undefined;
    if (zoomMode === "full") return [0, data.time[data.time.length - 1]];
    if (zoomMode === "15s") return [145, 165];
    return [120, 185];
  }, [data, zoomMode]);

  const eventShapes = useMemo(() => {
    if (!data) return [];
    return data.events
      .filter((e) => !e.practice && (e.type === "VAS7" || e.type === "VAS3"))
      .map((e) => ({
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: e.onset,
        x1: e.onset + Math.max(1, e.duration || 5),
        y0: 0,
        y1: 1,
        fillcolor: e.type === "VAS7" ? "rgba(220,38,38,0.09)" : "rgba(22,163,74,0.08)",
        line: { width: 0 },
        layer: "below",
      }));
  }, [data]);

  const mainPlot = useMemo(() => {
    if (!data) return { traces: [], layout: {} };
    const t = data.time;
    const st = data.stages;

    if (stage === "raw") {
      return {
        traces: [
          { x: t, y: st.raw.wl690, name: "690 nm (AU)", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.5 } },
          { x: t, y: st.raw.wl830, name: "830 nm (AU)", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.5 }, yaxis: "y2" },
        ],
        layout: {
          xaxis: { title: { text: "Time in run (s)", font: { size: 10 } }, range: xRange, gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "690 nm (AU)", font: { size: 10 } }, gridcolor: "#f1f5f9" },
          yaxis2: { title: { text: "830 nm (AU)", font: { size: 10 } }, overlaying: "y", side: "right", showgrid: false },
          margin: { l: 64, r: 64, t: 30, b: 36 },
          shapes: eventShapes,
        },
      };
    }

    if (stage === "od") {
      return {
        traces: [
          { x: t, y: st.od.od690, name: "ΔOD 690 nm", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.5 } },
          { x: t, y: st.od.od830, name: "ΔOD 830 nm", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.4 } },
        ],
        layout: {
          xaxis: { title: { text: "Time in run (s)", font: { size: 10 } }, range: xRange, gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "Optical Density (ΔOD)", font: { size: 10 } }, gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
          shapes: eventShapes,
        },
      };
    }

    if (stage === "tddr") {
      const traces: any[] = [];
      if (showCompare) {
        traces.push({ x: t, y: st.tddr.before, name: "Before TDDR", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.2 } });
      }
      traces.push({ x: t, y: st.tddr.after, name: "After TDDR (690 nm)", type: "scatter", mode: "lines", line: { color: "#0f766e", width: 1.8 } });
      const motShapes = st.tddr.motion_intervals.map(([a, b]) => ({
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: a,
        x1: b,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(180,83,9,0.16)",
        line: { width: 0 },
        layer: "below",
      }));
      return {
        traces,
        layout: {
          xaxis: { title: { text: "Time in run (s)", font: { size: 10 } }, range: xRange, gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "ΔOD", font: { size: 10 } }, gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
          shapes: [...eventShapes, ...motShapes],
        },
      };
    }

    if (stage === "mbll") {
      return {
        traces: [
          { x: t, y: st.mbll.hbo, name: "HbO (unfiltered µM)", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.6 } },
          { x: t, y: st.mbll.hbr, name: "HbR (unfiltered µM)", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.4 } },
        ],
        layout: {
          xaxis: { title: { text: "Time in run (s)", font: { size: 10 } }, range: xRange, gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "ΔConcentration (µM)", font: { size: 10 } }, gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
          shapes: eventShapes,
        },
      };
    }

    if (stage === "short_channel") {
      const traces: any[] = [];
      if (showCompare) {
        traces.push({ x: t, y: st.short_channel.before, name: "Before SC reg.", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.2 } });
        if (st.short_channel.short_name) {
          traces.push({
            x: t,
            y: st.short_channel.short_trace,
            name: `Scalp (${st.short_channel.short_name})`,
            type: "scatter",
            mode: "lines",
            line: { color: "#d97706", width: 1.2, dash: "dot" },
          });
        }
      }
      traces.push({ x: t, y: st.short_channel.after, name: "After SC reg. (cortical)", type: "scatter", mode: "lines", line: { color: "#0f766e", width: 1.9 } });
      return {
        traces,
        layout: {
          xaxis: { title: { text: "Time in run (s)", font: { size: 10 } }, range: xRange, gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "ΔHbO (µM)", font: { size: 10 } }, gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
          shapes: eventShapes,
        },
      };
    }

    if (stage === "bandpass") {
      const traces: any[] = [];
      if (showCompare) {
        traces.push({ x: t, y: st.bandpass.before, name: "Before filter", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.1 } });
      }
      traces.push({ x: t, y: st.bandpass.after, name: "Clean HbO (0.01–0.2 Hz)", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.9 } });
      traces.push({ x: t, y: st.bandpass.hbr_after, name: "Clean HbR", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.4 } });
      return {
        traces,
        layout: {
          xaxis: { title: { text: "Time in run (s)", font: { size: 10 } }, range: xRange, gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "ΔConcentration (µM)", font: { size: 10 } }, gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
          shapes: eventShapes,
        },
      };
    }

    // stage === "epoch"
    const ep = st.epoch;
    const plus = (m: (number | null)[], se: (number | null)[]) =>
      m.map((v, i) => (v === null || se[i] === null ? null : v + (se[i] as number)));
    const minus = (m: (number | null)[], se: (number | null)[]) =>
      m.map((v, i) => (v === null || se[i] === null ? null : v - (se[i] as number)));
    const traces: any[] = [
      { x: ep.t, y: plus(ep.vas7_mean, ep.vas7_sem), type: "scatter", mode: "lines", line: { width: 0, color: "rgba(0,0,0,0)" }, showlegend: false, hoverinfo: "skip" },
      { x: ep.t, y: minus(ep.vas7_mean, ep.vas7_sem), type: "scatter", mode: "lines", fill: "tonexty", fillcolor: "rgba(220,38,38,0.12)", line: { width: 0, color: "rgba(0,0,0,0)" }, showlegend: false, hoverinfo: "skip" },
      { x: ep.t, y: ep.vas7_mean, name: `Painful VAS7 (n=${ep.n_vas7})`, type: "scatter", mode: "lines", line: { color: "#dc2626", width: 2.4 } },
      { x: ep.t, y: plus(ep.vas3_mean, ep.vas3_sem), type: "scatter", mode: "lines", line: { width: 0, color: "rgba(0,0,0,0)" }, showlegend: false, hoverinfo: "skip" },
      { x: ep.t, y: minus(ep.vas3_mean, ep.vas3_sem), type: "scatter", mode: "lines", fill: "tonexty", fillcolor: "rgba(22,163,74,0.10)", line: { width: 0, color: "rgba(0,0,0,0)" }, showlegend: false, hoverinfo: "skip" },
      { x: ep.t, y: ep.vas3_mean, name: `Innocuous VAS3 (n=${ep.n_vas3})`, type: "scatter", mode: "lines", line: { color: "#16a34a", width: 2.1 } },
    ];
    return {
      traces,
      layout: {
        xaxis: { title: { text: "Time from stimulus onset (s)", font: { size: 10 } }, range: [-5, 25], gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
        yaxis: { title: { text: "ΔHbO (µM)", font: { size: 10 } }, gridcolor: "#f1f5f9", zeroline: true, zerolinecolor: "#cbd5e1" },
        shapes: [
          { type: "rect", xref: "x", yref: "paper", x0: 0, x1: 5, y0: 0, y1: 1, fillcolor: "rgba(220,38,38,0.08)", line: { width: 0 }, layer: "below" },
          { type: "rect", xref: "x", yref: "paper", x0: 7, x1: 10, y0: 0, y1: 1, fillcolor: "rgba(15,118,110,0.06)", line: { color: "rgba(15,118,110,0.4)", width: 1, dash: "dot" }, layer: "below" },
        ],
      },
    };
  }, [data, stage, showCompare, xRange, eventShapes]);

  const sideSpectrum = useMemo(() => {
    if (!data) return null;
    if (stage === "od") {
      const s = data.stages.od;
      // Locate peak cardiac frequency in 0.75–2.2 Hz for live annotation
      let peakFreq: number | null = null;
      let peakVal = -Infinity;
      for (let i = 0; i < s.psd_freqs.length; i++) {
        const f = s.psd_freqs[i];
        const v = s.psd_830[i];
        if (f >= 0.75 && f <= 2.2 && v != null && v > peakVal) {
          peakVal = v;
          peakFreq = f;
        }
      }
      const annotations: any[] = [
        { x: 0.10, y: 0.04, yref: "paper", text: "Brain", showarrow: false, yanchor: "bottom", textangle: -90, font: { size: 8.5, color: "#0f766e" } },
        { x: 0.35, y: 0.04, yref: "paper", text: "Breath", showarrow: false, yanchor: "bottom", textangle: -90, font: { size: 8.5, color: "#b45309" } },
        { x: 1.65, y: 0.97, yref: "paper", text: "Heartbeat band (0.8–2.5 Hz)", showarrow: false, yanchor: "top", font: { size: 9, color: "#b91c1c" } },
      ];
      if (peakFreq != null && Number.isFinite(peakVal)) {
        annotations.push({
          x: peakFreq,
          y: peakVal,
          text: `Pulse ${peakFreq.toFixed(2)} Hz (${Math.round(peakFreq * 60)} bpm)`,
          showarrow: true,
          arrowhead: 2,
          arrowsize: 0.8,
          arrowcolor: "#b91c1c",
          ax: 28,
          ay: -20,
          font: { size: 9, color: "#b91c1c" },
          bgcolor: "rgba(255,255,255,0.92)",
        });
      }
      return {
        title: "Frequency spectrum · cardiac peak (~1 Hz)",
        caption: "Bands: 0.01–0.20 Hz cortical HRF · 0.20–0.50 Hz breathing · 0.80–2.50 Hz heartbeat pulse (used for SCI).",
        traces: [
          { x: s.psd_freqs, y: s.psd_690, name: "690 nm", type: "scatter", mode: "lines", line: { color: "#dc2626", width: 1.6 } },
          { x: s.psd_freqs, y: s.psd_830, name: "830 nm", type: "scatter", mode: "lines", line: { color: "#2563eb", width: 1.4 } },
        ],
        layout: {
          margin: { l: 52, r: 14, t: 54, b: 36 },
          legend: { orientation: "h", y: 1.12, x: 0, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
          title: { text: "Power Spectral Density (PSD) · physiological bands", x: 0, xanchor: "left", y: 0.97, yanchor: "top", font: { size: 11 } },
          xaxis: { title: { text: "Frequency (Hz)", font: { size: 10 } }, range: [0, 3], gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "log10 Power (PSD)", font: { size: 10 } }, gridcolor: "#f1f5f9" },
          shapes: [
            { type: "rect", xref: "x", yref: "paper", x0: 0.01, x1: 0.2, y0: 0, y1: 1, fillcolor: "rgba(15,118,110,0.07)", line: { width: 0 }, layer: "below" },
            { type: "rect", xref: "x", yref: "paper", x0: 0.2, x1: 0.5, y0: 0, y1: 1, fillcolor: "rgba(180,83,9,0.06)", line: { width: 0 }, layer: "below" },
            { type: "rect", xref: "x", yref: "paper", x0: 0.8, x1: 2.5, y0: 0, y1: 1, fillcolor: "rgba(220,38,38,0.06)", line: { color: "rgba(220,38,38,0.28)", width: 1, dash: "dot" }, layer: "below" },
          ],
          annotations,
        },
      };
    }
    if (stage === "bandpass") {
      const s = data.stages.bandpass;
      return {
        title: "Filter response · 0.01–0.2 Hz passband",
        caption: "Kept: 0.01–0.20 Hz cortical HRF · Attenuated: <0.01 Hz drift, 0.2–0.5 Hz breathing, ~1 Hz heartbeat.",
        traces: [
          { x: s.psd_freqs, y: s.psd_before, name: "Before filter", type: "scatter", mode: "lines", line: { color: "#9ca3af", width: 1.3 } },
          { x: s.psd_freqs, y: s.psd_after, name: "After filter", type: "scatter", mode: "lines", line: { color: "#0f766e", width: 1.8 } },
        ],
        layout: {
          margin: { l: 52, r: 14, t: 54, b: 36 },
          legend: { orientation: "h", y: 1.12, x: 0, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
          title: { text: "Power Spectral Density (PSD) · passband vs rejected", x: 0, xanchor: "left", y: 0.97, yanchor: "top", font: { size: 11 } },
          xaxis: { title: { text: "Frequency (Hz)", font: { size: 10 } }, range: [0, 2.5], gridcolor: "#f1f5f9" },
          yaxis: { title: { text: "log10 Power (PSD)", font: { size: 10 } }, gridcolor: "#f1f5f9" },
          shapes: [
            { type: "rect", xref: "x", yref: "paper", x0: 0.01, x1: 0.2, y0: 0, y1: 1, fillcolor: "rgba(15,118,110,0.09)", line: { color: "rgba(15,118,110,0.35)", width: 1, dash: "dot" }, layer: "below" },
            { type: "rect", xref: "x", yref: "paper", x0: 0.2, x1: 0.5, y0: 0, y1: 1, fillcolor: "rgba(180,83,9,0.05)", line: { width: 0 }, layer: "below" },
            { type: "rect", xref: "x", yref: "paper", x0: 0.8, x1: 2.5, y0: 0, y1: 1, fillcolor: "rgba(220,38,38,0.04)", line: { width: 0 }, layer: "below" },
          ],
          annotations: [
            { x: 0.11, y: 0.04, yref: "paper", text: "Kept (Brain)", showarrow: false, yanchor: "bottom", textangle: -90, font: { size: 8.5, color: "#0f766e" } },
            { x: 0.36, y: 0.04, yref: "paper", text: "Breath", showarrow: false, yanchor: "bottom", textangle: -90, font: { size: 8.5, color: "#b45309" } },
            { x: 1.65, y: 0.95, yref: "paper", text: "Blocked: Heartbeat (~1 Hz)", showarrow: false, yanchor: "top", font: { size: 8.5, color: "#9ca3af" } },
          ],
        },
      };
    }
    return null;
  }, [data, stage]);

  if (error) {
    return <div className="empty-panel"><p>Could not load pipeline stages: {error}</p></div>;
  }

  return (
    <div className="pipeline">
      {/* Interactive Visual Pipeline Stepper */}
      <section className="panel pipe-flow-panel">
        <div className="pipe-top">
          <div>
            <h2>Signal Processing Pipeline · {data ? `${data.subject} / ${data.condition} / ${data.timepoint}` : runId}</h2>
            <p className="pipe-sub">Click any stage to inspect the live transformation on real data.</p>
          </div>
          <div className="pipe-controls">
            {data && (
              <select
                value={data.channel.name}
                onChange={(e) => setChannel(e.target.value)}
                aria-label="Channel"
              >
                {data.all_channels
                  .filter((c) => !c.short)
                  .map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                      {c.paper_index ? ` (C${c.paper_index})` : ""} · {roiLabel(c.roi)} · SCI{" "}
                      {c.sci?.toFixed(2) ?? "—"}
                      {c.good ? "" : " [flagged]"}
                    </option>
                  ))}
              </select>
            )}
            <button
              className="ghost small"
              disabled={stageIndex <= 0}
              onClick={() => setStage(STAGES[Math.max(0, stageIndex - 1)].id)}
            >
              ← Prev
            </button>
            <button
              className="ghost small"
              disabled={stageIndex >= STAGES.length - 1}
              onClick={() => setStage(STAGES[Math.min(STAGES.length - 1, stageIndex + 1)].id)}
            >
              Next →
            </button>
            <button
              className={`ghost small ${autoStep ? "active-btn" : ""}`}
              onClick={() => setAutoStep((v) => !v)}
            >
              {autoStep ? "Stop tour" : "Auto tour"}
            </button>
            {onAsk && data && (
              <button
                className="ghost small"
                onClick={() =>
                  onAsk(
                    `Explain pipeline stage "${stageMeta.title}" for channel ${data.channel.name} in ${data.run_id}. Include its quality metrics.`,
                  )
                }
              >
                Ask analyst →
              </button>
            )}
          </div>
        </div>

        <div className="pipe-flow">
          {STAGES.map((s, idx) => {
            const active = s.id === stage;
            let badge = "";
            if (data) {
              if (s.id === "raw") badge = `CV ${(data.stages.raw.cv * 100).toFixed(1)}%`;
              if (s.id === "od") badge = `SCI ${data.stages.od.sci.toFixed(2)}`;
              if (s.id === "tddr") badge = `${(data.stages.tddr.motion_frac * 100).toFixed(1)}% mot`;
              if (s.id === "mbll") badge = `DPF ${data.stages.mbll.dpf}`;
              if (s.id === "short_channel") badge = `-${data.stages.short_channel.removed_pct}% scalp`;
              if (s.id === "bandpass") badge = "0.01–0.2 Hz";
              if (s.id === "epoch") badge = `${data.stages.epoch.n_vas7} VAS7`;
            }
            return (
              <div key={s.id} className="pipe-node-wrap">
                <button
                  className={`pipe-node ${active ? "active" : idx < stageIndex ? "done" : ""}`}
                  onClick={() => {
                    setStage(s.id);
                    setAutoStep(false);
                  }}
                >
                  <span className="pipe-num">{s.step}</span>
                  <span className="pipe-label">{s.short}</span>
                  {badge && <small className="pipe-badge">{badge}</small>}
                </button>
                {idx < STAGES.length - 1 && <span className="pipe-arrow" aria-hidden="true">→</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Active Stage Visual Workbench */}
      <section className="panel pipe-stage-panel">
        <div className="pipe-stage-head">
          <div>
            <h3>
              Stage {stageMeta.step}: {stageMeta.title}
            </h3>
            <p className="pipe-takeaway">{stageMeta.takeaway}</p>
          </div>
          <div className="pipe-stage-tools">
            {stage !== "epoch" && (
              <div className="segmented compact">
                {(["15s", "60s", "full"] as const).map((z) => (
                  <button key={z} className={zoomMode === z ? "active" : ""} onClick={() => setZoomMode(z)}>
                    {z === "15s" ? "15s pulse" : z === "60s" ? "60s window" : "Full run"}
                  </button>
                ))}
              </div>
            )}
            {(stage === "tddr" || stage === "short_channel" || stage === "bandpass") && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={showCompare}
                  onChange={(e) => setShowCompare(e.target.checked)}
                />
                overlay before
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={showMath}
                onChange={(e) => setShowMath(e.target.checked)}
              />
              equations
            </label>
          </div>
        </div>

        {loading || !data ? (
          <div className="pipe-loading">Computing intermediate stages…</div>
        ) : (
          <>
            {showMath && stageMath && (
              <div className="math-strip">
                <div className="math-eq">
                  <span>Equation</span>
                  <code>{stageMath.formula}</code>
                </div>
                <div className="math-terms">
                  <span>Live values</span>
                  <code>{stageMath.terms}</code>
                </div>
                <div className="math-glossary">
                  <span>Key terms</span>
                  <div className="glossary-chips">
                    {STAGE_GLOSSARY[stage].map((g) => (
                      <span key={g.term} className="glossary-chip">
                        <b>{g.term}</b> {g.desc}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className={`pipe-charts ${sideSpectrum ? "split" : ""}`}>
              <div className="pipe-chart-box">
                <PlotPane traces={mainPlot.traces} layout={mainPlot.layout} height={315} />
              </div>
              {sideSpectrum && (
                <div className="pipe-chart-box">
                  <PlotPane traces={sideSpectrum.traces} layout={sideSpectrum.layout} height={295} />
                  <p className="psd-caption">{sideSpectrum.caption}</p>
                </div>
              )}
            </div>

            <div className="telemetry-strip">
              <div className="tele-cell">
                <div className="tele-head">
                  <span>Channel</span>
                  <b className="tele-num">
                    {data.channel.name}
                    {data.channel.paper_index ? ` · C${data.channel.paper_index}` : ""}
                  </b>
                </div>
                <div className="tele-sub">{roiLabel(data.channel.roi)}</div>
              </div>
              <div className="tele-cell">
                <div className="tele-head">
                  <span>Cardiac coupling (SCI)</span>
                  <b className={`qc-tag ${data.channel.good ? "good" : "fair"}`}>
                    {data.stages.od.sci.toFixed(2)}
                  </b>
                </div>
                <div className="tele-sub">threshold ≥ 0.70 · CV {(data.stages.raw.cv * 100).toFixed(1)}%</div>
              </div>
              <div className="tele-cell">
                <div className="tele-head">
                  <span>Scalp regression</span>
                  <b className="tele-num">−{data.stages.short_channel.removed_pct.toFixed(1)}% var</b>
                </div>
                <div className="tele-sub">
                  r = {data.stages.short_channel.corr_before.toFixed(2)} with {data.stages.short_channel.short_name ?? "short ch"}
                </div>
              </div>
              <div className="tele-cell">
                <div className="tele-head">
                  <span>VAS7 outcome</span>
                  <b className="tele-num">
                    {data.stages.epoch.nadir_5_15 != null
                      ? `${data.stages.epoch.nadir_5_15 >= 0 ? "+" : ""}${data.stages.epoch.nadir_5_15.toFixed(3)} µM`
                      : "—"}
                  </b>
                </div>
                <div className="tele-sub">
                  nadir @ {data.stages.epoch.nadir_latency_s ?? "—"} s · n = {data.stages.epoch.n_vas7} trials
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
