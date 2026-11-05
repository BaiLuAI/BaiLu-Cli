/**
 * /output-style 命令 — 切換 AI 輸出風格（比照 Claude Code output styles）
 *
 * 風格會持久化到用戶配置，並透過環境變數注入 system prompt。
 */

import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { getConfig, saveConfig } from "../../config.js";

export const OUTPUT_STYLES = {
  default: "",
  concise: "回覆務求精簡：只給結論與關鍵步驟，不展開解釋，代碼注釋從簡。",
  verbose: "回覆務求詳盡：解釋每個決策的原因、列出替代方案、說明權衡取捨。",
  teaching: "教學模式：逐步解釋概念，指出相關的知識點與最佳實踐，適合學習場景。",
} as const;

export type OutputStyleName = keyof typeof OUTPUT_STYLES;

export async function handleOutputStyle(
  args: string[],
  _context: SlashCommandContext
): Promise<SlashCommandResult> {
  const styleName = args[0]?.toLowerCase();

  // 無參數：顯示當前風格與可選項
  if (!styleName) {
    const current = (process.env.BAILU_OUTPUT_STYLE as OutputStyleName) || "default";
    let response = chalk.bold.cyan(`當前輸出風格: ${current}\n\n`) + "可選風格：\n";
    for (const [name, directive] of Object.entries(OUTPUT_STYLES)) {
      const marker = name === current ? chalk.green("← 當前") : "";
      response += `  ${chalk.green(name.padEnd(12))} ${chalk.gray(directive || "標準行為")} ${marker}\n`;
    }
    response += chalk.gray(`\n用法: /output-style <風格名>`);
    return { handled: true, response };
  }

  if (!(styleName in OUTPUT_STYLES)) {
    return {
      handled: true,
      response: chalk.red(`未知風格: ${styleName}（可選: ${Object.keys(OUTPUT_STYLES).join(", ")}）`),
    };
  }

  // 持久化到用戶配置 + 環境變數即時生效
  process.env.BAILU_OUTPUT_STYLE = styleName;
  try {
    const config = await getConfig();
    config.outputStyle = styleName;
    await saveConfig(config);
  } catch {
    // 配置保存失敗不影響本次會話
  }

  return {
    handled: true,
    response: chalk.green(`✓ 輸出風格已切換為 ${styleName}（下次對話生效）`),
  };
}
