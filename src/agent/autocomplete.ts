/**
 * 斜線命令自動補全
 */

import readline from "readline";
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
  { command: "/clear", alias: "/c", description: "清空對話歷史" },
  { command: "/exit", alias: "/q", description: "退出 CLI" },
];

/**
 * 顯示斜線命令選擇器（使用自定義 readline UI）
 */
export async function showSlashCommandPicker(): Promise<string | null> {
  console.log(chalk.cyan("\n📋 可用的斜線命令（用上下鍵選擇，Enter 確認，Esc 取消）：\n"));

  const commands: Array<{ display: string; value: string | null }> = slashCommands.map((cmd) => ({
    display: formatCommandDisplay(cmd),
    value: cmd.command,
  }));

  // 添加取消選項
  commands.push({
    display: chalk.gray("  (取消)"),
    value: null,
  });

  let selectedIndex = 0;
  let isFirstRender = true;

  // 初始顯示
  for (let i = 0; i < commands.length; i++) {
    const isSelected = i === selectedIndex;
    const prefix = isSelected ? chalk.cyan("❯ ") : "  ";
    const display = isSelected ? chalk.bold(commands[i].display) : commands[i].display;
    console.log(prefix + display);
  }

  return new Promise((resolve) => {
    let wasRawMode = false;
    let hadKeypressListener = false;

    // 檢查是否已經在監聽 keypress
    const existingListeners = process.stdin.listenerCount("keypress");
    if (existingListeners === 0) {
      readline.emitKeypressEvents(process.stdin);
      hadKeypressListener = false;
    } else {
      hadKeypressListener = true;
    }

    // 設置 raw mode
    if (process.stdin.isTTY && !process.stdin.isRaw) {
      process.stdin.setRawMode(true);
      wasRawMode = false;
    } else {
      wasRawMode = true;
    }

    const onKeypress = (str: string, key: any) => {
      if (!key) return;

      if (key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        if (!isFirstRender) {
          renderCommands(commands, selectedIndex);
        } else {
          isFirstRender = false;
          renderCommands(commands, selectedIndex);
        }
      } else if (key.name === "down") {
        selectedIndex = Math.min(commands.length - 1, selectedIndex + 1);
        if (!isFirstRender) {
          renderCommands(commands, selectedIndex);
        } else {
          isFirstRender = false;
          renderCommands(commands, selectedIndex);
        }
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        console.log(); // 換行
        resolve(commands[selectedIndex].value);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        console.log(chalk.gray("\n(已取消)"));
        resolve(null);
      }
    };

    const cleanup = () => {
      // 移除事件監聽器
      process.stdin.off("keypress", onKeypress);
      
      // 恢復 raw mode 狀態
      if (process.stdin.isTTY && !wasRawMode) {
        process.stdin.setRawMode(false);
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

/**
 * 渲染命令列表
 */
function renderCommands(
  commands: Array<{ display: string; value: string | null }>,
  selectedIndex: number,
  isFirstRender = false
): void {
  if (!isFirstRender) {
    // 清除之前的輸出（只在非首次渲染時）
    readline.moveCursor(process.stdout, 0, -(commands.length + 1));
    readline.clearScreenDown(process.stdout);
  }

  // 重新渲染
  for (let i = 0; i < commands.length; i++) {
    const isSelected = i === selectedIndex;
    const prefix = isSelected ? chalk.cyan("❯ ") : "  ";
    const display = isSelected ? chalk.bold(commands[i].display) : commands[i].display;
    console.log(prefix + display);
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

