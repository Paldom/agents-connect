#!/usr/bin/env bash
# Plays the human: waits until an open question appears on the deploy channel, thinks for a moment, answers "yes".
set -euo pipefail
DEMO_DIR=${DEMO_DIR:?}; THINK=${1:-3}
API=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.DEMO_DIR+"/config.json","utf8")).apiUrl)')
TOKEN=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.env.DEMO_DIR+"/config.json","utf8"));console.log(c.tokens[c.apiUrl])')
for _ in $(seq 1 60); do
  ID=$(curl -sf "$API/v1/messages?channel=deploy&status=open" -H "authorization: Bearer $TOKEN" -H 'x-scope: shop-backend' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a.at(-1)?.id??"")})')
  [ -n "$ID" ] && break
  sleep 1
done
[ -n "$ID" ] || exit 1
sleep "$THINK"
curl -sf "$API/v1/messages/$ID/answer" -H "authorization: Bearer $(cat "$DEMO_DIR/idtoken")" -H 'x-scope: shop-backend' -H 'content-type: application/json' -d '{"value":"yes"}' >/dev/null
