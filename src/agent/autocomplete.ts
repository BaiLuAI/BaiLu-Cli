/**
 * 斜線命令自動補全
 */

import inquirer from "inquirer";
import chalk from "chalk";

export interface SlashCommandDef {
  command: string;
  alias?: string;
  description: string;
  usage?: string;
}

export const slashCommands: SlashCommandDef[] = [
  { command: "/help", alias: "/h", description: "顯示幫助信息" },
  { command: "/status", alias: "/s", description: "查看 CLI 狀態、模型、token 使用" },
  { command: "/tokens", alias: "/t", description: "查看 token 使用詳情" },
  { command: "/model", alias: "/m", description: "切換或查看當前模型", usage: "/model [模型ID]" },
  { command: "/models", description: "列出所有可用模型" },
  { command: "/history", description: "顯示對話歷史摘要" },
  { command: "/compress", description: "壓縮對話上下文（保留最近 3 輪）" },
  { command: "/settings", description: "查看或修改配置", usage: "/settings [set <key> <value>]" },
  { command: "/mode", description: "切換安全模式", usage: "/mode [dry-run|review|auto-apply]" },
  { command: "/undo", alias: "/u", description: "回滾最近的文件修改", usage: "/undo [數字]" },
  { command: "/commit", description: "使用 AI 生成提交信息並自動提交" },
  { command: "/workspace", description: "查看工作區信息" },
  { command: "/clear", alias: "/c", description: "清空對話歷史" },
  { command: "/exit", alias: "/q", description: "退出 CLI" },
];

/**
 * 顯示斜線命令選擇器（使用 inquirer 库）
 * @param initialInput 初始輸入，用於過濾命令
 */
export async function showSlashCommandPicker(initialInput: string = "/"): Promise<string | null> {
  // 根據輸入過濾命令
  const filteredCommands = filterCommands(initialInput);
  
  if (filteredCommands.length === 0) {
    console.log(chalk.yellow("\n沒有匹配的命令"));
    return null;
  }
  
  // 如果只有一個匹配且完全匹配，直接返回
  if (filteredCommands.length === 1 && filteredCommands[0].command === initialInput) {
    return filteredCommands[0].command;
  }
  
  const inputHint = initialInput === "/" ? "" : ` (匹配 "${initialInput}")`;
  
  // 创建选择列表
  const choices = filteredCommands.map((cmd) => ({
    name: formatCommandDisplay(cmd),
    value: cmd.command,
  }));
  
  // 添加取消选项
  choices.push({
    name: chalk.gray("(取消)"),
    value: null as any,
  });
  
  try {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'command',
        message: `可用的斜線命令${inputHint}：`,
        choices: choices,
        pageSize: 15,
      },
    ]);
    
    return answer.command;
  } catch (error) {
    // 用户按 Ctrl+C 取消
    console.log(chalk.gray("\n(已取消)"));
    return null;
  }
}

/**
 * 格式化命令顯示
 */
function formatCommandDisplay(cmd: SlashCommandDef): string {
  const main = chalk.green(cmd.command);
  const alias = cmd.alias ? chalk.gray(` (${cmd.alias})`) : "";
  const desc = chalk.gray(` - ${cmd.description}`);
  return `${main}${alias}${desc}`;
}

/**
 * 根據輸入過濾命令
 */
export function filterCommands(input: string): SlashCommandDef[] {
  const normalizedInput = input.toLowerCase().trim();

  if (!normalizedInput || normalizedInput === "/") {
    return slashCommands;
  }

  return slashCommands.filter(
    (cmd) =>
      cmd.command.toLowerCase().startsWith(normalizedInput) ||
      (cmd.alias && cmd.alias.toLowerCase().startsWith(normalizedInput))
  );
}

/**
 * 獲取命令建議（用於自動補全提示）
 */
export function getCommandSuggestions(input: string): string[] {
  const filtered = filterCommands(input);
  return filtered.map((cmd) => cmd.command);
}

