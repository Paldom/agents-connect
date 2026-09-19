#!/usr/bin/env bash
# End-to-end check against the local emulator suite: human signs in, creates scope + token,
# agent uses the CLI to send/notify/ask, human answers, agent receives the answer.
# Requires: `firebase emulators:start --only auth,firestore,functions` running.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
AUTH=http://127.0.0.1:9099
export AC_API_URL=${AC_API_URL:-http://127.0.0.1:5001/$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).projects.default)' "./.firebaserc")/europe-west1/api}
export AC_CONFIG_DIR=$(mktemp -d)
EMAIL="owner+$RANDOM@example.com"
# Run from a scratch dir so the repo's own .agents-connect.json is neither read nor overwritten.
WORK=$(mktemp -d); cd "$WORK"
AC="node $ROOT/bin/aconn.js"

j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(process.argv[1].split(".").reduce((a,k)=>a?.[k],o)??"")})' "$1"; }

SIGNUP=$(curl -sf "$AUTH/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"returnSecureToken\":true}")
ID_TOKEN=$(echo "$SIGNUP" | j idToken); LOCAL_ID=$(echo "$SIGNUP" | j localId)
H=(-H "authorization: Bearer $ID_TOKEN" -H 'content-type: application/json')
echo "# human: unverified email is rejected, then verify it (emulator admin call)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/scopes" "${H[@]}")
[ "$code" = 403 ] || { echo "expected 403 for unverified email, got $code"; exit 1; }
curl -sf "$AUTH/identitytoolkit.googleapis.com/v1/accounts:update?key=fake" -H 'authorization: Bearer owner' -H 'content-type: application/json' \
  -d "{\"localId\":\"$LOCAL_ID\",\"emailVerified\":true}" >/dev/null
ID_TOKEN=$(curl -sf "$AUTH/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"returnSecureToken\":true}" | j idToken)
H=(-H "authorization: Bearer $ID_TOKEN" -H 'content-type: application/json')
echo "# human: duplicate scope name is a 409"
curl -sf "$AC_API_URL/v1/scopes" "${H[@]}" -d '{"name":"dup"}' >/dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/scopes" "${H[@]}" -d '{"name":"dup"}')
[ "$code" = 409 ] || { echo "expected 409, got $code"; exit 1; }

echo "# human: create scope"
SCOPE_ID=$(curl -sf "$AC_API_URL/v1/scopes" "${H[@]}" -d '{"name":"demo"}' | j id)
echo "# human: create scoped token"
TOKEN=$(curl -sf "$AC_API_URL/v1/tokens" "${H[@]}" -d "{\"name\":\"ci-agent\",\"scopes\":[\"$SCOPE_ID\"]}" | j token)
echo "# human: an agent token must NOT be able to answer or mint tokens"
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/tokens" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"x","scopes":["*"]}')
[ "$code" = 403 ] || { echo "expected 403, got $code"; exit 1; }

echo "# agent: login + whoami"
printf '%s' "$TOKEN" | $AC login
$AC whoami --json | grep -q '"name":"ci-agent"'

echo "# agent: send events, read with cursor"
$AC send build 'started build 42' --data '{"pr":42}' >/dev/null
$AC send build 'build 42 green' >/dev/null
$AC notify build 'Build 42 is green' >/dev/null
sleep 2.2   # settle window: reads exclude messages younger than 2s
OUT=$($AC read build --json)
[ "$(echo "$OUT" | wc -l | tr -d ' ')" = 3 ] || { echo "expected 3 messages, got: $OUT"; exit 1; }
[ -z "$($AC read build --json)" ] || { echo "cursor did not advance"; exit 1; }
$AC send build 'one more' >/dev/null
sleep 2.2
[ "$($AC read build --json | wc -l | tr -d ' ')" = 1 ] || { echo "cursor read failed"; exit 1; }
echo "# agent: --after / --kind reads do not move the saved cursor"
FIRST=$($AC read build --all --json | head -1 | j id)
[ "$($AC read build --after "$FIRST" --json | wc -l | tr -d ' ')" = 3 ] || { echo "--after read failed"; exit 1; }
[ -z "$($AC read build --json)" ] || { echo "--after moved the cursor"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/messages?channel=build&after=not-an-id" -H "authorization: Bearer $TOKEN")
[ "$code" = 400 ] || { echo "expected 400 for bad cursor, got $code"; exit 1; }

echo "# agent: wrong channel name and missing scope are rejected"
$AC send 'Bad Channel' x 2>/dev/null && { echo "expected failure"; exit 1; }
AC_SCOPE=nope $AC channels 2>/dev/null && { echo "expected 404"; exit 1; }

echo "# agent: ask (no wait) → human answers → agent waits"
QID=$($AC ask deploy 'Ship 42 to prod?' --choices 'yes,no,later' --no-wait --json | j id)
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/messages/$QID/answer" "${H[@]}" -H 'x-scope: demo' -d '{"value":"maybe"}')
[ "$code" = 400 ] || { echo "expected 400 for invalid option, got $code"; exit 1; }
curl -sf "$AC_API_URL/v1/messages/$QID/answer" "${H[@]}" -H 'x-scope: demo' -d '{"value":"later"}' >/dev/null
ANSWER=$($AC wait "$QID" --json | j answer.value)
[ "$ANSWER" = later ] || { echo "expected answer 'later', got $ANSWER"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/messages/$QID/answer" "${H[@]}" -H 'x-scope: demo' -d '{"value":"yes"}')
[ "$code" = 409 ] || { echo "expected 409 on double answer, got $code"; exit 1; }

echo "# agent: ask with 2s timeout exits 3 and leaves the question open; cancel it explicitly"
set +e; $AC ask deploy 'Silence?' --timeout 2 --json >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 3 ] || { echo "expected exit 3, got $rc"; exit 1; }
sleep 2.2
OPEN=$($AC read deploy --all --json --kind question | grep '"status":"open"' | tail -1 | j id)
[ -n "$OPEN" ] || { echo "question should still be open"; exit 1; }
$AC cancel "$OPEN" --json | grep -q cancelled
set +e; $AC wait "$OPEN" --timeout 1 >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 0 ] || { echo "wait on a cancelled question should return it (exit 0), got $rc"; exit 1; }

