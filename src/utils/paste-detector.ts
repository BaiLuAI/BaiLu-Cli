/**
 * 粘贴检测工具
 * 基于定时器的粘贴检测方案（跨平台兼容）
 * 
 * 参考：
 * - rustyline (Rust CLI库)：使用定时器检测快速连续输入
 * - inquirer.js：通过 readline 事件聚合处理
 * - Node.js REPL：在新版本中使用 Bracketed Paste Mode
 * 
 * 原理：
 * 粘贴时，多行内容会在极短时间内（通常<10ms）触发多个 line 事件
 * 正常打字时，两次回车之间间隔通常>100ms
 * 我们使用50ms的缓冲窗口来区分这两种情况
 */

export interface PasteDetectorOptions {
  /**
   * 粘贴检测延迟（毫秒）
   * 在最后一个输入后等待此时间才处理
   * @default 50
   */
  delay?: number;

  /**
   * 长延迟（毫秒）
   * 用于处理可能没有换行符的最后一行
   * @default 150
   */
  longDelay?: number;

  /**
   * 最大缓冲行数
   * 超过此数量立即处理，避免内存问题
   * @default 1000
   */
  maxLines?: number;

  /**
   * 粘贴回调
   * @param lines 所有粘贴的行
   * @param isPaste 是否为粘贴（true=多行，false=单行）
   */
  onComplete: (lines: string[], isPaste: boolean) => void | Promise<void>;
}

/**
 * 粘贴检测器
 */
export class PasteDetector {
  private buffer: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private longTimer: NodeJS.Timeout | null = null;
  private readonly delay: number;
  private readonly longDelay: number;
  private readonly maxLines: number;
  private readonly onComplete: (lines: string[], isPaste: boolean) => void | Promise<void>;

  constructor(options: PasteDetectorOptions) {
    this.delay = options.delay || 50; // 50ms足够检测快速粘贴，太长会导致单独处理
    this.longDelay = options.longDelay || 150; // 150ms作为最终后备
    this.maxLines = options.maxLines || 1000; // 默认最大1000行
    this.onComplete = options.onComplete;
  }

  /**
   * 添加一行输入
   * @param line 输入行
   */
  push(line: string): void {
    // 添加到缓冲区
    this.buffer.push(line);

    // 检查是否超过最大行数限制
    if (this.buffer.length >= this.maxLines) {
      // 立即处理，避免缓冲区过大
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.longTimer) {
        clearTimeout(this.longTimer);
        this.longTimer = null;
      }
      this.flush();
      return;
    }

    // 清除之前的短定时器
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // 如果是缓冲区的第一行，启动长定时器作为最终后备
    // 长定时器不重置，确保在最坏情况下也能处理所有内容
    if (this.buffer.length === 1) {
      if (this.longTimer) {
        clearTimeout(this.longTimer);
      }
      this.longTimer = setTimeout(() => {
        if (this.buffer.length > 0) {
          this.flush();
        }
      }, this.longDelay);
    }

    // 设置短定时器，每次新输入都重置
    // 这样可以聚合快速连续的输入
    this.timer = setTimeout(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    }, this.delay);
  }

  /**
   * 立即处理缓冲区内容
   */
  private flush(): void {
    if (this.buffer.length === 0) {
      return;
    }

    const lines = [...this.buffer];
    const isPaste = lines.length > 1;

    // 清空缓冲区
    this.buffer = [];
    this.timer = null;
    this.longTimer = null;

    // 调用回调
    this.onComplete(lines, isPaste);
  }

  /**
   * 清空缓冲区（不触发回调）
   */
  clear(): void {
    this.buffer = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.longTimer) {
      clearTimeout(this.longTimer);
      this.longTimer = null;
    }
  }

  /**
   * 销毁检测器
   */
  destroy(): void {
    this.clear();
  }
}
