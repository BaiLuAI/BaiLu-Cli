/**
 * Console 攔截器
 *
 * 串流面板開啟期間，任何外部輸出（logger 警告、錯誤等）都會打斷面板框線，
 * 造成終端排版錯位。此模組在面板活躍時攔截 console 輸出並暫存，
 * 面板關閉後由呼叫方一次補印，保持框線完整。
 */

type ConsoleMethod = (...args: unknown[]) => void;

interface CaptureState {
  buffer: string[];
  original: {
    log: ConsoleMethod;
    warn: ConsoleMethod;
    error: ConsoleMethod;
  };
}

let captureState: CaptureState | null = null;

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

/** 開始攔截 console 輸出（已在攔截中時為無操作） */
export function beginConsoleCapture(): void {
  if (captureState) return;

  captureState = {
    buffer: [],
    original: {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    },
  };

  const redirect = (method: 'log' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      if (captureState) {
        captureState.buffer.push(`[${method}] ${formatArgs(args)}`);
        return;
      }
      captureState!.original[method](...args);
    };

  console.log = redirect('log');
  console.warn = redirect('warn');
  console.error = redirect('error');
}

/**
 * 結束攔截並回傳暫存的輸出。
 * @returns 暫存的訊息陣列（含級別前綴），未在攔截中時回傳空陣列
 */
export function endConsoleCapture(): string[] {
  if (!captureState) return [];

  const { buffer, original } = captureState;
  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
  captureState = null;
  return buffer;
}

/** 是否正在攔截中 */
export function isCapturing(): boolean {
  return captureState !== null;
}
