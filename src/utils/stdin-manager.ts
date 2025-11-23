/**
 * Stdin 狀態管理器
 * 防止多個模塊同時操作 stdin 導致衝突
 */

let rawModeRefCount = 0;
let keypressInitialized = false;

/**
 * 進入 raw mode（引用計數）
 */
export function enterRawMode(): void {
  console.log(`[STDIN] enterRawMode 调用，当前计数: ${rawModeRefCount}, isTTY: ${process.stdin.isTTY}`);
  if (process.stdin.isTTY && rawModeRefCount === 0) {
    process.stdin.setRawMode(true);
    console.log('[STDIN] raw mode 已启用');
  }
  rawModeRefCount++;
  console.log(`[STDIN] 新计数: ${rawModeRefCount}`);
}

/**
 * 退出 raw mode（引用計數）
 */
export function exitRawMode(): void {
  console.log(`[STDIN] exitRawMode 调用，当前计数: ${rawModeRefCount}`);
  rawModeRefCount = Math.max(0, rawModeRefCount - 1);
  console.log(`[STDIN] 新计数: ${rawModeRefCount}`);
  if (process.stdin.isTTY && rawModeRefCount === 0) {
    process.stdin.setRawMode(false);
    console.log('[STDIN] raw mode 已禁用');
  }
}

/**
 * 確保 keypress 事件已初始化
 */
export function ensureKeypressEvents(): void {
  if (!keypressInitialized) {
    const readline = require("readline");
    readline.emitKeypressEvents(process.stdin);
    keypressInitialized = true;
  }
}

/**
 * 重置所有狀態（緊急清理）
 */
export function resetStdinState(): void {
  rawModeRefCount = 0;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
}

