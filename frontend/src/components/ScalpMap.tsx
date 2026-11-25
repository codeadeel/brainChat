import { useEffect, useMemo, useRef, useState } from "react";
import type { ChannelMeta } from "../types";

const ROI_COLOR: Record<string, string> = {
  medial_ba10: "#d94a4a",
  left_pfc: "#c27c0e",
  right_s1: "#2f855a",
  short: "#94a3b8",
  other: "#64748b",
};

const ROI_LABEL: Record<string, string> = {
  medial_ba10: "medial BA10",
  left_pfc: "left PFC",
  right_s1: "right S1",
  short: "short",
  other: "other",
};

function valueColor(v: number | undefined) {
  if (v === undefined || !Number.isFinite(v)) return null;
  const mag = Math.min(1, Math.abs(v) / 0.25);
  if (Math.abs(v) < 0.01) return null;
  return v >= 0
    ? `rgba(217, 74, 74, ${0.25 + mag * 0.65})`
    : `rgba(37, 99, 235, ${0.25 + mag * 0.65})`;
}

type Group = "left" | "medial" | "right";

function optodeGroup(name: string): Group {
  const n = Number(name.replace(/[^0-9]/g, ""));
  if (name.startsWith("S")) return n >= 7 ? "right" : n >= 4 ? "medial" : "left";
  if (name.startsWith("D")) {
    if ([9, 10, 11, 12, 19, 20, 21].includes(n)) return "right";
    if ([1, 2, 3, 4, 13, 14].includes(n)) return "left";
  }
  return "medial";
}

const REGION_CONFIG: Record<
  Group,
  {
    cx: number;
    cy: number;
    box: { x: number; y: number; w: number; h: number; rx: number };
    title: string;
    tx: number;
    ty: number;
    tint: string;
    stroke: string;
    titleColor: string;
  }
> = {
  medial: {
    cx: 0,
    cy: -63,
    box: { x: -45, y: -110, w: 90, h: 86, rx: 9 },
    title: "medial BA10",
    tx: 0,
    ty: -100,
    tint: "rgba(220, 38, 38, 0.035)",
    stroke: "rgba(220, 38, 38, 0.22)",
    titleColor: "#b23c3c",
  },
  left: {
    cx: -50,
    cy: 24,
    box: { x: -93, y: -23, w: 86, h: 86, rx: 9 },
    title: "left PFC",
    tx: -50,
    ty: -13,
    tint: "rgba(194, 124, 14, 0.035)",
    stroke: "rgba(194, 124, 14, 0.24)",
    titleColor: "#a1680b",
  },
  right: {
    cx: 48,
    cy: 44,
    box: { x: 5, y: -3, w: 86, h: 86, rx: 9 },
    title: "right S1",
    tx: 48,
    ty: 7,
    tint: "rgba(47, 133, 90, 0.035)",
    stroke: "rgba(47, 133, 90, 0.24)",
    titleColor: "#267049",
  },
};

const PAPER_BA10 = [10, 14, 15, 16];

interface PlacedChannel {
  channel: ChannelMeta;
  x: number;
  y: number;
  labelDy: number;
}

interface Props {
  channels: ChannelMeta[];
  selected: string[];
  values?: Record<string, number>;
  onToggle: (name: string) => void;
}

