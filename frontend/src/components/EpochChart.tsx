import { useEffect, useMemo, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import type { ChannelMeta, RunData } from "../types";

interface Props {
  run: RunData;
  selected: string[];
  showTrials: boolean;
  showChannels: boolean;
}

const CH_PALETTE = ["#e11d48", "#ea580c", "#d97706", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#4f46e5"];
const PAPER_BA10 = [10, 14, 15, 16];

function channelLabel(ch: ChannelMeta) {
  const star = ch.paper_index != null && PAPER_BA10.includes(ch.paper_index);
  return ch.paper_index != null ? `${ch.name} · C${ch.paper_index}${star ? "★" : ""}` : `${ch.name} · SC`;
}

function fmtClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function computeHrf(run: RunData, indices: number[], eventType: "VAS7" | "VAS3") {
  const fs = run.sample_rate;
  const pre = Math.round(5 * fs);
  const post = Math.round(25 * fs);
  const len = pre + post;
  const t = Array.from({ length: len }, (_, k) => (k - pre) / fs);
  const trials: number[][] = [];
  const onsets: number[] = [];
  const maxLen = run.time.length;

  for (const ev of run.events) {
    if (ev.type !== eventType || ev.practice) continue;
    const i0 = Math.round(ev.onset * fs) - pre;
    const i1 = i0 + len;
    if (i0 < 0 || i1 > maxLen || !indices.length) continue;

    // Average across selected channels, then baseline-correct -5..0 s per trial.
    const row = new Array<number>(len).fill(0);
    let validChans = 0;
    for (const ch of indices) {
      const series = run.hbo[ch];
      if (!series) continue;
      let base = 0;
      let bn = 0;
      for (let k = 0; k < pre; k++) {
        const v = series[i0 + k];
        if (v !== null && Number.isFinite(v)) {
          base += v;
          bn += 1;
        }
      }
      if (!bn) continue;
      const b = base / bn;
      validChans += 1;
      for (let k = 0; k < len; k++) {
        const v = series[i0 + k];
        if (v !== null && Number.isFinite(v)) row[k] += v - b;
      }
    }
    if (validChans > 0) {
      for (let k = 0; k < len; k++) row[k] /= validChans;
      trials.push(row);
      onsets.push(ev.onset);
    }
  }

  const n = trials.length;
  const mean = new Array<number>(len).fill(0);
  const sem = new Array<number>(len).fill(0);
  if (n > 0) {
    for (let k = 0; k < len; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += trials[i][k];
      const m = s / n;
      mean[k] = m;
      if (n > 1) {
        let vs = 0;
        for (let i = 0; i < n; i++) vs += (trials[i][k] - m) ** 2;
        sem[k] = Math.sqrt(vs / (n - 1)) / Math.sqrt(n);
      }
    }
  }
  return { t, mean, sem, trials, onsets, n };
}

export default function EpochChart({ run, selected, showTrials, showChannels }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const indices = useMemo(
    () =>
      selected
        .map((name) => run.channels.findIndex((c) => c.name === name))
        .filter((i) => i >= 0),
    [selected, run],
  );

  const vas7 = useMemo(() => computeHrf(run, indices, "VAS7"), [run, indices]);
  const vas3 = useMemo(() => computeHrf(run, indices, "VAS3"), [run, indices]);

  const traces = useMemo(() => {
    const out: any[] = [];
    if (showTrials) {
      vas7.trials.forEach((tr, i) => {
        const onsetStr = fmtClock(vas7.onsets[i] ?? 0);
        out.push({
          x: vas7.t,
          y: tr,
          type: "scatter",
          mode: "lines",
          line: { color: "#dc2626", width: 1.0 },
          opacity: 0.32,
          showlegend: false,
          name: `VAS7 #${i + 1}`,
          hovertemplate: `VAS7 Trial #${i + 1} (@ ${onsetStr}) · %{y:.3f} µM @ %{x:.1f}s<extra></extra>`,
        });
      });
      vas3.trials.forEach((tr, i) => {
        const onsetStr = fmtClock(vas3.onsets[i] ?? 0);
        out.push({
          x: vas3.t,
          y: tr,
          type: "scatter",
          mode: "lines",
          line: { color: "#16a34a", width: 1.0 },
          opacity: 0.28,
          showlegend: false,
          name: `VAS3 #${i + 1}`,
          hovertemplate: `VAS3 Trial #${i + 1} (@ ${onsetStr}) · %{y:.3f} µM @ %{x:.1f}s<extra></extra>`,
        });
      });
    }

    if (showChannels) {
      indices.forEach((idx, ci) => {
        const ch = run.channels[idx];
        const chHrf = computeHrf(run, [idx], "VAS7");
        if (!chHrf.n) return;
        const label = channelLabel(ch);
        out.push({
          x: chHrf.t,
          y: chHrf.mean,
          type: "scatter",
          mode: "lines",
          name: label,
          line: { color: CH_PALETTE[ci % CH_PALETTE.length], width: 1.5, dash: "dot" },
          opacity: 0.85,
          showlegend: true,
          hovertemplate: `${label} (VAS7 mean) · %{y:.3f} µM @ %{x:.1f}s<extra></extra>`,
        });
      });
    }

    const addGroup = (
      g: ReturnType<typeof computeHrf>,
      label: string,
      color: string,
      fill: string,
    ) => {
      if (!g.n) return;
      out.push({
        x: g.t,
        y: g.mean.map((m, i) => m + g.sem[i]),
        type: "scatter",
        mode: "lines",
        line: { width: 0, color: "rgba(0,0,0,0)" },
        hoverinfo: "skip",
        showlegend: false,
      });
      out.push({
        x: g.t,
        y: g.mean.map((m, i) => m - g.sem[i]),
        type: "scatter",
        mode: "lines",
        fill: "tonexty",
        fillcolor: fill,
        line: { width: 0, color: "rgba(0,0,0,0)" },
        hoverinfo: "skip",
        showlegend: false,
      });
      out.push({
        x: g.t,
        y: g.mean,
        type: "scatter",
        mode: "lines",
        name: `${label} (n=${g.n})`,
        line: { color, width: 2.5 },
        hovertemplate: `${label} · %{y:.3f} µM @ %{x:.1f}s<extra></extra>`,
      });
    };

    addGroup(vas7, "Painful VAS7", "#dc2626", "rgba(220,38,38,0.12)");
    addGroup(vas3, "Innocuous VAS3", "#16a34a", "rgba(22,163,74,0.10)");
    return out;
  }, [run, indices, vas7, vas3, showTrials, showChannels]);

  const layout = useMemo(
    () => ({
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      font: { color: "#374151", size: 11, family: "Inter, system-ui, sans-serif" },
      margin: { l: 54, r: 16, t: showChannels ? 40 : 28, b: 34 },
      height: 285,
      hovermode: (showTrials || showChannels ? "closest" : "x unified") as "closest" | "x unified",
      hoverdistance: 18,
      showlegend: true,
      legend: { orientation: "h" as const, y: showChannels ? 1.2 : 1.14, x: 0, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
      xaxis: {
        title: { text: "Time from stimulus onset (s)", font: { size: 10 } },
        gridcolor: "#f1f5f9",
        zeroline: true,
        zerolinecolor: "#cbd5e1",
        range: [-5, 25],
      },
      yaxis: {
        title: { text: "ΔHbO (µM)", font: { size: 10 } },
        gridcolor: "#f1f5f9",
        zeroline: true,
        zerolinecolor: "#cbd5e1",
      },
      shapes: [
        {
          type: "rect",
          xref: "x",
          yref: "paper",
          x0: 0,
          x1: 5,
          y0: 0,
          y1: 1,
          fillcolor: "rgba(220,38,38,0.08)",
          line: { width: 0 },
          layer: "below",
        },
        {
          type: "rect",
          xref: "x",
          yref: "paper",
          x0: 7,
          x1: 10,
          y0: 0,
          y1: 1,
          fillcolor: "rgba(15,118,110,0.06)",
          line: { color: "rgba(15,118,110,0.35)", width: 1, dash: "dot" },
          layer: "below",
        },
      ],
    }),
    [showTrials, showChannels],
  );

  useEffect(() => {
    if (!ref.current) return;
    Plotly.react(ref.current, traces, layout as any, {
      responsive: true,
      displaylogo: false,
      displayModeBar: false,
    });
  }, [traces, layout]);

  useEffect(() => () => { if (ref.current) Plotly.purge(ref.current); }, []);

  return <div className="chart" style={{ height: 285 }} ref={ref} />;
}
