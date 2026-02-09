/**
 * Markdown 渲染器 - 使用 marked-terminal
 */

import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import chalk from 'chalk';

// 配置 marked 使用 terminal renderer
// @ts-ignore - marked-terminal 类型与 marked 接口不兼容，但运行时正常工作
marked.setOptions({
  // @ts-ignore - TerminalRenderer 类型定义与 marked 不完全兼容
  renderer: new TerminalRenderer({
    // 程式碼區塊樣式
    code: chalk.cyan,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.bold.green,
    // @ts-ignore - chalk 返回函数但 marked-terminal 期望字符串
    firstHeading: chalk.bold.cyan,
    hr: chalk.gray,
    listitem: chalk.cyan,
    list: (body: string) => body,
    paragraph: chalk.white,
    strong: chalk.bold.yellow,
    em: chalk.italic,
    codespan: chalk.green,
    del: chalk.dim.gray.strikethrough,
    link: chalk.blue.underline,
    href: chalk.blue.underline,
    
    // 表格樣式
    table: chalk.white,
    tablerow: (content: string) => content,
    tablecell: (content: string) => content,
    
    // 縮排和格式
    tab: 2,
    reflowText: true,
    width: 80,
    showSectionPrefix: false,
    
    // 程式碼高亮（使用內建的高亮）
    codeHighlight: true,
  })
});

/**
 * 渲染 Markdown 文本為終端機格式
 */
export function renderMarkdown(content: string): string {
  try {
    // 使用 marked 渲染 Markdown（同步版本）
    const rendered = marked.parse(content, { async: false }) as string;
    return rendered;
  } catch (error) {
    // 降級：渲染失敗時返回原始內容
    console.error(chalk.yellow('[Markdown 渲染錯誤]'), error);
    return content;
  }
}

/**
 * 檢測內容是否包含 Markdown 語法
 */
export function hasMarkdownSyntax(content: string): boolean {
  // 檢測常見的 Markdown 語法
  const markdownPatterns = [
    /^#+\s/m,              // 標題
    /\*\*[^*]+\*\*/,       // 粗體
    /\*[^*]+\*/,           // 斜體
    /`[^`]+`/,             // 行內程式碼
    /```[\s\S]*?```/,      // 程式碼區塊
    /^\s*[-*+]\s/m,        // 無序列表
    /^\s*\d+\.\s/m,        // 有序列表
    /\[([^\]]+)\]\(([^)]+)\)/, // 連結
    /^\s*>\s/m,            // 引用
    /^\s*\|.*\|.*\|/m,     // 表格
  ];
  
  return markdownPatterns.some(pattern => pattern.test(content));
}

/**
 * 智能渲染：自動檢測是否需要 Markdown 渲染
 */
export function smartRender(content: string): string {
  if (hasMarkdownSyntax(content)) {
    return renderMarkdown(content);
  }
  return content;
}
