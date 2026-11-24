#!/usr/bin/env bash
# Kane green, reduced plan (15 credits left; one agent run of the e2 objective cost 87.4).
#
#   1. The fixed store runs under the e2 policy (60 days), qwen3:8b at T0.
#   2. The e2 conversation runs in the probe, through /api/chat: the endpoint the chat
#      widget posts to. Labelled "probe" wherever it appears.
#   3. Free pre-check: /orders must already show 1042 REFUNDED, or no credits are spent.
#   4. Kane reads /orders as Ana in --analyzer-only mode: no agent steps, one verdict per
#      condition on run_end. Condition 3 is a negative control: the old copy (30 days)
#      must judge false.
#   5. The credit balance is logged before and after.
#
# Usage: [OUT=<dir>] kane/green-read.sh [--precheck-only]
set -u
cd "$(dirname "$0")/.."
OUT=${OUT:-evidence/kane/green-read}   # set OUT to keep a new take apart from the committed record
mkdir -p "$OUT"
PATTERN="disable-warning=ExperimentalWarning server[.]js"
FIX=5652674

pkill -f "$PATTERN" 2>/dev/null; sleep 1
(cd target && OLLAMA_MODEL=qwen3:8b OLLAMA_TEMPERATURE=0 OLLAMA_NUM_PARALLEL=1 nohup npm start >/dev/null 2>&1 &)
for i in $(seq 1 30); do curl -sf localhost:3000/healthz >/dev/null && break; sleep 1; done
curl -s localhost:11434/api/generate -d '{"model":"qwen3:8b","prompt":"hi","stream":false,"options":{"num_predict":1}}' >/dev/null

{
  echo "date: $(date -u +%FT%TZ)"
  echo "HEAD: $(git rev-parse --short HEAD)"
  echo "fix commit: $FIX"
  echo "code diff since fix (target/src, target/public): $(git diff $FIX -- target/src target/public | wc -l) lines"
  echo "policy.md §2: $(grep -o 'within \*\*[0-9]* days' target/policy.md)"
  echo "kane-cli: $(kane-cli --version 2>/dev/null | head -1)"
  echo "model: qwen3:8b T0 seed 1 ($(ollama list | awk '$1=="qwen3:8b"{print $2}'))"
} > "$OUT/context.txt"

# 2. the conversation (probe)
rm -f "$OUT"/after-edit-e2_qwen3_8b_T0.jsonl
RESET_CMD="npm --prefix target run seed --silent" OUT_DIR="$OUT" \
  node spike/probe.mjs --file checks/after-edit-e2.json --model qwen3:8b --temp 0 --seeds 1 --only a2-refund-1042 | tee "$OUT/probe.log"

# 3. free pre-check of what the customer sees
COOKIE=$(curl -s -o /dev/null -D - localhost:3000/login-as/cust-ana | awk -F'[ ;]' 'tolower($1)=="set-cookie:"{print $2}')
curl -s -H "cookie: $COOKIE" localhost:3000/orders > "$OUT/orders-after-probe.html"
curl -s -H "cookie: $COOKIE" localhost:3000/account/ledger > "$OUT/ledger-after-probe.html"
node -e '
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const t = strip(require("fs").readFileSync(process.argv[1], "utf8"));
const copy = (t.match(/Refunds are available within \d+ days[^.]*\./) || [""])[0];
const row = (t.match(/1042.{0,200}/) || [""])[0];
const refunded = /1042[\s\S]{0,200}REFUNDED/i.test(t);
console.log(JSON.stringify({ copy, refunded, row1042: row.slice(0, 160) }));
process.exit(refunded && /within 60 days/.test(copy) ? 0 : 1);
' "$OUT/orders-after-probe.html" | tee "$OUT/precheck.json"
PRE=${PIPESTATUS[0]}
if [ "$PRE" != 0 ]; then echo "PRECHECK FAILED: no Kane credits spent"; exit 1; fi
[ "${1:-}" = "--precheck-only" ] && { echo "precheck ok (Kane not run)"; exit 0; }

# 4. Kane reads /orders
kane-cli balance > "$OUT/balance-before.txt" 2>&1
kane-cli run --analyzer-only --agent --headless \
  --url http://localhost:3000/login-as/cust-ana \
  --condition "Order 1042 has status REFUNDED." \
  --condition "The text near the top of the page says refunds are available within 60 days of delivery." \
  --condition "The text near the top of the page says refunds are available within 30 days of delivery." \
  --timeout 300 < /dev/null > "$OUT/run.ndjson" 2> "$OUT/run.stderr"
echo "kane exit: $?" | tee "$OUT/exit.txt"
kane-cli balance > "$OUT/balance-after.txt" 2>&1
cat "$OUT/balance-before.txt" "$OUT/balance-after.txt"
pkill -f "$PATTERN" 2>/dev/null
