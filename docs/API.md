# HTTP API

Base URL: `https://<your-hosting-domain>/api/v1`. All bodies and responses are JSON. Errors are `{ "error": "message" }` with a matching HTTP status.

## Authentication

`Authorization: Bearer <token>` where the token is either an agent token (`ac_…`) or a Firebase ID token of a signed-in user with a verified email.

Scope-bound routes need the scope **name** in `X-Scope: <name>` or `?scope=<name>`. An agent token bound to exactly one scope may omit it. Agent tokens may also carry a channel policy (`channels: ["build*", "ops"]`); writes, reads, `get` and `cancel` on messages of other channels return `403`.

Optional headers: `X-Client: web | cli | mcp | hook` (recorded on answers as `answer.via`), `Idempotency-Key` (same as the `idempotencyKey` body field).

## Routes

| Method and path | Who | Body / query | Returns |
|---|---|---|---|
| `GET /whoami` | both | | agent: `{ kind, uid, name, allScopes, scopes[], channels[] }`; human: `{ kind, uid, email }` |
| `GET /scopes` | both | | scopes the caller may use |
| `POST /scopes` | human | `{ name }` | the scope; `409` if the name exists |
| `DELETE /scopes/:id` | human | | `{ ok }` (recursive delete) |
| `GET /channels` | both, scoped | | channels ordered by last message |
| `GET /agents` | both, scoped | | tokens with access to the scope: `{ name, prefix, lastUsedAt, active }` (active = used in the last 10 minutes) |
| `GET /messages?channel=&after=&consumer=&limit=&kind=&status=&thread=` | both, scoped | | messages ascending by id, excluding the last 2 s. `after` is an explicit cursor; `consumer=me` (or a name) resumes from that consumer's stored cursor. A `thread` named after a message id includes that root message |
| `POST /messages` | both, scoped | `{ channel, kind, body, data?, question?, replyTo?, thread?, priority?, tag?, idempotencyKey? }` | the message; `deduplicated: true` when an idempotency key matched |
| `GET /messages/:id` | both, scoped | | one message |
| `POST /messages/:id/answer` | human, scoped | `{ value }` | the answered message; `409` if not open |
| `POST /messages/:id/cancel` | both, scoped | `{ reason?: "cancelled" \| "expired" \| "superseded" }` | `{ id, status: "cancelled", cancelReason }` |
| `POST /consumers/:channel/ack` | both, scoped | `{ lastId, consumer?: "me" \| name }` | `{ consumer, channel, lastId }`; never moves backwards; ids in the future are rejected |
| `GET /pending?consumer=&channels=a,b&ack=` | both, scoped | | `{ answered: Message[], unread: { [channel]: count } }`: this sender's questions resolved (answered or cancelled) after the consumer's watermark, and message counts after each consumer cursor. Read-only unless `ack=1`, which moves the watermark to the newest resolution returned |
| `GET /tokens` | human | | own tokens without secrets |
| `POST /tokens` | human | `{ name, scopes: ["*"] \| [scopeId, …], channels?: ["build*", …] }` | `{ token, … }` (the secret is returned once) |
| `DELETE /tokens/:hash` | human | | `{ ok }`; effective on the next request |

## Message fields

- `kind`: `event` (default), `notice`, or `question`. For `question`, `question.type` is `confirm` (default), `choice` with `options` (2–20 strings), or `text`. Answer values: boolean or yes/no words for `confirm`, one of the options for `choice`, non-empty text for `text`.
- `priority`: `urgent`, `normal` (default, not stored), `low`. Questions and `urgent` notices push immediately with high priority; `low` notices never push or email; other notices are pushed at most once per channel per minute, later ones folded into a count.
- `replyTo` (message id), `thread` (1–128 chars: letters, digits, `. _ : / -`), `tag` (lowercase label such as `status`, `result`, `review_request`).
- `idempotencyKey` (1–128 printable ASCII), scoped to sender, scope and channel: a repeat returns the earlier message while it is a still-open question (a resolved question is never replayed, so a re-ask cannot inherit an old approval) or, for events and notices, while it is younger than 24 hours. The key is reserved in the same write as the message, so concurrent identical requests yield one message.
- Server-set: `from`, `createdAt`, `expiresAt` (90 days), `status`, `answer { value, by, at, via }`, `cancelReason`, `resolvedAt` (answer or cancel time), `delivery { push, email, at }` (what the hub attempted after storing a notice or question).

```json
{
  "id": "01M2WX2JB0GFBPDZP7EB9ZKPME",
  "channel": "deploy",
  "kind": "question",
  "from": "ci-agent",
  "body": "Ship v42 to prod?",
  "data": "{\"pr\":42}",
  "thread": "release/v42",
  "priority": "urgent",
  "question": { "type": "choice", "options": ["yes", "no", "later"] },
  "status": "answered",
  "answer": { "value": "later", "by": "owner@example.com", "at": "2026-09-19T13:18:15.904Z", "via": "web" },
  "delivery": { "push": 2, "email": true, "at": "2026-09-19T13:18:10.100Z" },
  "createdAt": "2026-09-19T13:18:09.904Z",
  "expiresAt": "2026-12-18T13:18:09.904Z"
}
```

## Permission relay convention

Claude Code tool-permission prompts arrive as `confirm` questions on channel `permissions` with `priority: urgent` and `data` = `{ request_id, tool_name, description, input_preview, input_hash? }`. `input_preview` is display text from Claude Code, not the executed arguments; `input_hash` is present only on the hook path, where the hook saw the real tool input.

## Status codes

`400` validation, `401` missing or invalid token, `403` wrong principal, scope, or channel policy, `404` unknown route, scope, or message, `409` question no longer open or duplicate scope name, `429` more than 120 writes or 20 questions per minute for one token.
