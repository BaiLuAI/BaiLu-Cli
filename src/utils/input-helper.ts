/**
 * 输入辅助工具
 * 提供多行输入、输入验证等功能
 */
import chalk from "chalk";

/**
 * 检测输入是否应该继续（多行输入）
 */
export function shouldContinueInput(input: string): boolean {
  const trimmed = input.trim();
  
  // 以反斜杠结尾表示继续
  if (trimmed.endsWith("\\")) {
    return true;
  }
  
  // 未闭合的引号
  const singleQuotes = (trimmed.match(/'/g) || []).length;
  const doubleQuotes = (trimmed.match(/"/g) || []).length;
  
  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
    return true;
  }
  
  // 未闭合的括号
  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  const openBraces = (trimmed.match(/\{/g) || []).length;
  const closeBraces = (trimmed.match(/\}/g) || []).length;
  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/\]/g) || []).length;
  
  if (
    openParens !== closeParens ||
    openBraces !== closeBraces ||
    openBrackets !== closeBrackets
  ) {
    return true;
  }
  
  return false;
}

/**
 * 清理输入（移除多行连接符）
 */
export function cleanInput(input: string): string {
  return input
    .split("\n")
    .map((line) => line.replace(/\\$/, ""))
    .join("\n")
    .trim();
}

/**
 * 验证命令输入
 */
export function validateInput(input: string): { valid: boolean; error?: string } {
  const trimmed = input.trim();
  
  if (!trimmed) {
    return { valid: false, error: "輸入不能為空" };
  }
  
  // 检查是否只包含空白字符
  if (!/\S/.test(trimmed)) {
    return { valid: false, error: "輸入不能只包含空白字符" };
  }
  
  // 检查长度限制
  if (trimmed.length > 10000) {
    return { valid: false, error: "輸入過長（最多 10000 字符）" };
  }
  
  return { valid: true };
}

/**
 * 格式化提示符
 */
export function formatPrompt(multiline: boolean = false): string {
  if (multiline) {
    return chalk.gray("... ");
  }
  return chalk.cyan("\n你: ");
}

/**
 * 显示输入提示
 */
export function showInputHints(): void {
  console.log(chalk.gray("\n💡 輸入提示:"));
  console.log(chalk.gray("  - 輸入 / 可以查看所有斜線命令"));
  console.log(chalk.gray("  - 使用 \\ 在行末可以繼續輸入多行"));
  console.log(chalk.gray("  - 按 Ctrl+C 兩次退出"));
  console.log();
}

/**
 * 智能命令建议
 */
export function suggestCommands(partialInput: string): string[] {
  const commands = [
    "/help",
    "/model",
    "/models",
    "/status",
    "/tokens",
    "/clear",
    "/history",
    "/compress",
    "/settings",
    "/mode",
    "/undo",
    "/commit",
    "/workspace",
    "/exit",
    "/quit",
  ];
  
  const lowerInput = partialInput.toLowerCase();
  return commands.filter((cmd) => cmd.startsWith(lowerInput));
}

/**
 * 高亮显示代码块
 */
export function highlightCodeBlocks(text: string): string {
  // 简单的代码块高亮（检测 ``` 标记）
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  
  return text.replace(codeBlockRegex, (match, lang, code) => {
    return chalk.gray("```") + chalk.yellow(lang) + "\n" + 
           chalk.cyan(code) + 
           chalk.gray("```");
  });
}
