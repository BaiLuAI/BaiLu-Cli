/**
 * TUI 輸入框（比照 Claude Code 的底部輸入框）
 *
 * 常駐終端底部的框線輸入區，raw mode 完整行編輯：
 * - 光標移動（← → Home End）、歷史（↑ ↓）、退格、Delete
 * - 水平滾動（長文本超出寬度時窗口跟隨光標）
 * - 處理期間：打字仍可編輯，Enter 提交（由上層排隊），Esc 中斷當前回合
 * - 多行貼上：整段作為一則訊息提交
 *
 * 渲染採用「開放右側」設計（與串流面板一致），避免字符寬度估算誤差導致框線錯位。
 */

import { getStringWidth } from "../utils/terminal-width.js";

/** 按鍵處理結果（供測試斷言） */
export interface KeyHandleResult {
  /** 是否產生提交 */
  submitted: boolean;
  /** 提交的文本（submitted 時有效） */
  text?: string;
  /** 是否觸發中斷（Esc） */
  interrupted: boolean;
  /** 是否請求退出（空 buffer 按 Ctrl+C / Ctrl+D） */
  exitRequested: boolean;
  /** 狀態是否變化（需要重繪） */
  changed: boolean;
}

export interface InputBoxOptions {
  /** 提示符文字（顯示在內容行開頭） */
  prompt?: string;
  /** 終端寬度（默認取 process.stdout.columns） */
  width?: number;
  /** 歷史記錄初始內容 */
  history?: string[];
  /**
   * Tab 補全器：給定當前文本與光標，回傳替換後的文本與光標；
   * 回傳 null 表示無補全。重複 Tab 由補全器自行循環。
   */
  completer?: (text: string, cursor: number) => { text: string; cursor: number } | null;
}

/** 渲染結果 */
export interface InputBoxRender {
  top: string;
  line: string;
  bottom: string;
  /** 光標在內容行中的列位置（0 起） */
  cursorCol: number;
}

export class InputBox {
  /** 輸入緩衝（按碼點切分） */
  private buffer: string[] = [];
  /** 光標位置（碼點索引） */
  private cursor = 0;
  /** 歷史記錄 */
  private history: string[] = [];
  private historyIndex = -1;
  private savedBuffer = "";
  /** 是否活躍（接收按鍵） */
  private active = false;
  /** 是否暫停（處理期間：仍可編輯，提交由上層排隊） */
  private paused = false;
  /** 水平滾動偏移（碼點索引） */
  private scrollOffset = 0;

  private onSubmitCb?: (text: string) => void;
  private onInterruptCb?: () => void;
  private onExitCb?: () => void;
  private onRedrawCb?: (rendered: InputBoxRender) => void;

  private readonly prompt: string;
  private readonly width: number;
  private completer?: (text: string, cursor: number) => { text: string; cursor: number } | null;

  constructor(options: InputBoxOptions = {}) {
    this.prompt = options.prompt ?? "You: ";
    this.width = options.width ?? (process.stdout.columns || 80);
    this.history = [...(options.history ?? [])];
    this.completer = options.completer;
  }

  // ── 回調註冊 ──────────────────────────────────────────────

  onSubmit(cb: (text: string) => void): void {
    this.onSubmitCb = cb;
  }

  onInterrupt(cb: () => void): void {
    this.onInterruptCb = cb;
  }

  onExit(cb: () => void): void {
    this.onExitCb = cb;
  }

  /** 重繪回調（OutputManager 接管實際渲染與光標定位） */
  onRedraw(cb: (rendered: InputBoxRender) => void): void {
    this.onRedrawCb = cb;
  }

  // ── 生命週期 ──────────────────────────────────────────────

  start(): void {
    this.active = true;
    this.redraw();
  }

  close(): void {
    this.active = false;
  }

  pause(): void {
    this.paused = true;
    this.redraw();
  }

  resume(): void {
    this.paused = false;
    this.redraw();
  }

  get isActive(): boolean {
    return this.active;
  }

  // ── 狀態存取（測試用） ────────────────────────────────────

  getText(): string {
    return this.buffer.join("");
  }

  getCursor(): number {
    return this.cursor;
  }

