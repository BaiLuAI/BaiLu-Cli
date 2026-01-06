/**
 * 模型管理命令處理器
 */

import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { getConfig, saveConfig } from "../../config.js";

/**
 * /model - 切換模型
 */
export async function handleModel(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
  if (args.length === 0) {
    // 顯示當前模型
    const currentModel = context.llmClient["model"];
    return {
      handled: true,
      response: chalk.cyan(`當前使用模型: ${chalk.bold(currentModel)}\n使用 /models 查看所有可用模型`),
    };
  }

  const newModel = args[0];
  context.llmClient["model"] = newModel;

  // 持久化模型設定到配置文件
  const config = await getConfig();
  config.model = newModel;
  await saveConfig(config);

  return {
    handled: true,
    response: chalk.green(`✓ 已切換到模型: ${chalk.bold(newModel)}\n✓ 模型設定已保存到配置文件`),
  };
}

/**
 * /models - 列出所有可用模型
 */
export async function handleListModels(context: SlashCommandContext): Promise<SlashCommandResult> {
  try {
    console.log(chalk.gray("正在獲取模型列表..."));
    const models = await context.llmClient.listModels();
    const currentModel = context.llmClient["model"];

    let response = chalk.cyan("\n可用模型：\n");
    for (const model of models) {
      const mark = model === currentModel ? chalk.green("● ") : "  ";
      response += `${mark}${model}\n`;
    }

    response += chalk.gray(`\n使用 /model <模型ID> 切換模型`);

    return { handled: true, response };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`獲取模型列表失敗: ${error}`),
    };
  }
}
