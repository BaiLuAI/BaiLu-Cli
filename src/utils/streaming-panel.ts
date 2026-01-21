/**
 * 流式輸出面板 - 在框架內實現逐字流式輸出
 * 
 * 策略：先輸出標題行，逐字流式輸出內容，最後補上底部邊框
 */

import chalk from 'chalk';
import logSymbols from 'log-symbols';

// ANSI 控制碼
const ANSI = {
  HIDE_CURSOR: '\x1b[?25l',
  SHOW_CURSOR: '\x1b[?25h',
};

// 框架字符（圓角風格）
const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
};

export interface StreamingPanelOptions {
  title?: string;
  modelName?: string;
  borderColor?: 'green' | 'cyan' | 'yellow' | 'red' | 'magenta' | 'gray';
  maxWidth?: number;
}

/**
 * 計算字符的顯示寬度
 * 中文、日文、韓文等全角字符佔 2 個寬度
 * ASCII 字符佔 1 個寬度
 */
function getCharWidth(char: string): number {
  const code = char.charCodeAt(0);
  
  // 中日韓統一表意文字
  if (code >= 0x4E00 && code <= 0x9FFF) return 2;
  // 中日韓統一表意文字擴展A
  if (code >= 0x3400 && code <= 0x4DBF) return 2;
  // 中日韓相容表意文字
  if (code >= 0xF900 && code <= 0xFAFF) return 2;
  // 全角ASCII、全角標點
  if (code >= 0xFF00 && code <= 0xFFEF) return 2;
  // 中日韓符號和標點
  if (code >= 0x3000 && code <= 0x303F) return 2;
  // 日文平假名
  if (code >= 0x3040 && code <= 0x309F) return 2;
  // 日文片假名
  if (code >= 0x30A0 && code <= 0x30FF) return 2;
  // 韓文音節
  if (code >= 0xAC00 && code <= 0xD7AF) return 2;
  // Emoji 和其他寬字符（簡化處理）
  if (code >= 0x1F000 && code <= 0x1FFFF) return 2;
  
  return 1;
}

/**
 * 計算字符串的顯示寬度
 */
function getStringWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    width += getCharWidth(char);
  }
  return width;
}

/**
 * 流式輸出面板類
 * 
 * 使用方式：
 * 1. start() - 繪製頂部邊框
 * 2. write(text) - 逐字輸出內容（自動處理換行和左邊框）
 * 3. end() - 繪製底部邊框
 */
export class StreamingPanel {
  private options: Required<StreamingPanelOptions>;
  private width: number;
  private contentWidth: number;
  private isStarted: boolean = false;
  private currentLineWidth: number = 0; // 當前行的顯示寬度
  private borderColorFn: (s: string) => string;
  private allContent: string = '';

  constructor(options: StreamingPanelOptions = {}) {
    const terminalWidth = process.stdout.columns || 80;
    
    this.options = {
      title: options.title || 'AI 助手',
      modelName: options.modelName || '',
      borderColor: options.borderColor || 'green',
      maxWidth: options.maxWidth || Math.min(100, terminalWidth - 2),
    };

    this.width = this.options.maxWidth;
    this.contentWidth = this.width - 4; // 左右邊框各1 + padding各1
    this.borderColorFn = this.getColorFn(this.options.borderColor);
  }

  private getColorFn(color: string): (s: string) => string {
    const colorMap: Record<string, (s: string) => string> = {
      green: chalk.green,
      cyan: chalk.cyan,
      yellow: chalk.yellow,
      red: chalk.red,
      magenta: chalk.magenta,
      gray: chalk.gray,
    };
    return colorMap[color] || chalk.green;
  }

  /**
   * 開始流式輸出（繪製頂部邊框）
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    // 隱藏游標
    process.stdout.write(ANSI.HIDE_CURSOR);

    // 繪製頂部邊框
    const icon = logSymbols.success;
    const titleText = this.options.modelName 
      ? `${icon} ${chalk.green.bold(this.options.title)} ${chalk.gray(`[${this.options.modelName}]`)}`
      : `${icon} ${chalk.green.bold(this.options.title)}`;
    
    const titleVisibleWidth = getStringWidth(this.stripAnsi(titleText));
    const lineLength = this.width - titleVisibleWidth - 4;
    
    const topLine = this.borderColorFn(BOX.topLeft) + 
                    ' ' + titleText + ' ' +
                    this.borderColorFn(BOX.horizontal.repeat(Math.max(0, lineLength))) +
                    this.borderColorFn(BOX.topRight);
    
    console.log(topLine);
    
    // 開始第一行內容（輸出左邊框和 padding）
    process.stdout.write(this.borderColorFn(BOX.vertical) + ' ');
    this.currentLineWidth = 0;
  }

  /**
   * 寫入文字（流式）
   */
  write(text: string): void {
    if (!this.isStarted) {
      this.start();
    }

    for (const char of text) {
      this.allContent += char;
      
      if (char === '\n') {
        // 換行：補齊當前行的空白，輸出右邊框，然後開始新行
        this.finishLine();
        this.startNewLine();
      } else {
        const charWidth = getCharWidth(char);
        
        // 檢查是否需要自動換行（考慮字符寬度）
        if (this.currentLineWidth + charWidth > this.contentWidth) {
          this.finishLine();
          this.startNewLine();
        }
        
        // 輸出字符
        process.stdout.write(char);
        this.currentLineWidth += charWidth;
      }
    }
  }

  /**
   * 完成當前行（補齊空白 + 右邊框）
   */
  private finishLine(): void {
    const padding = this.contentWidth - this.currentLineWidth;
    if (padding > 0) {
      process.stdout.write(' '.repeat(padding));
    }
    process.stdout.write(' ' + this.borderColorFn(BOX.vertical));
  }

  /**
   * 開始新行
   */
  private startNewLine(): void {
    process.stdout.write('\n');
    process.stdout.write(this.borderColorFn(BOX.vertical) + ' ');
    this.currentLineWidth = 0;
  }

  /**
   * 結束流式輸出（繪製底部邊框）
   */
  end(): void {
    if (!this.isStarted) return;

    // 完成當前行
    this.finishLine();
    process.stdout.write('\n');

    // 繪製底部邊框
    const bottomLine = this.borderColorFn(BOX.bottomLeft) +
                       this.borderColorFn(BOX.horizontal.repeat(this.width - 2)) +
                       this.borderColorFn(BOX.bottomRight);
    console.log(bottomLine);

    // 顯示游標
    process.stdout.write(ANSI.SHOW_CURSOR);
    
    this.isStarted = false;
  }

  /**
   * 移除 ANSI 控制碼
   */
  private stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * 獲取已輸出的完整內容
   */
  getContent(): string {
    return this.allContent;
  }
}

/**
 * 創建流式輸出面板的便捷函數
 */
export function createStreamingPanel(options?: StreamingPanelOptions): StreamingPanel {
  return new StreamingPanel(options);
}
