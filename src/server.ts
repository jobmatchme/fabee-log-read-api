import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { URL } from "node:url";
import { LogReadRepository } from "./repository.js";
import { isBearerTokenAuthorized, validateAgentId, validateLimit, validateSessionId, validateUserKey } from "./security.js";
import { ReadApiConfig } from "./types.js";

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function routePath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function routeUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://localhost");
}

export function createApp(config: ReadApiConfig, repository = new LogReadRepository(config.sessionDir, config.runLogDir)) {
  return async function app(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = routeUrl(request);
      const path = routePath(request);
      const method = request.method ?? "GET";

      if (method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }

      if (path === "/health") {
        sendJson(response, 200, { ok: true, version: config.apiVersion });
        return;
      }

      if (!isBearerTokenAuthorized(request.headers.authorization, config.bearerToken)) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }

      if (path === "/sessions") {
        const agentId = validateAgentId(url.searchParams.get("agentId"));
        const userKey = validateUserKey(url.searchParams.get("userKey"));
        const limit = validateLimit(url.searchParams.get("limit"));
        const sessions = await repository.listSessions(agentId, userKey, limit);
        sendJson(response, 200, { sessions });
        return;
      }

      const detailMatch = path.match(/^\/sessions\/([^/]+)$/);
      if (detailMatch) {
        const userKey = validateUserKey(url.searchParams.get("userKey"));
        const sessionId = validateSessionId(decodeURIComponent(detailMatch[1] ?? ""), userKey);
        const session = await repository.getSession(sessionId, userKey);
        if (!session) {
          sendJson(response, 404, { error: "Session not found" });
          return;
        }
        sendJson(response, 200, { session });
        return;
      }

      const runsMatch = path.match(/^\/sessions\/([^/]+)\/runs$/);
      if (runsMatch) {
        const userKey = validateUserKey(url.searchParams.get("userKey"));
        const sessionId = validateSessionId(decodeURIComponent(runsMatch[1] ?? ""), userKey);
        const runs = await repository.getSessionRuns(sessionId);
        if (!runs) {
          sendJson(response, 404, { error: "Session not found" });
          return;
        }
        sendJson(response, 200, { sessionId, runs });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 400, { error: (error as Error).message });
    }
  };
}

export function startServer(config: ReadApiConfig, repository?: LogReadRepository): Promise<Server> {
  const app = createApp(config, repository);
  const server = createServer((request, response) => {
    void app(request, response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve(server));
  });
}
