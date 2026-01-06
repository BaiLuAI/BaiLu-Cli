/**
 * 斜線命令系統（Slash Commands）
 * 在 chat 模式下使用，例如 /help, /model, /status 等
 * 
 * 注意：此檔案已重構為模組化結構
 * 實際的命令處理器位於 ./commands/ 目錄中
 */

import { LLMClient, ChatMessage } from "../llm/client.js";
import { WorkspaceContext } from "./types.js";

// 導入重構後的命令處理器
export { handleSlashCommand } from "./commands/index.js";

// 導出類型定義供其他模組使用
export interface SlashCommandContext {
  llmClient: LLMClient;
  workspaceContext: WorkspaceContext;
  messages: ChatMessage[];
  sessionStats: {
    messagesCount: number;
    toolCallsCount: number;
    totalTokensUsed: number;
    totalResponseTime: number;
    apiCallsCount: number;
    filesModified: number;
    startTime: Date;
    lastRequestTime: number;
  };
  // 文件管理功能
  fileManager?: {
    addFile: (filepath: string) => void;
    removeFile: (filepath: string) => void;
    clearFiles: () => void;
    getActiveFiles: () => string[];
  };
  // 会话管理功能
  sessionManager?: {
    saveCurrentSession: (name?: string) => Promise<string>;
    loadSession: (sessionIdOrName: string) => Promise<boolean>;
    listSessions: () => Promise<any[]>;
    deleteSession: (sessionIdOrName: string) => Promise<boolean>;
  };
}

export interface SlashCommandResult {
  handled: boolean;
  shouldExit?: boolean;
  shouldClearHistory?: boolean;
  response?: string;
  // 添加到对话历史（用于 /review 等需要后续引用的命令）
  addToHistory?: {
    userMessage: string;    // 用户的命令
    assistantMessage: string; // AI 的响应（纯文本，用于对话历史）
  };
}
