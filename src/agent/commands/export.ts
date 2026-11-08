/**
 * /export 命令 — 匯出對話為 Markdown 或 JSON
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { ChatMessage } from "../../llm/client.js";

function formatMarkdown(messages: ChatMessage[], title: string): string {
  const lines: string[] = [
    `# ${title}`,
    "",
    `> 由 Bailu CLI 匯出於 ${new Date().toLocaleString()}`,
    "",
  ];

  for (const msg of messages) {
    const role =
      msg.role === "user" ? "🙋 用戶" :
      msg.role === "assistant" ? "🦌 白鹿" :
      "⚙️ 系統";
    lines.push(`## ${role}`);
    lines.push("");
    lines.push(typeof msg.content === "string" ? msg.content : "[多模態內容]");
    lines.push("");
  }

  return lines.join("\n");
}

export async function handleExport(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  const format = (args[0] || "md").toLowerCase();
  const messages = context.messages;

  if (messages.length === 0) {
    return { handled: true, response: chalk.yellow("目前對話為空，沒有可匯出的內容") };
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const rootPath = context.workspaceContext.rootPath;

  if (format === "json") {
    const filePath = path.join(rootPath, `bailu-export-${timestamp}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ exportedAt: new Date().toISOString(), messages }, null, 2),
      "utf8"
    );
    return {
      handled: true,
      response: chalk.green(`✓ 已匯出 JSON: ${filePath}`),
    };
  }

  if (format === "md" || format === "markdown") {
    const filePath = path.join(rootPath, `bailu-export-${timestamp}.md`);
    const title = `Bailu 對話記錄（${messages.length} 則消息）`;
    fs.writeFileSync(filePath, formatMarkdown(messages, title), "utf8");
    return {
      handled: true,
      response: chalk.green(`✓ 已匯出 Markdown: ${filePath}`),
    };
  }

  return {
    handled: true,
    response: chalk.yellow("用法: /export [md|json]"),
  };
}
