/**
 * ChatInput 抽象：TUI 輸入框與 readline 的統一介面
 * 非 TTY 環境（管道輸入）自動回退 readline
 */

import readline from "readline";
import { InputBox } from "./input-box.js";
import { globalOutputManager } from "./output-manager.js";

export interface ChatInput {
  /** 開始接收輸入 */
  start(): void;
  /** 關閉並還原終端 */
  close(): void;
  /** 暫停（處理期間） */
  pause(): void;
  /** 恢復並顯示提示 */
  resume(): void;
  /** 註冊提交回調 */
  onSubmit(cb: (text: string) => void): void;
  /** 註冊關閉回調（Ctrl+D / readline close） */
  onClose(cb: () => void): void;
  /** 註冊中斷回調（Esc，僅 TUI 模式） */
  onInterrupt?(cb: () => void): void;
  /** 是否為 TUI 模式 */
  readonly isTui: boolean;
}

/** readline 實現（非 TTY 回退） */
export class ReadlineInput implements ChatInput {
  readonly isTui = false;
  private rl: readline.Interface;

  constructor(prompt: string) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt,
    });
  }

  start(): void {
    this.rl.prompt();
  }

  close(): void {
    this.rl.close();
  }

  pause(): void {
    this.rl.pause();
  }

  resume(): void {
    this.rl.resume();
    this.rl.prompt();
  }

  onSubmit(cb: (text: string) => void): void {
    this.rl.on("line", (input) => cb(input));
  }

  onClose(cb: () => void): void {
    this.rl.on("close", () => cb());
  }
}

/** TUI 輸入框實現 */
export class TuiInput implements ChatInput {
  readonly isTui = true;
  private box: InputBox;
  private stdinListener: ((chunk: Buffer) => void) | null = null;
  private savedRawMode = false;
  private closeCb?: () => void;

  constructor(prompt: string, history: string[] = []) {
    this.box = new InputBox({ prompt, history });
  }

  start(): void {
    if (!process.stdin.isTTY) {
      throw new Error("TuiInput 需要 TTY");
    }

    globalOutputManager.install(this.box);

    this.savedRawMode = process.stdin.isRaw ?? false;
    process.stdin.setRawMode(true);

    // 按鍵分發
    this.stdinListener = (chunk: Buffer) => {
      this.box.handleKey(chunk.toString());
    };
    process.stdin.on("data", this.stdinListener);

    this.box.start();
  }

  close(): void {
    if (this.stdinListener) {
      process.stdin.removeListener("data", this.stdinListener);
      this.stdinListener = null;
    }
    try {
      process.stdin.setRawMode(this.savedRawMode);
    } catch {
      // ignore
    }
    this.box.close();
    globalOutputManager.uninstall();
    this.closeCb?.();
  }

  pause(): void {
    this.box.pause();
  }

  resume(): void {
    this.box.resume();
  }

  onSubmit(cb: (text: string) => void): void {
    this.box.onSubmit(cb);
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  onInterrupt(cb: () => void): void {
    this.box.onInterrupt(cb);
  }

  /** 歷史記錄注入（chat 的 historyManager 同步用） */
  addHistory(text: string): void {
    this.box.addHistory(text);
  }

  /**
   * 掛起 TUI（互動式元件接管終端前呼叫，如斜線命令選擇器）
   * 卸載輸出鉤子、分離按鍵監聽、擦除輸入框
   */
  suspend(): void {
    if (this.stdinListener) {
      process.stdin.removeListener("data", this.stdinListener);
      this.stdinListener = null;
    }
    // 擦除輸入框區域（3 行）
    process.stdout.write("\u001b[2K\u001b[1A\u001b[2K\u001b[1A\u001b[2K\r");
    globalOutputManager.uninstall();
  }

  /** 恢復 TUI（互動式元件結束後呼叫） */
  restore(): void {
    globalOutputManager.install(this.box);
    this.stdinListener = (chunk: Buffer) => {
      this.box.handleKey(chunk.toString());
    };
    process.stdin.on("data", this.stdinListener);
    this.box.redraw();
  }
}

/** 建立合適的輸入實現 */
export function createChatInput(prompt: string, history: string[] = []): ChatInput {
  if (process.stdin.isTTY) {
    return new TuiInput(prompt, history);
  }
  return new ReadlineInput(prompt);
}
