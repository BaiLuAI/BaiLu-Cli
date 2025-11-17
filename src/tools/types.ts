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

export type ToolHandler = (params: Record<string, any>) => Promise<ToolResult>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * 工具調用上下文：包含執行時所需的所有信息
 */
export interface ToolExecutionContext {
  workspaceRoot: string;
  safetyMode: "dry-run" | "review" | "auto-apply";
  verbose?: boolean;
}

