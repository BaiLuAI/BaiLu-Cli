/**
 * 終端字符寬度計算（共用）
 *
 * 中文、日文、韓文等全角字符佔 2 個寬度；
 * 結合字符、變體選擇器等零寬字符佔 0 個寬度。
 */

/** 計算單個字符的顯示寬度 */
export function getCharWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  // 零寬字符：結合符號、變體選擇器、零寬空格等
  if (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff ||
    (code >= 0x2060 && code <= 0x2064)
  ) {
    return 0;
  }

  // 中日韓統一表意文字及擴展
  if (code >= 0x4e00 && code <= 0x9fff) return 2;
  if (code >= 0x3400 && code <= 0x4dbf) return 2;
  if (code >= 0xf900 && code <= 0xfaff) return 2;
  // 全角 ASCII 與標點
  if (code >= 0xff00 && code <= 0xffef) return 2;
  // 中日韓符號和標點
  if (code >= 0x3000 && code <= 0x303f) return 2;
  // 日文假名
  if (code >= 0x3040 && code <= 0x30ff) return 2;
  // 韓文音節
  if (code >= 0xac00 && code <= 0xd7af) return 2;
  // Emoji 與其他寬字符
  if (code >= 0x1f000 && code <= 0x1ffff) return 2;
  // CJK 擴展 B-F
  if (code >= 0x20000 && code <= 0x3ffff) return 2;

  return 1;
}

/** 計算字符串的顯示寬度（跳過 ANSI 轉義序列） */
export function getStringWidth(str: string): number {
  let width = 0;
  let inAnsi = false;
  for (const char of str) {
    if (inAnsi) {
      if (char === "m" || char === "\u0007") inAnsi = false;
      continue;
    }
    if (char === "\u001b") {
      inAnsi = true;
      continue;
    }
    width += getCharWidth(char);
  }
  return width;
}
