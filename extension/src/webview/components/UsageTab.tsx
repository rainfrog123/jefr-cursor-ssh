/**
 * Usage tab: shows Cursor usage info. Reads an optional injected token so the
 * host can query usage on the user's behalf.
 */
import React, { useState } from "react";
import { post } from "../vscode";
import type { UsageData } from "../types";

export function UsageTab(props: {
  usage: UsageData | null;
  loading: boolean;
  tokenInjected: boolean;
}): JSX.Element {
  const { usage, loading, tokenInjected } = props;
  const [token, setToken] = useState("");

  return (
    <div className="usage-tab">
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
