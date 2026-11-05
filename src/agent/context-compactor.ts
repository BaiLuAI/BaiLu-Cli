/**
 * 上下文壓縮器（從 orchestrator 抽出）
 *
 * 估算對話 token 用量，超過模型 context window 閾值時
 * 用 AI 生成摘要壓縮舊消息，保留最近幾輪的連貫性。
 */

import { LLMClient, ChatMessage } from "../llm/client.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ContextCompactor");

/** 模型 context window 大小映射（tokens） */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "bailu-2.8": 32000,
  "bailu-2.6-preview": 32000,
  "bailu-2.6": 32000,
  "bailu-2.6-fast-thinking": 32000,
  "bailu-2.6-mini": 16000,
  "bailu-2.5-pro": 32000,
  "bailu-2.5-lite-code": 16000,
  "bailu-2.5-code-cc": 16000,
  "bailu-Edge": 8000,
  "bailu-Minimum-free": 8000,
};

const DEFAULT_CONTEXT_WINDOW = 16000;

/** 壓縮時保留的最近消息數（維持上下文連貫） */
const KEEP_RECENT_MESSAGES = 4;

export class ContextCompactor {
  // 預編譯正則（性能）
  private static readonly CHINESE_CHAR_PATTERN = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g;
  private static readonly ENGLISH_WORD_PATTERN = /[a-zA-Z]+/g;

  constructor(
    private llmClient: LLMClient,
    private verbose: boolean = false
  ) {}

  /** 取得模型的 context window 大小 */
  getModelContextWindow(modelName: string): number {
    return MODEL_CONTEXT_WINDOWS[modelName] || DEFAULT_CONTEXT_WINDOW;
  }

  /**
   * 估算消息的 token 數（近似值）
   * 中文 ~1.5 token/字，英文 ~1.3 token/詞，其他 ~0.5 token/字符
   */
  estimateTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const content = msg.content || "";
      const chineseChars = (content.match(ContextCompactor.CHINESE_CHAR_PATTERN) || []).length;
      const englishWords = (content.match(ContextCompactor.ENGLISH_WORD_PATTERN) || []).length;
      const englishChars = (content.match(ContextCompactor.ENGLISH_WORD_PATTERN) || []).join("").length;
      const otherChars = content.length - chineseChars - englishChars;
      total += chineseChars * 1.5 + englishWords * 1.3 + Math.max(0, otherChars) * 0.5;
    }
    return Math.ceil(total);
  }

  /**
   * 自動壓縮：超過 context window 80% 閾值且消息夠多時觸發
   * 直接修改傳入的 messages 陣列（原地壓縮）
   */
  async maybeCompress(messages: ChatMessage[], modelName: string, maxTokens?: number): Promise<boolean> {
    const effectiveMax = maxTokens ?? this.getModelContextWindow(modelName);
    const currentTokens = this.estimateTokens(messages);
    const threshold = effectiveMax * 0.8;

    if (currentTokens <= threshold || messages.length <= 10) {
      return false;
    }

    const systemMsg = messages[0];
    const recentMessages = messages.slice(-KEEP_RECENT_MESSAGES);
    const oldMessages = messages.slice(1, -KEEP_RECENT_MESSAGES);

    // 嘗試用 AI 生成摘要
    let summary: string;
    try {
      const summaryPrompt: ChatMessage[] = [
        {
          role: "system",
          content:
            "你是一個對話摘要助手。請用 3-5 句話總結以下對話的關鍵決策、已完成的操作和重要上下文。只輸出摘要，不要其他內容。",
        },
        {
          role: "user",
          content: oldMessages
            .map((m) => `[${m.role}]: ${m.content?.substring(0, 500) || ""}`)
            .join("\n"),
        },
      ];
      summary = await this.llmClient.chat(summaryPrompt, false);
      if (!summary || summary.length < 10) {
        throw new Error("摘要太短");
      }
    } catch {
      // AI 摘要失敗時回退到簡單描述
      summary = `之前進行了 ${oldMessages.length} 輪對話，包含文件操作和代碼修改。`;
    }

    const compressedCount = oldMessages.length;
    messages.length = 0;
    messages.push(systemMsg);
    messages.push({
      role: "system",
      content: `[對話歷史摘要（${compressedCount} 條消息已壓縮）]\n${summary}`,
    });
    messages.push(...recentMessages);

    if (this.verbose) {
      logger.info(
        `智能壓縮：${currentTokens} tokens → ${this.estimateTokens(messages)} tokens (超過 ${threshold} 閾值)`
      );
    }

    return true;
  }

  /**
   * 手動壓縮（/compress 命令用）：無閾值檢查，支援自訂指示
   * @returns 移除的消息數與 token 統計；消息太少時回傳 null
   */
  async compressNow(
    messages: ChatMessage[],
    modelName: string,
    instructions?: string
  ): Promise<{ removedCount: number; beforeTokens: number; afterTokens: number } | null> {
    if (messages.length <= 6) return null;

    const beforeTokens = this.estimateTokens(messages);
    const systemMsg = messages[0];
    const recentMessages = messages.slice(-KEEP_RECENT_MESSAGES);
    const oldMessages = messages.slice(1, -KEEP_RECENT_MESSAGES);
    const removedCount = oldMessages.length;

    let summary: string;
    try {
      const summaryPrompt: ChatMessage[] = [
        {
          role: "system",
          content:
            "你是一個對話摘要助手。請總結以下對話的關鍵決策、已完成的操作、重要文件路徑和未完成的事項。" +
            (instructions
              ? `用戶特別要求：${instructions}`
              : "") +
            " 只輸出摘要，不要其他內容。",
        },
        {
          role: "user",
          content: oldMessages
            .map((m) => `[${m.role}]: ${m.content?.substring(0, 800) || ""}`)
            .join("\n"),
        },
      ];
      summary = await this.llmClient.chat(summaryPrompt, false);
      if (!summary || summary.length < 10) {
        throw new Error("摘要太短");
      }
    } catch {
      summary = `之前進行了 ${oldMessages.length} 輪對話，包含文件操作和代碼修改。`;
    }

    messages.length = 0;
    messages.push(systemMsg);
    messages.push({
      role: "system",
      content: `[對話歷史摘要（${removedCount} 條消息已壓縮${instructions ? "，按用戶指示保留重點" : ""}）]\n${summary}`,
    });
    messages.push(...recentMessages);

    return { removedCount, beforeTokens, afterTokens: this.estimateTokens(messages) };
  }

  /** Context 用量信息（可視化用） */
  getUsageInfo(messages: ChatMessage[], modelName: string): {
    used: number;
    total: number;
    percent: number;
  } {
    const total = this.getModelContextWindow(modelName);
    const used = this.estimateTokens(messages);
    return { used, total, percent: Math.min(100, Math.round((used / total) * 100)) };
  }

  /** Context 用量進度條（渲染用） */
  renderUsageBar(messages: ChatMessage[], modelName: string): string {
    const { used, total, percent } = this.getUsageInfo(messages, modelName);
    const barLength = 20;
    const filled = Math.round((percent / 100) * barLength);
    const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

    const usedK = (used / 1000).toFixed(1);
    const totalK = (total / 1000).toFixed(0);

    // 超過 80% 警告
    const warn =
      percent >= 80
        ? " ⚠️ 即將滿載，建議 /compress 壓縮"
        : "";

    return `Context: ${percent}% ${bar} ${usedK}K/${totalK}K${warn}`;
  }
}
