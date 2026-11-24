#!/usr/bin/env bash
# Run the probe matrix. Restarts the target per (model, temperature).
#   FILE=scenarios.json|variants.json  MODELS="qwen3:8b gpt-oss:20b"  CONFIGS="0:1,2 0.7:1,2,3,4,5"
set -u
cd "$(dirname "$0")/.."
export RESET_CMD="npm --prefix target run seed --silent"
FILE=${FILE:-scenarios.json}
stop_target() { pkill -f "disable-warning=ExperimentalWarning server[.]js" 2>/dev/null; sleep 1; }
for MODEL in ${MODELS:-qwen3:8b gpt-oss:20b}; do
  for CFG in ${CONFIGS:-0:1,2 0.7:1,2,3,4,5}; do
    T=${CFG%%:*}; SEEDS=${CFG#*:}
    stop_target
    (cd target && OLLAMA_MODEL=$MODEL OLLAMA_TEMPERATURE=$T nohup npm start >/dev/null 2>&1 &)
    for i in $(seq 1 30); do curl -sf localhost:3000/healthz >/dev/null && break; sleep 1; done
    curl -s localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1}}" >/dev/null
    node spike/probe.mjs --file "$FILE" --model "$MODEL" --temp "$T" --seeds "$SEEDS"
  done
done
stop_target
echo "MATRIX DONE ($FILE)"
