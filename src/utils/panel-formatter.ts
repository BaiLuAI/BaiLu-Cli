/**
 * 面板格式化工具 - 使用 boxen 美化聊天介面
 */

import boxen from 'boxen';
import logSymbols from 'log-symbols';
import chalk from 'chalk';
import { renderMarkdown } from './markdown-renderer.js';

export interface PanelOptions {
  title?: string;
  type?: 'user' | 'assistant' | 'system' | 'error' | 'tool' | 'thinking';
  content: string;
  modelName?: string;
}

/**
 * 為不同類型的訊息創建美化面板
 */
export function createPanel(options: PanelOptions): string {
  const { title, type = 'assistant', content, modelName } = options;
  
  // 根據類型選擇圖示和顏色
  const typeConfig = {
    user: {
      icon: logSymbols.info,
      borderColor: 'cyan' as const,
      titleColor: chalk.cyan.bold,
      prefix: '你'
    },
    assistant: {
      icon: logSymbols.success,
      borderColor: 'green' as const,
      titleColor: chalk.green.bold,
      prefix: 'AI 助手'
    },
    system: {
      icon: logSymbols.warning,
      borderColor: 'yellow' as const,
      titleColor: chalk.yellow.bold,
      prefix: '系統'
    },
    error: {
      icon: logSymbols.error,
      borderColor: 'red' as const,
      titleColor: chalk.red.bold,
      prefix: '錯誤'
    },
    tool: {
      icon: '[*]',
      borderColor: 'magenta' as const,
      titleColor: chalk.magenta.bold,
      prefix: '工具執行'
    },
    thinking: {
      icon: '[~]',
      borderColor: 'gray' as const,
      titleColor: chalk.gray.bold,
      prefix: '思考中'
    }
  };

  const config = typeConfig[type];
  
  // 構建標題
  let panelTitle = `${config.icon} ${config.titleColor(config.prefix)}`;
  if (modelName && type === 'assistant') {
    panelTitle += ` ${chalk.gray(`[${modelName}]`)}`;
  }
  if (title) {
    panelTitle += ` ${chalk.gray('·')} ${title}`;
  }

  // 計算適當的寬度（根據終端寬度調整）
  const terminalWidth = process.stdout.columns || 80;
  const maxWidth = Math.min(100, terminalWidth - 4);

  // 創建面板
  return boxen(content, {
    padding: 1,
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: config.borderColor,
    title: panelTitle,
    titleAlignment: 'left',
    width: maxWidth > 40 ? maxWidth : undefined, // 如果終端太窄就不設置寬度
  });
}

/**
 * 創建簡單的分隔面板
 */
export function createSeparator(text?: string): string {
  const terminalWidth = process.stdout.columns || 80;
  const maxWidth = Math.min(100, terminalWidth - 4);
  
  if (text) {
    return boxen(text, {
      padding: 0,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      borderStyle: 'single',
      borderColor: 'gray',
      dimBorder: true,
      width: maxWidth > 40 ? maxWidth : undefined,
      textAlignment: 'center'
    });
  }
  
  // 如果沒有文字，返回簡單的分隔線
  return chalk.gray('─'.repeat(Math.min(60, terminalWidth - 4)));
}

/**
 * 創建使用者訊息面板
 */
export function createUserPanel(content: string): string {
  return createPanel({
    type: 'user',
    content
  });
}

/**
 * 創建 AI 回應面板（自動渲染 Markdown）
 */
export function createAssistantPanel(content: string, modelName?: string): string {
  // 先渲染 Markdown，再放入面板
  const renderedContent = renderMarkdown(content);
  
  return createPanel({
    type: 'assistant',
    content: renderedContent,
    modelName
  });
}

/**
 * 創建系統訊息面板
 */
export function createSystemPanel(content: string, title?: string): string {
  return createPanel({
    type: 'system',
    content,
    title
  });
}

/**
 * 創建錯誤訊息面板
 */
export function createErrorPanel(content: string, title?: string): string {
  return createPanel({
    type: 'error',
    content,
    title
  });
}

/**
 * 創建工具執行面板
 */
export function createToolPanel(content: string, toolName?: string): string {
  return createPanel({
    type: 'tool',
    content,
    title: toolName
  });
}

/**
 * 創建思考過程面板
 */
export function createThinkingPanel(content: string): string {
  return createPanel({
    type: 'thinking',
    content
  });
}

/**
 * 創建精簡版統計資訊面板（用於簡單對話）
 */
export function createCompactStatsPanel(stats: {
  totalTokensUsed: number;
  responseTime: number;
}): string {
  const content = [
    `Token: ${chalk.cyan(stats.totalTokensUsed.toString())}`,
    `時間: ${chalk.cyan((stats.responseTime / 1000).toFixed(2) + 's')}`
  ].join('  |  ');

  return boxen(content, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'single',
    borderColor: 'gray',
    dimBorder: true,
    textAlignment: 'center'
  });
}

/**
 * 創建完整統計資訊面板（用於複雜操作）
 */
export function createStatsPanel(stats: {
  messagesCount: number;
  toolCallsCount: number;
  totalTokensUsed: number;
  responseTime: number;
}): string {
  const content = [
    `訊息數: ${chalk.cyan(stats.messagesCount.toString())}`,
    `工具調用: ${chalk.cyan(stats.toolCallsCount.toString())}`,
    `Token 使用: ${chalk.cyan(stats.totalTokensUsed.toString())}`,
    `響應時間: ${chalk.cyan((stats.responseTime / 1000).toFixed(2) + 's')}`
  ].join('  |  ');

  return boxen(content, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'single',
    borderColor: 'gray',
    dimBorder: true,
    textAlignment: 'center'
  });
}
