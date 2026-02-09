/**
 * 错误恢复系统
 * 提供智能重试策略和文件备份/回滚功能
 */

import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";

/**
 * 文件备份信息
 */
export interface FileBackup {
  path: string;
  contentBefore: string;
  timestamp: Date;
  operation: string; // write_file, apply_diff, etc.
}

/**
 * 错误类型枚举
 */
export enum ErrorType {
  FILE_NOT_FOUND = "file_not_found",
  PERMISSION_DENIED = "permission_denied",
  SYNTAX_ERROR = "syntax_error",
  INVALID_PATH = "invalid_path",
  DISK_FULL = "disk_full",
  TIMEOUT = "timeout",
  UNKNOWN = "unknown",
}

/**
 * 重试策略接口
 */
export interface RetryStrategy {
  errorType: ErrorType;
  maxRetries: number;
  description: string;
  execute: (error: Error, context: RetryContext) => Promise<RetryResult>;
}

/**
 * 重试上下文
 */
export interface RetryContext {
  tool: string;
  params: Record<string, any>;
  error: Error;
  attemptNumber: number;
  previousAttempts: RetryAttempt[];
}

/**
 * 重试尝试记录
 */
export interface RetryAttempt {
  attemptNumber: number;
  strategy: string;
  timestamp: Date;
  success: boolean;
  error?: string;
}

/**
 * 重试结果
 */
export interface RetryResult {
  shouldRetry: boolean;
  suggestedAction?: string;
  modifiedParams?: Record<string, any>;
  message: string;
}

/**
 * 错误恢复管理器
 */
