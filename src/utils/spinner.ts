/**
 * 簡單的終端 Spinner 工具
 * 用於顯示動態載入效果
 */

import chalk from "chalk";

export class Spinner {
  private message: string;
  private frames: string[];
  private currentFrame: number;
  private interval: NodeJS.Timeout | null;
  private isSpinning: boolean;

  constructor(message: string = "Loading") {
    this.message = message;
    // 使用簡單的點點點動畫
    this.frames = [".", "..", "...", ""];
    this.currentFrame = 0;
    this.interval = null;
    this.isSpinning = false;
  }

  /**
   * 開始旋轉動畫
   */
  start(): void {
    if (this.isSpinning) {
      return;
    }

    this.isSpinning = true;
    this.currentFrame = 0;

    // 隱藏光標
    process.stdout.write("\x1B[?25l");

    // 顯示初始消息
    this.render();

    // 每 300ms 更新一次
    this.interval = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.render();
    }, 300);
  }

  /**
   * 停止旋轉動畫
   */
  stop(): void {
    if (!this.isSpinning) {
      return;
    }

    this.isSpinning = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // 清除當前行
    this.clearLine();

    // 恢復光標
    process.stdout.write("\x1B[?25h");
    
    // 換行，確保下一行輸出從新行開始
    process.stdout.write("\n");
  }

  /**
   * 停止並顯示成功消息
   */
  succeed(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    console.log(chalk.green(`[SUCCESS] ${finalMessage}`));
  }

  /**
   * 停止並顯示失敗消息
   */
  fail(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    console.log(chalk.red(`[ERROR] ${finalMessage}`));
  }

  /**
   * 停止並顯示警告消息
   */
  warn(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    console.log(chalk.yellow(`[WARNING] ${finalMessage}`));
  }

  /**
   * 更新消息
   */
  updateMessage(message: string): void {
    this.message = message;
    if (this.isSpinning) {
      this.render();
    }
  }

  /**
   * 渲染當前幀
   */
  private render(): void {
    this.clearLine();
    const frame = this.frames[this.currentFrame];
    const text = `${this.message}${frame}`;
    process.stdout.write(chalk.cyan(text));
  }

  /**
   * 清除當前行
   */
  private clearLine(): void {
    // 移動到行首並清除整行
    process.stdout.write("\r\x1B[K");
  }
}

/**
 * 創建一個新的 Spinner
 */
export function createSpinner(message: string): Spinner {
  return new Spinner(message);
}
