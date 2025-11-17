import { WorkspaceContext } from "../agent/types";
import { ChatMessage } from "./client";

function buildWorkspaceSummary(context: WorkspaceContext): string {
  const parts: string[] = [];
  parts.push(`Root: ${context.rootPath}`);
  if (context.config.testCommand) {
    parts.push(`Test command: ${context.config.testCommand}`);
  }
  if (context.config.buildCommand) {
    parts.push(`Build command: ${context.config.buildCommand}`);
  }
  if (context.importantFiles.length > 0) {
    parts.push(`Important files (subset):`);
    parts.push(context.importantFiles.slice(0, 16).map((f) => `- ${f}`).join("\n"));
  }
  if (context.agentDoc) {
    parts.push("\nAGENT guidance (from AGENT.md/AGENTS.md):\n");
    parts.push(context.agentDoc.slice(0, 2000));
  }
  return parts.join("\n");
}

export function buildAskPrompt(context: WorkspaceContext, question: string): ChatMessage[] {
  const summary = buildWorkspaceSummary(context);
  const system: ChatMessage = {
    role: "system",
    content:
      "你是一個專業的軟件工程 AI 助手。你只能基於我提供的項目信息進行推理，盡量具體，必要時給出代碼示例。",
  };
  const user: ChatMessage = {
    role: "user",
    content: `這是當前代碼庫的一部分概覽：\n\n${summary}\n\n我的問題是：\n${question}`,
  };
  return [system, user];
}

export function buildFixPrompt(context: WorkspaceContext, instruction: string): ChatMessage[] {
  const summary = buildWorkspaceSummary(context);
  const system: ChatMessage = {
    role: "system",
    content:
      "你是一個代碼修改助手。請基於指令給出具體的修改建議，必要時以 diff 或代碼片段形式呈現，但不要假設可以直接寫入文件。",
  };
  const user: ChatMessage = {
    role: "user",
    content: `這是當前代碼庫的一部分概覽：\n\n${summary}\n\n請根據以下需求提出修改建議，但暫時只需生成建議，不要假設改動已經應用：\n${instruction}`,
  };
  return [system, user];
}


