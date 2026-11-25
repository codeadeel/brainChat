import { useEffect, useMemo, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import type { RunData } from "../types";

const COLORS = {
  hbo: "#d94a4a",
  hbr: "#2563eb",
  pain: "rgba(217, 74, 74, 0.12)",
  safe: "rgba(47, 133, 90, 0.10)",
  response: "rgba(194, 124, 14, 0.08)",
  grid: "#e7edf5",
  text: "#334155",
  muted: "#6b7c91",
  zero: "#cbd5e1",
};

interface Props {
  run: RunData;
  selected: string[];
  playhead: number;
  follow: boolean;
  view: { start: number; end: number } | null;
  highlight?: { start: number; end: number } | null;
  responseWindow?: { start: number; end: number } | null;
  showIndividual: boolean;
  onSeek?: (t: number) => void;
}

function meanAndSem(rows: (number | null)[][], indices: number[]) {
  const n = indices.length;
  const len = rows[0]?.length ?? 0;
  const mean = new Array<number | null>(len).fill(null);
  const sem = new Array<number | null>(len).fill(null);
  if (!n) return { mean, sem };
  for (let t = 0; t < len; t++) {
    let sum = 0;
    let count = 0;
    const vals: number[] = [];
    for (const i of indices) {
      const v = rows[i]?.[t];
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        sum += v;
        count += 1;
        vals.push(v);
      }
    }
    if (!count) continue;
    const m = sum / count;
    mean[t] = m;
    if (count > 1) {
      const varSum = vals.reduce((acc, v) => acc + (v - m) ** 2, 0);
      sem[t] = Math.sqrt(varSum / (count - 1)) / Math.sqrt(count);
    } else {
      sem[t] = 0;
    }
  }
  return { mean, sem };
}

function plus(a: (number | null)[], b: (number | null)[]) {
  return a.map((v, i) => (v === null || b[i] === null ? null : v + (b[i] as number)));
}

function minus(a: (number | null)[], b: (number | null)[]) {
  return a.map((v, i) => (v === null || b[i] === null ? null : v - (b[i] as number)));
}

function shapesFor(
  run: RunData,
  playhead: number,
  highlight?: { start: number; end: number } | null,
  responseWindow?: { start: number; end: number } | null,
) {
  const shapes: Record<string, unknown>[] = [];
  for (const e of run.events) {
    if (e.type !== "VAS7" && e.type !== "VAS3") continue;
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: e.onset,
      x1: e.onset + Math.max(1, e.duration || 5),
      y0: 0,
      y1: 1,
      fillcolor: e.type === "VAS7" ? COLORS.pain : COLORS.safe,
      line: { width: 0 },
      layer: "below",
    });
  }
  if (responseWindow) {
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: responseWindow.start,
      x1: responseWindow.end,
      y0: 0,
      y1: 1,
      fillcolor: COLORS.response,
      line: { color: "rgba(194,124,14,0.35)", width: 1, dash: "dot" },
      layer: "below",
    });
  }
  if (highlight) {
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: highlight.start,
      x1: highlight.end,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(15,118,110,0.04)",
      line: { color: "rgba(15,118,110,0.55)", width: 1, dash: "dot" },
      layer: "above",
    });
  }
  shapes.push({
    type: "line",
    xref: "x",
    yref: "paper",
    x0: playhead,
    x1: playhead,
    y0: 0,
    y1: 1,
    line: { color: "#0f766e", width: 1.5, dash: "dash" },
    layer: "above",
  });
  return shapes;
}

function robustRange(mean: (number | null)[], sem: (number | null)[]) {
  const vals: number[] = [];
  for (let i = 0; i < mean.length; i++) {
    const m = mean[i];
    if (m === null) continue;
    const s = sem[i] ?? 0;
    vals.push(m - s, m + s);
  }
  if (!vals.length) return [-0.3, 0.3];
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)];
  const hi = vals[Math.floor(vals.length * 0.98)];
  const pad = Math.max(0.05, (hi - lo) * 0.18);
  const absMax = Math.max(0.15, Math.abs(lo), Math.abs(hi)) + pad;
  return [-absMax, absMax];
}

