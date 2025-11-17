/**
 * 會話管理：支持任務的持久化、暫停和恢復
 */

import fs from "fs/promises";
import path from "path";
import { Task, Run } from "./types";

export interface SessionMetadata {
  sessionId: string;
  createdAt: string;
  lastUpdatedAt: string;
  task: Task;
  runs: Run[];
  currentRunId?: string;
}

export class SessionManager {
  private sessionsDir: string;

  constructor(baseDir?: string) {
    this.sessionsDir = baseDir || path.join(process.cwd(), ".bailu", "sessions");
  }

  /**
   * 初始化會話目錄
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  /**
   * 創建新會話
   */
  async createSession(task: Task): Promise<SessionMetadata> {
    await this.initialize();

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const session: SessionMetadata = {
      sessionId,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      task,
      runs: [],
    };

    await this.saveSession(session);
    return session;
  }

  /**
   * 保存會話
   */
  async saveSession(session: SessionMetadata): Promise<void> {
    session.lastUpdatedAt = new Date().toISOString();
    const filePath = path.join(this.sessionsDir, `${session.sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  /**
   * 載入會話
   */
  async loadSession(sessionId: string): Promise<SessionMetadata | null> {
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as SessionMetadata;
    } catch {
      return null;
    }
  }

  /**
   * 列出所有會話
   */
  async listSessions(): Promise<SessionMetadata[]> {
    try {
      await this.initialize();
      const files = await fs.readdir(this.sessionsDir);
      const sessions: SessionMetadata[] = [];

      for (const file of files) {
        if (file.endsWith(".json")) {
          const sessionId = file.replace(".json", "");
          const session = await this.loadSession(sessionId);
          if (session) {
            sessions.push(session);
          }
        }
      }

      // 按最後更新時間排序
      sessions.sort((a, b) => {
        return new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime();
      });

      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * 刪除會話
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 更新會話的 run
   */
  async updateSessionRun(sessionId: string, run: Run): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error(`會話 ${sessionId} 不存在`);
    }

    const existingIndex = session.runs.findIndex((r) => r.id === run.id);
    if (existingIndex >= 0) {
      session.runs[existingIndex] = run;
    } else {
      session.runs.push(run);
    }

    session.currentRunId = run.id;
    await this.saveSession(session);
  }
}

