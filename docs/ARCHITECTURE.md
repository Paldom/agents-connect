# Architecture

Firebase backend, one HTTP function, a thin web client and a CLI. Two rounds of flagship-model review and a research pass on agent wake surfaces, approval design and Firebase cost shaped the decisions below.

## Concepts

| Term | Meaning |
|---|---|
| Scope | A namespace owned by one user, e.g. `myapp-prod`. A repo may point at any scope through `.agents-connect.json`; one user may own many. |
| Channel | A named stream inside a scope (`build`, `deploy`, `ops`, `permissions`). Every message has exactly one. Reads must name it. |
| Event | Agent-to-agent message. Fan-out: every reader sees every event after its own cursor. No consume, no ack semantics beyond cursors. |
| Notice | Human notification (push + email). No answer expected. |
| Question | Human notification that expects an answer: `confirm` (yes/no), `choice` (one of 2–20 options), `text`. |
| Thread | Optional grouping key; replies carry `replyTo` and inherit the thread, which defaults to the root message id. |
| Token | `ac_` + 32 random bytes. Only the SHA-256 hash is stored. Bound to scope ids or `*`, optionally to channel patterns. |
| Consumer | A named server-side cursor per channel (`token:<hash>` by default), so stateless agents resume where they left off. |

## Data (Firestore)

```
users/{uid}                    { emailNotifications?, fcmTokens?, mute?: { "<scopeId>/<channel>": Timestamp } }  ← only client-writable doc
scopes/{id}                    { name, ownerUid, createdAt }                     id = sha256(ownerUid/name)[0:28]
scopes/{id}/channels/{name}    { name, ownerUid, lastMessageAt, last, lastPushAt, suppressed }
scopes/{id}/messages/{ulid}    { ownerUid, channel, kind, from, body, data?, replyTo?, thread?, priority?, tag?,
                                 question?, status?, answer?, cancelReason?, delivery?, createdAt, expiresAt }
scopes/{id}/keys/{sha256}      { messageId, createdAt }                          idempotency records
scopes/{id}/consumers/{c__n}   { consumer, channel, lastId, updatedAt }          durable cursors; `_<consumer>` holds lastPendingAt
tokens/{sha256}                { uid, name, prefix, scopes, channels?, createdAt, lastUsedAt }
```

Message ids are ULIDs minted by the function, so id order is creation order and the id doubles as the cursor. `ownerUid` is denormalised onto channels and messages so security rules need no extra reads. `data` is a JSON string excluded from indexing. `expiresAt` is `createdAt` + 90 days for a TTL policy (retention, not enforcement: expired rows can linger up to a day).

## Single writer

The `api` function (Node 22, `europe-west1`, reachable as `/api/**` through Hosting) is the only writer. The web app reads Firestore directly with realtime listeners; rules allow reads where `ownerUid == auth.uid` and deny client writes except `users/{uid}`. Every request reads the token document and the scope document; there is no cache, so revocation is immediate on every instance.

Two kinds of bearer token:

- `ac_…` agent tokens: publish events, notices and questions (within their channel policy); read; ack cursors; cancel questions with a reason. Never answer, never mint tokens.
- Firebase ID tokens (humans, verified email required, optionally allow-listed): everything above plus answer, create/delete scopes, create/revoke tokens.

Answers run in a transaction with an `open → answered` precondition, so a second device gets `409`. `from`, `answer.by`, `answer.via` and `cancelledBy` are set server-side.

## Idempotency and terminal states

`POST /messages` with an idempotency key (scoped to scope + sender + channel) returns the earlier message while it is a still-open question, or, for events and notices, while it is younger than 24 hours. A resolved question is never replayed: a re-ask after the human answered creates a new question rather than inheriting the old approval. The key record is created in the same batch as the message, so two concurrent identical requests produce one message. The CLI and MCP server derive a key for `ask` from channel, body and question so a shell-tool retry re-attaches instead of asking twice.

Questions end in exactly one of: `answered` (with the value), or `cancelled` with `cancelReason` `cancelled` (the asker withdrew it), `expired` (nobody answered inside the relay window; the terminal decided) or `superseded`. "Nobody was there" is never rendered as a denial.

