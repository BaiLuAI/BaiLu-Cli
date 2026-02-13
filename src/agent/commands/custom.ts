/**
 * 自定義斜線命令
 * 從 .bailu/commands/*.md 載入用戶定義的命令
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";

interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  filePath: string;
}

/**
 * 解析 .md 文件的 YAML frontmatter
 */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content.trim() };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }

  return { meta, body: match[2].trim() };
}

/**
 * 載入所有自定義命令
 */
export function loadCustomCommands(): CustomCommand[] {
  const commandsDir = path.join(process.cwd(), ".bailu", "commands");
  if (!fs.existsSync(commandsDir)) {
    return [];
  }

  const commands: CustomCommand[] = [];
  try {
    const files = fs.readdirSync(commandsDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = path.join(commandsDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const { meta, body } = parseFrontmatter(content);
        const name = "/" + file.replace(/\.md$/, "");

        commands.push({
          name,
          description: meta.description || `自定義命令 ${name}`,
          prompt: body,
          filePath,
        });
      } catch {
        // 忽略無法讀取的文件
      }
    }
  } catch {
    // 目錄讀取失敗
  }

  return commands;
}

/**
 * 處理自定義命令
 * 將 .md 中的 prompt 注入到 AI 對話中
 */
export async function handleCustomCommand(
  commandName: string,
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  const commands = loadCustomCommands();
  const cmd = commands.find((c) => c.name === commandName);

  if (!cmd) {
    return { handled: false };
  }

  // 將參數替換到 prompt 中（支持 $1, $2, $ARGS 佔位符）
  let prompt = cmd.prompt;
  if (args.length > 0) {
    prompt = prompt.replace(/\$ARGS/g, args.join(" "));
    args.forEach((arg, i) => {
      prompt = prompt.replace(new RegExp(`\\$${i + 1}`, "g"), arg);
    });
  }

  // 注入到對話歷史，讓 AI 執行
  context.messages.push({
    role: "user",
    content: prompt,
  });

  return {
    handled: true,
    response: chalk.cyan(`▶ 執行自定義命令 ${cmd.name}: ${cmd.description}`),
    addToHistory: {
      userMessage: prompt,
      assistantMessage: "", // AI 會在後續對話中回應
    },
  };
}

/**
 * 列出所有自定義命令（用於 /help 顯示）
 */
export function listCustomCommands(): string {
  const commands = loadCustomCommands();
  if (commands.length === 0) return "";

  let output = chalk.bold("\n📌 自定義命令：\n");
  for (const cmd of commands) {
    output += chalk.cyan(`  ${cmd.name}`) + chalk.gray(` — ${cmd.description}\n`);
  }
  output += chalk.gray(`  (來源: .bailu/commands/*.md)\n`);
  return output;
}
