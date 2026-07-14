export interface ReadApiConfig {
  host: string;
  port: number;
  bearerToken: string;
  runLogDir: string;
  sessionDir: string;
  apiVersion: string;
}

export interface RunSummary {
  runId: string;
  sessionId?: string;
  filePath: string;
  fileMtimeIso: string;
  status: "completed" | "failed" | "incomplete" | "unknown";
  requestedAt?: string;
  completedAt?: string;
  failedAt?: string;
  usage?: {
    contextTokens?: number;
    contextWindow?: number;
  };
  model?: {
    provider?: string;
    id?: string;
  };
  thinkingLevel?: string;
  parseWarnings: Array<{ line: number; message: string }>;
}

export interface SessionSummary {
  sessionId: string;
  contextUpdatedAt?: string;
  lastPromptUpdatedAt?: string;
  lastRunAt?: string;
  lastActivityAt?: string;
  runCount: number;
}

export interface SessionDetail extends SessionSummary {
  context: unknown[];
  lastPrompt?: unknown;
  latestRun?: RunSummary;
}