## Reads, cursors and waiting

No long-polling. `aconn read --follow`, `aconn ask`, `aconn wait` and the MCP channel loop poll with a backoff that caps at 10–30 s and retry transient errors. Cursor reads exclude messages younger than 2 s, so a write that commits late on another instance never lands behind a cursor that already moved past it. Cursors are either client-side files (one per hub/scope/channel) or server-side consumer documents advanced by `ack`; `read_messages` in the MCP server uses the latter by default. `GET /pending` answers "what should I look at" in one call: questions of this sender resolved after the consumer's watermark (`resolvedAt`) and unread counts per subscribed channel, computed with count aggregations. It is read-only; only callers that actually deliver the answers (`aconn inbox`, the channel loop) pass `ack=1`, which moves the watermark to the newest resolution returned. Status lines and the MCP `_meta` indicator never consume anything.

## Notifications

After the write has committed, the function decides per message:

- questions and `urgent` notices: push to every device token (`apns-priority: 10`, `Urgency: high`, FCM `high`) with a `category` equal to the question type so a native client can offer one-tap answers, plus email when SMTP is configured; each question gets its own web-push tag so decisions never collapse into one another;
- `normal` notices: at most one push per channel per minute; later ones increment a counter and the next push says "N new notices";
- `low` notices and muted channels (`users.mute`): inbox only.

Failures are logged and never fail the request; what was attempted is stored in `delivery`. Push is an attention signal, Firestore is the record: the web app re-reads open questions on start and reconnect.

## Agent wake paths

1. **Claude Code channel mode.** `aconn mcp --channel` declares `experimental["claude/channel"]` and `experimental["claude/channel/permission"]`, polls `/pending` for the subscribed channels and the session's own questions, and emits `notifications/claude/channel` per message (which wakes an idle session). Permission prompts arrive as `notifications/claude/channel/permission_request` and become `confirm` questions on channel `permissions` (`priority: urgent`, key `perm:<request_id>`); the human's answer is emitted as `notifications/claude/channel/permission` with `behavior: allow | deny`. After 10 minutes without an answer the question is cancelled as `expired` and the terminal dialog decides. The MCP SDK is pinned because the 2026-07-28 protocol revision silently stops channel registration.
2. **Claude Code hooks** (no allowlist needed; written per project into `.claude/settings.local.json`, and silent no-ops wherever the project has no scope or the hub is unreachable): `UserPromptSubmit` runs `aconn inbox --hook` (unread messages as plain-text context, then ack); `Stop` runs `aconn inbox --hook --stop`, which emits `{ "decision": "block", "reason": <messages> }` because plain stdout from a Stop hook is not shown to Claude, and starts an `asyncRewake` hook running `aconn wake` (exit 2 wakes the session with the printed messages); `PermissionRequest` runs `aconn permission-hook`, which asks on `permissions` with a hash of tool name, cwd and the real tool input and returns `decision: { behavior: "allow" | "deny" }`, or nothing on timeout (the question is marked expired and the terminal decides).
3. **Everything else** (Codex, Gemini CLI, OpenCode, Cursor, scripts): MCP tools with the `_meta` pending indicator, or `aconn read --follow` / `aconn wake` loops. None of these harnesses accept an unsolicited push into a running session today.

## Limits

- Body ≤ 16 KB, `data` ≤ 64 KB, channel/scope/tag names `[a-z0-9][a-z0-9._-]{0,63}`, threads ≤ 128 chars, idempotency keys ≤ 128 chars.
- 120 writes and 20 questions per minute per token (per function instance).
- `/pending` counts at most 10 channels per call.

## Known simplifications

Marked with `ponytail:` comments in the code:

- Rate limiting is per instance.
- The channel summary (`last`, `lastMessageAt`) can briefly show an older message if two writes race.
- SMTP credentials are a plain function parameter (`.env`), not a Secret Manager secret.
- Scopes have one owner; there is no sharing, delegation or quorum.
- The relay records the human's decision, not whether the harness executed the tool call afterwards.
