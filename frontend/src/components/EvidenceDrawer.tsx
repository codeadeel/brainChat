import { useEffect } from "react";
import type { EvidenceMeta } from "../types";

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Math.abs(value) < 0.0001 && value !== 0) return value.toExponential(2);
    return Number(value.toFixed(4)).toString();
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return value.join(", ");
    return JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function flatten(obj: unknown, prefix = ""): [string, string][] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== "object") return [[prefix || "value", fmt(obj)]];
  if (Array.isArray(obj)) {
    if (obj.every((v) => typeof v !== "object" || v === null)) {
      return [[prefix || "value", fmt(obj)]];
    }
    return [[prefix || "value", JSON.stringify(obj)]];
  }
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
    } else {
      out.push([prefix ? `${prefix}.${k}` : k, fmt(v)]);
    }
  }
  return out;
}

/** Slide-over Evidence Drawer displaying generated figures, exact stats, preprocessing method, and caveats. */
export default function EvidenceDrawer({
  evidence,
  onClose,
}: {
  evidence: EvidenceMeta | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!evidence) return null;
  const rows = flatten(evidence.stats ?? {}).filter(
    ([k]) => !k.startsWith("per_subject") && !k.includes("channels") && !k.includes("excluded"),
  );

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Evidence · {evidence.id}</div>
            <h2>{evidence.title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close evidence">
            ✕
          </button>
        </div>
        <div className="drawer-scroll">
          {evidence.summary && <p className="drawer-summary">{evidence.summary}</p>}
          {evidence.figure_url && (
            <figure className="drawer-figure">
              <img src={evidence.figure_url} alt={`Evidence figure ${evidence.id}`} />
            </figure>
          )}
          {!!rows.length && (
            <section>
              <h3>Computed values</h3>
              <table className="stats">
                <tbody>
                  {rows.map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {evidence.method && (
            <section>
              <h3>Method</h3>
              <p>{evidence.method}</p>
            </section>
          )}
          {!!evidence.caveats?.length && (
            <section>
              <h3>Caveats</h3>
              <ul>
                {evidence.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
