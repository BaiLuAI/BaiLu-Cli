/**
 * 代码审查功能
 * 使用 AI 分析代码质量、安全性和最佳实践
 */
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { LLMClient } from "../llm/client";

/**
 * 审查结果类型
 */
export interface ReviewIssue {
  type: "error" | "warning" | "info" | "suggestion";
  category: "bug" | "performance" | "security" | "style" | "best-practice";
  line?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  file: string;
  summary: string;
  issues: ReviewIssue[];
  overallScore?: number; // 0-100
}

/**
 * 审查选项
 */
export interface ReviewOptions {
  checkBugs?: boolean;
  checkPerformance?: boolean;
  checkSecurity?: boolean;
  checkStyle?: boolean;
  checkBestPractices?: boolean;
  maxIssues?: number;
}

/**
 * 使用 AI 审查代码文件
 */
export async function reviewCodeFile(
  filePath: string,
  llmClient: LLMClient,
  options: ReviewOptions = {}
): Promise<ReviewResult | null> {
  const {
    checkBugs = true,
    checkPerformance = true,
    checkSecurity = true,
    checkStyle = true,
    checkBestPractices = true,
    maxIssues = 20,
  } = options;

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return null;
  }

  // 读取文件内容
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    console.error(chalk.red(`无法读取文件: ${filePath}`));
    return null;
  }

  // 限制文件大小（避免 token 过多）
  const maxLength = 5000;
  if (content.length > maxLength) {
    content = content.substring(0, maxLength) + "\n... (文件过大，已截断)";
  }

  // 检测文件类型
  const ext = path.extname(filePath).toLowerCase();
  const language = detectLanguage(ext);

  // 构建审查 prompt
  const checks = [];
  if (checkBugs) checks.push("潜在 bug");
  if (checkPerformance) checks.push("性能问题");
  if (checkSecurity) checks.push("安全漏洞");
  if (checkStyle) checks.push("代码规范");
  if (checkBestPractices) checks.push("最佳实践");

  const prompt = `你是一个专业的代码审查专家。请审查以下 ${language} 代码，重点检查：${checks.join("、")}。

文件路径：${filePath}

代码内容：
\`\`\`${language}
${content}
\`\`\`

请按以下 JSON 格式返回审查结果（只返回 JSON，不要有其他文字）：
{
  "summary": "整体评价（50字以内）",
  "overallScore": 85,
  "issues": [
    {
      "type": "warning",
      "category": "bug",
      "line": 42,
      "message": "问题描述",
      "suggestion": "改进建议（可选）"
    }
  ]
}

注意：
1. type 可以是: error, warning, info, suggestion
2. category 可以是: bug, performance, security, style, best-practice
3. line 是行号（如果能定位）
4. 最多返回 ${maxIssues} 个问题
5. 按严重程度排序（error > warning > info > suggestion）
6. 如果代码很好，issues 可以是空数组
7. overallScore 是代码质量评分（0-100）

请开始审查：`;

  try {
    const messages = [
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    let response = "";
    for await (const chunk of llmClient.chatStream(messages)) {
      response += chunk;
    }

    // 解析 JSON 响应
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(chalk.red("AI 返回格式错误"));
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);

    return {
      file: filePath,
      summary: result.summary || "审查完成",
      issues: result.issues || [],
      overallScore: result.overallScore,
    };
  } catch (error) {
    console.error(chalk.red("代码审查失败:"), error);
    return null;
  }
}

/**
 * 格式化审查结果输出
 */
export function formatReviewResult(result: ReviewResult): string {
  let output = "";

  // 文件标题
  output += chalk.bold.cyan(`\n📋 代码审查报告: ${path.basename(result.file)}\n`);
  output += chalk.gray(`━`.repeat(60)) + "\n\n";

  // 整体评价
  output += chalk.yellow("📊 整体评价：\n");
  output += chalk.gray(`  ${result.summary}\n`);
  
  if (result.overallScore !== undefined) {
    const scoreColor = 
      result.overallScore >= 80 ? chalk.green :
      result.overallScore >= 60 ? chalk.yellow :
      chalk.red;
    output += chalk.gray(`  质量评分: ${scoreColor(result.overallScore)}/100\n`);
  }
  output += "\n";

  // 问题列表
  if (result.issues.length === 0) {
    output += chalk.green("✓ 未发现明显问题\n");
    output += chalk.gray("  代码质量良好，继续保持！\n");
  } else {
    // 按类型分组
    const errors = result.issues.filter(i => i.type === "error");
    const warnings = result.issues.filter(i => i.type === "warning");
    const infos = result.issues.filter(i => i.type === "info");
    const suggestions = result.issues.filter(i => i.type === "suggestion");

    if (errors.length > 0) {
      output += chalk.red.bold(`❌ 错误 (${errors.length}):\n`);
      errors.forEach((issue, idx) => {
        output += formatIssue(issue, idx + 1);
      });
      output += "\n";
    }

    if (warnings.length > 0) {
      output += chalk.yellow.bold(`⚠️  警告 (${warnings.length}):\n`);
      warnings.forEach((issue, idx) => {
        output += formatIssue(issue, idx + 1);
      });
      output += "\n";
    }

    if (infos.length > 0) {
      output += chalk.blue.bold(`ℹ️  提示 (${infos.length}):\n`);
      infos.forEach((issue, idx) => {
        output += formatIssue(issue, idx + 1);
      });
      output += "\n";
    }

    if (suggestions.length > 0) {
      output += chalk.cyan.bold(`💡 建议 (${suggestions.length}):\n`);
      suggestions.forEach((issue, idx) => {
        output += formatIssue(issue, idx + 1);
      });
      output += "\n";
    }
  }

  output += chalk.gray(`━`.repeat(60)) + "\n";
  return output;
}

/**
 * 格式化单个问题
 */
function formatIssue(issue: ReviewIssue, index: number): string {
  let output = "";
  
  const categoryIcon = {
    "bug": "🐛",
    "performance": "⚡",
    "security": "🔒",
    "style": "🎨",
    "best-practice": "✨",
  };

  const icon = categoryIcon[issue.category] || "•";
  const lineInfo = issue.line ? chalk.gray(` (第${issue.line}行)`) : "";
  
  output += chalk.gray(`  ${index}. `) + icon + lineInfo + "\n";
  output += chalk.gray(`     ${issue.message}\n`);
  
  if (issue.suggestion) {
    output += chalk.gray(`     💡 建议: ${issue.suggestion}\n`);
  }
  
  return output;
}

/**
 * 检测编程语言
 */
function detectLanguage(ext: string): string {
  const langMap: { [key: string]: string } = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".cpp": "cpp",
    ".c": "c",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".vue": "vue",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
  };

  return langMap[ext] || "code";
}
