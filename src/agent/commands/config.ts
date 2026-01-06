/**
 * 配置管理命令處理器
 */

import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { getConfig, saveConfig } from "../../config.js";

/**
 * /settings - 配置管理
 */
export async function handleSettings(args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    // 顯示當前配置
    const config = await getConfig();
    let settings = `\n${chalk.bold.cyan("當前配置：")}\n\n`;

    settings += chalk.yellow("API 配置：\n");
    settings += `  API Key: ${config.apiKey ? chalk.green("✓ 已設置") : chalk.red("✗ 未設置")}\n`;
    settings += `  模型: ${config.model || chalk.gray("(使用默認)")}\n`;
    settings += `  端點: ${config.baseUrl || chalk.gray("(使用默認)")}\n\n`;

    settings += chalk.yellow("安全模式：\n");
    settings += `  當前模式: ${process.env.BAILU_MODE || "review"}\n\n`;

    settings += chalk.gray("使用 /settings set <key> <value> 修改配置\n");
    settings += chalk.gray("例如: /settings set model bailu-2.5-pro");

    return { handled: true, response: settings };
  }

  if (args[0] === "set" && args.length >= 3) {
    const key = args[1];
    const value = args.slice(2).join(" ");

    const config = await getConfig();
    (config as any)[key] = value;
    await saveConfig(config);

    return {
      handled: true,
      response: chalk.green(`✓ 已設置 ${key} = ${value}`),
    };
  }

  return {
    handled: true,
    response: chalk.red("用法: /settings 或 /settings set <key> <value>"),
  };
}

/**
 * /mode - 切換安全模式
 */
export async function handleMode(args: string[]): Promise<SlashCommandResult> {
  const validModes = ["dry-run", "review", "auto-apply"];

  if (args.length === 0) {
    const currentMode = process.env.BAILU_MODE || "review";
    let response = chalk.cyan(`當前安全模式: ${chalk.bold(currentMode)}\n\n`);
    response += chalk.yellow("可用模式：\n");
    response += `  ${chalk.green("dry-run")}    - 僅顯示計畫，不執行\n`;
    response += `  ${chalk.green("review")}     - 每個操作前確認（默認）\n`;
    response += `  ${chalk.green("auto-apply")} - 自動執行（危險）\n\n`;
    response += chalk.gray("使用 /mode <模式> 切換");
    return { handled: true, response };
  }

  const newMode = args[0].toLowerCase();
  if (!validModes.includes(newMode)) {
    return {
      handled: true,
      response: chalk.red(`無效的模式: ${newMode}\n可用: ${validModes.join(", ")}`),
    };
  }

  process.env.BAILU_MODE = newMode;

  return {
    handled: true,
    response: chalk.green(`✓ 已切換到 ${chalk.bold(newMode)} 模式`),
  };
}
