# wepchat-host

`wepchat-host` is a LAN bridge that lets WepChat control Codex running on a desktop machine.

It is intentionally a host-side adapter:

```text
WepChat Android H5
  -> HTTP/WebSocket + token
wepchat-host
  -> stdio JSON-RPC
codex app-server
  -> local repo, shell, git, Codex config, Codex sessions
```

The phone never talks to `codex app-server` directly. The host process owns authentication, workspace allowlisting, event translation, and approval routing.

## Status

This package is an MVP scaffold. It currently provides:

- zero runtime npm dependencies
- `wepchat-host` CLI
- workspace registry from cwd, `--workspace`, or config
- token-protected HTTP API
- token-protected WebSocket API
- `codex app-server --stdio` child process management
- Codex `initialize` / `initialized`
- `thread/start`
- `thread/resume`
- `thread/read`
- `thread/list`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- command/file-change approval forwarding
- Codex notification translation for message deltas, item lifecycle, command output, turn lifecycle, and diff updates

It does not attempt to control a running Codex Desktop window or reuse Codex's official mobile pairing flow.

## Usage

From a project directory:

```bash
npx wepchat-host --lan
```

Or explicitly register directories:

```bash
wepchat-host --lan --workspace E:\wepchat\wepchat --workspace D:\projects\foo
```

By default the server listens on `127.0.0.1:8797`. Use `--lan` only when you want access from another device on the same network.

```bash
wepchat-host --help
```

## HTTP API

Unauthenticated:

```text
GET /health
```

Token-protected:

```text
GET /pairing
GET /workspaces
GET /threads?workspaceId=...
```

Pass the token either as:

```text
Authorization: Bearer <token>
```

or:

```text
?token=<token>
```

The query-token form exists because browser WebSocket clients cannot set arbitrary headers.

## WebSocket API

Connect to:

```text
ws://<host>:8797/session?token=<token>
```

Client messages:

```json
{ "type": "remote.thread.start", "id": "1", "workspaceId": "ws_..." }
{ "type": "remote.thread.resume", "id": "2", "workspaceId": "ws_...", "threadId": "..." }
{ "type": "remote.thread.read", "id": "3", "threadId": "...", "includeTurns": true }
{ "type": "remote.threads.list", "id": "4", "workspaceId": "ws_..." }
{ "type": "remote.turn.start", "id": "5", "workspaceId": "ws_...", "threadId": "...", "text": "Fix the failing tests" }
{ "type": "remote.turn.steer", "id": "6", "threadId": "...", "text": "Also check Windows behavior" }
{ "type": "remote.turn.interrupt", "id": "7", "threadId": "..." }
{ "type": "remote.approval.respond", "id": "8", "approvalId": "appr_...", "decision": "accept" }
```

Responses use:

```json
{ "type": "response", "id": "5", "ok": true, "result": {} }
```

or:

```json
{ "type": "response", "id": "5", "ok": false, "error": "message" }
```

Server events include:

```json
{ "type": "remote.message.delta", "seq": 1, "threadId": "...", "turnId": "...", "itemId": "...", "delta": "..." }
{ "type": "remote.item.started", "seq": 2, "threadId": "...", "turnId": "...", "item": {} }
{ "type": "remote.item.completed", "seq": 3, "threadId": "...", "turnId": "...", "item": {} }
{ "type": "remote.command.output.delta", "seq": 4, "threadId": "...", "turnId": "...", "itemId": "...", "delta": "..." }
{ "type": "remote.approval.required", "seq": 5, "approvalId": "appr_...", "kind": "command", "command": "npm test" }
{ "type": "remote.turn.completed", "seq": 6, "threadId": "...", "turn": {} }
```

To replay recent events:

```json
{ "type": "remote.events.replay", "id": "9", "afterSeq": 100 }
```

## Config

Default config path:

```text
~/.wepchat-host/config.json
```

Example:

```json
{
  "bind": "127.0.0.1",
  "port": 8797,
  "workspaces": [
    { "name": "WepChat", "path": "E:\\wepchat\\wepchat" }
  ],
  "codex": {
    "command": "codex",
    "model": "",
    "approvalPolicy": "on-request",
    "sandbox": "workspace-write"
  }
}
```

The token is generated automatically and persisted into the config file.

## Security Model

- The default bind address is `127.0.0.1`.
- `--lan` is required for LAN access.
- Every non-health endpoint requires the token.
- Only registered workspaces can be used.
- The phone cannot send arbitrary filesystem paths.
- The phone cannot execute arbitrary shell commands through this host protocol.
- Codex command and file-change approvals are surfaced as explicit mobile approvals.

Do not expose this server directly to the public internet. Use a private network or VPN if you need access beyond the local LAN.
