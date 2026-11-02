/**
 * /memory 命令 — 查看與管理分層記憶
 *
 * 用法：
 *   /memory          顯示所有記憶層（路徑 + 內容）
 *   /memory add <文字>  附加一條記憶到專案 BAILU.md
 *   /memory edit     用系統編輯器開啟專案記憶檔
 */

import chalk from "chalk";
import fs from "fs";
import { spawn } from "child_process";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import {
  loadMemoryLayers,
  appendMemory,
  getProjectMemoryPath,
} from "../memory-files.js";

export async function handleMemory(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  const rootPath = context.workspaceContext.rootPath;
  const sub = args[0]?.toLowerCase();

  // /memory — 顯示所有層
  if (!sub) {
    const layers = loadMemoryLayers(rootPath);
    let response = chalk.bold.cyan("\n分層記憶：\n\n");

    for (const layer of layers) {
      const status = layer.exists ? chalk.green("✓") : chalk.gray("（不存在，首次寫入時建立）");
      response += chalk.yellow(`${layer.name} `) + chalk.gray(`${layer.filePath} ${status}\n`);
      if (layer.exists && layer.content.trim()) {
        const preview = layer.content.trim().split("\n").slice(0, 10);
        for (const line of preview) {
          response += chalk.gray(`  │ ${line}\n`);
        }
        const total = layer.content.trim().split("\n").length;
        if (total > 10) {
          response += chalk.gray(`  │ ...共 ${total} 行\n`);
        }
      }
      response += "\n";
    }

    response += chalk.gray("用法: ");
    response += chalk.green("/memory add <文字>") + chalk.gray(" 附加記憶｜");
    response += chalk.green("/memory edit") + chalk.gray(" 用編輯器開啟專案記憶檔");

    return { handled: true, response };
  }

  // /memory add <文字>
  if (sub === "add") {
    const text = args.slice(1).join(" ").trim();
    if (!text) {
      return {
        handled: true,
        response: chalk.yellow("用法: /memory add <要記住的事項>"),
      };
    }

    const projectPath = getProjectMemoryPath(rootPath);
    try {
      appendMemory(projectPath, text);
      return {
        handled: true,
        response:
          chalk.green(`✓ 已記住（寫入 ${projectPath}）\n`) +
          chalk.gray("下次對話自動生效"),
      };
    } catch (error) {
      return {
        handled: true,
        response: chalk.red(`寫入失敗: ${error instanceof Error ? error.message : String(error)}`),
      };
    }
  }

  // /memory edit — 用編輯器開啟專案記憶檔
  if (sub === "edit") {
    const projectPath = getProjectMemoryPath(rootPath);
    if (!fs.existsSync(projectPath)) {
      fs.writeFileSync(projectPath, "# 專案記憶\n\n", "utf8");
    }

    const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === "win32" ? "notepad" : "vi");
    const child = spawn(editor, [projectPath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    return new Promise<SlashCommandResult>((resolve) => {
      child.on("exit", () => {
        resolve({
          handled: true,
          response: chalk.green(`✓ 編輯完成，下次對話自動載入 ${projectPath}`),
        });
      });
      child.on("error", () => {
        resolve({
          handled: true,
          response: chalk.red(`無法啟動編輯器「${editor}」。可設 EDITOR 環境變數，或手動編輯 ${projectPath}`),
        });
      });
    });
  }

  return {
    handled: true,
    response: chalk.yellow("用法: /memory | /memory add <文字> | /memory edit"),
  };
}
