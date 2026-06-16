/**
 * Chat tab: the scrollable send/reply history plus the composer (input area
 * with staged attachments, attach + send buttons).
 */
import React, { useRef, useState } from "react";
import { post } from "../vscode";
import type { Attachment, HistoryItem } from "../types";

export function ChatTab(props: {
  history: HistoryItem[];
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
}): JSX.Element {
  return (
    <>
      <History items={props.history} />
      <Composer attachments={props.attachments} setAttachments={props.setAttachments} />
    </>
  );
}

/* ------------------------------- History -------------------------------- */

function History(props: { items: HistoryItem[] }): JSX.Element {
  return (
    <div className="history">
      {props.items.map((item) => (
        <HistoryRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function HistoryRow(props: { item: HistoryItem }): JSX.Element {
  const { item } = props;
  const classes =
    "history-item-v2" +
    (item.kind === "reply" ? " ai-reply" : "") +
    (item.kind === "image" ? " hi-image" : "") +
    (item.kind === "file" ? " hi-file" : "");

  return (
    <div className={classes}>
      <span className="hi-idx">{item.index ?? ""}</span>

      {item.kind === "image" && item.dataUrl ? (
        <div className="hi-media">
          <img className="hi-thumb" src={item.dataUrl} alt={item.name || "image"} />
          {item.caption && <span className="hi-caption">{item.caption}</span>}
        </div>
      ) : item.kind === "file" ? (
        <div className="hi-file">
          <span className="hi-file-badge">FILE</span>
          <span className="hi-file-name">{item.name || item.path}</span>
        </div>
      ) : (
        <span className="hi-text">{item.text}</span>
      )}

      {item.time && <span className="hi-time">{item.time}</span>}

      {/* Files can be re-sent to the agent queue. */}
      {item.kind === "file" && item.path && (
        <button
          className="hi-resend-btn"
          onClick={() => post({ type: "resendFile", path: item.path! })}
        >
          Resend
        </button>
      )}
    </div>
  );
}

/* ------------------------------- Composer ------------------------------- */

function Composer(props: {
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
}): JSX.Element {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim().length > 0 || props.attachments.length > 0;

  const send = () => {
    const trimmed = text.trim();
    if (trimmed) post({ type: "sendText", text: trimmed });

    for (const a of props.attachments) {
      if (a.type === "image" && a.dataUrl) {
        post({ type: "sendPastedImage", dataUrl: a.dataUrl, caption: "" });
      } else {
        post({ type: "resendFile", path: a.path });
      }
    }

    setText("");
    props.setAttachments([]);
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) send();
    }
  };

  return (
    <div className="input-area">
      {props.attachments.length > 0 && (
        <div className="compose-attachments pasted-images">
          {props.attachments.map((a) => (
            <div className="pasted-thumb" key={a.id}>
              {a.type === "image" && a.dataUrl ? (
                <img src={a.dataUrl} alt={a.name} />
              ) : (
                <span className="hi-file-name">{a.name}</span>
              )}
              <button
                className="remove-thumb"
                onClick={() =>
                  props.setAttachments((list) => list.filter((x) => x.id !== a.id))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        className="input-box"
        placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />

      <div className="compose-toolbar">
        <div className="input-actions">
          <button
            className="compose-icon-btn"
            title="Attach file or image"
            onClick={() => post({ type: "pickAttachment" })}
          >
            +
          </button>
        </div>
        <button className="compose-send-btn" disabled={!canSend} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