  setText(text: string): void {
    this.buffer = Array.from(text);
    this.cursor = this.buffer.length;
    this.scrollOffset = 0;
    this.redraw();
  }

  clearText(): void {
    this.buffer = [];
    this.cursor = 0;
    this.scrollOffset = 0;
  }

  addHistory(text: string): void {
    if (text.trim() && this.history[this.history.length - 1] !== text) {
      this.history.push(text);
    }
    this.historyIndex = -1;
  }

  // ── 按鍵處理（純邏輯，可測試） ────────────────────────────

  /**
   * 處理一段終端輸入（raw mode bytes 解碼後的字符串）
   * 支援單鍵與轉義序列（方向鍵、Home/End、Delete）
   */
  handleKey(chunk: string): KeyHandleResult {
    const result: KeyHandleResult = {
      submitted: false,
      interrupted: false,
      exitRequested: false,
      changed: false,
    };

    if (!this.active) return result;

    // 多行貼上：整段（含內部換行）作為一則訊息提交
    // 注意：單獨的 \r / \n 是 Enter，不走此分支
    if (chunk.length > 1 && (chunk.includes("\n") || chunk.includes("\r")) && !chunk.startsWith("\u001b")) {
      const text = chunk.replace(/\r\n?/g, "\n").replace(/\n+$/, "").trim();
      if (text) {
        this.addHistory(text);
        result.submitted = true;
        result.text = text;
        this.onSubmitCb?.(text);
      }
      this.redraw();
      return result;
    }

    // 完整轉義序列（方向鍵等）
    if (chunk.length > 1 && chunk.startsWith("\u001b")) {
      return this.handleEscapeSequence(chunk, result);
    }

    // 逐字符處理
    for (const ch of Array.from(chunk)) {
      const stop = this.handleSingleChar(ch, result);
      if (stop) return result; // 提交/中斷/退出時立即返回
    }

    if (result.changed) this.redraw();
    return result;
  }

  /** @returns true 表示已終止處理（提交/中斷/退出） */
  private handleSingleChar(ch: string, result: KeyHandleResult): boolean {
    switch (ch) {
      case "\r": // Enter
      case "\n": {
        const text = this.buffer.join("").trim();
        this.buffer = [];
        this.cursor = 0;
        this.scrollOffset = 0;
        if (text) {
          this.addHistory(text);
          result.submitted = true;
          result.text = text;
          this.onSubmitCb?.(text);
        }
        this.redraw();
        return true;
      }

      case "\u007f": // Backspace
      case "\b":
        if (this.cursor > 0) {
          this.buffer.splice(this.cursor - 1, 1);
          this.cursor--;
          result.changed = true;
        }
        return false;

      case "\u001b": // 單獨 Esc：中斷
        result.interrupted = true;
        this.onInterruptCb?.();
        return true;

      case "\u0003": // Ctrl+C
        if (this.buffer.length === 0) {
          result.exitRequested = true;
          this.onExitCb?.();
          return true;
        }
        // 有內容：清空（Claude Code 行為）
        this.buffer = [];
        this.cursor = 0;
        this.scrollOffset = 0;
        result.changed = true;
        return false;

      case "\u0004": // Ctrl+D：退出
        result.exitRequested = true;
        this.onExitCb?.();
        return true;

      case "\t": { // Tab：路徑/命令補全
        if (this.completer) {
          const completion = this.completer(this.buffer.join(""), this.cursor);
          if (completion) {
            this.buffer = Array.from(completion.text);
            this.cursor = Math.min(completion.cursor, this.buffer.length);
            result.changed = true;
          }
        }
        return false;
      }

      default:
        if (ch >= " ") {
          // 可打印字符（含 UTF-8）插入光標處
          this.buffer.splice(this.cursor, 0, ch);
          this.cursor++;
          result.changed = true;
        }
        return false;
    }
  }

