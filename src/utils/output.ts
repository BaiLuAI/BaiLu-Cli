/**
 * 輸出管理器：支援 quiet 和 JSON 模式（用於 CI/CD）
 */

export interface OutputOptions {
  quiet?: boolean;
  json?: boolean;
}

let globalOutputOptions: OutputOptions = {};

export function setOutputOptions(options: OutputOptions): void {
  globalOutputOptions = { ...options };
}

export function getOutputOptions(): OutputOptions {
  return globalOutputOptions;
}

export function isQuiet(): boolean {
  return globalOutputOptions.quiet === true;
}

export function isJsonMode(): boolean {
  return globalOutputOptions.json === true;
}

/**
 * 僅在非 quiet 模式下輸出到 console
 */
export function log(...args: unknown[]): void {
  if (!isQuiet() && !isJsonMode()) {
    console.log(...args);
  }
}

/**
 * 錯誤輸出（quiet 模式下仍然輸出到 stderr）
 */
export function logError(...args: unknown[]): void {
  console.error(...args);
}

/**
 * JSON 模式下的結構化輸出
 */
export interface JsonOutput {
  success: boolean;
  command: string;
  result?: string;
  error?: string;
  iterations?: number;
  toolCalls?: number;
  model?: string;
}

export function outputJson(data: JsonOutput): void {
  console.log(JSON.stringify(data, null, 2));
}
