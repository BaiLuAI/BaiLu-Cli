/**
 * 子代理調度工具（比照 Claude Code 的 Task/AgentTool）
 *
 * 把獨立的探索/規劃/驗證任務交給專用子代理，在獨立的對話上下文中執行，
 * 只回傳最終結論，不污染主對話的 context window。
 * 子代理只能使用唯讀工具（搜索、讀取），不能修改檔案。
 */

import path from "path";
import { Tool, ToolResult, ToolExecutionContext } from "../types.js";
import { ToolRegistry } from "../registry.js";
import { AgentManager, AgentType } from "../../agent/sub-agents.js";
import { validatePath } from "../../utils/path-validator.js";

/** 子代理可用的唯讀工具（不能寫檔、不能執行命令） */
const READONLY_TOOLS = new Set([
  "read_file",
  "list_directory",
  "grep_search",
  "file_search",
  "todo_write",
]);

const AGENT_TYPES: AgentType[] = ["explore", "plan", "verification"];

export const dispatchAgentTool: Tool = {
  definition: {
    name: "dispatch_agent",
    description:
      "把獨立的調研任務交給專用子代理在背景上下文中執行，只回傳結論。" +
      "適合：大範圍代碼探索（explore）、生成實施計劃（plan）、驗證修改正確性（verification）。" +
      "子代理擁有獨立的上下文窗口，不會佔用主對話的空間；它只能讀取和搜索，不能修改檔案。",
    parameters: [
      {
        name: "agent_type",
        type: "string",
        description:
          "子代理類型：explore（探索代碼庫結構、查找文件與代碼）、plan（分析需求生成實施計劃）、verification（驗證代碼修改正確性）",
        required: true,
      },
      {
        name: "task",
        type: "string",
        description: "給子代理的完整任務描述（要自包含，子代理看不到主對話內容）",
        required: true,
      },
    ],
  },

  handler: async (params, context: ToolExecutionContext | undefined): Promise<ToolResult> => {
    const agentType = params.agent_type as AgentType;
    const task = params.task as string;

    if (!AGENT_TYPES.includes(agentType)) {
      return {
        success: false,
        error: `無效的 agent_type: ${agentType}（可用: ${AGENT_TYPES.join(", ")}）`,
      };
    }
    if (typeof task !== "string" || !task.trim()) {
      return { success: false, error: "task 參數無效：必須是非空字符串" };
    }
    if (!context?.llmClient) {
      return { success: false, error: "子代理需要 LLM 客戶端，但當前上下文未提供" };
    }

    const workspaceRoot = context.workspaceRoot || process.cwd();
    const pathValidation = validatePath(".", workspaceRoot);
    if (!pathValidation.valid) {
      return { success: false, error: `工作區驗證失敗: ${pathValidation.error}` };
    }

    // 建立唯讀工具註冊表（子代理不能寫檔/執行命令）
    // 注意：直接從全局註冊表挑選唯讀工具，避免共享可變狀態
    const { globalToolRegistry } = await import("../registry.js");
    const readonlyRegistry = new ToolRegistry();
    for (const name of READONLY_TOOLS) {
      const tool = globalToolRegistry.get(name);
      if (tool) {
        readonlyRegistry.register(tool);
      }
    }

    const manager = new AgentManager(context.llmClient, readonlyRegistry, {
      ...context,
      safetyMode: "auto-apply", // 子代理只有唯讀工具，自動執行是安全的
    });

    try {
      const result = await manager.executeAgentTask(
        agentType,
        task,
        `工作區: ${workspaceRoot}`,
        { workspaceRoot, parentAgent: "main" }
      );

      if (!result.success) {
        return { success: false, error: result.error || "子代理執行失敗" };
      }

      return {
        success: true,
        output:
          `[子代理 ${agentType} 完成，${result.iterations} 輪迭代，${result.toolCallsExecuted} 次工具調用]\n\n` +
          result.output,
        metadata: {
          agentType,
          iterations: result.iterations,
          toolCallsExecuted: result.toolCallsExecuted,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `子代理執行異常: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