  private handleEscapeSequence(seq: string, result: KeyHandleResult): KeyHandleResult {
    switch (seq) {
      case "\u001b[A": // ↑ 歷史上一條
        if (this.history.length > 0) {
          if (this.historyIndex === -1) {
            this.savedBuffer = this.buffer.join("");
            this.historyIndex = this.history.length - 1;
          } else if (this.historyIndex > 0) {
            this.historyIndex--;
          }
          this.buffer = Array.from(this.history[this.historyIndex]);
          this.cursor = this.buffer.length;
          result.changed = true;
        }
        break;

      case "\u001b[B": // ↓ 歷史下一條
        if (this.historyIndex !== -1) {
          this.historyIndex++;
          if (this.historyIndex >= this.history.length) {
            this.historyIndex = -1;
            this.buffer = Array.from(this.savedBuffer);
          } else {
            this.buffer = Array.from(this.history[this.historyIndex]);
          }
          this.cursor = this.buffer.length;
          result.changed = true;
        }
        break;

      case "\u001b[C": // → 光標右移
        if (this.cursor < this.buffer.length) {
          this.cursor++;
          result.changed = true;
        }
        break;

      case "\u001b[D": // ← 光標左移
        if (this.cursor > 0) {
          this.cursor--;
          result.changed = true;
        }
        break;

      case "\u001b[H": // Home
      case "\u001b[1~":
        this.cursor = 0;
        result.changed = true;
        break;

      case "\u001b[F": // End
      case "\u001b[4~":
        this.cursor = this.buffer.length;
        result.changed = true;
        break;

      case "\u001b[3~": // Delete：刪除光標處字符
        if (this.cursor < this.buffer.length) {
          this.buffer.splice(this.cursor, 1);
          result.changed = true;
        }
        break;

      default:
        // 未知序列：忽略
        break;
    }

    if (result.changed) this.redraw();
    return result;
  }

  // ── 渲染 ──────────────────────────────────────────────────

  /** 計算內容行（含水平滾動窗口與光標列位置） */
  computeContentLine(): { content: string; cursorCol: number } {
    const promptWidth = getStringWidth(this.prompt);
    // 內容可用寬度 = 總寬 - 左框線與空格(2) - 提示符 - 省略號餘量(2)
    const contentWidth = Math.max(10, this.width - 2 - promptWidth - 2);

    // 光標前的顯示寬度（含提示符）
    const beforeCursor = this.buffer.slice(0, this.cursor).join("");
    const cursorAbsWidth = promptWidth + getStringWidth(beforeCursor);

    // 調整滾動偏移：確保光標可見
    let offset = this.scrollOffset;
    const widthUpTo = (idx: number) =>
      promptWidth + getStringWidth(this.buffer.slice(0, idx).join(""));

    // 光標超出右邊界：向右滾動（保留 1 格給光標）
    while (offset < this.buffer.length && cursorAbsWidth - widthUpTo(offset) > contentWidth - 1) {
      offset++;
    }
    // 光標超出左邊界：向左滾動
    while (offset > 0 && cursorAbsWidth - widthUpTo(offset) < 0) {
      offset--;
    }
    this.scrollOffset = offset;

    // 從 offset 組裝可見文本（不超過 contentWidth）
    let visible = "";
    let visibleWidth = 0;
    for (let i = offset; i < this.buffer.length; i++) {
      const w = getStringWidth(this.buffer[i]);
      if (visibleWidth + w > contentWidth) break;
      visible += this.buffer[i];
      visibleWidth += w;
    }

    const hasLeft = offset > 0;
    const hasRight = offset + visible.length < this.buffer.length;
    const content = (hasLeft ? "…" : "") + visible + (hasRight ? "…" : "");

    // 光標列位置
    const beforeVisible = this.buffer.slice(offset, this.cursor).join("");
    const cursorCol = promptWidth + getStringWidth(hasLeft ? "…" : "") + getStringWidth(beforeVisible);

    return { content, cursorCol };
  }

  /** 渲染整個輸入框 */
  render(): InputBoxRender {
    const { content, cursorCol } = this.computeContentLine();

    const statusText = this.paused
      ? "⏸ 處理中（Enter 排隊 / Esc 中斷）"
      : "You";
    const top = `╭─ ${statusText} ─${"─".repeat(Math.max(3, this.width - statusText.length - 8))}`;
    const bottom = `╰${"─".repeat(this.width - 2)}`;
    const line = `│ ${this.prompt}${content}`;

    return { top, line, bottom, cursorCol };
  }

  /** 重繪（委託給 onRedraw 回調） */
  redraw(): void {
    if (!this.active) return;
    this.onRedrawCb?.(this.render());
  }
}
