/**
 * 自动 Git 提交功能
 * 使用 AI 生成描述性的提交信息
 */
import chalk from "chalk";
import { LLMClient } from "../llm/client";
import { 
  hasUncommittedChanges, 
  getChangedFiles, 
  getFileDiff, 
  autoCommit 
} from "./integration";

/**
 * 生成 AI 提交信息的选项
 */
export interface GenerateCommitMessageOptions {
  maxLength?: number;
  style?: "conventional" | "simple" | "descriptive";
  includeFiles?: boolean;
}

/**
 * 使用 AI 生成提交信息
 */
export async function generateCommitMessage(
  rootPath: string,
  llmClient: LLMClient,
  options: GenerateCommitMessageOptions = {}
): Promise<string | null> {
  const {
    maxLength = 100,
    style = "conventional",
    includeFiles = true,
  } = options;

  // 检查是否有变更
  if (!hasUncommittedChanges(rootPath)) {
    return null;
  }

  // 获取变更的文件和 diff
  const changedFiles = getChangedFiles(rootPath);
  const diff = getFileDiff(rootPath);

  // 限制 diff 长度以避免 token 过多
  const truncatedDiff = diff.length > 3000 
    ? diff.substring(0, 3000) + "\n... (truncated)"
    : diff;

  // 构建 prompt
  const styleGuides = {
    conventional: `使用 Conventional Commits 格式：
- feat: 新功能
- fix: 修复 bug
- docs: 文档更新
- style: 代码格式（不影响代码运行）
- refactor: 重构
- test: 测试相关
- chore: 构建过程或辅助工具变动

示例：feat: 添加用户登录功能`,
    simple: `使用简洁的描述，直接说明做了什么`,
    descriptive: `使用详细的描述，说明为什么做这个改动`,
  };

  const prompt = `你是一个 Git 提交信息生成器。请根据以下代码变更生成一个清晰、准确的提交信息。

${styleGuides[style]}

变更的文件（${changedFiles.length} 个）：
${changedFiles.map(f => `- ${f}`).join("\n")}

代码 diff：
\`\`\`diff
${truncatedDiff}
\`\`\`

要求：
1. 提交信息必须简洁明了
2. 长度不超过 ${maxLength} 个字符
3. 只返回提交信息本身，不要有任何额外的解释
4. 使用中文${style === "conventional" ? "，格式遵循 Conventional Commits" : ""}

请生成提交信息：`;

  try {
    const messages = [
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    let commitMessage = "";
    for await (const chunk of llmClient.chatStream(messages)) {
      commitMessage += chunk;
    }

    // 清理生成的提交信息
    commitMessage = commitMessage
      .trim()
      .replace(/^["']|["']$/g, "") // 移除引号
      .replace(/\n/g, " ") // 移除换行
      .substring(0, maxLength); // 限制长度

    return commitMessage || null;
  } catch (error) {
    console.error(chalk.red("生成提交信息失败:"), error);
    return null;
  }
}

/**
 * 自动提交变更（带 AI 生成的提交信息）
 */
export async function autoCommitWithAI(
  rootPath: string,
  llmClient: LLMClient,
  options: GenerateCommitMessageOptions = {}
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    // 检查是否有变更
    if (!hasUncommittedChanges(rootPath)) {
      return {
        success: false,
        error: "没有需要提交的变更",
      };
    }

    console.log(chalk.cyan("🤖 正在使用 AI 生成提交信息..."));

    // 生成提交信息
    const commitMessage = await generateCommitMessage(rootPath, llmClient, options);
    
    if (!commitMessage) {
      return {
        success: false,
        error: "无法生成提交信息",
      };
    }

    console.log(chalk.gray(`提交信息: ${commitMessage}`));

    // 执行提交
    const success = autoCommit(rootPath, commitMessage);

    if (success) {
      return {
        success: true,
        message: commitMessage,
      };
    } else {
      return {
        success: false,
        error: "Git 提交失败",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
