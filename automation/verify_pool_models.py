#!/usr/bin/env python3
"""CDP-verify every pool model row can be selected on the live picker."""
import json
import os
import sys

import cdp

# Fallback pool labels (UI prefers live picker via Refresh Models).
POOL_MODELS = [
    "Composer 2.5 Fast",
    "Opus 4.8 1M Extra High Fast",
    "GPT-5.5 Extra High Fast",
    "Fable 5 1M High",
    "GLM 5.2 High",
]


def js_bundle(*names, **subs):
    js = cdp.js_bundle("layout.js", "tile_status.js", "tile_helpers.js", *names)
    for key, val in subs.items():
        js = js.replace(key, str(val))
    return js


def eval_js(ws, js, await_promise=True):
    res, _ = cdp.evaluate(ws, js, await_promise=await_promise, want_console=False)
    return res.get("result", {}).get("value")


def main():
    ws, page = cdp.find_workbench()
    if not ws:
        print("ERROR: no CDP workbench")
        sys.exit(3)
    print(f"# page: {page.get('title', '')[:60]}")

    list_js = open(
        os.path.join(os.path.dirname(__file__), "list_models.js"),
        encoding="utf-8",
    ).read().replace("__TILE__", "-1")
    listed = eval_js(ws, list_js, await_promise=True) or {}
    print("picker rows:", json.dumps(listed, indent=2))

    live = set(listed.get("models") or [])
    pool_rows = [m for m in POOL_MODELS if m.lower() != "auto"]
    missing = [
        m
        for m in pool_rows
        if not any(m.lower() in row.lower() or row.lower() in m.lower() for row in live)
    ]
    if missing:
        print("WARN: pool models not found in live picker:", missing)

    verify = eval_js(
        ws,
        js_bundle(
            "verify_pool_models.js",
            __TARGETS__=json.dumps(POOL_MODELS),
            __AGENT_ID__=json.dumps(None),
        ),
        await_promise=True,
    )
    print("select verify:", json.dumps(verify, indent=2)[:4000])

    if not verify or verify.get("error"):
        sys.exit(1)
    if not verify.get("ok"):
        failed = [r for r in verify.get("results", []) if not r.get("ok") and r.get("error")]
        print("FAILED selections:", json.dumps(failed, indent=2))
        sys.exit(1)
    print("OK: all pool models selectable")


if __name__ == "__main__":
    main()