export class ErrorRecoveryManager {
  private backups: Map<string, FileBackup[]> = new Map();
  private maxBackupsPerFile: number = 5;
  private maxTotalBackupSize: number = 50 * 1024 * 1024; // 50MB 总大小限制
  private currentBackupSize: number = 0;
  private backupTTL: number = 30 * 60 * 1000; // 30分钟过期时间
  private strategies: Map<ErrorType, RetryStrategy> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.registerDefaultStrategies();
    this.startCleanupTimer();
  }

  /**
   * 注册默认的重试策略
   */
  private registerDefaultStrategies(): void {
    // 文件不存在策略
    this.registerStrategy({
      errorType: ErrorType.FILE_NOT_FOUND,
      maxRetries: 2,
      description: "文件不存在时，先探索目录结构确认文件位置",
      execute: async (error: Error, context: RetryContext) => {
        const { tool, params, attemptNumber } = context;

        if (attemptNumber === 1) {
          // 第一次重试：建议先探索目录
          return {
            shouldRetry: true,
            message: "文件不存在。建议先执行 list_directory 确认文件位置，然后重试。",
            suggestedAction: "先使用 list_directory 探索目录结构",
          };
        } else if (attemptNumber === 2) {
          // 第二次重试：建议检查路径
          const filePath = params.path || params.file;
          const dir = path.dirname(filePath);
          const filename = path.basename(filePath);

          return {
            shouldRetry: true,
            message: `文件 "${filename}" 在目录 "${dir}" 中不存在。请检查路径是否正确，或者该文件是否已被创建。`,
            suggestedAction: `确认路径 "${filePath}" 是否正确`,
          };
        }

        return {
          shouldRetry: false,
          message: "文件确实不存在，无法继续操作。",
        };
      },
    });

    // 权限拒绝策略
    this.registerStrategy({
      errorType: ErrorType.PERMISSION_DENIED,
      maxRetries: 1,
      description: "权限被拒绝时，提示用户检查权限或使用管理员权限",
      execute: async (error: Error, context: RetryContext) => {
        const filePath = context.params.path || context.params.file;

        return {
          shouldRetry: false,
          message: `权限被拒绝：无法访问文件 "${filePath}"`,
          suggestedAction: 
            "1. 检查文件权限\n" +
            "2. 确保文件未被其他程序锁定\n" +
            "3. 尝试以管理员权限运行 CLI\n" +
            "4. 检查文件是否为只读",
        };
      },
    });

    // 语法错误策略
    this.registerStrategy({
      errorType: ErrorType.SYNTAX_ERROR,
      maxRetries: 2,
      description: "语法错误时，重新读取文件并尝试修复",
      execute: async (error: Error, context: RetryContext) => {
        const { attemptNumber } = context;

        if (attemptNumber === 1) {
          return {
            shouldRetry: true,
            message: "检测到语法错误。建议重新读取文件并检查语法。",
            suggestedAction: "使用 read_file 重新读取文件，然后修复语法错误",
          };
        }

        return {
          shouldRetry: false,
          message: "语法错误持续存在，请手动检查代码。",
          suggestedAction: "手动审查代码语法",
        };
      },
    });

    // 无效路径策略
    this.registerStrategy({
      errorType: ErrorType.INVALID_PATH,
      maxRetries: 1,
      description: "路径无效时，建议检查路径格式",
      execute: async (error: Error, context: RetryContext) => {
        const filePath = context.params.path || context.params.file;

        return {
          shouldRetry: false,
          message: `路径格式无效：${filePath}`,
          suggestedAction: 
            "1. 确保路径不包含非法字符\n" +
            "2. 使用正斜杠 / 或反斜杠 \\ 分隔路径\n" +
            "3. 确保路径相对于工作目录是正确的",
        };
      },
    });
  }

  /**
   * 注册自定义重试策略
   */
  registerStrategy(strategy: RetryStrategy): void {
    this.strategies.set(strategy.errorType, strategy);
  }

  /**
   * 识别错误类型
   */
  identifyErrorType(error: Error): ErrorType {
    const message = error.message.toLowerCase();

    if (message.includes("enoent") || message.includes("not found") || message.includes("no such file")) {
      return ErrorType.FILE_NOT_FOUND;
    } else if (message.includes("eacces") || message.includes("permission denied") || message.includes("eperm")) {
      return ErrorType.PERMISSION_DENIED;
    } else if (message.includes("syntax error") || message.includes("unexpected token")) {
      return ErrorType.SYNTAX_ERROR;
    } else if (message.includes("invalid path") || message.includes("illegal characters")) {
      return ErrorType.INVALID_PATH;
    } else if (message.includes("enospc") || message.includes("disk full")) {
      return ErrorType.DISK_FULL;
    } else if (message.includes("timeout") || message.includes("timed out")) {
      return ErrorType.TIMEOUT;
    }

    return ErrorType.UNKNOWN;
  }

  /**
   * 尝试恢复错误
   */
  async attemptRecovery(
    tool: string,
    params: Record<string, any>,
    error: Error,
    attemptNumber: number,
    previousAttempts: RetryAttempt[]
  ): Promise<RetryResult> {
    const errorType = this.identifyErrorType(error);
    const strategy = this.strategies.get(errorType);

    console.log(chalk.yellow(`\n⚠️  错误恢复尝试 #${attemptNumber}`));
    console.log(chalk.gray(`   错误类型: ${errorType}`));
    console.log(chalk.gray(`   工具: ${tool}`));

    if (!strategy) {
      console.log(chalk.red(`   未找到针对 "${errorType}" 的恢复策略`));
      return {
        shouldRetry: false,
        message: `未知错误类型：${errorType}`,
      };
    }

    // 检查是否超过最大重试次数
    if (attemptNumber > strategy.maxRetries) {
      console.log(chalk.red(`   已达到最大重试次数 (${strategy.maxRetries})`));
      return {
        shouldRetry: false,
        message: `已达到最大重试次数 (${strategy.maxRetries})`,
      };
    }

    console.log(chalk.cyan(`   策略: ${strategy.description}`));

    const context: RetryContext = {
      tool,
      params,
      error,
      attemptNumber,
      previousAttempts,
    };

    const result = await strategy.execute(error, context);

    if (result.shouldRetry) {
      console.log(chalk.green(`   ✓ 建议重试`));
    } else {
      console.log(chalk.red(`   ✗ 不建议重试`));
    }

    if (result.suggestedAction) {
      console.log(chalk.cyan(`\n   建议操作：\n   ${result.suggestedAction.replace(/\n/g, '\n   ')}`));
    }

    return result;
  }

  /**
   * 创建文件备份
   */
  async createBackup(filePath: string, operation: string): Promise<boolean> {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        // 文件不存在，无需备份（可能是新建文件）
        console.log(chalk.gray(`[备份] 文件不存在，跳过备份: ${filePath}`));
        return true;
      }

      // 读取当前内容
      const contentBefore = fs.readFileSync(filePath, "utf-8");
      const backupSize = Buffer.byteLength(contentBefore, 'utf-8');

      // 检查是否超过总大小限制
      if (this.currentBackupSize + backupSize > this.maxTotalBackupSize) {
        // 清理最旧的备份直到有足够空间
        this.cleanOldestBackupsUntilSpace(backupSize);
      }

      // 创建备份记录
      const backup: FileBackup = {
        path: filePath,
        contentBefore,
        timestamp: new Date(),
        operation,
      };

      // 存储备份
      if (!this.backups.has(filePath)) {
        this.backups.set(filePath, []);
      }

      const fileBackups = this.backups.get(filePath)!;
      fileBackups.push(backup);
      this.currentBackupSize += backupSize;

      // 限制备份数量
      if (fileBackups.length > this.maxBackupsPerFile) {
        const removed = fileBackups.shift()!; // 删除最旧的备份
        this.currentBackupSize -= Buffer.byteLength(removed.contentBefore, 'utf-8');
      }

      console.log(chalk.gray(`[备份] 已创建备份: ${filePath} (${fileBackups.length}/${this.maxBackupsPerFile})`));
      return true;
    } catch (error) {
      console.error(chalk.red(`[备份] 创建备份失败: ${error}`));
      return false;
    }
  }

  /**
   * 回滚文件到上一个版本
   */
  async rollbackFile(filePath: string): Promise<boolean> {
    try {
      const fileBackups = this.backups.get(filePath);

      if (!fileBackups || fileBackups.length === 0) {
        console.log(chalk.yellow(`[回滚] 没有找到文件的备份: ${filePath}`));
        return false;
      }

      // 获取最新的备份
      const latestBackup = fileBackups[fileBackups.length - 1];

      // 恢复文件内容
      fs.writeFileSync(filePath, latestBackup.contentBefore, "utf-8");

      // 移除这个备份（因为已经回滚）
      fileBackups.pop();

      console.log(chalk.green(`✓ [回滚] 文件已恢复到修改前的状态: ${filePath}`));
      console.log(chalk.gray(`   备份时间: ${latestBackup.timestamp.toLocaleString()}`));
      console.log(chalk.gray(`   操作类型: ${latestBackup.operation}`));

      return true;
    } catch (error) {
      console.error(chalk.red(`[回滚] 回滚失败: ${error}`));
      return false;
    }
  }

  /**
   * 获取文件的备份历史
   */
  getBackupHistory(filePath: string): FileBackup[] {
    return this.backups.get(filePath) || [];
  }

  /**
   * 清除文件的所有备份
   */
  clearBackups(filePath?: string): void {
    if (filePath) {
      this.backups.delete(filePath);
      console.log(chalk.gray(`[备份] 已清除文件的备份: ${filePath}`));
    } else {
      this.backups.clear();
      console.log(chalk.gray(`[备份] 已清除所有备份`));
    }
  }

  /**
   * 获取备份统计
   */
  getBackupStats(): { totalFiles: number; totalBackups: number } {
    let totalBackups = 0;
    for (const backups of this.backups.values()) {
      totalBackups += backups.length;
    }

    return {
      totalFiles: this.backups.size,
      totalBackups,
    };
  }

  /**
   * 导出备份数据（用于持久化）
   */
  exportBackups(): string {
    const data: Record<string, FileBackup[]> = {};
    for (const [path, backups] of this.backups.entries()) {
      data[path] = backups;
    }
    return JSON.stringify(data, null, 2);
  }

  /**
   * 导入备份数据（从持久化恢复）
   */
  importBackups(data: string): void {
    try {
      const parsed: Record<string, FileBackup[]> = JSON.parse(data);
      this.backups.clear();
      this.currentBackupSize = 0;
      
      for (const [path, backups] of Object.entries(parsed)) {
        const restoredBackups = backups.map((b) => ({
          ...b,
          timestamp: new Date(b.timestamp),
        }));
        
        this.backups.set(path, restoredBackups);
        
        // 重新计算备份大小
        for (const backup of restoredBackups) {
          this.currentBackupSize += Buffer.byteLength(backup.contentBefore, 'utf-8');
        }
      }
      
      console.log(chalk.green(`✓ [备份] 已导入 ${this.backups.size} 个文件的备份`));
    } catch (error) {
      console.error(chalk.red(`[备份] 导入备份数据失败: ${error}`));
    }
  }

  /**
   * 启动定期清理定时器
   */
  private startCleanupTimer(): void {
    // 每5分钟清理一次过期备份
    this.cleanupTimer = setInterval(() => {
      this.cleanExpiredBackups();
    }, 5 * 60 * 1000);
    
    // 确保进程退出时清理定时器
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 清理过期的备份
   */
  private cleanExpiredBackups(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [filePath, backups] of this.backups.entries()) {
      const validBackups = backups.filter(backup => {
        const age = now - backup.timestamp.getTime();
        if (age > this.backupTTL) {
          this.currentBackupSize -= Buffer.byteLength(backup.contentBefore, 'utf-8');
          cleanedCount++;
          return false;
        }
        return true;
      });

      if (validBackups.length === 0) {
        this.backups.delete(filePath);
      } else if (validBackups.length !== backups.length) {
        this.backups.set(filePath, validBackups);
      }
    }

    if (cleanedCount > 0) {
      console.log(chalk.gray(`[备份] 已清理 ${cleanedCount} 个过期备份`));
    }
  }

  /**
   * 清理最旧的备份直到有足够空间
   */
  private cleanOldestBackupsUntilSpace(requiredSpace: number): void {
    const allBackups: Array<{ filePath: string; backup: FileBackup; index: number }> = [];

    // 收集所有备份
    for (const [filePath, backups] of this.backups.entries()) {
      backups.forEach((backup, index) => {
        allBackups.push({ filePath, backup, index });
      });
    }

    // 按时间排序（最旧的在前）
    allBackups.sort((a, b) => a.backup.timestamp.getTime() - b.backup.timestamp.getTime());

    // 删除最旧的备份直到有足够空间
    for (const item of allBackups) {
      if (this.currentBackupSize + requiredSpace <= this.maxTotalBackupSize) {
        break;
      }

      const fileBackups = this.backups.get(item.filePath);
      if (fileBackups) {
        const removed = fileBackups.splice(item.index, 1)[0];
        if (removed) {
          this.currentBackupSize -= Buffer.byteLength(removed.contentBefore, 'utf-8');
        }
        
        if (fileBackups.length === 0) {
          this.backups.delete(item.filePath);
        }
      }
    }
  }

  /**
   * 停止清理定时器（用于清理资源）
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
