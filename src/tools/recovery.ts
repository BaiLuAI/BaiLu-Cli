/**
 * 錯誤處理和恢復機制
 * 類似 Claude Code 的 recovery.ts，提供智能錯誤恢復
 */

import chalk from "chalk";
import { ToolCall, ToolResult } from "../tools/types.js";

/**
 * 錯誤類型
 */
export type ErrorType = 
  | 'tool_execution'    // 工具執行錯誤
  | 'llm_response'      // LLM 響應錯誤
  | 'parsing'           // 解析錯誤
  | 'validation'        // 驗證錯誤
  | 'timeout'           // 超時錯誤
  | 'permission'        // 權限錯誤
  | 'network'           // 網絡錯誤
  | 'unknown';          // 未知錯誤

/**
 * 錯誤記錄
 */
export interface ErrorRecord {
  id: string;
  type: ErrorType;
  message: string;
  toolCall?: ToolCall;
  timestamp: Date;
  context?: Record<string, any>;
  recovered: boolean;
  recoveryAction?: string;
}

/**
 * 恢復策略
 */
export interface RecoveryStrategy {
  type: ErrorType;
  maxRetries: number;
  retryDelay: number; // 毫秒
  fallbackAction?: (error: ErrorRecord) => Promise<ToolResult>;
  shouldRetry: (error: ErrorRecord, retryCount: number) => boolean;
}

/**
 * 錯誤恢復管理器
 */
export class ErrorRecoveryManager {
  private errorHistory: ErrorRecord[] = [];
  private strategies: Map<ErrorType, RecoveryStrategy> = new Map();
  private defaultStrategy: RecoveryStrategy;

  constructor() {
    // 默認恢復策略
    this.defaultStrategy = {
      type: 'unknown',
      maxRetries: 3,
      retryDelay: 1000,
      shouldRetry: (error, retryCount) => retryCount < 3,
    };

    // 初始化各類錯誤的恢復策略
    this.initializeStrategies();
  }

  /**
   * 初始化恢復策略
   */
  private initializeStrategies(): void {
    // 工具執行錯誤
    this.strategies.set('tool_execution', {
      type: 'tool_execution',
      maxRetries: 3,
      retryDelay: 500,
      shouldRetry: (error, retryCount) => {
        // 某些錯誤不應該重試
        const nonRetryableErrors = [
          'permission denied',
          'file not found',
          'invalid path',
          'syntax error',
        ];
        
        const errorMessage = error.message.toLowerCase();
        const isNonRetryable = nonRetryableErrors.some(e => errorMessage.includes(e));
        
        return !isNonRetryable && retryCount < 3;
      },
    });

    // LLM 響應錯誤
    this.strategies.set('llm_response', {
      type: 'llm_response',
      maxRetries: 2,
      retryDelay: 1000,
      shouldRetry: (error, retryCount) => retryCount < 2,
    });

    // 網絡錯誤
    this.strategies.set('network', {
      type: 'network',
      maxRetries: 3,
      retryDelay: 2000,
      shouldRetry: (error, retryCount) => retryCount < 3,
    });

    // 超時錯誤
    this.strategies.set('timeout', {
      type: 'timeout',
      maxRetries: 2,
      retryDelay: 3000,
      shouldRetry: (error, retryCount) => retryCount < 2,
    });

    // 權限錯誤
    this.strategies.set('permission', {
      type: 'permission',
      maxRetries: 0, // 權限錯誤不重試
      retryDelay: 0,
      shouldRetry: () => false,
    });
  }

  /**
   * 記錄錯誤
   */
  recordError(
    type: ErrorType,
    message: string,
    toolCall?: ToolCall,
    context?: Record<string, any>
  ): ErrorRecord {
    const record: ErrorRecord = {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      message,
      toolCall,
      timestamp: new Date(),
      context,
      recovered: false,
    };

    this.errorHistory.push(record);
    return record;
  }

  /**
   * 嘗試恢復錯誤
   */
  async attemptRecovery(
    error: ErrorRecord,
    retryCount: number = 0
  ): Promise<{ recovered: boolean; result?: ToolResult; shouldContinue: boolean }> {
    const strategy = this.strategies.get(error.type) || this.defaultStrategy;

    // 檢查是否應該重試
    if (!strategy.shouldRetry(error, retryCount)) {
      console.log(chalk.yellow(`⚠️ 錯誤 "${error.message}" 不適合重試，跳過恢復`));
      return { recovered: false, shouldContinue: false };
    }

    // 檢查重試次數
    if (retryCount >= strategy.maxRetries) {
      console.log(chalk.red(`❌ 錯誤 "${error.message}" 已達到最大重試次數 (${strategy.maxRetries})`));
      return { recovered: false, shouldContinue: false };
    }

    console.log(chalk.cyan(`🔄 嘗試恢復錯誤 (第 ${retryCount + 1} 次): ${error.message}`));

    // 等待重試延遲
    if (strategy.retryDelay > 0) {
      await this.delay(strategy.retryDelay);
    }

    // 如果有回退動作，執行它
    if (strategy.fallbackAction) {
      try {
        const result = await strategy.fallbackAction(error);
        error.recovered = true;
        error.recoveryAction = 'fallback_action';
        return { recovered: true, result, shouldContinue: true };
      } catch (fallbackError) {
        console.log(chalk.yellow(`⚠️ 回退動作執行失敗: ${fallbackError}`));
      }
    }

    // 返回需要重試的信號
    return { recovered: false, shouldContinue: true };
  }

