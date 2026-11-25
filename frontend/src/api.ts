import type {
  Catalog,
  EvidenceMeta,
  GroupSummary,
  PipelineData,
  RunData,
  UiAction,
} from "./types";

const API = "/api";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const getCatalog = () => json<Catalog>(`${API}/catalog`);

export const getRun = (runId: string, all = true) =>
  json<RunData>(`${API}/run/${encodeURIComponent(runId)}?all=${all ? "true" : "false"}`);

export const getGroup = () => json<GroupSummary>(`${API}/group`);

export const getPipeline = (runId: string, channel?: string) =>
  json<PipelineData>(`${API}/pipeline/${encodeURIComponent(runId)}${channel ? `?channel=${encodeURIComponent(channel)}` : ""}`);

export const getEvidence = (sessionId: string, evidenceId: string) =>
  json<EvidenceMeta>(
    `${API}/evidence/${encodeURIComponent(sessionId)}/${encodeURIComponent(evidenceId)}`,
  );

export interface ChatPayload {
  session_id: string;
  run_id: string;
  playhead: number;
  roi: string;
  channels: string[] | null;
  message: string;
}

export interface ChatHandlers {
  status?: (data: { message: string }) => void;
  tool_call?: (data: { name: string; args: Record<string, unknown> }) => void;
  tool_result?: (data: {
    name: string;
    status?: string | null;
    summary?: string | null;
  }) => void;
  evidence?: (data: EvidenceMeta) => void;
  answer?: (data: { text: string }) => void;
  ui_action?: (data: UiAction) => void;
  citation_warning?: (data: { missing: string[]; known: string[] }) => void;
  error?: (data: { message: string }) => void;
  done?: (data: { session_id: string; evidence: string[] }) => void;
}

/** Minimal SSE-over-fetch parser (POST streaming). */
export async function streamChat(
  payload: ChatPayload,
  handlers: ChatHandlers,
): Promise<void> {
  const res = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      const handler = handlers[event as keyof ChatHandlers] as
        | ((d: unknown) => void)
        | undefined;
      handler?.(data);
    }
  }
}
