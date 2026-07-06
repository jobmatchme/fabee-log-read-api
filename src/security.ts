const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const SAFE_SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export function validateAgentId(value: string | null): string {
  if (!value || !SAFE_SEGMENT.test(value)) {
    throw new Error("Invalid agentId");
  }
  return value;
}

export function validateUserKey(value: string | null): string {
  if (!value || !SAFE_SEGMENT.test(value)) {
    throw new Error("Invalid userKey");
  }
  return value;
}

export function validateLimit(value: string | null, fallback = 50): number {
  if (value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 200) {
    throw new Error("Invalid limit");
  }
  return parsed;
}

export function validateSessionId(value: string, userKey: string): string {
  if (!SAFE_SESSION_ID.test(value)) {
    throw new Error("Invalid sessionId");
  }
  const parts = value.split(":");
  if (parts.length < 4 || parts[1] !== "web" || parts[2] !== userKey || !parts[0] || !parts[3]) {
    throw new Error("Session not accessible");
  }
  return value;
}

export function sessionPrefix(agentId: string, userKey: string): string {
  return `${agentId}:web:${userKey}:`;
}

export function isAuthorizedSessionId(sessionId: string, agentId: string, userKey: string): boolean {
  return sessionId.startsWith(sessionPrefix(agentId, userKey));
}

export function isBearerTokenAuthorized(headerValue: string | undefined, expectedToken: string): boolean {
  if (!headerValue?.startsWith("Bearer ")) return false;
  return headerValue.slice(7) === expectedToken;
}
