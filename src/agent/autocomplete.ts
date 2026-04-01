/**
 * 斜線命令自動補全
 */

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
  { command: "/review", description: "AI 代碼審查（檢查bug、性能、安全等）", usage: "/review <文件路径>" },
  { command: "/workspace", description: "查看工作區信息" },
  { command: "/add", description: "添加文件到上下文", usage: "/add <文件路径>" },
  { command: "/drop", description: "從上下文移除文件", usage: "/drop <文件路径> | all" },
  { command: "/files", description: "列出當前上下文中的所有文件" },
  { command: "/stats", description: "查看會話性能統計" },
  { command: "/save", description: "保存當前會話", usage: "/save [會話名稱]" },
  { command: "/load", description: "加載已保存的會話", usage: "/load <會話名稱>" },
  { command: "/sessions", description: "列出所有已保存的會話" },
  { command: "/clear", alias: "/c", description: "清空對話歷史" },
  { command: "/exit", alias: "/q", description: "退出 CLI" },
];

/**
 * 顯示斜線命令選擇器（自寫渲染，避免 inquirer 在 Windows 的重繪鬼影問題）
 * @param initialInput 初始輸入，用於過濾命令
 */
export async function showSlashCommandPicker(initialInput: string = "/"): Promise<string | null> {
  const filteredCommands = filterCommands(initialInput);

  if (filteredCommands.length === 0) {
    console.log(chalk.yellow("\n沒有匹配的命令"));
    return null;
  }

  if (filteredCommands.length === 1 && filteredCommands[0].command === initialInput) {
    return filteredCommands[0].command;
  }

  const items = filteredCommands.map((cmd) => ({
    label: formatCommandDisplay(cmd),
    value: cmd.command,
  }));
  items.push({ label: chalk.gray("(取消)"), value: "" });

  let selected = 0;
  const pageSize = Math.min(15, items.length);

  // 渲染列表（覆蓋式重繪）
  const render = () => {
    // 移動游標到列表起始位置並清除舊內容
    // 先回到行首，清除 header + 所有列表行
    let output = "";
    for (let i = 0; i < pageSize + 1; i++) {
      output += "\x1b[2K"; // 清除整行
      if (i < pageSize) output += "\x1b[1B"; // 下移一行
    }
    // 回到起始位置
    output += `\x1b[${pageSize}A`;

    // 寫 header
    const hint = initialInput === "/" ? "" : ` (匹配 "${initialInput}")`;
    output += chalk.cyan(`斜線命令${hint}`) + "\n";

    // 計算滾動視窗
    let start = 0;
    if (selected >= pageSize - 1) {
      start = Math.min(selected - pageSize + 2, items.length - pageSize);
    }
    const end = Math.min(start + pageSize - 1, items.length); // -1 for header line

    for (let i = start; i < end; i++) {
      const prefix = i === selected ? chalk.cyan("❯ ") : "  ";
      output += `${prefix}${items[i].label}`;
      if (i < end - 1) output += "\n";
    }

    process.stdout.write("\r" + output);
  };

  return new Promise<string | null>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    stdin.setRawMode(true);
    stdin.resume();

    // 初始渲染：先寫空行佔位
    let placeholderLines = "";
    for (let i = 0; i < pageSize + 1; i++) {
      placeholderLines += "\n";
    }
    process.stdout.write(placeholderLines);
    process.stdout.write(`\x1b[${pageSize + 1}A`); // 回到起始位置
    render();

    const onData = (key: Buffer) => {
      const s = key.toString();

      // 上箭頭: \x1b[A
      if (s === "\x1b[A" || s === "\x1bOA") {
        if (selected > 0) {
          selected--;
          render();
        }
        return;
      }

      // 下箭頭: \x1b[B
      if (s === "\x1b[B" || s === "\x1bOB") {
        if (selected < items.length - 1) {
          selected++;
          render();
        }
        return;
      }

      // Enter
      if (s === "\r" || s === "\n") {
        cleanup();
        const val = items[selected].value;
        resolve(val || null);
        return;
      }

      // Escape 或 q
      if (s === "\x1b" || s === "q") {
        cleanup();
        resolve(null);
        return;
      }

      // Ctrl+C
      if (s === "\x03") {
        cleanup();
        resolve(null);
        return;
      }
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw ?? false);
      // 移動游標到列表末尾
      process.stdout.write("\n");
    };

    stdin.on("data", onData);
  });
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

