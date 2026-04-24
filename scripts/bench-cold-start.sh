#!/usr/bin/env bash
# bench-cold-start.sh — measure cold-isolate WASM instantiate cost.
#
# Each iteration: restart `wrangler dev --local`, wait for "Ready on",
# hit /cold-stats once (brand-new isolate → first ensureWasm() runs),
# kill wrangler. Aggregate wasm_instantiate_ms across N samples.
#
# The workerd-isolate process itself has ~1-2s of miniflare startup
# overhead that production cold-starts don't pay, so we intentionally
# don't measure wall-clock. The in-worker wasm_instantiate_ms number
# is a property of our code (size/complexity of the 5 WASM modules)
# and ports to production.
#
# Usage:
#   scripts/bench-cold-start.sh [N_SAMPLES]  # default 10

set -euo pipefail

SAMPLES="${1:-10}"
PORT="${PORT:-8799}"
WORKER_DIR="examples/minimal-worker"
LOG="/tmp/paleta-coldstart-wrangler.log"
OUT="/tmp/paleta-coldstart-samples.jsonl"

command -v jq >/dev/null   || { echo "jq is required (brew install jq)"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }

: > "$OUT"

echo "cold-start bench: $SAMPLES samples, port $PORT, worker=$WORKER_DIR"

for i in $(seq 1 "$SAMPLES"); do
  printf "[%02d/%02d] " "$i" "$SAMPLES"
  : > "$LOG"

  (cd "$WORKER_DIR" && pnpm exec wrangler dev --port "$PORT" --local > "$LOG" 2>&1) &
  WPID=$!

  # Wait up to 30s for "Ready on"
  deadline=$(( $(date +%s) + 30 ))
  until grep -q "Ready on" "$LOG" 2>/dev/null; do
    if ! kill -0 "$WPID" 2>/dev/null; then
      echo "wrangler died before ready:"
      tail -20 "$LOG"
      exit 1
    fi
    if [ $(date +%s) -gt $deadline ]; then
      echo "timeout waiting for Ready"
      kill "$WPID" 2>/dev/null || true
      exit 1
    fi
    sleep 0.2
  done
  sleep 0.3  # settle

  if ! RESP="$(curl -sf --max-time 30 "http://localhost:$PORT/cold-stats")"; then
    echo "/cold-stats failed:"
    tail -10 "$LOG"
    kill "$WPID" 2>/dev/null || true
    exit 1
  fi

  WASM_MS=$(echo "$RESP" | jq -r '.wasm_instantiate_ms')
  echo "wasm_instantiate=${WASM_MS}ms"
  echo "$RESP" | jq -c '{wasm_instantiate_ms}' >> "$OUT"

  # Wrangler forks workerd which holds the port; kill children first,
  # then the parent, then wait for the port to free.
  pkill -P "$WPID" 2>/dev/null || true
  kill "$WPID" 2>/dev/null || true
  while kill -0 "$WPID" 2>/dev/null; do sleep 0.1; done
  # In case any descendants survived the parent, sweep once more.
  pkill -9 -f "workerd.*--port $PORT" 2>/dev/null || true
  while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do sleep 0.2; done
done

echo
echo "aggregate over $(wc -l < "$OUT" | tr -d ' ') samples:"
jq -s '{
  samples: length,
  wasm_instantiate_ms: {
    min:  ([.[].wasm_instantiate_ms] | min),
    mean: (([.[].wasm_instantiate_ms] | add) / length | . * 1000 | round / 1000),
    p50:  ([.[].wasm_instantiate_ms] | sort | .[(length/2)|floor]),
    p95:  ([.[].wasm_instantiate_ms] | sort | .[(length*0.95)|floor]),
    max:  ([.[].wasm_instantiate_ms] | max)
  }
}' "$OUT"
