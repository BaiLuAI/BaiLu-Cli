/**
 * 輸出管理器：讓 AI 輸出與底部輸入框共存
 *
 * 原理：所有輸出先擦除輸入框區域 → 寫出內容 → 重繪輸入框。
 * 掛鉤 process.stdout.write 與 console.log，上層代碼無需感知。
 */

import { InputBox, InputBoxRender } from "./input-box.js";

export class OutputManager {
  private box: InputBox | null = null;
  private originalWrite: typeof process.stdout.write;
  private installed = false;
  /** 重入保護：重繪輸入框自身不觸發擦除 */
  private drawing = false;

  constructor() {
    // 保存真正的底層 write（避免與其他 hook / 多次 install 互相覆蓋）
    this.originalWrite = process.stdout.write.bind(process.stdout);
  }

  /** 掛鉤 stdout 並綁定輸入框 */
  install(box: InputBox): void {
    if (this.installed) {
      // 已安裝：只換綁的 box，不重複 hook
      this.box = box;
      box.onRedraw((rendered) => this.drawBox(rendered));
      return;
    }
    this.installed = true;
    this.box = box;

    box.onRedraw((rendered) => this.drawBox(rendered));

    process.stdout.write = ((chunk: any, ...rest: any[]): boolean => {
      if (this.drawing || !this.box?.isActive) {
        return (this.originalWrite as any)(chunk, ...rest);
      }
      // 擦除輸入框 → 寫輸出 → 重繪輸入框
      this.eraseBox();
      const res = (this.originalWrite as any)(chunk, ...rest);
      this.box.redraw();
      return res;
    }) as typeof process.stdout.write;
  }

  /** 卸載鉤子（退出 TUI 模式時） */
  uninstall(): void {
    if (!this.installed) return;
    process.stdout.write = this.originalWrite;
    this.installed = false;
    this.box = null;
  }

  /** 直接寫出（不經過擦除/重繪循環） */
  rawWrite(text: string): void {
    this.originalWrite(text);
  }

  /** 擦除輸入框區域（3 行：頂框/內容/底框） */
  private eraseBox(): void {
    // 當前光標在內容行（drawBox 定位後的狀態）：
    // 上行 = 頂框，本行 = 內容行，下行 = 底框
    this.originalWrite("\r\u001b[2K");        // 清內容行
    this.originalWrite("\u001b[1A\u001b[2K");   // 清頂框
    this.originalWrite("\u001b[1B");            // 回到內容行（供 drawBox 覆寫）
  }

  /** 繪製輸入框並定位光標 */
  private drawBox(rendered: InputBoxRender): void {
    this.drawing = true;
    try {
      this.originalWrite("\r\u001b[2K"); // 清當前行（內容行）
      // 寫頂框 + 內容行 + 底框
      this.originalWrite(rendered.top + "\n" + rendered.line + "\n" + rendered.bottom);
      // 光標現在在底框行；向上 1 行回到內容行，移到 cursorCol
      const col = Math.max(0, rendered.cursorCol) + 1; // ANSI 從 1 起
      this.originalWrite(`\u001b[1A\r\u001b[${col}C`);
    } finally {
      this.drawing = false;
    }
  }
}

/** 全局輸出管理器實例 */
export const globalOutputManager = new OutputManager();
