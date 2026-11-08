/**
 * 工具調用系統的核心類型定義
 */

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  safe?: boolean; // 标记为安全的只读工具，review 模式下自动批准
}

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export type ToolHandler = (
  params: Record<string, any>,
  context?: ToolExecutionContext,
) => Promise<ToolResult>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * 工具調用上下文：包含執行時所需的所有信息
 */
export interface ToolExecutionContext {
  workspaceRoot: string;
  safetyMode: "dry-run" | "review" | "auto-apply" | "plan";
  verbose?: boolean;
  /** 已批准的命令前缀；仅在当前进程/会话内生效。 */
  approvedCommands?: string[];
  /** 是否允许 MCP 工具在 review 模式下自动执行。 */
  autoApproveMcp?: boolean;
  /** LLM 客户端（供 dispatch_agent 子代理使用） */
  llmClient?: import("../llm/client.js").LLMClient;
  /** 權限規則（來自 .bailu.yml 的 permissions.allow / deny） */
  permissionRules?: {
    allow?: string[];
    deny?: string[];
  };
  /** Hooks 鉤子配置（來自 .bailu.yml 的 hooks） */
  hooks?: import("../runtime/hooks.js").HookConfigMap;
  /** 會話環境變數（來自 .bailu.yml 的 env，啟動時合併到 process.env） */
  env?: Record<string, string>;
}

