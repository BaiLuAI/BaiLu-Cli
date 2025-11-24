/**
 * Chat 会话持久化管理
 * 用于保存和加载交互式聊天会话
 */
import fs from "fs/promises";
import path from "path";
import { ChatMessage } from "../llm/client";

export interface ChatSessionData {
  sessionId: string;
  name?: string; // 用户定义的会话名称
  createdAt: string;
  lastUpdatedAt: string;
  messages: ChatMessage[];
  stats: {
    messagesCount: number;
    toolCallsCount: number;
    totalTokensUsed: number;
    totalResponseTime: number;
    apiCallsCount: number;
    startTime: string;
  };
  activeFiles: string[];
}

export class ChatSessionManager {
  private sessionsDir: string;

  constructor(baseDir?: string) {
    const home = require("os").homedir();
    this.sessionsDir =
      baseDir || path.join(home, ".bailu-cli", "chat-sessions");
  }

  /**
   * 初始化会话目录
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  /**
   * 保存会话
   */
  async saveSession(session: ChatSessionData): Promise<void> {
    await this.initialize();
    session.lastUpdatedAt = new Date().toISOString();
    
    const filePath = path.join(
      this.sessionsDir,
      `${session.sessionId}.json`
    );
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  /**
   * 按名称保存会话
   */
  async saveSessionByName(session: ChatSessionData, name: string): Promise<void> {
    await this.initialize();
    session.name = name;
    session.sessionId = this.sanitizeFilename(name);
    await this.saveSession(session);
  }

  /**
   * 加载会话
   */
  async loadSession(sessionIdOrName: string): Promise<ChatSessionData | null> {
    try {
      await this.initialize();
      
      // 尝试直接作为 session ID 加载
      let filePath = path.join(
        this.sessionsDir,
        `${sessionIdOrName}.json`
      );
      
      // 如果文件不存在，尝试按名称查找
      try {
        await fs.access(filePath);
      } catch {
        // 查找匹配的会话名称
        const sessions = await this.listSessions();
        const found = sessions.find(
          (s) => s.name?.toLowerCase() === sessionIdOrName.toLowerCase()
        );
        if (found) {
          filePath = path.join(
            this.sessionsDir,
            `${found.sessionId}.json`
          );
        } else {
          return null;
        }
      }

      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as ChatSessionData;
    } catch (error) {
      return null;
    }
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<ChatSessionData[]> {
    try {
      await this.initialize();
      const files = await fs.readdir(this.sessionsDir);
      const sessions: ChatSessionData[] = [];

      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await fs.readFile(
            path.join(this.sessionsDir, file),
            "utf-8"
          );
          try {
            const session = JSON.parse(content) as ChatSessionData;
            sessions.push(session);
          } catch {
            // 忽略损坏的会话文件
          }
        }
      }

      // 按最后更新时间排序
      sessions.sort((a, b) => {
        return (
          new Date(b.lastUpdatedAt).getTime() -
          new Date(a.lastUpdatedAt).getTime()
        );
      });

      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionIdOrName: string): Promise<boolean> {
    try {
      await this.initialize();
      
      let filePath = path.join(
        this.sessionsDir,
        `${sessionIdOrName}.json`
      );
      
      // 如果文件不存在，尝试按名称查找
      try {
        await fs.access(filePath);
      } catch {
        const sessions = await this.listSessions();
        const found = sessions.find(
          (s) => s.name?.toLowerCase() === sessionIdOrName.toLowerCase()
        );
        if (found) {
          filePath = path.join(
            this.sessionsDir,
            `${found.sessionId}.json`
          );
        } else {
          return false;
        }
      }

      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理文件名（移除非法字符）
   */
  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
  }
}
