import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, EvidenceMeta, TraceEntry } from "../types";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  status: string;
  trace: TraceEntry[];
  evidenceById: Record<string, EvidenceMeta>;
  citationWarning: string[] | null;
  suggestions: string[];
  context: string;
  onSend: (text: string) => void;
  onClear: () => void;
  onOpenEvidence: (id: string) => void;
}

function renderInline(
  text: string,
  onOpen: (id: string) => void,
  keyPrefix: string,
): ReactNode[] {
  // Split on [E1] / E1 citations, **bold**, and `code`.
  const tokens = text.split(/(\[E\d+\]|\bE\d+\b|\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((tok, i) => {
    const cite = /^\[?(E\d+)\]?$/.exec(tok);
    if (cite) {
      return (
        <button
          key={`${keyPrefix}-${i}`}
          className="cite"
          onClick={() => onOpen(cite[1])}
          title={`Open evidence ${cite[1]}`}
        >
          {cite[1]}
        </button>
      );
    }
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{renderInline(tok.slice(2, -2), onOpen, `${keyPrefix}b${i}`)}</strong>;
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return <code key={`${keyPrefix}-${i}`} className="inline-code">{tok.slice(1, -1)}</code>;
    }
    return <span key={`${keyPrefix}-${i}`}>{tok}</span>;
  });
}

function FormattedAnswer({ text, onOpen }: { text: string; onOpen: (id: string) => void }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = (idx: number) => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${idx}`} className="md-list">
        {bullets.map((b, j) => (
          <li key={j}>{renderInline(b, onOpen, `li-${idx}-${j}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) {
      flushBullets(idx);
      return;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flushBullets(idx);
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <div key={`h-${idx}`} className="md-heading">
          {renderInline(heading[1], onOpen, `h-${idx}`)}
        </div>,
      );
      return;
    }
    blocks.push(
      <p key={`p-${idx}`} className="md-para">
        {renderInline(line, onOpen, `p-${idx}`)}
      </p>,
    );
  });
  flushBullets(lines.length);
  return <>{blocks}</>;
}

/** Grounded Brain Analyst chat sidebar with markdown formatting, tool trace, and clickable `[E#]` citations. */
export default function ChatPanel({
  messages,
  streaming,
  status,
  trace,
  evidenceById,
  citationWarning,
  suggestions,
  context,
  onSend,
  onClear,
  onOpenEvidence,
}: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, status]);

  const send = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    onSend(text);
    textRef.current?.focus();
  };

  return (
    <section className="chat">
      <div className="chat-head">
        <div>
          <h2>Brain Analyst</h2>
          <div className="chat-sub">Grounded in deterministic fNIRS tools</div>
        </div>
        <div className="chat-head-actions">
          {messages.length > 0 && !streaming && (
            <button className="ghost tiny" onClick={onClear} title="Clear conversation">
              Clear
            </button>
          )}
          <span className={`live-pill ${streaming ? "busy" : ""}`}>
            <i /> {streaming ? "analysing" : "grounded"}
          </span>
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Query the active recording or group comparison. Numbers are computed by the local
              engine and linked to evidence cards.
            </p>
            <div className="suggestions">
              {suggestions.slice(0, 6).map((s) => (
                <button key={s} onClick={() => onSend(s)} disabled={streaming}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "You" : "Analyst"}</div>
            <div className="msg-body">
              {m.role === "assistant" ? (
                <FormattedAnswer text={m.text} onOpen={onOpenEvidence} />
              ) : (
                m.text
              )}
            </div>
            {m.role === "assistant" && !!m.evidence?.length && (
              <div className="msg-evidence">
                {m.evidence.map((id) => (
                  <button key={id} className="evidence-chip" onClick={() => onOpenEvidence(id)}>
                    {evidenceById[id]?.title ? `${id} · ${evidenceById[id].title}` : id}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {streaming && (
          <div className="thinking">
            <span className="spinner" />
            <span>{status || "Working through the analysis…"}</span>
          </div>
        )}

        {citationWarning && (
          <div className="warning">
            The model cited {citationWarning.join(", ")} but that evidence was not in the tool
            results. Treat the citation with caution.
          </div>
        )}

        {!!trace.length && (
          <details className="trace" open={streaming}>
            <summary>
              Tool trace · {trace.length} call{trace.length > 1 ? "s" : ""}
            </summary>
            <div className="trace-list">
              {trace.map((t) => (
                <div key={t.id} className="trace-row">
                  <code>{t.name}</code>
                  <span className={`trace-status ${t.status ?? ""}`}>{t.status ?? "…"}</span>
                  <pre>{JSON.stringify(t.args)}</pre>
                  {t.summary && <div className="trace-summary">{t.summary}</div>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="chat-context">
        <span>Context</span>
        <b>{context}</b>
      </div>

      <div className="chat-input">
        <textarea
          ref={textRef}
          value={input}
          rows={2}
          placeholder="Ask what the brain is showing, or how morphine changed the response…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        <button className="send" onClick={send} disabled={streaming || !input.trim()}>
          Ask
        </button>
      </div>
      <div className="chat-foot">
        Playhead &amp; selected ROI are sent with each question. Replay pauses when you ask.
      </div>
    </section>
  );
}
