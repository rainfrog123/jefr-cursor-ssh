# Reconstructed webview source

This folder is a **reverse-engineered, human-readable reconstruction** of the
React UI that ships minified as `extension/dist/webview.js`.

## Why this exists

The packaged extension only contains the *built* output. `dist/webview.js` was
produced by esbuild with `--minify`, so all names were shortened and whitespace
stripped — it is effectively unreadable. The original TypeScript/React source
(`src/webview/`) was never included in the `.vsix`.

These files restore that source so the UI can be read, understood, and edited.

## How it was reconstructed

The minified bundle itself is not parseable by hand, so the behavior was
recovered from sources that **are** readable:

1. **`dist/extension.js`** (not minified) — the host side of the bridge. It
   defines every message the webview sends and receives, plus the JSON data
   shapes. This is the authoritative contract and is mirrored in `types.ts`.
2. **`dist/webview.css`** — the complete DOM class inventory, which dictates the
   element structure each component renders.
3. **`HOW_IT_WORKS.md`** — the documented architecture, IPC, and flows.
4. **`preview-console.html`** — a sibling standalone console implementing the
   same question/answer logic, used as a logic reference.

## Fidelity / caveats

- This is a **functional reconstruction**: it reproduces the message protocol,
  data shapes, DOM class names, and behavior — not the exact original code.
- Internal variable names, component boundaries, and minor render details of
  the original cannot be recovered from a minified bundle and were chosen for
  clarity here.
- The three runtime enhancements added later (Markdown rendering, header font
  controls, Enter-to-submit) currently live as appended scripts at the bottom
  of `dist/webview.js`; they are intentionally **not** part of this React
  source.

## File map

- `types.ts` — message protocol + data shapes (the bridge contract).
- `vscode.ts` — single shared `acquireVsCodeApi()` wrapper.
- `index.tsx` — mounts `<App/>` into `#root`.
- `App.tsx` — top-level state + inbound message routing + tab layout.
- `components/Header.tsx` — title, version tag, console button.
- `components/QuestionPanel.tsx` — `ask_question` UI (single/multi + Other).
- `components/ChatTab.tsx` — history list + composer (input, attachments).
- `components/QueueTab.tsx` — pending queue (edit / delete / clear).
- `components/UsageTab.tsx` — Cursor usage + token injection.

## Building (reference)

`extension/package.json` already declares the build:

```
npm run compile:webview   # esbuild src/webview/index.tsx --bundle --minify -> dist/webview.js
```

That script also copies `src/webview/webview.css` to `dist/`. The current CSS
lives at `dist/webview.css`; if you want the build to round-trip, copy it to
`src/webview/webview.css` first. Building requires Node.js (not installed in
this environment).
