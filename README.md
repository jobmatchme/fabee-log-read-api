# fabee-log-read-api

Read-only HTTP API for Bee dashboard history backed by local `fabee-pi-agent` session snapshots and run logs.

## Security model

- All endpoints except `GET /health` require a shared bearer token via `Authorization: Bearer <token>`.
- `userKey` is mandatory on session reads.
- Session access is restricted to IDs matching `${agentId}:web:${userKey}:` for listings and `*:web:${userKey}:*` for direct session reads.
- Slack sessions (`:slack:`) and other users' sessions are never returned because only `:web:` sessions with the caller's `userKey` pass validation.
- The API is read-only. It never deletes, prunes, or mutates session or log files.

## Configuration

```sh
READ_API_BEARER_TOKEN=change-me
```

Defaults:

```sh
READ_API_HOST=0.0.0.0
READ_API_PORT=8080
READ_API_RUN_LOG_DIR=/workspace/.fabee-pi-agent/logs
READ_API_SESSION_DIR=/workspace/.fabee-pi-agent/sessions
```

## API

### `GET /health`

No auth required.

### `GET /sessions?agentId=fabee-pi-agent&userKey=<userKey>&limit=50`

Returns matching web sessions sorted by most recent activity descending. Activity uses `context.jsonl`, `last_prompt.json`, and matching run log mtimes.

### `GET /sessions/:sessionId?userKey=<userKey>`

Returns one session summary plus parsed `context.jsonl` entries and `last_prompt.json` if present.

### `GET /sessions/:sessionId/runs?userKey=<userKey>`

Scans current JSONL run logs, filters by `sessionId`, and returns run summaries.

## Development

```sh
npm install
npm run check
npm start
```

Example:

```sh
export READ_API_BEARER_TOKEN=dev-token
npm run build
node dist/main.js
curl http://127.0.0.1:8080/health
curl -H 'Authorization: Bearer dev-token' 'http://127.0.0.1:8080/sessions?agentId=fabee-pi-agent&userKey=alice&limit=50'
```

Build image:

```sh
docker build -t ghcr.io/jobmatchme/fabee-log-read-api:0.1.0 .
```
