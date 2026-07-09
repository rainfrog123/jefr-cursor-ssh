#!/usr/bin/env python3
"""Thin wrapper: re-prime a dropped tile via workflow.py --reconnect.

--reconnect implies skip-auto (agent id already known — no Auto stand-by).
Selects --model on the existing tile, then MCP-primes.
"""
import argparse
import os
import subprocess
import sys


def main():
    ap = argparse.ArgumentParser(
        description="Re-prime a dropped tile's MCP loop (workflow.py --reconnect)"
    )
    ap.add_argument("--enter-interval", type=float, default=0)
    ap.add_argument("--max-secs", type=float, default=6000.0)
    ap.add_argument("--type-text", default=None)
    ap.add_argument(
        "--model",
        default=None,
        help="Model to select on the tile (default: workflow.py DEFAULT_MODEL)",
    )
    ap.add_argument("--tile", type=int, default=None)
    ap.add_argument("--agent-id", dest="agent_id", default=None)
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(here, "workflow.py")
    cmd = [sys.executable, script, "--reconnect"]
    if args.model:
        cmd += ["--model", args.model]
    if args.tile is not None:
        cmd += ["--tile", str(args.tile)]
    if args.agent_id:
        cmd += ["--agent-id", args.agent_id]
    if args.type_text:
        cmd += ["--type-text", args.type_text]
    if args.enter_interval:
        cmd += ["--enter-interval", str(args.enter_interval)]
    if args.max_secs != 6000.0:
        cmd += ["--max-secs", str(args.max_secs)]

    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    raise SystemExit(subprocess.call(cmd, cwd=here, env=env))


if __name__ == "__main__":
    main()
