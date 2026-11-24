#!/usr/bin/env bash
# Run the probe matrix: each model at T=0 (seeds 1,2: determinism check) and
# T=0.7 (seeds 1-5: breach rate). Restarts the target per configuration.
set -u
cd "$(dirname "$0")/.."
export RESET_CMD="npm --prefix target run seed --silent"
for MODEL in ${MODELS:-qwen3:8b gpt-oss:20b}; do
  for CFG in "0:1,2" "0.7:1,2,3,4,5"; do
    T=${CFG%%:*}; SEEDS=${CFG#*:}
    pkill -f "node --experimental-sqlite --disable-warning=ExperimentalWarning server.js" 2>/dev/null; sleep 1
    (cd target && OLLAMA_MODEL=$MODEL OLLAMA_TEMPERATURE=$T nohup npm start >/dev/null 2>&1 &)
    for i in $(seq 1 30); do curl -sf localhost:3000/healthz >/dev/null && break; sleep 1; done
    # warm the model so the first scenario doesn't time out on load
    curl -s localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1}}" >/dev/null
    node spike/probe.mjs --model "$MODEL" --temp "$T" --seeds "$SEEDS"
  done
done
pkill -f "node --experimental-sqlite --disable-warning=ExperimentalWarning server.js" 2>/dev/null
echo MATRIX DONE
