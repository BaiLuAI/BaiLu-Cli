/**
 * 流式輸出面板 - 在框架內實現逐字流式輸出
 *
 * 設計說明（開放右側）：
 * 內容行只繪製左邊框，不繪製右邊框、不補空格，由終端自然換行。
 * 原因：emoji、全角標點、✔ 等字符在不同終端/字體下的渲染寬度不一致，
 * 任何基於字符寬度計算的右邊框補齊都會錯位。開放右側後沒有對齊基準，
 * 從根本上消除排版歪斜問題。
 *
 * 使用方式：
 * 1. start() - 繪製頂部邊框
 * 2. write(text) - 逐字輸出內容（自動處理換行和左邊框）
 * 3. end() - 繪製底部邊框
 */

import chalk from 'chalk';
import logSymbols from 'log-symbols';
import { beginConsoleCapture, endConsoleCapture } from './console-capture.js';

// ANSI 控制碼
const ANSI = {
  HIDE_CURSOR: '\x1b[?25l',
  SHOW_CURSOR: '\x1b[?25h',
  CLEAR_LINE: '\x1b[2K',
  CARRIAGE_RETURN: '\r',
};

// 框架字符（圓角風格）
const BOX = {
  topLeft: '╭',
  bottomLeft: '╰',
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
 * 結合字符、變體選擇器等零寬字符佔 0 個寬度
 */
function getCharWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  // 零寬字符：結合符號、變體選擇器、零寬空格等（渲染寬度為 0）
  if (
    (code >= 0x0300 && code <= 0x036F) || // 結合變音符號
    (code >= 0x200B && code <= 0x200F) || // 零寬空格、方向標記
    (code >= 0xFE00 && code <= 0xFE0F) || // 變體選擇器（emoji 文字/彩色呈現）
    code === 0xFEFF ||                     // 零寬不換行空格
    (code >= 0x2060 && code <= 0x2064)    // 其他零寬字符
  ) {
    return 0;
  }

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
  // Emoji 和其他寬字符
  if (code >= 0x1F000 && code <= 0x1FFFF) return 2;
  // CJK 擴展 B-F（罕見漢字）
  if (code >= 0x20000 && code <= 0x3FFFF) return 2;

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
 */
export class StreamingPanel {
  private options: Required<StreamingPanelOptions>;
  private width: number;
  private isStarted: boolean = false;
  private borderColorFn: (s: string) => string;
  private allContent: string = '';
  /** 跨 chunk 斷裂的高位代理（emoji 一半），等下一個 write 補全 */
  private pendingHighSurrogate: string = '';
  /** 當前行是否尚無內容（只有左邊框） */
  private currentLineEmpty: boolean = true;
  /** 當前行已使用的顯示寬度（不含左邊框） */
  private col: number = 0;
  /** 暫存的英文單字（避免單字被換行切斷） */
  private wordBuf: string = '';
  /** 內容區可用寬度（扣除左邊框，預留誤差邊際） */
  private readonly wrapWidth: number;
  /** 是否在 ANSI 轉義序列中（不計寬度） */
  private inAnsiEscape: boolean = false;

  constructor(options: StreamingPanelOptions = {}) {
    const terminalWidth = process.stdout.columns || 80;

    this.options = {
      title: options.title || 'AI 助手',
      modelName: options.modelName || '',
      borderColor: options.borderColor || 'green',
      maxWidth: options.maxWidth || Math.min(100, terminalWidth - 2),
    };

    this.width = this.options.maxWidth;
    // 內容寬度 = 總寬 - 左邊框與空格；再預留 2 格吸收字符寬度估算誤差，
    // 確保終端不會搶在我們之前換行（那會導致左邊凸出）
    this.wrapWidth = Math.max(20, this.width - 2 - 2);
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

    // 繪製頂部邊框（開放右側，無右角，標題寬度誤差不影響對齊）
    const icon = logSymbols.success;
    const titleText = this.options.modelName
      ? `${icon} ${chalk.green.bold(this.options.title)} ${chalk.gray(`[${this.options.modelName}]`)}`
      : `${icon} ${chalk.green.bold(this.options.title)}`;

    const titleVisibleWidth = getStringWidth(this.stripAnsi(titleText));
    const dashCount = Math.max(3, this.width - titleVisibleWidth - 4);

    const topLine = this.borderColorFn(BOX.topLeft) +
                    this.borderColorFn(BOX.horizontal) +
                    ' ' + titleText + ' ' +
                    this.borderColorFn(BOX.horizontal.repeat(dashCount));

    console.log(topLine);

    // 頂框畫完後才開始攔截外部 console 輸出（logger 警告等），避免打斷面板框線
    beginConsoleCapture();

    // 開始第一行內容（輸出左邊框）
    process.stdout.write(this.borderColorFn(BOX.vertical) + ' ');
    this.currentLineEmpty = true;
  }

  /**
   * 寫入文字（流式）
   * 每行帶左邊框；到達寬度時主動換行（懸掛縮排），避免終端搶先換行導致左邊凸出
   */
  write(text: string): void {
    if (!this.isStarted) {
      this.start();
    }

    // 補上上一個 chunk 留下的高位代理（emoji 跨 chunk 斷裂）
    if (this.pendingHighSurrogate) {
      text = this.pendingHighSurrogate + text;
      this.pendingHighSurrogate = '';
    }

    // 若結尾是高位代理（surrogate pair 前半），留到下一個 write 再輸出，
    // 避免代理對被拆成兩半寫入終端變成亂碼
    if (text.length > 0) {
      const lastCode = text.charCodeAt(text.length - 1);
      if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
        this.pendingHighSurrogate = text.slice(-1);
        text = text.slice(0, -1);
      }
    }

    if (!text) return;

    this.allContent += text;

    for (const char of text) {
      this.writeChar(char);
    }
  }

  /** 逐字符處理：換行、主動換行（懸掛縮排）、單字緩衝 */
  private writeChar(char: string): void {
    // ANSI 轉義序列：直接輸出，不計寬度
    if (this.inAnsiEscape) {
      process.stdout.write(char);
      if (char === 'm' || char === '\u0007') {
        this.inAnsiEscape = false;
      }
      return;
    }
    if (char === '\u001b') {
      this.inAnsiEscape = true;
      process.stdout.write(char);
      return;
    }

    // 換行：先清空單字緩衝，再換行並補左邊框
    if (char === '\n') {
      this.flushWord();
      this.startNewLine();
      return;
    }

    // 忽略 \r（避免 Windows 換行符干擾排版）
    if (char === '\r') {
      return;
    }

    // Tab 展開為 4 個空格（保持列寬計算一致）
    if (char === '\t') {
      this.flushWord();
      this.writePlain('    ');
      return;
    }

    // 英文單字字符：暫存，避免被換行切斷
    if (/[A-Za-z0-9'_\-.\/]/.test(char)) {
      this.wordBuf += char;
      // 單字本身超過一行寬（如超長 URL）：硬切
      if (getStringWidth(this.wordBuf) > this.wrapWidth) {
        this.flushWord();
      }
      return;
    }

    // 非單字字符：先輸出暫存的單字
    this.flushWord();
    this.writePlain(char);
  }

  /** 輸出字符並處理主動換行（懸掛縮排） */
  private writePlain(text: string): void {
    const w = getStringWidth(text);

    // 到達行寬：主動換行並補左邊框（零寬字符不觸發換行）
    if (w > 0 && this.col + w > this.wrapWidth) {
      this.startNewLine();
    }

    process.stdout.write(text);
    this.col += w;
    this.currentLineEmpty = false;
  }

  /** 輸出暫存的英文單字 */
  private flushWord(): void {
    if (!this.wordBuf) return;
    const word = this.wordBuf;
    this.wordBuf = '';

    // 單字放不進剩餘空間：先換行（單字保持完整）
    const w = getStringWidth(word);
    if (w > 0 && this.col > 0 && this.col + w > this.wrapWidth) {
      this.startNewLine();
    }

    process.stdout.write(word);
    this.col += w;
    this.currentLineEmpty = false;
  }

  /** 換行並補左邊框 */
  private startNewLine(): void {
    process.stdout.write('\n' + this.borderColorFn(BOX.vertical) + ' ');
    this.col = 0;
    this.currentLineEmpty = true;
  }

  /**
   * 結束流式輸出（繪製底部邊框）
   */
  end(): void {
    if (!this.isStarted) return;

    // 先結束攔截，取出面板期間暫存的外部輸出
    const captured = endConsoleCapture();

    // 補上殘留的代理字符（異常情況下的最後一個高位代理）
    if (this.pendingHighSurrogate) {
      process.stdout.write(this.pendingHighSurrogate);
      this.pendingHighSurrogate = '';
    }

    // 輸出暫存的單字
    this.flushWord();

    if (this.currentLineEmpty) {
      // 當前行只有左邊框：清除該行，直接畫底框
      process.stdout.write(ANSI.CARRIAGE_RETURN + ANSI.CLEAR_LINE);
    } else {
      process.stdout.write('\n');
    }

    // 繪製底部邊框（開放右側）
    const bottomLine = this.borderColorFn(BOX.bottomLeft) +
                       this.borderColorFn(BOX.horizontal.repeat(this.width - 2));
    console.log(bottomLine);

    // 顯示游標
    process.stdout.write(ANSI.SHOW_CURSOR);

    this.isStarted = false;

    // 補印面板期間被暫存的外部輸出（如模型切換警告），保持框線完整
    if (captured.length > 0) {
      for (const line of captured) {
        process.stdout.write(chalk.gray(`  ${line}\n`));
      }
    }
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
