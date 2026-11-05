/**
 * /mcp 命令 — 查看 MCP 伺服器狀態、重連
 *
 * 用法：
 *   /mcp              顯示所有伺服器狀態
 *   /mcp reconnect <名稱>  重連指定伺服器
 */

import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { McpManager } from "../../mcp/manager.js";

/** 全局 MCP 管理器引用（chat.ts 啟動時注入） */
let globalMcpManager: McpManager | null = null;

export function setMcpManager(manager: McpManager | null): void {
  globalMcpManager = manager;
}

export async function handleMcp(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  const sub = args[0]?.toLowerCase();

  // /mcp reconnect <名稱>
  if (sub === "reconnect") {
    const name = args[1];
    if (!name) {
      return { handled: true, response: chalk.yellow("用法: /mcp reconnect <伺服器名稱>") };
    }
    if (!globalMcpManager) {
      return { handled: true, response: chalk.red("MCP 管理器未初始化") };
    }
    if (!context.toolRegistry) {
      return { handled: true, response: chalk.red("工具註冊表未初始化") };
    }

    const result = await globalMcpManager.reconnect(name, context.toolRegistry);
    return {
      handled: true,
      response: result.success
        ? chalk.green(`✓ ${result.message}`)
        : chalk.red(`✗ ${result.message}`),
    };
  }

  // /mcp — 狀態總覽
  if (!globalMcpManager) {
    return { handled: true, response: chalk.gray("MCP 未啟用（沒有配置任何 MCP 伺服器）") };
  }

  const servers = await globalMcpManager.listServers();
  if (servers.length === 0) {
    return {
      handled: true,
      response: chalk.gray("沒有配置 MCP 伺服器。在 .bailu.yml 或 .mcp.json 中配置 mcpServers。"),
    };
  }

  let response = chalk.bold.cyan("\nMCP 伺服器狀態：\n\n");
  for (const server of servers) {
    const status = server.connected ? chalk.green("● 已連接") : chalk.red("○ 未連接");
    response += `${status}  ${chalk.bold(server.name)} ${chalk.gray(`[${server.transport}]`)}\n`;
    response += chalk.gray(`    工具: ${server.toolCount}｜資源: ${server.resourceCount}｜提示: ${server.promptCount}\n`);
    if (server.error) {
      response += chalk.red(`    ${server.error}\n`);
    }
  }
  response += chalk.gray("\n重連: /mcp reconnect <名稱>");

  return { handled: true, response };
}
