/**
 * General tab — Cursor usage + session token, the agent **workflow runner**
 * (model + prompts + keep-tiles + Run/Reconnect), and a live log.
 */
import React, { useEffect, useRef, useState } from "react";
import { post } from "../vscode";
import type { DebugEntry, UsageData } from "../types";
import { DEFAULT_WORKFLOW_MODEL, WORKFLOW_MODELS } from "../workflowModels";
import { BrandHeader } from "./Header";

export interface WorkflowLine {
  stream: "stdout" | "stderr";
  line: string;
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function GeneralTab(props: {
  usage: UsageData | null;
  loading: boolean;
  tokenInjected: boolean;
  /** Shared pool spawn model (also used by Add agent / Fill / keep-N). */
  workflowModel: string;
  onModelChange: (model: string) => void;
  workflowRunning: boolean;
  workflowOutput: WorkflowLine[];
  onClearWorkflowOutput: () => void;
  debugLog: DebugEntry[];
  onClearDebugLog: () => void;
  version: string;
  onOpenConsole: () => void;
}): JSX.Element {
  const {
    usage,
    loading,
    tokenInjected,
    workflowModel,
    onModelChange,
    workflowRunning,
    workflowOutput,
    onClearWorkflowOutput,
    debugLog,
    onClearDebugLog,
    version,
    onOpenConsole,
  } = props;

  const [token, setToken] = useState("");
  // The model is shared (App owns it, host persists it) so Add agent / Fill /
  // keep-N all spawn with the same model the dropdown shows.
  const model = workflowModel || DEFAULT_WORKFLOW_MODEL;
  const [keepTiles, setKeepTiles] = useState(true);
  const outRef = useRef<HTMLPreElement | null>(null);
  const dbgRef = useRef<HTMLPreElement | null>(null);

  // Keep the debug log scrolled to the newest line.
  useEffect(() => {
    if (dbgRef.current) {
      dbgRef.current.scrollTop = dbgRef.current.scrollHeight;
    }
  }, [debugLog]);

  // Keep the log scrolled to the newest line.
  useEffect(() => {
    if (outRef.current) {
      outRef.current.scrollTop = outRef.current.scrollHeight;
    }
  }, [workflowOutput]);

  const runWorkflow = () => {
    post({
      type: "runWorkflow",
      model: model.trim() || undefined,
      keepTiles,
    });
  };

  const reconnectWorkflow = () => {
    post({
      type: "reconnectWorkflow",
      model: model.trim() || undefined,
    });
  };

  return (
    <div className="general-tab">
      {/* ── Brand header (moved here from the footer) ── */}
      <BrandHeader version={version} onOpenConsole={onOpenConsole} />

      {/* ── Agent workflow runner ── */}
      <div className="workflow-card">
        <div className="workflow-head">
          <span className="workflow-title">Agent workflow</span>
          <span
            className={"workflow-status" + (workflowRunning ? " on" : " off")}
          >
            {workflowRunning ? "Running" : "Idle"}
          </span>
        </div>

        <div className="workflow-row">
          <select
            className="workflow-model-select"
            value={model}
            disabled={workflowRunning}
            onChange={(e) => onModelChange(e.target.value)}
            title="Model the pool spawns with — Add agent, Fill and Keep-N all use this"
          >
            {WORKFLOW_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label
            className="workflow-keep-tiles"
            title="Keep already-open tiles so repeated spawns accumulate agents"
          >
            <input
              type="checkbox"
              checked={keepTiles}
              disabled={workflowRunning}
              onChange={(e) => setKeepTiles(e.target.checked)}
            />
            Keep agents
          </label>
        </div>

        <div className="workflow-row">
          {workflowRunning ? (
            <button
              className="btn btn-danger btn-small"
              onClick={() => post({ type: "stopWorkflow" })}
            >
              Stop
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary btn-small"
                onClick={runWorkflow}
              >
                Run
              </button>
              <button
                className="btn btn-secondary btn-small"
                onClick={reconnectWorkflow}
                title="Re-prime a dropped tile in place to rebuild the MCP loop"
              >
                Reconnect
              </button>
            </>
          )}
        </div>

        {workflowOutput.length > 0 && (
          <>
            <pre className="workflow-output" ref={outRef}>
              {workflowOutput.map((l, i) => (
                <div
                  key={i}
                  className={
                    "workflow-line" + (l.stream === "stderr" ? " err" : "")
                  }
                >
                  {l.line}
                </div>
              ))}
            </pre>
            <div className="workflow-row workflow-row-end">
              <button
                className="btn btn-secondary btn-small"
                onClick={onClearWorkflowOutput}
              >
                Clear output
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Cursor usage (kept) ── */}
      <div className="inject-status">
        <span
          className={"inject-status-dot" + (tokenInjected ? " on" : " off")}
        />
        <span>{tokenInjected ? "Token injected" : "No token"}</span>
        {tokenInjected ? (
          <button
            className="btn btn-secondary btn-small"
            onClick={() => post({ type: "clearInjectedToken" })}
          >
            Clear
          </button>
        ) : (
          <>
            <input
              className="card-input"
              placeholder="Paste session token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="btn btn-primary btn-small"
              disabled={!token.trim()}
              onClick={() => post({ type: "injectToken", token: token.trim() })}
            >
              Inject
            </button>
          </>
        )}
        <button
          className="btn btn-secondary btn-small"
          onClick={() => post({ type: "fetchUsage" })}
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="usage-loading">
          <div className="usage-spinner" />
          <span>Loading usage…</span>
        </div>
      )}

      {!loading && usage && !usage.success && (
        <div className="usage-error">
          <div className="usage-error-icon">!</div>
          <span>{usage.error || "Failed to load usage"}</span>
        </div>
      )}

      {!loading && usage && usage.success && (
        <div className="usage-header-card">
          <div className="usage-header-top">
            <div className="usage-header-info">
              {usage.email && (
                <div className="usage-email-row">
                  <span className="usage-email">{usage.email}</span>
                </div>
              )}
              {usage.membershipType && (
                <span className="usage-member-badge">{usage.membershipType}</span>
              )}
            </div>
          </div>

          {usage.isUnlimited ? (
            <span className="usage-unlimited-badge">Unlimited</span>
          ) : (
            <UsageProgress used={usage.used} limit={usage.limit} />
          )}
        </div>
      )}

      {/* ── Debug log ── */}
      <div className="debug-card">
        <div className="debug-head">
          <span className="debug-title">Debug log</span>
          <span className="debug-count">{debugLog.length}</span>
          <div className="debug-actions">
            <button
              className="btn btn-secondary btn-small"
              disabled={debugLog.length === 0}
              onClick={() => {
                const text = debugLog
                  .map((e) => `${fmtClock(e.ts)} [${e.level}] ${e.line}`)
                  .join("\n");
                navigator.clipboard?.writeText(text).catch(() => {});
              }}
              title="Copy the whole debug log"
            >
              Copy
            </button>
            <button
              className="btn btn-secondary btn-small"
              disabled={debugLog.length === 0}
              onClick={onClearDebugLog}
              title="Clear the debug log"
            >
              Clear
            </button>
          </div>
        </div>
        {debugLog.length === 0 ? (
          <div className="debug-empty">
            No events yet — agent connects, drops, self-heals, spawns and reaps
            will show up here.
          </div>
        ) : (
          <pre className="debug-output" ref={dbgRef}>
            {debugLog.map((e, i) => (
              <div key={i} className={"debug-line " + e.level}>
                <span className="debug-time">{fmtClock(e.ts)}</span>
                <span className="debug-msg">{e.line}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

function UsageProgress(props: { used?: number; limit?: number }): JSX.Element | null {
  const { used, limit } = props;
  if (used == null || !limit) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="usage-progress-card">
      <div className="usage-progress-header">
        <span className="usage-progress-label">
          {used} / {limit}
        </span>
        <span className="usage-progress-pct">{pct}%</span>
      </div>
    </div>
  );
}