export default function ScalpMap({ channels, selected, values, onToggle }: Props) {
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const placed = useMemo<PlacedChannel[]>(() => {
    const groups: Record<Group, ChannelMeta[]> = { medial: [], left: [], right: [] };
    for (const c of channels) {
      groups[optodeGroup(c.source)].push(c);
    }
    const out: PlacedChannel[] = [];
    (["medial", "left", "right"] as Group[]).forEach((g) => {
      const cfg = REGION_CONFIG[g];
      const groupChans = groups[g];
      const longs = groupChans.filter((c) => !c.short);
      const shorts = [...groupChans.filter((c) => c.short)].sort((a, b) => a.x_mid - b.x_mid);
      const yVals = longs.map((c) => c.y_mid).sort((a, b) => a - b);
      const splitY = yVals.length ? (yVals[0] + yVals[yVals.length - 1]) / 2 : 0;

      const topLongs = longs.filter((c) => c.y_mid >= splitY).sort((a, b) => a.x_mid - b.x_mid);
      const botLongs = longs.filter((c) => c.y_mid < splitY).sort((a, b) => a.x_mid - b.x_mid);

      topLongs.forEach((c, i) => {
        const offset = (topLongs.length - 1) / 2;
        out.push({
          channel: c,
          x: cfg.cx + (i - offset) * 22,
          y: cfg.cy - 18,
          labelDy: -8.5,
        });
      });
      shorts.forEach((c, i) => {
        const offset = (shorts.length - 1) / 2;
        out.push({
          channel: c,
          x: cfg.cx + (i - offset) * 22,
          y: cfg.cy + 3,
          labelDy: 9.5,
        });
      });
      botLongs.forEach((c, i) => {
        const offset = (botLongs.length - 1) / 2;
        out.push({
          channel: c,
          x: cfg.cx + (i - offset) * 22,
          y: cfg.cy + 24,
          labelDy: 11,
        });
      });
    });
    return out;
  }, [channels]);

  const clampView = (s: number, x: number, y: number) => {
    const svg = svgRef.current;
    if (!svg) return { s, x, y };
    const rect = svg.getBoundingClientRect();
    const maxX = (s - 1) * rect.width;
    const maxY = (s - 1) * rect.height;
    return {
      s,
      x: Math.min(0, Math.max(-maxX, x)),
      y: Math.min(0, Math.max(-maxY, y)),
    };
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        const s2 = Math.min(6, Math.max(1, v.s * factor));
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const u = (mx - v.x) / v.s;
        const w = (my - v.y) / v.s;
        return clampView(s2, mx - u * s2, my - w * s2);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomBy = (k: number) => {
    const svg = svgRef.current;
    setView((v) => {
      const s2 = Math.min(6, Math.max(1, v.s * k));
      const rect = svg ? svg.getBoundingClientRect() : { width: 300, height: 300 };
      const mx = rect.width / 2;
      const my = rect.height / 2;
      const u = (mx - v.x) / v.s;
      const w = (my - v.y) / v.s;
      return clampView(s2, mx - u * s2, my - w * s2);
    });
  };

  const resetView = () => setView({ s: 1, x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setView((v) => clampView(v.s, d.ox + dx, d.oy + dy));
  };
  const onPointerUp = () => {
    if (dragRef.current?.moved) suppressClick.current = true;
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div className="scalp-wrap">
      <div
        ref={wrapRef}
        className={`scalp-zoom-wrap ${dragging ? "dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetView}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
            suppressClick.current = false;
          }
        }}
      >
        <svg
          ref={svgRef}
          viewBox="-132 -144 264 278"
          className="scalp"
          role="img"
          aria-label="Top-down fNIRS probe map"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
            transformOrigin: "0 0",
          }}
        >
          <defs>
            <radialGradient id="headFill" cx="50%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#eef3f9" />
            </radialGradient>
            <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#94a3b8" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* Head seen from above: nose at the top, ears at the sides */}
          <ellipse cx="0" cy="4" rx="118" ry="126" fill="url(#headFill)" stroke="#c7d3e2" strokeWidth="1.5" />
          <path d="M -14 -120 L 0 -136 L 14 -120" fill="#ffffff" stroke="#c7d3e2" strokeWidth="1.4" />
          <path d="M -118 -8 C -130 -4 -130 18 -118 22" fill="none" stroke="#c7d3e2" strokeWidth="1.8" />
          <path d="M 118 -8 C 130 -4 130 18 118 22" fill="none" stroke="#c7d3e2" strokeWidth="1.8" />
          <text x="0" y="-138" textAnchor="middle" className="scalp-front">FRONT</text>
          <text x="-124" y="48" textAnchor="middle" className="scalp-side">L</text>
          <text x="124" y="48" textAnchor="middle" className="scalp-side">R</text>

          {/* Regional mini-grid enclosures */}
          {(["medial", "left", "right"] as Group[]).map((g) => {
            const cfg = REGION_CONFIG[g];
            return (
              <g key={g}>
                <rect
                  x={cfg.box.x}
                  y={cfg.box.y}
                  width={cfg.box.w}
                  height={cfg.box.h}
                  rx={cfg.box.rx}
                  fill={cfg.tint}
                  stroke={cfg.stroke}
                  strokeWidth="0.9"
                  strokeDasharray="3 2"
                />
                <text x={cfg.tx} y={cfg.ty} textAnchor="middle" fill={cfg.titleColor} className="roi-label">
                  {cfg.title}
                </text>
              </g>
            );
          })}

          {/* Non-overlapping mini-grid channel dots */}
          <g>
            {placed.map(({ channel: c, x, y, labelDy }) => {
              const active = selected.includes(c.name);
              const v = values?.[c.name];
              const fill = valueColor(v) ?? (ROI_COLOR[c.roi] ?? ROI_COLOR.other);
              const r = active ? 5.6 : c.short ? 3.8 : 4.8;
              const star = c.paper_index != null && PAPER_BA10.includes(c.paper_index);
              return (
                <g
                  key={`ch-${c.name}`}
                  className="scalp-channel"
                  onClick={() => onToggle(c.name)}
                  opacity={c.good ? 1 : 0.45}
                >
                  <title>
                    {c.name}{c.paper_index ? ` · C${c.paper_index}` : ""} · {ROI_LABEL[c.roi] ?? c.roi}
                    {v !== undefined ? ` · now ${v >= 0 ? "+" : ""}${v.toFixed(3)} µM` : ""}
                    {` · SCI ${c.sci?.toFixed(2) ?? "n/a"}`}
                    {c.good ? "" : " · flagged"}
                    {star ? " · paper BA10 channel" : ""}
                  </title>
                  {active && (
                    <circle
                      cx={x}
                      cy={y}
                      r={r + 3.2}
                      fill="none"
                      stroke="#0f766e"
                      strokeWidth="1.2"
                      strokeDasharray="2 2"
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={fill}
                    stroke={active ? "#0f766e" : "#ffffff"}
                    strokeWidth={active ? 2 : 1.2}
                    filter="url(#soft)"
                  />
                  <text
                    x={x}
                    y={y + labelDy}
                    textAnchor="middle"
                    className={star ? "ch-label star" : "ch-label"}
                  >
                    {c.paper_index != null ? `C${c.paper_index}${star ? "★" : ""}` : "SC"}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="map-controls">
          <button onClick={() => zoomBy(1.3)} title="Zoom in">＋</button>
          <button onClick={() => zoomBy(1 / 1.3)} title="Zoom out">−</button>
          <button onClick={resetView} title="Reset view">⟲</button>
        </div>
      </div>

      <div className="scalp-legend">
        <span><i className="mid-dot" style={{ background: "#d94a4a" }} /> medial BA10</span>
        <span><i className="mid-dot" style={{ background: "#c27c0e" }} /> left PFC</span>
        <span><i className="mid-dot" style={{ background: "#2f855a" }} /> right S1</span>
        <span><i className="mid-dot" style={{ background: "#94a3b8" }} /> short (SC)</span>
        <span><i className="mid-dot" style={{ background: "#d94a4a" }} /> HbO ↑</span>
        <span><i className="mid-dot" style={{ background: "#2563eb" }} /> HbO ↓</span>
        <span><i className="star-mark">★</i> paper BA10</span>
      </div>
    </div>
  );
}
