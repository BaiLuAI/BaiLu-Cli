/**
 * Bracketed Paste Mode 支持
 * 终端标准功能，用于准确检测粘贴行为
 * 
 * 参考：
 * - https://cirw.in/blog/bracketed-paste
 * - https://en.wikipedia.org/wiki/Bracketed-paste
 */

export class BracketedPasteHandler {
  private isEnabled = false;
  private isPasting = false;
  private pasteBuffer: string[] = [];
  private onPasteCallback: ((content: string) => void) | null = null;

  // ANSI 转义序列
  private readonly ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
  private readonly DISABLE_BRACKETED_PASTE = '\x1b[?2004l';
  private readonly PASTE_START = '\x1b[200~';
  private readonly PASTE_END = '\x1b[201~';

  constructor() {}

  /**
   * 启用 Bracketed Paste Mode
   */
  enable(): void {
    if (!this.isEnabled && process.stdout.isTTY) {
      try {
        process.stdout.write(this.ENABLE_BRACKETED_PASTE);
        this.isEnabled = true;
        if (process.env.BAILU_DEBUG) {
          console.debug('[BracketedPaste] 已启用');
        }
      } catch (err) {
        if (process.env.BAILU_DEBUG) {
          console.warn('[BracketedPaste] 启用失败:', err);
        }
      }
    }
  }

  /**
   * 禁用 Bracketed Paste Mode
   */
  disable(): void {
    if (this.isEnabled && process.stdout.isTTY) {
      try {
        process.stdout.write(this.DISABLE_BRACKETED_PASTE);
        this.isEnabled = false;
        if (process.env.BAILU_DEBUG) {
          console.debug('[BracketedPaste] 已禁用');
        }
      } catch (err) {
        if (process.env.BAILU_DEBUG) {
          console.warn('[BracketedPaste] 禁用失败:', err);
        }
      }
    }
  }

  /**
   * 设置粘贴回调
   */
  onPaste(callback: (content: string) => void): void {
    this.onPasteCallback = callback;
  }

  /**
   * 处理输入数据
   * @param data 原始输入数据
   * @returns 处理结果
   */
  handleInput(data: string): { 
    data: string; 
    isPaste: boolean; 
    pasteContent?: string;
  } {
    // 检测粘贴开始
    if (data.includes(this.PASTE_START)) {
      this.isPasting = true;
      this.pasteBuffer = [];
      
      // 移除粘贴开始标记
      let cleanData = data.replace(this.PASTE_START, '');
      
      // 检查是否在同一个数据块中结束（快速粘贴）
      if (cleanData.includes(this.PASTE_END)) {
        return this.finalizePaste(cleanData);
      }
      
      // 粘贴内容较多，需要等待后续数据
      if (cleanData) {
        this.pasteBuffer.push(cleanData);
      }
      return { data: '', isPaste: true };
    }

    // 粘贴进行中
    if (this.isPasting) {
      // 检测粘贴结束
      if (data.includes(this.PASTE_END)) {
        return this.finalizePaste(data);
      }
      
      // 继续累积粘贴内容
      this.pasteBuffer.push(data);
      return { data: '', isPaste: true };
    }

    // 正常输入（非粘贴）
    return { data, isPaste: false };
  }

  /**
   * 完成粘贴
   */
  private finalizePaste(data: string): {
    data: string;
    isPaste: boolean;
    pasteContent: string;
  } {
    // 移除粘贴结束标记
    const cleanData = data.replace(this.PASTE_END, '');
    if (cleanData) {
      this.pasteBuffer.push(cleanData);
    }
    
    const pasteContent = this.pasteBuffer.join('');
    this.pasteBuffer = [];
    this.isPasting = false;

    if (process.env.BAILU_DEBUG) {
      console.debug('[BracketedPaste] 粘贴完成:', pasteContent.length, '字符');
    }

    // 调用回调
    if (this.onPasteCallback) {
      this.onPasteCallback(pasteContent);
    }

    return { 
      data: '', 
      isPaste: true, 
      pasteContent 
    };
  }

  /**
   * 是否正在粘贴
   */
  isCurrentlyPasting(): boolean {
    return this.isPasting;
  }

  /**
   * 是否已启用
   */
  isCurrentlyEnabled(): boolean {
    return this.isEnabled;
  }
}
