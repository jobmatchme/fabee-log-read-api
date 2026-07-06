import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { listDirectories, listFiles, pathExists } from "./fs-utils.js";
import { parseJsonLines, parseRunLog } from "./parser.js";
import { isAuthorizedSessionId, sessionPrefix } from "./security.js";
import { RunSummary, SessionDetail, SessionSummary } from "./types.js";

interface SessionFiles {
  sessionId: string;
  contextPath: string;
  lastPromptPath: string;
}

interface ScanData {
  runsBySessionId: Map<string, RunSummary[]>;
  runActivityBySessionId: Map<string, string>;
}

export class LogReadRepository {
  constructor(
    private readonly sessionDir: string,
    private readonly runLogDir: string,
  ) {}

  async listSessions(agentId: string, userKey: string, limit: number): Promise<SessionSummary[]> {
    const scan = await this.scanRuns();
    const sessions = await this.findAuthorizedSessionFiles(agentId, userKey);
    const summaries = await Promise.all(
      sessions.map(async (session) => this.buildSessionSummary(session, scan.runsBySessionId.get(session.sessionId) ?? [], scan.runActivityBySessionId.get(session.sessionId))),
    );
    return summaries
      .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || a.sessionId.localeCompare(b.sessionId))
      .slice(0, limit);
  }

  async getSession(sessionId: string, userKey: string): Promise<SessionDetail | null> {
    const validated = sessionId;
    const files = await this.getSessionFiles(validated);
    if (!files) return null;
    const scan = await this.scanRuns();
    const runs = scan.runsBySessionId.get(validated) ?? [];
    const summary = await this.buildSessionSummary(files, runs, scan.runActivityBySessionId.get(validated));
    const context = await parseJsonLines(files.contextPath);
    const lastPrompt = (await pathExists(files.lastPromptPath))
      ? JSON.parse(await readFile(files.lastPromptPath, "utf8"))
      : undefined;
    return { ...summary, context, lastPrompt };
  }

  async getSessionRuns(sessionId: string): Promise<RunSummary[] | null> {
    const files = await this.getSessionFiles(sessionId);
    if (!files) return null;
    const scan = await this.scanRuns();
    return (scan.runsBySessionId.get(sessionId) ?? []).sort((a, b) => b.fileMtimeIso.localeCompare(a.fileMtimeIso));
  }

  private async findAuthorizedSessionFiles(agentId: string, userKey: string): Promise<SessionFiles[]> {
    const names = await listDirectories(this.sessionDir);
    const prefix = sessionPrefix(agentId, userKey);
    const sessions = names.filter((name) => isAuthorizedSessionId(name, agentId, userKey));
    return (await Promise.all(sessions.map(async (sessionId) => this.getSessionFiles(sessionId)))).filter((value): value is SessionFiles => Boolean(value));
  }

  private async getSessionFiles(sessionId: string): Promise<SessionFiles | null> {
    const contextPath = join(this.sessionDir, sessionId, "context.jsonl");
    if (!(await pathExists(contextPath))) return null;
    return {
      sessionId,
      contextPath,
      lastPromptPath: join(this.sessionDir, sessionId, "last_prompt.json"),
    };
  }

  private async buildSessionSummary(session: SessionFiles, runs: RunSummary[], runActivityAt?: string): Promise<SessionSummary> {
    const contextUpdatedAt = await this.safeMtimeIso(session.contextPath);
    const lastPromptUpdatedAt = await this.safeMtimeIso(session.lastPromptPath);
    const lastActivityAt = [contextUpdatedAt, lastPromptUpdatedAt, runActivityAt].filter((value): value is string => Boolean(value)).sort().at(-1);
    return {
      sessionId: session.sessionId,
      contextUpdatedAt,
      lastPromptUpdatedAt,
      lastRunAt: runActivityAt,
      lastActivityAt,
      runCount: runs.length,
    };
  }

  private async safeMtimeIso(filePath: string): Promise<string | undefined> {
    try {
      return (await stat(filePath)).mtime.toISOString();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async scanRuns(): Promise<ScanData> {
    const runFiles = await listFiles(this.runLogDir, ".jsonl");
    const runsBySessionId = new Map<string, RunSummary[]>();
    const runActivityBySessionId = new Map<string, string>();

    for (const filePath of runFiles) {
      const summary = await parseRunLog(filePath);
      if (!summary.sessionId) continue;
      const runs = runsBySessionId.get(summary.sessionId) ?? [];
      runs.push(summary);
      runsBySessionId.set(summary.sessionId, runs);
      const previous = runActivityBySessionId.get(summary.sessionId);
      if (!previous || previous < summary.fileMtimeIso) {
        runActivityBySessionId.set(summary.sessionId, summary.fileMtimeIso);
      }
    }

    return { runsBySessionId, runActivityBySessionId };
  }
}
