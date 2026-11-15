/**
 * 輸出管理器：讓 AI 輸出與底部輸入框共存
 *
 * 原理：
 * - 一般輸出（console.log / 帶換行的整行）：擦除輸入框 → 寫出內容 → 重繪輸入框
 * - 串流輸出（StreamingPanel 逐字）：呼叫 suspend() 暫時收起輸入框，
 *   讓串流內容自由輸出，完成後 resume() 重繪輸入框（比照 Claude Code：
 *   回答期間不維持輸入框，回答完再出現）
 *
 * 關鍵：光標恆定位於輸入框的「內容行」；eraseBox 從內容行向上清 3 行，
 * drawBox 從該位置重繪。
 */

import { InputBox, InputBoxRender } from "./input-box.js";

export class OutputManager {
  private box: InputBox | null = null;
  private originalWrite: typeof process.stdout.write;
  private installed = false;
  /** 重入保護：重繪輸入框自身不觸發擦除 */
  private drawing = false;
  /** 暫停狀態：串流期間收起輸入框，輸出直接透傳 */
  private suspended = false;
  /** 輸入框目前是否已繪製（游標是否停在內容行） */
  private boxDrawn = false;

  constructor() {
    // 保存真正的底層 write
    this.originalWrite = process.stdout.write.bind(process.stdout);
  }

  /** 掛鉤 stdout 並綁定輸入框 */
  install(box: InputBox): void {
    this.box = box;
    box.onRedraw((rendered) => this.drawBox(rendered));

    if (this.installed) return;
    this.installed = true;

    process.stdout.write = ((chunk: any, ...rest: any[]): boolean => {
      // 暫停中 / 重繪自身 / 輸入框未活躍：直接透傳
      if (this.drawing || this.suspended || !this.box?.isActive) {
        return (this.originalWrite as any)(chunk, ...rest);
      }

      const text = typeof chunk === "string" ? chunk : chunk.toString();

      // 只含控制序列（無可見內容、無換行，如 spinner 的 \r 幀）：
      // 擦除輸入框後直接寫入，暫不重繪（避免每幀閃爍），等真正內容到來再重繪
      // 含換行的整行輸出：擦除 → 寫 → 重繪
      this.eraseBox();
      const res = (this.originalWrite as any)(text, ...rest);

      if (text.includes("\n")) {
        this.box.redraw();
      } else {
        // 未換行（如 spinner 幀、或半行）：保持擦除狀態，標記需要稍後重繪
        this.pendingRedraw = true;
      }
      return res;
    }) as typeof process.stdout.write;
  }

  /** 是否有待重繪（未換行的輸出之後） */
  private pendingRedraw = false;

  /** 暫停：收起輸入框，串流輸出直通（回答期間） */
  suspend(): void {
    if (!this.box?.isActive || this.suspended) return;
    this.suspended = true;
    // 收起輸入框：游標在內容行，向上清 3 行
    this.eraseBoxFull();
    this.pendingRedraw = false;
  }

  /** 恢復：重繪輸入框（回答結束後） */
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    // 確保從新行開始繪製（避免接在串流尾端）
    this.originalWrite("\r\n");
    this.box?.redraw();
  }

  /** 卸載鉤子（退出 TUI 模式時） */
  uninstall(): void {
    // 先清除殘留的輸入框（否則退出後空框留在畫面上）
    this.clearBox();
    if (!this.installed) {
      this.box = null;
      this.suspended = false;
      return;
    }
    process.stdout.write = this.originalWrite;
    this.installed = false;
    this.box = null;
    this.suspended = false;
    this.pendingRedraw = false;
    this.boxDrawn = false;
  }

  /** 清除輸入框（退出前呼叫，避免殘留空框） */
  clearBox(): void {
    if (!this.boxDrawn) return;
    // 游標在內容行 → 上移頂框行，清除向下所有內容，並移到框下方新行
    this.originalWrite("\r\u001b[1A\u001b[J");
    this.boxDrawn = false;
  }

  /** 直接寫出（不經過擦除/重繪循環） */
  rawWrite(text: string): void {
    this.originalWrite(text);
  }

  /** 擦除輸入框 3 行，游標回到頂框行行首（供重繪覆寫） */
  private eraseBox(): void {
    if (!this.boxDrawn) return;
    // 游標在內容行 → 上移到頂框行行首，清除向下所有內容（含底框）
    this.originalWrite("\r\u001b[1A\u001b[J");
    this.boxDrawn = false;
  }

  /** 擦除整個框（含底框），游標停在框頂（suspend 用） */
  private eraseBoxFull(): void {
    this.eraseBox();
  }

  /** 繪製輸入框並定位光標 */
  private drawBox(rendered: InputBoxRender): void {
    this.drawing = true;
    try {
      if (this.boxDrawn) {
        // 已繪製：游標在內容行 → 上移到頂框行行首並清除舊框（避免每幀下移）
        this.originalWrite("\r\u001b[1A\u001b[J");
      } else {
        // 未繪製：從當前位置（行首）開始
        this.originalWrite("\r\u001b[2K");
      }

      this.originalWrite(rendered.top + "\n" + rendered.line + "\n" + rendered.bottom);
      // 光標在底框行；向上 1 行回到內容行，絕對定位到 cursorCol
      // rendered.cursorCol 已含 "│ " 前綴（2 欄）
      const col = Math.max(1, rendered.cursorCol + 1); // ANSI CHA 從 1 起
      this.originalWrite(`\u001b[1A\r\u001b[${col}G`);
      this.boxDrawn = true;
    } finally {
      this.drawing = false;
    }
  }

  /** 是否有暫停 */
  get isSuspended(): boolean {
    return this.suspended;
  }
}

/** 全局輸出管理器實例 */
export const globalOutputManager = new OutputManager();