export default function SignalChart({
  run,
  selected,
  playhead,
  follow,
  view,
  highlight,
  responseWindow,
  showIndividual,
  onSeek,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const indices = useMemo(
    () =>
      selected
        .map((name) => run.channels.findIndex((c) => c.name === name))
        .filter((i) => i >= 0),
    [selected, run],
  );

  const stats = useMemo(() => {
    const hbo = meanAndSem(run.hbo, indices);
    const hbr = meanAndSem(run.hbr, indices);
    return {
      hbo,
      hbr,
      range: robustRange(hbo.mean, hbo.sem),
    };
  }, [run, indices]);

  const traces = useMemo(() => {
    const out: any[] = [];
    if (showIndividual) {
      const palette = ["#e11d48", "#ea580c", "#d97706", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#4f46e5"];
      indices.forEach((idx, ci) => {
        const ch = run.channels[idx];
        const star = ch.paper_index != null && [10, 14, 15, 16].includes(ch.paper_index);
        const label = ch.paper_index != null ? `${ch.name} · C${ch.paper_index}${star ? "★" : ""}` : `${ch.name} · SC`;
        out.push({
          x: run.time,
          y: run.hbo[idx],
          type: "scatter",
          mode: "lines",
          name: label,
          line: { color: palette[ci % palette.length], width: 1.2 },
          opacity: 0.55,
          showlegend: false,
          hovertemplate: `${label} · HbO %{y:.3f} µM @ %{x:.1f}s<extra></extra>`,
        });
      });
    }
    // HbO confidence band + mean
    out.push({
      x: run.time,
      y: plus(stats.hbo.mean, stats.hbo.sem),
      type: "scatter",
      mode: "lines",
      line: { width: 0, color: "rgba(0,0,0,0)" },
      hoverinfo: "skip",
      showlegend: false,
    });
    out.push({
      x: run.time,
      y: minus(stats.hbo.mean, stats.hbo.sem),
      type: "scatter",
      mode: "lines",
      fill: "tonexty",
      fillcolor: "rgba(217,74,74,0.12)",
      line: { width: 0, color: "rgba(0,0,0,0)" },
      hoverinfo: "skip",
      showlegend: false,
    });
    out.push({
      x: run.time,
      y: stats.hbo.mean,
      type: "scatter",
      mode: "lines",
      name: "HbO (ROI mean)",
      line: { color: COLORS.hbo, width: 2.6 },
      hovertemplate: "HbO %{y:.3f} µM · %{x:.1f}s<extra></extra>",
    });
    // HbR confidence band + mean
    out.push({
      x: run.time,
      y: plus(stats.hbr.mean, stats.hbr.sem),
      type: "scatter",
      mode: "lines",
      line: { width: 0, color: "rgba(0,0,0,0)" },
      hoverinfo: "skip",
      showlegend: false,
    });
    out.push({
      x: run.time,
      y: minus(stats.hbr.mean, stats.hbr.sem),
      type: "scatter",
      mode: "lines",
      fill: "tonexty",
      fillcolor: "rgba(37,99,235,0.10)",
      line: { width: 0, color: "rgba(0,0,0,0)" },
      hoverinfo: "skip",
      showlegend: false,
    });
    out.push({
      x: run.time,
      y: stats.hbr.mean,
      type: "scatter",
      mode: "lines",
      name: "HbR (ROI mean)",
      line: { color: COLORS.hbr, width: 2.1 },
      hovertemplate: "HbR %{y:.3f} µM · %{x:.1f}s<extra></extra>",
    });
    return out;
  }, [run, indices, stats, showIndividual]);

  const layout: any = useMemo(
    () => ({
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      font: { color: COLORS.text, size: 11, family: "Inter, system-ui, sans-serif" },
      margin: { l: 56, r: 16, t: 28, b: 34 },
      height: 285,
      hovermode: showIndividual ? "closest" : "x unified",
      hoverdistance: 18,
      showlegend: true,
      legend: {
        orientation: "h",
        y: 1.14,
        x: 0,
        font: { size: 10 },
        bgcolor: "rgba(255,255,255,0)",
        traceorder: "normal",
      },
      xaxis: {
        title: { text: "Time in run (s)", font: { size: 10 } },
        gridcolor: COLORS.grid,
        zeroline: false,
        range: view ? [view.start, view.end] : undefined,
        fixedrange: false,
        tickfont: { size: 10 },
      },
      yaxis: {
        title: { text: "ΔHbO / ΔHbR (µM)", font: { size: 10 } },
        gridcolor: COLORS.grid,
        zeroline: true,
        zerolinecolor: COLORS.zero,
        zerolinewidth: 1,
        range: stats.range,
        fixedrange: false,
        tickfont: { size: 10 },
      },
      shapes: shapesFor(run, playhead, highlight, responseWindow),
      dragmode: "pan",
    }),
    [run, view, stats.range, highlight, responseWindow, showIndividual], // playhead is updated via relayout
  );

  useEffect(() => {
    if (!ref.current) return;
    Plotly.react(ref.current, traces, layout, {
      responsive: true,
      displaylogo: false,
      displayModeBar: false,
      scrollZoom: true,
    });
  }, [traces, layout]);

  useEffect(() => {
    if (!ref.current) return;
    const update: Record<string, unknown> = {
      shapes: shapesFor(run, playhead, highlight, responseWindow),
    };
    if (follow && !view) {
      update["xaxis.range"] = [
        Math.max(0, playhead - 60),
        Math.min(run.meta.duration_s, playhead + 8),
      ];
    }
    Plotly.relayout(ref.current, update);
  }, [playhead, follow, view, highlight, responseWindow, run]);

  useEffect(() => {
    const el = ref.current as any;
    if (!el || !onSeek) return;
    const handler = (ev: any) => {
      const x = ev?.points?.[0]?.x;
      if (typeof x === "number" && Number.isFinite(x)) onSeek(x);
    };
    el.on?.("plotly_click", handler);
    return () => {
      el.removeListener?.("plotly_click", handler);
    };
  }, [onSeek]);

  useEffect(() => {
    return () => {
      if (ref.current) Plotly.purge(ref.current);
    };
  }, []);

  return <div className="chart" style={{ height: 285 }} ref={ref} />;
}
