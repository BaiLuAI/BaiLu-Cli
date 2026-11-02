/**
 * 串流 Markdown 行內格式化器
 *
 * 在逐字串流時即時渲染行內 Markdown（粗體 **x**、行內代碼 `x`），
 * 輸出 ANSI 轉義序列（面板的字符寬度計算會跳過 ANSI）。
 *
 * 難點：chunk 邊界可能切在標記中間（如 "**" 只收到一個 "*"），
 * 因此用狀態機跨 chunk 緩衝，未閉合的標記先扣住不輸出。
 */

const ANSI_BOLD = "\u001b[1m";
const ANSI_CODE = "\u001b[36m"; // 青色
const ANSI_RESET = "\u001b[0m";

type Mode = "normal" | "maybe-bold" | "bold" | "maybe-code" | "code";

export class StreamingMarkdownFormatter {
  private mode: Mode = "normal";
  /** 已輸出的內容中，當前標記的起始位置之後累積的文本（用於未閉合時回退為原文） */
  private markedContent: string = "";
  /** 待定字符緩衝（可能是標記開頭） */
  private pending: string = "";
  /** 已進入的未閉合標記原文（如 "**" 或 "`"），flush 時回退用 */
  private openMarker: string = "";

  /**
   * 餵入一個 chunk，回傳可安全輸出的文本（含 ANSI）
   * 未閉合的標記會被扣住，直到閉合或 flush
   */
  feed(text: string): string {
    let out = "";

    for (const ch of text) {
      switch (this.mode) {
        case "normal":
          if (ch === "*") {
            this.pending += ch;
            if (this.pending === "**") {
              this.mode = "maybe-bold";
              this.pending = "";
              this.markedContent = "";
              this.openMarker = "**";
            }
          } else if (ch === "`") {
            this.mode = "code";
            out += ANSI_CODE;
            this.markedContent = "";
            this.openMarker = "`";
          } else {
            // 先吐出 pending（不完整的星號按原文輸出）
            if (this.pending) {
              out += this.pending;
              this.pending = "";
            }
            out += ch;
          }
          break;

        case "maybe-bold":
          // 已收到 **，等待內容；若再收到 * 判定為結束或三連星
          if (ch === "*") {
            // "**" 後立即又見 "*"：視為字面星號處理太複雜，按進入粗體失敗回退
            out += "**" + this.markedContent;
            this.markedContent = "";
            this.mode = "normal";
            this.pending = "*";
          } else {
            this.mode = "bold";
            this.markedContent += ch;
          }
          break;

        case "bold":
          if (ch === "*") {
            this.pending += ch;
            if (this.pending === "**") {
              // 粗體閉合
              out += ANSI_BOLD + this.markedContent + ANSI_RESET;
              this.markedContent = "";
              this.pending = "";
              this.mode = "normal";
            }
          } else {
            if (this.pending) {
              this.markedContent += this.pending;
              this.pending = "";
            }
            this.markedContent += ch;
          }
          break;

        case "code":
          // 行內代碼：進入時已輸出 ANSI_CODE，此處直接串流，閉合時補 RESET
          if (ch === "`") {
            out += ANSI_RESET;
            this.markedContent = "";
            this.mode = "normal";
          } else {
            this.markedContent += ch;
            out += ch;
          }
          break;
      }
    }

    return out;
  }

  /**
   * 串流結束時呼叫：把扣住的未閉合標記按原文吐出
   */
  flush(): string {
    let out = "";
    if (this.pending) {
      out += this.pending;
      this.pending = "";
    }
    if (this.markedContent) {
      if (this.mode === "bold" || this.mode === "maybe-bold") {
        out += this.openMarker + this.markedContent; // 未閉合的標記按原文回退
      } else if (this.mode === "code") {
        out += ANSI_RESET;
      }
      this.markedContent = "";
    }
    this.mode = "normal";
    return out;
  }

  reset(): void {
    this.mode = "normal";
    this.pending = "";
    this.markedContent = "";
    this.openMarker = "";
  }
}
