#!/usr/bin/env bash
# Prepares a throwaway agent environment against the emulators for the README terminal demo.
# Writes: $DEMO_DIR/config.json (token), $DEMO_DIR/repo/.agents-connect.json (scope), $DEMO_DIR/idtoken (human).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEMO_DIR=${DEMO_DIR:?set DEMO_DIR}
API=${AC_API_URL:-http://127.0.0.1:5001/$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).projects.default)' "$ROOT/.firebaserc")/europe-west1/api}
AUTH=http://127.0.0.1:9099
j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(process.argv[1].split(".").reduce((a,k)=>a?.[k],o)??"")})' "$1"; }
mkdir -p "$DEMO_DIR/repo" "$DEMO_DIR/bin"
ln -sf "$(cd "$(dirname "$0")/../.." && pwd)/bin/aconn.js" "$DEMO_DIR/bin/aconn"
cp "$(dirname "$0")/answer.sh" "$DEMO_DIR/answer.sh"
EMAIL="you+$RANDOM@example.com"
SIGNUP=$(curl -sf "$AUTH/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"demo-password-123\",\"returnSecureToken\":true}")
# the API only serves verified accounts: flip the flag with the emulator's admin bearer, then sign in for a fresh token
curl -sf "$AUTH/identitytoolkit.googleapis.com/v1/accounts:update?key=fake" -H 'authorization: Bearer owner' -H 'content-type: application/json' \
  -d "{\"localId\":\"$(echo "$SIGNUP" | j localId)\",\"emailVerified\":true}" >/dev/null
ID_TOKEN=$(curl -sf "$AUTH/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"demo-password-123\",\"returnSecureToken\":true}" | j idToken)
printf '%s' "$ID_TOKEN" > "$DEMO_DIR/idtoken"
SCOPE_ID=$(curl -sf "$API/v1/scopes" -H "authorization: Bearer $ID_TOKEN" -H 'content-type: application/json' -d '{"name":"shop-backend"}' | j id)
TOKEN=$(curl -sf "$API/v1/tokens" -H "authorization: Bearer $ID_TOKEN" -H 'content-type: application/json' -d "{\"name\":\"deploy-agent\",\"scopes\":[\"$SCOPE_ID\"]}" | j token)
printf '{ "apiUrl": "%s", "tokens": { "%s": "%s" } }\n' "$API" "$API" "$TOKEN" > "$DEMO_DIR/config.json"
printf '{ "scope": "shop-backend" }\n' > "$DEMO_DIR/repo/.agents-connect.json"
# a second agent leaves an event on the build channel
curl -sf "$API/v1/messages" -H "authorization: Bearer $TOKEN" -H 'x-scope: shop-backend' -H 'content-type: application/json' \
  -d '{"channel":"build","kind":"event","body":"build 42 green","data":{"pr":42,"sha":"9f3c1a"}}' >/dev/null
