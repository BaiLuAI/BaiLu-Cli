/**
 * 成本追蹤器
 * 追蹤 Token 用量和費用，支持即時顯示
 */

import chalk from "chalk";

// 模型定價（每 1K tokens，單位：人民幣）
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "bailu-2.6-preview": { input: 0.01, output: 0.03 },
  "bailu-Edge": { input: 0.005, output: 0.015 },
  "bailu-2.5": { input: 0.008, output: 0.024 },
};

const DEFAULT_PRICING = { input: 0.01, output: 0.03 };

export interface UsageRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  timestamp: Date;
}

export class CostTracker {
  private records: UsageRecord[] = [];
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;
  private totalCost = 0;
  private currentModel = "";

  setModel(model: string): void {
    this.currentModel = model;
  }

  /**
   * 記錄一次 API 調用的 usage
   */
  recordUsage(usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }, model?: string): void {
    const m = model || this.currentModel;
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

    const pricing = MODEL_PRICING[m] || DEFAULT_PRICING;
    const cost = (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output;

    this.totalPromptTokens += promptTokens;
    this.totalCompletionTokens += completionTokens;
    this.totalCost += cost;

    this.records.push({
      model: m,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
      timestamp: new Date(),
    });
  }

  /**
   * 格式化單次調用的 token 摘要（用於每輪結束後顯示）
   */
  formatLastUsage(): string {
    if (this.records.length === 0) return "";
    const last = this.records[this.records.length - 1];
    const inK = (last.promptTokens / 1000).toFixed(1);
    const outK = (last.completionTokens / 1000).toFixed(1);
    const costStr = last.cost.toFixed(4);
    const totalCostStr = this.totalCost.toFixed(4);
    return chalk.gray(`[Token: ${inK}K in / ${outK}K out | ¥${costStr} | 累計: ¥${totalCostStr}]`);
  }

  /**
   * 格式化完整統計（用於 /status 命令）
   */
  formatFullStats(): string {
    const lines: string[] = [
      chalk.bold("📊 Token 用量統計"),
      "",
      `  輸入 Token:   ${this.totalPromptTokens.toLocaleString()}`,
      `  輸出 Token:   ${this.totalCompletionTokens.toLocaleString()}`,
      `  總計 Token:   ${(this.totalPromptTokens + this.totalCompletionTokens).toLocaleString()}`,
      `  API 調用次數: ${this.records.length}`,
      "",
      `  本次費用:     ¥${this.totalCost.toFixed(4)}`,
    ];

    if (this.records.length > 0) {
      const avgCost = this.totalCost / this.records.length;
      lines.push(`  平均每次:     ¥${avgCost.toFixed(4)}`);
    }

    return lines.join("\n");
  }

  /**
   * 獲取原始統計數據
   */
  getStats() {
    return {
      totalPromptTokens: this.totalPromptTokens,
      totalCompletionTokens: this.totalCompletionTokens,
      totalTokens: this.totalPromptTokens + this.totalCompletionTokens,
      totalCost: this.totalCost,
      callCount: this.records.length,
    };
  }

  reset(): void {
    this.records = [];
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalCost = 0;
  }
}

// 全局實例
export const globalCostTracker = new CostTracker();
