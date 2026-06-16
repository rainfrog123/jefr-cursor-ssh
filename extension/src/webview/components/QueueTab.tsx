/**
 * Queue tab: pending items the user has queued for the agent. Supports
 * inline editing of text items, deleting one item, or clearing all.
 */
import React, { useState } from "react";
import { post } from "../vscode";
import type { QueueItem } from "../types";

export function QueueTab(props: { queue: QueueItem[] }): JSX.Element {
  const { queue } = props;

  if (queue.length === 0) {
    return (
      <div className="queue-tab">
        <div className="queue-empty">
          <div className="queue-empty-icon">∅</div>
          <div className="queue-empty-title">Queue is empty</div>
          <div className="queue-empty-hint">Messages you queue appear here.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="queue-tab">
      <div className="queue-tab-toolbar">
        <span className="queue-tab-count">{queue.length} items</span>
        <button className="btn-danger-outline" onClick={() => post({ type: "clearQueue" })}>
          Clear all
        </button>
      </div>
      <div className="queue-tab-list">
        {queue.map((item) => (
          <QueueRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function QueueRow(props: { item: QueueItem }): JSX.Element {
  const { item } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content || "");

  const save = () => {
    post({ type: "updateQueueItem", id: item.id, content: draft });
    setEditing(false);
  };

  return (
    <div className="queue-tab-item">
      <div className="queue-tab-item-top">
        <span className="queue-type-badge">{item.type.toUpperCase()}</span>
        <span className="queue-tab-time">{formatTime(item.timestamp)}</span>
      </div>

      <div className="queue-tab-item-body">
        {editing ? (
          <textarea
            className="queue-edit-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <div className="queue-tab-item-content">
            {item.type === "text" ? item.content : item.name || item.path}
          </div>
        )}
      </div>

      <div className="queue-tab-item-actions">
        {item.type === "text" &&
          (editing ? (
            <button className="btn btn-primary btn-small" onClick={save}>
              Save
            </button>
          ) : (
            <button className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>
              Edit
            </button>
          ))}
        <button
          className="btn btn-secondary btn-small"
          onClick={() => post({ type: "deleteQueueItem", id: item.id })}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
