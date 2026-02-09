/**
 * Stdin 狀態管理器
 * 防止多個模塊同時操作 stdin 導致衝突
 */

import { createLogger } from './logger.js';

const logger = createLogger('STDIN');

let rawModeRefCount = 0;
let keypressInitialized = false;

/**
 * 進入 raw mode（引用計數）
 */
export function enterRawMode(): void {
  logger.debug(`enterRawMode 调用，当前计数: ${rawModeRefCount}, isTTY: ${process.stdin.isTTY}`);
  if (process.stdin.isTTY && rawModeRefCount === 0) {
    process.stdin.setRawMode(true);
    logger.debug('raw mode 已启用');
  }
  rawModeRefCount++;
  logger.debug(`新计数: ${rawModeRefCount}`);
}

/**
 * 退出 raw mode（引用計數）
 */
export function exitRawMode(): void {
  logger.debug(`exitRawMode 调用，当前计数: ${rawModeRefCount}`);
  rawModeRefCount = Math.max(0, rawModeRefCount - 1);
  logger.debug(`新计数: ${rawModeRefCount}`);
  if (process.stdin.isTTY && rawModeRefCount === 0) {
    process.stdin.setRawMode(false);
    logger.debug('raw mode 已禁用');
  }
}

/**
 * 確保 keypress 事件已初始化
 */
export function ensureKeypressEvents(): void {
  if (!keypressInitialized) {
    // 移除 require() 調用，因為它在 ES 模塊中不被允許
    // 如果需要，可以在調用處動態 import
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
