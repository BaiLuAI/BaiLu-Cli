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
    this.originalWrite = process.stdout.write.bind(process.stdout);
  }

  /** 掛鉤 stdout 並綁定輸入框 */
  install(box: InputBox): void {
    if (this.installed) return;
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
    // 游標在框內某處：向上移到框底，逐行清除
    this.originalWrite("\u001b[2K"); // 清當前行
    this.originalWrite("\u001b[1A\u001b[2K"); // 上一行
    this.originalWrite("\u001b[1A\u001b[2K"); // 再上一行
  }

  /** 繪製輸入框並定位光標 */
  private drawBox(rendered: InputBoxRender): void {
    this.drawing = true;
    try {
      this.originalWrite("\r\u001b[2K"); // 清當前行
      this.originalWrite(rendered.top + "\n" + rendered.line + "\n" + rendered.bottom);
      // 光標定位回內容行的正確列：向上 1 行（底框），移到 cursorCol
      const up = "\u001b[1A";
      const col = Math.max(0, rendered.cursorCol) + 1; // ANSI 從 1 起
      this.originalWrite(`${up}\r\u001b[${col}C`);
    } finally {
      this.drawing = false;
    }
  }
}

/** 全局輸出管理器實例 */
export const globalOutputManager = new OutputManager();
