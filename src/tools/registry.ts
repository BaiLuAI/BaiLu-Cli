/**
 * 工具註冊中心：管理所有可用工具
 */

import { Tool, ToolDefinition } from "./types";

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * 註冊一個工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`工具 "${tool.definition.name}" 已經註冊過了`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  /**
   * 註冊多個工具
   */
  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 獲取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 檢查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 獲取所有工具定義（用於發送給 LLM）
   */
  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }

  /**
   * 獲取所有工具名稱
   */
  getAllNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * 獲取工具數量
   */
  size(): number {
    return this.tools.size;
  }
}

/**
 * 全局工具註冊中心實例
 */
export const globalToolRegistry = new ToolRegistry();

