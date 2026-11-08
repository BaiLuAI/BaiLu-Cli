/**
 * /image 命令 — 附加圖片到下一則訊息（需模型支援 vision）
 *
 * 用法：/image <路徑>   支援 png/jpg/jpeg/gif/webp
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

/** 待發送的圖片附件（base64 data URL） */
const pendingImages: string[] = [];

/** 取出並清空待發送圖片（processUserInput 在組裝消息時呼叫） */
export function takePendingImages(): string[] {
  const images = [...pendingImages];
  pendingImages.length = 0;
  return images;
}

/** 是否有待發送圖片 */
export function hasPendingImages(): boolean {
  return pendingImages.length > 0;
}

export function handleImage(
  args: string[],
  context: SlashCommandContext
): SlashCommandResult {
  const inputPath = args[0];
  if (!inputPath) {
    return {
      handled: true,
      response: chalk.yellow(`用法: /image <圖片路徑>（支援 ${[...IMAGE_EXTENSIONS].join(" ")}，附加到下一則訊息）`),
    };
  }

  const absolutePath = path.resolve(context.workspaceContext.rootPath, inputPath);

  // 驗證
  const ext = path.extname(absolutePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return { handled: true, response: chalk.red(`不支援的格式: ${ext}（支援 ${[...IMAGE_EXTENSIONS].join(" ")}）`) };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return { handled: true, response: chalk.red(`檔案不存在: ${absolutePath}`) };
  }

  if (stat.size > MAX_IMAGE_SIZE) {
    return { handled: true, response: chalk.red(`圖片過大: ${(stat.size / 1024 / 1024).toFixed(1)}MB（上限 5MB）`) };
  }

  // 讀取並轉 base64 data URL
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const base64 = fs.readFileSync(absolutePath).toString("base64");
  pendingImages.push(`data:${mimeMap[ext]};base64,${base64}`);

  return {
    handled: true,
    response: chalk.green(`✓ 已附加圖片 ${path.basename(absolutePath)}（${(stat.size / 1024).toFixed(0)}KB）\n`) +
      chalk.gray("輸入訊息後將隨下一則訊息發送（需模型支援 vision）"),
  };
}
