/**
 * Thin wrapper around the VS Code webview API.
 *
 * `acquireVsCodeApi()` may only be called once per webview document, so we
 * call it here and share the single instance everywhere.
 */
import type { OutboundMessage } from "./types";

interface VsCodeApi {
  postMessage(message: OutboundMessage): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;
try {
  api = acquireVsCodeApi();
} catch {
  // Not running inside a webview (e.g. unit test) — provide a no-op shim.
  api = {
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  };
}

export const vscode = api!;

/** Convenience helper so callers don't import the whole api object. */
export function post(message: OutboundMessage): void {
  vscode.postMessage(message);
}
