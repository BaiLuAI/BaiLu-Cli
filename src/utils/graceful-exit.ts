/**
 * 優雅退出機制
 * 用自定義 Error 替代 process.exit(0)，讓 finally 塊和清理函數能正常執行
 */

export class GracefulExitError extends Error {
  constructor() {
    super("GracefulExit");
    this.name = "GracefulExitError";
  }
}

const cleanupHandlers: (() => void | Promise<void>)[] = [];

/**
 * 註冊退出時的清理函數
 */
export function onExit(handler: () => void | Promise<void>): void {
  cleanupHandlers.push(handler);
}

/**
 * 執行所有清理函數並退出
 */
export async function runCleanupAndExit(code = 0): Promise<never> {
  for (const handler of cleanupHandlers) {
    try {
      await handler();
    } catch {
      // 清理函數不應阻止退出
    }
  }
  process.exit(code);
}

/**
 * 判斷錯誤是否為優雅退出
 */
export function isGracefulExit(err: unknown): boolean {
  return err instanceof GracefulExitError;
}
