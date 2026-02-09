/**
 * 統一日誌管理工具
 * 提供不同級別的日誌輸出，支援開發/生產環境切換
 */

import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  enableColors?: boolean;
}

class Logger {
  private level: LogLevel;
  private prefix: string;
  private enableColors: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = this.getLogLevelFromEnv(options.level);
    this.prefix = options.prefix || '';
    this.enableColors = options.enableColors ?? true;
  }

  private getLogLevelFromEnv(defaultLevel?: LogLevel): LogLevel {
    const envLevel = process.env.BAILU_LOG_LEVEL?.toUpperCase();
    
    if (process.env.BAILU_DEBUG === 'true') {
      return LogLevel.DEBUG;
    }

    switch (envLevel) {
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'INFO':
        return LogLevel.INFO;
      case 'WARN':
        return LogLevel.WARN;
      case 'ERROR':
        return LogLevel.ERROR;
      case 'SILENT':
        return LogLevel.SILENT;
      default:
        return defaultLevel ?? LogLevel.INFO;
    }
  }

  private formatMessage(level: string, message: string, ...args: unknown[]): string {
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ') : '';
    
    return `${timestamp} ${level} ${prefix}${message}${formattedArgs}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      const formatted = this.formatMessage('[DEBUG]', message, ...args);
      if (this.enableColors) {
        console.log(chalk.gray(formatted));
      } else {
        console.log(formatted);
      }
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      const formatted = this.formatMessage('[INFO]', message, ...args);
      if (this.enableColors) {
        console.log(chalk.cyan(formatted));
      } else {
        console.log(formatted);
      }
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      const formatted = this.formatMessage('[WARN]', message, ...args);
      if (this.enableColors) {
        console.warn(chalk.yellow(formatted));
      } else {
        console.warn(formatted);
      }
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      const formatted = this.formatMessage('[ERROR]', message, ...args);
      if (this.enableColors) {
        console.error(chalk.red(formatted));
      } else {
        console.error(formatted);
      }
    }
  }

  // 用於用戶界面的輸出（不受日誌級別限制）
  output(message: string): void {
    console.log(message);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }
}

// 默認全局 logger
export const logger = new Logger();

// 創建帶前綴的 logger
export function createLogger(prefix: string, options?: Omit<LoggerOptions, 'prefix'>): Logger {
  return new Logger({ ...options, prefix });
}

// 導出便捷方法
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const output = logger.output.bind(logger);
