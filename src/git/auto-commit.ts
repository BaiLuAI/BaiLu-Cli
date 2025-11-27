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
 * Truncate diff at line boundaries to ensure validity
 * @param diff Full diff content
 * @param maxChars Maximum characters (will truncate at line boundary before this)
 * @returns Truncated diff
 */
function truncateDiffSafely(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) {
    return diff;
  }

  // Find the last complete line before maxChars
  const truncated = diff.substring(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  
  if (lastNewline > 0) {
    // Truncate at last complete line
    return diff.substring(0, lastNewline) + "\n\n... (diff truncated for brevity)";
  }
  
  // Fallback if no newline found
  return truncated + "\n... (truncated)";
}

/**
 * Clean and trim commit message properly
 * @param message Raw commit message
 * @param maxLength Maximum length
 * @returns Cleaned message
 */
function cleanCommitMessage(message: string, maxLength: number): string {
  let cleaned = message
    .trim()
    .replace(/^["']|["']$/g, '') // Remove quotes
    .replace(/\n/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' '); // Collapse multiple spaces

  // Truncate at word boundary if too long
  if (cleaned.length > maxLength) {
    const truncated = cleaned.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      // Truncate at last space if it's reasonably close to maxLength
      cleaned = truncated.substring(0, lastSpace);
    } else {
      // Otherwise just hard truncate
      cleaned = truncated;
    }
  }

  return cleaned;
}

/**
 * 使用 AI 生成提交信息
 */
export async function generateCommitMessage(
  rootPath: string,
  llmClient: LLMClient,
  options: GenerateCommitMessageOptions = {}
): Promise<string | null> {
  // Validate rootPath
  if (!rootPath || typeof rootPath !== 'string') {
    throw new Error('Invalid rootPath: must be a non-empty string');
  }

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

  // Truncate diff safely at line boundaries to avoid token limits
  // Also helps prevent sending too much sensitive data to LLM
  const truncatedDiff = truncateDiffSafely(diff, 3000);

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
5. 不要包含敏感信息（如密码、密钥等）

请生成提交信息：`;

  try {
    const messages = [
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    let commitMessage = "";
    let chunkCount = 0;
    const maxChunks = 100; // Safety limit to prevent infinite streaming

    // Note: Consider adding timeout mechanism in production
    // The LLM client should have its own timeout handling
    for await (const chunk of llmClient.chatStream(messages)) {
      commitMessage += chunk;
      chunkCount++;
      
      // Safety check: prevent infinite streaming
      if (chunkCount > maxChunks) {
        console.warn(chalk.yellow('⚠️  LLM响应过长，已截断'));
        break;
      }
    }

    // Clean and properly truncate the commit message
    const cleaned = cleanCommitMessage(commitMessage, maxLength);

    return cleaned || null;
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
    // Validate inputs
    if (!rootPath || typeof rootPath !== 'string') {
      return {
        success: false,
        error: "无效的工作目录路径",
      };
    }

    if (!llmClient) {
      return {
        success: false,
        error: "LLM 客户端未初始化",
      };
    }

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
