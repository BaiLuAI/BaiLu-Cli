/**
 * 自定義斜線命令
 * 從 .bailu/commands/*.md 載入用戶定義的命令
 */

import { execSync } from "child_process";
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
 * 載入所有自定義命令（支援子目錄命名空間：/frontend:component → .bailu/commands/frontend/component.md）
 */
export function loadCustomCommands(): CustomCommand[] {
  const commandsDir = path.join(process.cwd(), ".bailu", "commands");
  if (!fs.existsSync(commandsDir)) {
    return [];
  }

  const commands: CustomCommand[] = [];

  const walk = (dir: string, namespace: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, namespace ? `${namespace}:${entry.name}` : entry.name);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const { meta, body } = parseFrontmatter(content);
          const baseName = entry.name.replace(/\.md$/, "");
          const name = "/" + (namespace ? `${namespace}:${baseName}` : baseName);

          commands.push({
            name,
            description: meta.description || `自定義命令 ${name}`,
            prompt: body,
            filePath: fullPath,
          });
        } catch {
          // 忽略無法讀取的文件
        }
      }
    }
  };

  walk(commandsDir, "");
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

  // 將參數替換到 prompt 中（支持 $ARGUMENTS / $ARGS / $1, $2... 佔位符）
  let prompt = cmd.prompt;
  if (args.length > 0) {
    prompt = prompt.replace(/\$ARGUMENTS/g, args.join(" "));
    prompt = prompt.replace(/\$ARGS/g, args.join(" "));
    args.forEach((arg, i) => {
      prompt = prompt.replace(new RegExp(`\\$${i + 1}`, "g"), arg);
    });
  }

  // !`command` 語法：執行 shell 命令並把輸出嵌入 prompt（比照 Claude Code）
  prompt = prompt.replace(/!`([^`]+)`/g, (_m, cmd: string) => {
    try {
      const output = execSync(cmd, {
        cwd: context.workspaceContext.rootPath,
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return `[${cmd} 的輸出]\n${String(output).trim()}`;
    } catch (error) {
      return `[命令執行失敗: ${cmd} — ${error instanceof Error ? error.message : String(error)}]`;
    }
  });

  // ! 開頭的行：執行整行 shell 命令並嵌入輸出
  prompt = prompt
    .split("\n")
    .map((line) => {
      if (!line.startsWith("!")) return line;
      const cmd = line.slice(1).trim();
      if (!cmd) return line;
      try {
          const output = execSync(cmd, {
          cwd: context.workspaceContext.rootPath,
          encoding: "utf-8",
          timeout: 30_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return String(output).trim();
      } catch (error) {
        return `[命令執行失敗: ${cmd} — ${error instanceof Error ? error.message : String(error)}]`;
      }
    })
    .join("\n");

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
