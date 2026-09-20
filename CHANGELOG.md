# Changelog

All notable changes to agents-connect. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [0.2.2] - 2026-09-20

### Added
- README quickstart: hub, once per machine, per project, first round trip.
- This changelog.

## [0.2.1] - 2026-09-20

### Changed
- `aconn setup` writes Claude Code hooks to the project's `.claude/settings.local.json` instead of `~/.claude/settings.json`, so hooks only run in projects bound to a scope.
- `inbox --hook`, `wake` and `permission-hook` exit quietly when the project has no scope, token or hub, or when the hub is unreachable (`AC_DEBUG=1` shows the reason).
- `aconn setup` warns about leftover global hooks from earlier versions.

## [0.2.0] - 2026-09-19

### Added
- Idempotency keys on `POST /messages` (`idempotencyKey` or `Idempotency-Key`), scoped to sender and channel; `aconn ask` derives one so a retried question re-attaches instead of duplicating.
- Message envelope: `replyTo`, `thread`, `priority` (`urgent` / `normal` / `low`), `tag`; `aconn reply` and the `reply` MCP tool; thread reads include the root message.
- Server-side consumer cursors (`POST /consumers/:channel/ack`, `consumer=me`), used by `read_messages` by default and by `aconn read --ack`.
- `GET /pending` and the `_meta["agents-connect/pending"]` indicator on every MCP tool result; `aconn status`, `aconn inbox`, `aconn wake`.
- Claude Code channel mode (`aconn mcp --channel`): pushes hub messages and answers into the running session and relays tool-permission prompts as `confirm` questions on channel `permissions`; plugin packaging under `plugin/` with a marketplace file.
- Claude Code hooks (`aconn setup`): inbox on prompt and stop, `asyncRewake` wake, `PermissionRequest` relay with `decision: { behavior }`.
- `aconn setup` for Claude Code, Codex, Cursor, Gemini CLI and OpenCode, plus an `AGENTS.md` snippet.
- Notice push digest (one push per channel per minute, later ones counted), per-channel mute, `low` priority inbox-only, token channel policies, `answer.via`, `delivery` records, cancel reasons (`cancelled` / `expired` / `superseded`), `GET /agents`.
- Web: decision history page, action-required badge, threads, mute, active-token indicator, busy states on every mutating control, email-verification banner.
- Terminal demo and explainer animation in `docs/media/`.

### Changed
- CLI renamed from `ac` to `aconn` (`agents-connect` stays as the long alias); generated hook and MCP configs use the long name.
- Tokens are stored per hub URL; a project file can no longer redirect a saved token to another server, and explicit `AC_TOKEN` values are never sent to a hub named only by a project file.
- Human API callers need a verified email; resolved questions are never replayed through idempotency keys; channel policy is enforced on `get`, `cancel`, `pending` and dedupe.
- `@modelcontextprotocol/sdk` pinned to 1.30.0 (the 2026-07-28 protocol revision disables Claude Code channels).
- Repository contains no deployment identifiers; Firebase project, web config and function parameters live in gitignored files with committed examples.

## [0.1.0] - 2026-09-19

### Added
- Firebase hub: single-writer `api` Cloud Function, Firestore rules and indexes, Hosting, email/password Auth.
- `ac` CLI and MCP server: events, notices, confirm / choice / text questions, cursors, scopes and tokens.
- React + shadcn web app: scopes, channels, realtime messages, inline answers, tokens, push and email settings.
- `agents-connect` agent skill.

[0.2.2]: https://github.com/Paldom/agents-connect/releases/tag/v0.2.2
[0.2.1]: https://github.com/Paldom/agents-connect/releases/tag/v0.2.1
[0.2.0]: https://github.com/Paldom/agents-connect/releases/tag/v0.2.0
[0.1.0]: https://github.com/Paldom/agents-connect/commits/b586e87