echo "# idempotency: same key returns the earlier message"
A=$($AC send build 'idem' --key k1 --json | j id); B=$($AC send build 'idem' --key k1 --json)
[ "$(echo "$B" | j id)" = "$A" ] && echo "$B" | grep -q '"deduplicated":true' || { echo "idempotency failed"; exit 1; }
echo "# idempotency never replays a resolved question; channel policy applies to get/cancel"
Q1=$($AC ask deploy 'Same question?' --no-wait --json | j id)
Q2=$($AC ask deploy 'Same question?' --no-wait --json | j id); [ "$Q1" = "$Q2" ] || { echo "open question should dedupe"; exit 1; }
curl -sf "$AC_API_URL/v1/messages/$Q1/answer" "${H[@]}" -H 'x-scope: demo' -d '{"value":"yes"}' >/dev/null
Q3=$($AC ask deploy 'Same question?' --no-wait --json | j id); [ "$Q3" != "$Q1" ] || { echo "answered question must not be replayed"; exit 1; }
$AC cancel "$Q3" --reason superseded --json | grep -q '"cancelReason":"superseded"' || { echo "cancel reason missing"; exit 1; }
echo "# pending is read-only until acked"
printf '{ "scope": "demo", "subscribe": ["deploy"] }\n' > .agents-connect.json
S1=$($AC status); S2=$($AC status); [ "$S1" = "$S2" ] || { echo "status consumed answers: $S1 vs $S2"; exit 1; }
echo "$S1" | grep -qE "^aconn: [1-9]" || { echo "expected answers pending: $S1"; exit 1; }
$AC inbox --hook --stop | grep -q '"decision":"block"' || { echo "stop hook JSON missing"; exit 1; }
$AC status | grep -qE "^aconn: 0 answers" || { echo "inbox did not ack answers: $($AC status)"; exit 1; }
rm -f .agents-connect.json
echo "# reply / thread / priority / tag"
R=$($AC reply "$A" 'got it' --tag status --priority low --json)
[ "$(echo "$R" | j replyTo)" = "$A" ] && [ "$(echo "$R" | j thread)" = "$A" ] && [ "$(echo "$R" | j priority)" = low ] || { echo "reply fields failed: $R"; exit 1; }
$AC send build 'bad prio' --priority high 2>/dev/null && { echo "expected priority validation"; exit 1; }
sleep 2.2
[ "$($AC read build --all --thread "$A" --json | wc -l | tr -d ' ')" = 2 ] || { echo "thread filter failed"; exit 1; }
echo "# server-side consumer cursor: read --ack then read again is empty; ack never moves backwards"
$AC send ops 'c1' >/dev/null; $AC send ops 'c2' >/dev/null; sleep 2.2
[ "$($AC read ops --all --ack --json | wc -l | tr -d ' ')" = 2 ] || { echo "ack read failed"; exit 1; }
[ -z "$(curl -sf "$AC_API_URL/v1/messages?channel=ops&consumer=me" -H "authorization: Bearer $TOKEN" | grep -o '"id"')" ] || { echo "consumer cursor not applied"; exit 1; }
FIRST_OPS=$($AC read ops --all --json | head -1 | j id)
$AC ack ops "$FIRST_OPS" --json >/dev/null
[ -z "$(curl -sf "$AC_API_URL/v1/messages?channel=ops&consumer=me" -H "authorization: Bearer $TOKEN" | grep -o '"id"')" ] || { echo "ack moved backwards"; exit 1; }
echo "# pending + status + inbox"
printf '{ "scope": "demo", "subscribe": ["ops", "build"] }\n' > .agents-connect.json
$AC send ops 'c3' >/dev/null; sleep 2.2
$AC status | grep -qE "ops 1" || { echo "status failed: $($AC status)"; exit 1; }
$AC inbox --hook | grep -q 'c3' || { echo "inbox failed"; exit 1; }
$AC status | grep -qE "ops 0" || { echo "inbox did not ack"; exit 1; }
rm -f .agents-connect.json
echo "# agents + channel policy + question rate limit shape"
$AC agents --json | grep -q '"active":true' || { echo "agents failed"; exit 1; }
LIMITED=$(curl -sf "$AC_API_URL/v1/tokens" "${H[@]}" -d "{\"name\":\"limited\",\"scopes\":[\"$SCOPE_ID\"],\"channels\":[\"build*\"]}" | j token)
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/messages" -H "authorization: Bearer $LIMITED" -H 'content-type: application/json' -d '{"channel":"ops","body":"x"}')
[ "$code" = 403 ] || { echo "channel policy: expected 403, got $code"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/messages" -H "authorization: Bearer $LIMITED" -H 'content-type: application/json' -d '{"channel":"build-2","body":"x"}')
[ "$code" = 200 ] || { echo "channel policy: expected 200, got $code"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/messages/$QID" -H "authorization: Bearer $LIMITED" -H 'x-scope: demo')
[ "$code" = 403 ] || { echo "channel policy on get: expected 403, got $code"; exit 1; }
echo "# answer via header + delivery field"
QID2=$($AC ask deploy 'Via?' --no-wait --json | j id)
curl -sf "$AC_API_URL/v1/messages/$QID2/answer" "${H[@]}" -H 'x-scope: demo' -H 'x-client: ios' -d '{"value":"yes"}' | grep -q '"via":"ios"' || { echo "via failed"; exit 1; }
$AC get "$QID2" --json | grep -q '"delivery"' || { echo "delivery field missing"; exit 1; }
echo "# mcp: tools/list over stdio"
AC_TOKEN=$TOKEN AC_SCOPE=demo ROOT=$ROOT node -e '
const req = require("module").createRequire(process.env.ROOT + "/package.json");
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");
(async () => {
  const c = new Client({ name: "e2e", version: "0" });
  await c.connect(new StdioClientTransport({ command: "node", args: [process.env.ROOT + "/bin/aconn.js", "mcp"], env: process.env }));
  const t = await c.listTools();
  const names = t.tools.map(x => x.name).sort().join(",");
  if (!names.includes("ask_human") || !names.includes("send_event") || !names.includes("list_scopes") || !names.includes("reply") || !names.includes("list_agents")) throw new Error(names);
  const r = await c.callTool({ name: "list_channels", arguments: {} });
  if (!JSON.stringify(r).includes("deploy")) throw new Error(JSON.stringify(r));
  if (!r._meta || !r._meta["agents-connect/pending"]) throw new Error("no pending _meta: " + JSON.stringify(r).slice(0, 200));
  await c.close(); console.log("mcp ok:", names);
})().catch(e => { console.error(e); process.exit(1) })'
echo "# channels + revoke"
LIMITED_WAKE=$(curl -sf "$AC_API_URL/v1/tokens" "${H[@]}" -d "{\"name\":\"waker\",\"scopes\":[\"$SCOPE_ID\"]}" | j token)
$AC channels --json | grep -q '"name":"deploy"'
HASH=$(curl -sf "$AC_API_URL/v1/tokens" "${H[@]}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(t=>t.name==="ci-agent").id))')
curl -sf -X DELETE "$AC_API_URL/v1/tokens/$HASH" "${H[@]}" >/dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' "$AC_API_URL/v1/whoami" -H "authorization: Bearer $TOKEN")
[ "$code" = 401 ] || { echo "revoked token still works: $code"; exit 1; }
echo "# mcp channel mode: capability + push of a subscribed channel message"
printf '{ "scope": "demo", "subscribe": ["wake"] }\n' > .agents-connect.json
AC_TOKEN=$LIMITED_WAKE AC_SCOPE=demo ROOT=$ROOT node -e '
const req = require("module").createRequire(process.env.ROOT + "/package.json");
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");
const { z } = req("zod");
(async () => {
  const c = new Client({ name: "e2e", version: "0" }, { capabilities: {} });
  const got = new Promise((res) => c.setNotificationHandler(z.object({ method: z.literal("notifications/claude/channel"), params: z.any() }), (n) => res(n.params)));
  await c.connect(new StdioClientTransport({ command: "node", args: [process.env.ROOT + "/bin/aconn.js", "mcp", "--channel"], env: process.env }));
  const caps = c.getServerCapabilities();
  if (!caps.experimental || !caps.experimental["claude/channel"] || !caps.experimental["claude/channel/permission"]) throw new Error("missing channel capability: " + JSON.stringify(caps));
  await c.callTool({ name: "send_event", arguments: { channel: "wake", body: "wake up", data: { n: 1 } } });
  const n = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("no channel notification within 25s")), 25000))]);
  if (!String(n.content).includes("wake up") || n.meta.channel !== "wake" || n.meta.kind !== "event") throw new Error(JSON.stringify(n));
  await c.close(); console.log("channel mode ok:", JSON.stringify(n.meta));
})().catch(e => { console.error(e); process.exit(1) })'
rm -f .agents-connect.json

echo "E2E OK"
