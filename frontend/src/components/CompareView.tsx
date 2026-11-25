import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { roiLabel } from "../labels";
import type { GroupPoint, GroupSummary } from "../types";

const COLORS = {
  morphine: "#6d28d9",
  placebo: "#0f766e",
  grid: "#f1f5f9",
  text: "#374151",
};

function PlotBox({
  traces,
  layout,
  height = 290,
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
        font: { color: COLORS.text, size: 11, family: "Inter, system-ui, sans-serif" },
        height,
        margin: { l: 54, r: 16, t: 32, b: 56 },
        legend: { orientation: "h", y: -0.22, x: 0, font: { size: 10 } },
        xaxis: { gridcolor: COLORS.grid, zeroline: false },
        yaxis: { gridcolor: COLORS.grid, zeroline: true, zerolinecolor: "#cbd5e1" },
        ...layout,
      },
      { responsive: true, displaylogo: false, displayModeBar: false },
    );
  }, [traces, layout, height]);
  useEffect(() => () => { if (ref.current) Plotly.purge(ref.current); }, []);
  return <div className="chart" style={{ height }} ref={ref} />;
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(3)} µM`;
}

function pval(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v < 0.001 ? "<0.001" : v.toFixed(3);
}

export default function CompareView({
  group,
  onAsk,
}: {
  group: GroupSummary | null;
  onAsk?: (prompt: string) => void;
}) {
  const [eventType, setEventType] = useState("VAS7");
  const [roi, setRoi] = useState("medial_ba10");
  const [timepoint, setTimepoint] = useState("90min");
  const [metric, setMetric] = useState<"mean_7_10" | "nadir_5_15">("mean_7_10");

  const between = group?.between_condition?.[eventType]?.[roi]?.[metric] ?? null;
  const withinMor = group?.within_condition?.morphine?.[eventType]?.[roi]?.[metric] ?? null;
  const withinPla = group?.within_condition?.placebo?.[eventType]?.[roi]?.[metric] ?? null;
  const point: GroupPoint | undefined = between?.[timepoint];
  const morPoint = withinMor?.[timepoint];
  const plaPoint = withinPla?.[timepoint];
  const roiName = roiLabel(roi);
  const tpLabel = timepoint.replace("min", " min");
  const stimLabel = eventType === "VAS7" ? "noxious (VAS7)" : "innocuous (VAS3)";
  const metricLabel = metric === "mean_7_10" ? "ΔHbO 7–10 s" : "Nadir 5–15 s";

  const timeCourse = useMemo(() => {
    if (!between) return null;
    const tps = ["pre", "30min", "60min", "90min"];
    return {
      x: [0, 1, 2, 3],
      morphine: tps.map((t) => between[t]?.morphine_mean ?? null),
      placebo: tps.map((t) => between[t]?.placebo_mean ?? null),
      morphineErr: tps.map((t) => between[t]?.morphine_sem ?? 0),
      placeboErr: tps.map((t) => between[t]?.placebo_sem ?? 0),
    };
  }, [between]);

  const traces = useMemo(() => {
    if (!timeCourse) return [];
    return [
      {
        x: timeCourse.x,
        y: timeCourse.morphine,
        error_y: { type: "data", array: timeCourse.morphineErr, color: COLORS.morphine, thickness: 1.2 },
        type: "scatter",
        mode: "lines+markers",
        name: "Morphine",
        line: { color: COLORS.morphine, width: 2.2 },
        marker: { size: 7 },
      },
      {
        x: timeCourse.x,
        y: timeCourse.placebo,
        error_y: { type: "data", array: timeCourse.placeboErr, color: COLORS.placebo, thickness: 1.2 },
        type: "scatter",
        mode: "lines+markers",
        name: "Placebo",
        line: { color: COLORS.placebo, width: 2.2 },
        marker: { size: 7 },
      },
    ];
  }, [timeCourse]);

  const timeLayout = useMemo(
    () => ({
      title: { text: `${roiName} · ${metricLabel} by scan`, x: 0, xanchor: "left", font: { size: 12 } },
      xaxis: {
        title: { text: "Scan" },
        gridcolor: COLORS.grid,
        zeroline: false,
        tickvals: [0, 1, 2, 3],
        ticktext: ["Pre", "30 min", "60 min", "90 min"],
        range: [-0.3, 3.3],
      },
      yaxis: { title: { text: "ΔHbO (µM)" }, gridcolor: COLORS.grid, zeroline: true, zerolinecolor: "#cbd5e1" },
      shapes: [
        {
          type: "line",
          xref: "x",
          yref: "paper",
          x0: ["pre", "30min", "60min", "90min"].indexOf(timepoint),
          x1: ["pre", "30min", "60min", "90min"].indexOf(timepoint),
          y0: 0,
          y1: 1,
          line: { color: "#0f766e", width: 1.3, dash: "dot" },
        },
      ],
    }),
    [timepoint, roiName, metricLabel],
  );

  const paired = useMemo(() => {
    if (!point?.per_subject?.length) return [];
    const subjects = point.per_subject.map((p) => p.subject.replace("sub-", "s"));
    const xs: (string | null)[] = [];
    const ys: (number | null)[] = [];
    point.per_subject.forEach((p) => {
      const label = p.subject.replace("sub-", "s");
      xs.push(label, label, null);
      ys.push(p.morphine, p.placebo, null);
    });
    return [
      {
        x: subjects,
        y: point.per_subject.map((p) => p.morphine),
        type: "scatter",
        mode: "markers",
        name: "Morphine",
        marker: { color: COLORS.morphine, size: 7 },
      },
      {
        x: subjects,
        y: point.per_subject.map((p) => p.placebo),
        type: "scatter",
        mode: "markers",
        name: "Placebo",
        marker: { color: COLORS.placebo, size: 7 },
      },
      {
        x: xs,
        y: ys,
        type: "scatter",
        mode: "lines",
        showlegend: false,
        line: { color: "#9ca3af", width: 0.9 },
        hoverinfo: "skip",
      },
    ];
  }, [point]);

  if (!group) {
    return (
      <div className="empty-panel">
        <h2>Group comparison</h2>
        <p>The group summary is still being built. Run <code>python -m backend.cli group</code>.</p>
      </div>
    );
  }

  return (
    <div className="compare">
      <div className="compare-head">
        <div>
          <h2>Morphine vs placebo · {group.n_subjects} subjects</h2>
          <p className="compare-intro">
            Crossover comparison ({stimLabel}, {roiName}). Positive values mean less negative ΔHbO
            (attenuated deactivation).
          </p>
        </div>
        <div className="compare-controls">
          <div className="segmented compact">
            <button className={eventType === "VAS7" ? "active" : ""} onClick={() => setEventType("VAS7")}>
              VAS7 pain
            </button>
            <button className={eventType === "VAS3" ? "active" : ""} onClick={() => setEventType("VAS3")}>
              VAS3 safe
            </button>
          </div>
          <select value={roi} onChange={(e) => setRoi(e.target.value)} aria-label="Region of interest">
            {group.rois.map((r) => (
              <option key={r} value={r}>
                {roiLabel(r)}
              </option>
            ))}
          </select>
          <select value={timepoint} onChange={(e) => setTimepoint(e.target.value)} aria-label="Timepoint">
            {["30min", "60min", "90min"].map((t) => (
              <option key={t} value={t}>
                {t.replace("min", " min")}
              </option>
            ))}
          </select>
          <div className="segmented compact">
            <button
              className={metric === "mean_7_10" ? "active" : ""}
              onClick={() => setMetric("mean_7_10")}
            >
              Mean 7–10s
            </button>
            <button
              className={metric === "nadir_5_15" ? "active" : ""}
              onClick={() => setMetric("nadir_5_15")}
            >
              Nadir 5–15s
            </button>
          </div>
          {onAsk && (
            <button
              className="ghost small"
              onClick={() =>
                onAsk(
                  `Compare morphine vs placebo at ${tpLabel} for ${stimLabel} in ${roiName}. Is the difference significant?`,
                )
              }
            >
              Ask analyst →
            </button>
          )}
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-cell">
          <span className="stat-label">Morphine · pre → {tpLabel}</span>
          <b className="stat-value">{pct(morPoint?.difference)}</b>
          <small className="stat-meta">
            p = {pval(morPoint?.p)} · q = {pval(morPoint?.p_fdr)} · n = {morPoint?.n ?? "—"}
          </small>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Placebo · pre → {tpLabel}</span>
          <b className="stat-value">{pct(plaPoint?.difference)}</b>
          <small className="stat-meta">
            p = {pval(plaPoint?.p)} · q = {pval(plaPoint?.p_fdr)} · n = {plaPoint?.n ?? "—"}
          </small>
        </div>
        <div className="stat-cell">
          <span className="stat-label">Direct contrast · morphine − placebo</span>
          <b className="stat-value">{pct(point?.difference)}</b>
          <small className="stat-meta">
            p = {pval(point?.p)} · q = {pval(point?.p_fdr)} · n = {point?.n ?? "—"}
          </small>
        </div>
      </div>

      <div className="compare-grid">
        <section className="panel">
          <PlotBox traces={traces} layout={timeLayout} height={290} />
          <div className="panel-note">
            Group mean ± SEM across scans. Dashed vertical line marks {tpLabel}.
          </div>
        </section>

        <section className="panel">
          <PlotBox
            traces={paired}
            layout={{
              title: { text: `Paired participants at ${tpLabel}`, x: 0, xanchor: "left", font: { size: 12 } },
              xaxis: { title: { text: "Participant" }, gridcolor: COLORS.grid, zeroline: false },
              yaxis: { title: { text: `${metricLabel} (µM)` }, gridcolor: COLORS.grid, zeroline: true, zerolinecolor: "#cbd5e1" },
            }}
            height={290}
          />
          <div className="panel-note">
            Each line pairs one subject across morphine and placebo visits. Note: run order assumes
            chronological acquisition.
          </div>
        </section>
      </div>
    </div>
  );
}
