/**
 * Webview entry point.
 *
 * The extension host serves an HTML shell containing `<div id="root">` and
 * loads the built `webview.js`. This file mounts the React app into that root.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