  /**
   * 分析錯誤模式
   */
  analyzeErrorPatterns(): {
    mostCommonErrors: { type: ErrorType; count: number }[];
    recoveryRate: number;
    recommendations: string[];
  } {
    const errorCounts = new Map<ErrorType, number>();
    let recoveredCount = 0;

    for (const error of this.errorHistory) {
      errorCounts.set(error.type, (errorCounts.get(error.type) || 0) + 1);
      if (error.recovered) {
        recoveredCount++;
      }
    }

    // 按錯誤類型統計
    const mostCommonErrors = Array.from(errorCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // 計算恢復率
    const recoveryRate = this.errorHistory.length > 0 
      ? recoveredCount / this.errorHistory.length 
      : 0;

    // 生成建議
    const recommendations: string[] = [];
    
    if (errorCounts.get('tool_execution') || 0 > 5) {
      recommendations.push('工具執行錯誤頻繁，建議檢查工具參數和權限設置');
    }
    
    if (errorCounts.get('timeout') || 0 > 3) {
      recommendations.push('超時錯誤較多，建議增加超時時間或優化網絡連接');
    }
    
    if (errorCounts.get('permission') || 0 > 0) {
      recommendations.push('存在權限錯誤，請檢查文件和目錄權限');
    }

    if (recoveryRate < 0.5) {
      recommendations.push('錯誤恢復率較低，建議調整恢復策略');
    }

    return {
      mostCommonErrors,
      recoveryRate,
      recommendations,
    };
  }

  /**
   * 獲取錯誤歷史
   */
  getErrorHistory(): ErrorRecord[] {
    return [...this.errorHistory];
  }

  /**
   * 清除錯誤歷史
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  /**
   * 獲取錯誤統計
   */
  getErrorStats(): {
    total: number;
    byType: Map<ErrorType, number>;
    recovered: number;
    unrecovered: number;
  } {
    const byType = new Map<ErrorType, number>();
    let recovered = 0;

    for (const error of this.errorHistory) {
      byType.set(error.type, (byType.get(error.type) || 0) + 1);
      if (error.recovered) {
        recovered++;
      }
    }

    return {
      total: this.errorHistory.length,
      byType,
      recovered,
      unrecovered: this.errorHistory.length - recovered,
    };
  }

  /**
   * 延遲函數
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 智能錯誤分析器
 */
export class ErrorAnalyzer {
  /**
   * 分析錯誤消息，確定錯誤類型
   */
  static analyzeErrorType(error: string | Error): ErrorType {
    const errorMessage = error instanceof Error ? error.message : error;
    const lowerMessage = errorMessage.toLowerCase();

    // 網絡錯誤
    if (lowerMessage.includes('network') || 
        lowerMessage.includes('fetch') || 
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('econnrefused') ||
        lowerMessage.includes('enotfound')) {
      return 'network';
    }

    // 超時錯誤
    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return 'timeout';
    }

    // 權限錯誤
    if (lowerMessage.includes('permission') || 
        lowerMessage.includes('access denied') ||
        lowerMessage.includes('eacces') ||
        lowerMessage.includes('eperm')) {
      return 'permission';
    }

    // 驗證錯誤
    if (lowerMessage.includes('validation') || 
        lowerMessage.includes('invalid') ||
        lowerMessage.includes('required')) {
      return 'validation';
    }

    // 解析錯誤
    if (lowerMessage.includes('parse') || 
        lowerMessage.includes('syntax') ||
        lowerMessage.includes('json')) {
      return 'parsing';
    }

    // LLM 響應錯誤
    if (lowerMessage.includes('llm') || 
        lowerMessage.includes('model') ||
        lowerMessage.includes('api')) {
      return 'llm_response';
    }

    // 工具執行錯誤
    if (lowerMessage.includes('tool') || 
        lowerMessage.includes('execute') ||
        lowerMessage.includes('command')) {
      return 'tool_execution';
    }

    return 'unknown';
  }

  /**
   * 生成錯誤報告
   */
  static generateErrorReport(errors: ErrorRecord[]): string {
    if (errors.length === 0) {
      return '沒有錯誤記錄';
    }

    let report = '錯誤分析報告\n';
    report += '═'.repeat(50) + '\n\n';

    // 統計信息
    const stats = {
      total: errors.length,
      recovered: errors.filter(e => e.recovered).length,
      byType: new Map<ErrorType, number>(),
    };

    for (const error of errors) {
      stats.byType.set(error.type, (stats.byType.get(error.type) || 0) + 1);
    }

    report += `總錯誤數: ${stats.total}\n`;
    report += `已恢復: ${stats.recovered}\n`;
    report += `未恢復: ${stats.total - stats.recovered}\n`;
    report += `恢復率: ${((stats.recovered / stats.total) * 100).toFixed(1)}%\n\n`;

    // 按類型統計
    report += '錯誤類型統計:\n';
    for (const [type, count] of stats.byType) {
      report += `  ${type}: ${count}\n`;
    }
    report += '\n';

    // 最近的錯誤
    report += '最近錯誤:\n';
    const recentErrors = errors.slice(-5);
    for (const error of recentErrors) {
      const time = error.timestamp.toLocaleTimeString();
      const status = error.recovered ? '✅ 已恢復' : '❌ 未恢復';
      report += `  [${time}] ${error.type}: ${error.message} ${status}\n`;
    }

    return report;
  }
}

/**
 * 全局錯誤恢復管理器實例
 */
export const globalErrorRecoveryManager = new ErrorRecoveryManager();
