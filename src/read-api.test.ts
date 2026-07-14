import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "./server.js";
import { parseRunLog } from "./parser.js";
import { ReadApiConfig } from "./types.js";

function config(root: string): ReadApiConfig {
  return {
    host: "127.0.0.1",
    port: 8080,
    bearerToken: "secret-token",
    runLogDir: join(root, "logs"),
    sessionDir: join(root, "sessions"),
    apiVersion: "0.1.0-test",
  };
}

async function setupWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabee-log-read-api-"));
  await mkdir(join(root, "logs"), { recursive: true });
  await mkdir(join(root, "sessions"), { recursive: true });

  const webSession = "fabee-pi-agent:web:user-1:session-a";
  const otherUserSession = "fabee-pi-agent:web:user-2:session-b";
  const slackSession = "fabee-pi-agent:slack:user-1:session-c";

  await mkdir(join(root, "sessions", webSession), { recursive: true });
  await mkdir(join(root, "sessions", otherUserSession), { recursive: true });
  await mkdir(join(root, "sessions", slackSession), { recursive: true });

  await writeFile(join(root, "sessions", webSession, "context.jsonl"), `${JSON.stringify({ type: "message", role: "user" })}\n`, "utf8");
  await writeFile(join(root, "sessions", webSession, "last_prompt.json"), JSON.stringify({ prompt: "hello" }), "utf8");
  await writeFile(join(root, "sessions", otherUserSession, "context.jsonl"), `${JSON.stringify({ type: "message", role: "user" })}\n`, "utf8");
  await writeFile(join(root, "sessions", slackSession, "context.jsonl"), `${JSON.stringify({ type: "message", role: "user" })}\n`, "utf8");

  const runFile = join(root, "logs", "run-1.jsonl");
  await writeFile(
    runFile,
    [
      JSON.stringify({ type: "run.requested", runId: "run-1", sessionId: webSession, timestamp: "2026-07-05T10:00:00.000Z" }),
      JSON.stringify({ type: "run.completed", runId: "run-1", sessionId: webSession, timestamp: "2026-07-05T10:01:00.000Z", usage: { contextTokens: 25481, contextWindow: 372000 }, model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "medium" }),
      "",
    ].join("\n"),
    "utf8",
  );
  await utimes(runFile, new Date("2026-07-05T10:01:00.000Z"), new Date("2026-07-05T10:01:00.000Z"));

  const otherRunFile = join(root, "logs", "run-2.jsonl");
  await writeFile(
    otherRunFile,
    [
      JSON.stringify({ type: "run.requested", runId: "run-2", sessionId: otherUserSession, timestamp: "2026-07-05T11:00:00.000Z" }),
      JSON.stringify({ type: "run.completed", runId: "run-2", sessionId: otherUserSession, timestamp: "2026-07-05T11:01:00.000Z" }),
      "",
    ].join("\n"),
    "utf8",
  );

  return root;
}

async function requestJson(app: ReturnType<typeof createApp>, path: string, token?: string): Promise<{ statusCode: number; body: any }> {
  let payload = "";
  let statusCode = 0;
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      if (typeof chunk === "string") payload += chunk;
      statusCode = this.statusCode;
    },
  } as any;

  await app(
    {
      method: "GET",
      url: path,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as any,
    response,
  );

  return { statusCode, body: payload ? JSON.parse(payload) : undefined };
}

test("health is public and auth protects session endpoints", async () => {
  const root = await setupWorkspace();
  const app = createApp(config(root));

  const health = await requestJson(app, "/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.ok, true);

  const unauthorized = await requestJson(app, "/sessions?agentId=fabee-pi-agent&userKey=user-1");
  assert.equal(unauthorized.statusCode, 401);
});

test("session listing filters by web agent/user prefix and returns runs", async () => {
  const root = await setupWorkspace();
  const app = createApp(config(root));

  const response = await requestJson(app, "/sessions?agentId=fabee-pi-agent&userKey=user-1&limit=50", "secret-token");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.sessions.length, 1);
  assert.equal(response.body.sessions[0].sessionId, "fabee-pi-agent:web:user-1:session-a");
  assert.equal(response.body.sessions[0].runCount, 1);

  const detail = await requestJson(app, "/sessions/fabee-pi-agent%3Aweb%3Auser-1%3Asession-a?userKey=user-1", "secret-token");
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.session.context.length, 1);
  assert.deepEqual(detail.body.session.latestRun.usage, { contextTokens: 25481, contextWindow: 372000 });
  assert.deepEqual(detail.body.session.latestRun.model, { provider: "openai-codex", id: "gpt-5.6-sol" });
  assert.equal(detail.body.session.latestRun.thinkingLevel, "medium");

  const runs = await requestJson(app, "/sessions/fabee-pi-agent%3Aweb%3Auser-1%3Asession-a/runs?userKey=user-1", "secret-token");
  assert.equal(runs.statusCode, 200);
  assert.equal(runs.body.runs.length, 1);
  assert.equal(runs.body.runs[0].runId, "run-1");
});

test("parseRunLog tolerates malformed lines and keeps sessionId", async () => {
  const root = await mkdtemp(join(tmpdir(), "fabee-log-read-api-parse-"));
  const filePath = join(root, "run-bad.jsonl");
  await writeFile(
    filePath,
    [
      JSON.stringify({ type: "run.requested", sessionId: "fabee-pi-agent:web:user-1:session-a", timestamp: 1770000000000 }),
      "{bad json",
      JSON.stringify({ type: "run.failed", timestamp: "2026-07-05T10:02:00.000Z" }),
      "",
    ].join("\n"),
    "utf8",
  );

  const summary = await parseRunLog(filePath);
  assert.equal(summary.sessionId, "fabee-pi-agent:web:user-1:session-a");
  assert.equal(summary.status, "failed");
  assert.equal(summary.parseWarnings.length, 1);
});
