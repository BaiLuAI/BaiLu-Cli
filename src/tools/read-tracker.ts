/**
 * 檔案讀取追蹤器（Claude Code 風格的 read-before-edit 強制）
 *
 * 規則：修改已存在的檔案前，必須先用 read_file 讀取過該檔案。
 * 防止 AI 基於過期/猜測的內容盲寫覆蓋，造成代碼丟失。
 * 追蹤範圍為當前進程（會話）內。
 */

import path from "path";

const readFiles = new Set<string>();

/** 標記檔案已在本會話中讀取過 */
export function markFileRead(absolutePath: string): void {
  readFiles.add(path.resolve(absolutePath));
}

/** 檢查檔案是否已讀取過 */
export function wasFileRead(absolutePath: string): boolean {
  return readFiles.has(path.resolve(absolutePath));
}

/** 清空追蹤（會話重置時呼叫） */
export function resetReadTracker(): void {
  readFiles.clear();
}
