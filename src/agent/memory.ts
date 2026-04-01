/**
 * 上下文记忆系统
 * 用于存储和管理 AI 会话中的重要信息
 * 
 * 改進版本：集成持久化記憶和增強緩存
 */

import { EnhancedMemoryManager, getMemoryManager } from './enhanced-memory.js';

/**
 * 项目结构信息
 */
export interface ProjectStructure {
  rootPath: string;
  files: string[];
  directories: string[];
  lastScanned: Date;
}

/**
 * 用户偏好设置
 */
export interface UserPreferences {
  codeStyle?: {
    indentation?: 'tabs' | 'spaces';
    spaceSize?: number;
    quotes?: 'single' | 'double';
    semicolons?: boolean;
  };
  framework?: string;
  language?: string;
}

/**
 * 会话摘要
 */
export interface SessionSummary {
  projectStructure?: ProjectStructure;
  modifiedFiles: string[];
  userPreferences: UserPreferences;
  importantDecisions: string[];
  createdAt: Date;
  lastUpdated: Date;
}

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  tool: string;
  params: Record<string, any>;
  result: {
    success: boolean;
    output?: string;
    error?: string;
  };
  timestamp: Date;
}

/**
 * 短期工作记忆
 */
export interface WorkingMemory {
  lastListDirectory?: {
    path: string;
    files: string[];
    timestamp: Date;
  };
  lastReadFiles: Map<string, {
    content: string;
    timestamp: Date;
  }>;
  lastUserRequest?: string;
  recentToolCalls: ToolCallRecord[];
}

/**
 * 上下文记忆管理器
 * 
 * 改進：現在支持持久化記憶和增強緩存
 */
export class ContextMemory {
  private sessionSummary: SessionSummary;
  private workingMemory: WorkingMemory;
  private maxRecentToolCalls: number = 20; // 從 10 增加到 20
  private maxReadFilesCache: number = 20;  // 從 5 增加到 20
  private enhancedMemory: EnhancedMemoryManager | null = null;
  private projectPath: string = '';

  constructor() {
    this.sessionSummary = {
      modifiedFiles: [],
      userPreferences: {},
      importantDecisions: [],
      createdAt: new Date(),
      lastUpdated: new Date(),
    };

    this.workingMemory = {
      lastReadFiles: new Map(),
      recentToolCalls: [],
    };
  }

  /**
   * 初始化增強版記憶系統
   */
  initEnhancedMemory(projectPath: string): void {
    this.projectPath = projectPath;
    this.enhancedMemory = getMemoryManager(projectPath);
    console.log('[Memory] 增強版記憶系統已啟用');
  }

  /**
   * 记录项目结构
   */
  recordProjectStructure(rootPath: string, files: string[], directories: string[]): void {
    this.sessionSummary.projectStructure = {
      rootPath,
      files,
      directories,
      lastScanned: new Date(),
    };
    this.sessionSummary.lastUpdated = new Date();

    // 同步到增強版記憶
    if (this.enhancedMemory) {
      this.enhancedMemory.recordProjectStructure(files, directories);
    }
  }

  /**
   * 记录 list_directory 的结果
   */
  recordListDirectory(path: string, files: string[]): void {
    this.workingMemory.lastListDirectory = {
      path,
      files,
      timestamp: new Date(),
    };
  }

  /**
   * 记录 read_file 的结果
   */
  recordReadFile(path: string, content: string): void {
    // 限制缓存大小
    if (this.workingMemory.lastReadFiles.size >= this.maxReadFilesCache) {
      // 删除最旧的条目
      const oldestKey = Array.from(this.workingMemory.lastReadFiles.keys())[0];
      this.workingMemory.lastReadFiles.delete(oldestKey);
    }

    this.workingMemory.lastReadFiles.set(path, {
      content,
      timestamp: new Date(),
    });

    // 同步到增強版記憶的緩存
    if (this.enhancedMemory) {
      this.enhancedMemory.cacheFile(path, content);
    }
  }

  /**
   * 记录文件修改
   */
  recordFileModification(path: string): void {
    if (!this.sessionSummary.modifiedFiles.includes(path)) {
      this.sessionSummary.modifiedFiles.push(path);
      this.sessionSummary.lastUpdated = new Date();
    }

    // 同步到增強版記憶
    if (this.enhancedMemory) {
      this.enhancedMemory.recordModification(path);
    }
  }

  /**
   * 记录重要决定
   */
  recordDecision(decision: string): void {
    this.sessionSummary.importantDecisions.push(decision);
    this.sessionSummary.lastUpdated = new Date();

    // 同步到增強版記憶
    if (this.enhancedMemory) {
      this.enhancedMemory.recordDecision(decision);
    }
  }

  /**
   * 记录用户偏好
   */
  recordUserPreference(key: keyof UserPreferences, value: any): void {
    this.sessionSummary.userPreferences[key] = value;
    this.sessionSummary.lastUpdated = new Date();

    // 同步到增強版記憶
    if (this.enhancedMemory) {
      this.enhancedMemory.updateUserPreference(key as string, value);
    }
  }

  /**
   * 记录工具调用
   */
  recordToolCall(record: ToolCallRecord): void {
    this.workingMemory.recentToolCalls.push(record);

    // 限制记录数量
    if (this.workingMemory.recentToolCalls.length > this.maxRecentToolCalls) {
      this.workingMemory.recentToolCalls.shift();
    }
  }

  /**
   * 记录用户请求
   */
  recordUserRequest(request: string): void {
    this.workingMemory.lastUserRequest = request;
  }

  /**
   * 获取项目结构
   */
  getProjectStructure(): ProjectStructure | undefined {
    return this.sessionSummary.projectStructure;
  }

  /**
   * 获取最近读取的文件内容
   */
  getLastReadFile(path: string): string | undefined {
    return this.workingMemory.lastReadFiles.get(path)?.content;
  }

  /**
   * 获取最近的 list_directory 结果
   */
  getLastListDirectory(): { path: string; files: string[] } | undefined {
    return this.workingMemory.lastListDirectory;
  }

  /**
   * 获取已修改的文件列表
   */
  getModifiedFiles(): string[] {
    return this.sessionSummary.modifiedFiles;
  }

  /**
   * 获取用户偏好
   */
  getUserPreferences(): UserPreferences {
    return this.sessionSummary.userPreferences;
  }

  /**
   * 获取重要决定
   */
  getImportantDecisions(): string[] {
    return this.sessionSummary.importantDecisions;
  }

  /**
   * 获取最近的工具调用
   */
  getRecentToolCalls(count?: number): ToolCallRecord[] {
    if (count) {
      return this.workingMemory.recentToolCalls.slice(-count);
    }
    return this.workingMemory.recentToolCalls;
  }

  /**
   * 生成记忆摘要（用于注入到 AI 上下文）
   */
  generateMemorySummary(): string {
    const parts: string[] = [];

    // 项目结构
    if (this.sessionSummary.projectStructure) {
      const { files, directories } = this.sessionSummary.projectStructure;
      parts.push(`📁 已知项目结构：`);
      parts.push(`   文件: ${files.slice(0, 15).join(', ')}${files.length > 15 ? '...' : ''}`);
      if (directories.length > 0) {
        parts.push(`   目录: ${directories.slice(0, 8).join(', ')}${directories.length > 8 ? '...' : ''}`);
      }
    }

    // 已修改的文件
    if (this.sessionSummary.modifiedFiles.length > 0) {
      parts.push(`\n✏️ 已修改的文件：`);
      this.sessionSummary.modifiedFiles.slice(-10).forEach(file => {
        parts.push(`   - ${file}`);
      });
    }

    // 最近读取的文件
    if (this.workingMemory.lastReadFiles.size > 0) {
      parts.push(`\n📖 最近读取的文件：`);
      Array.from(this.workingMemory.lastReadFiles.keys()).slice(0, 10).forEach(file => {
        parts.push(`   - ${file}`);
      });
    }

    // 用户偏好
    if (Object.keys(this.sessionSummary.userPreferences).length > 0) {
      parts.push(`\n⚙️ 用户偏好：`);
      const prefs = this.sessionSummary.userPreferences;
      if (prefs.framework) parts.push(`   框架: ${prefs.framework}`);
      if (prefs.language) parts.push(`   语言: ${prefs.language}`);
      if (prefs.codeStyle) {
        parts.push(`   代码风格: ${JSON.stringify(prefs.codeStyle)}`);
      }
    }

    // 重要决定
    if (this.sessionSummary.importantDecisions.length > 0) {
      parts.push(`\n📝 重要决定：`);
      this.sessionSummary.importantDecisions.slice(-5).forEach((decision, i) => {
        parts.push(`   ${i + 1}. ${decision}`);
      });
    }

    // 增強版記憶摘要
    if (this.enhancedMemory) {
      const enhancedSummary = this.enhancedMemory.generateContextSummary();
      if (enhancedSummary) {
        parts.push(`\n${enhancedSummary}`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  /**
   * 检查文件是否最近读取过
   */
  hasRecentlyRead(path: string, maxAgeMinutes: number = 5): boolean {
    const fileRecord = this.workingMemory.lastReadFiles.get(path);
    if (!fileRecord) return false;

    const ageMs = Date.now() - fileRecord.timestamp.getTime();
    const ageMinutes = ageMs / (1000 * 60);
    return ageMinutes <= maxAgeMinutes;
  }

  /**
   * 清除工作记忆（保留会话摘要）
   */
  clearWorkingMemory(): void {
    this.workingMemory = {
      lastReadFiles: new Map(),
      recentToolCalls: [],
    };
  }

  /**
   * 完全重置记忆
   */
  reset(): void {
    this.sessionSummary = {
      modifiedFiles: [],
      userPreferences: {},
      importantDecisions: [],
      createdAt: new Date(),
      lastUpdated: new Date(),
    };
    this.clearWorkingMemory();

    // 清除增強版記憶的當前會話
    if (this.enhancedMemory) {
      this.enhancedMemory.clearCurrentSession();
    }
  }

  /**
   * 导出记忆数据（用于保存）
   */
  export(): string {
    return JSON.stringify({
      sessionSummary: {
        ...this.sessionSummary,
        projectStructure: this.sessionSummary.projectStructure,
      },
      workingMemory: {
        ...this.workingMemory,
        lastReadFiles: Array.from(this.workingMemory.lastReadFiles.entries()),
      },
    }, null, 2);
  }

  /**
   * 导入记忆数据（用于恢复）
   */
  import(data: string): void {
    try {
      const parsed = JSON.parse(data);
      this.sessionSummary = {
        ...parsed.sessionSummary,
        createdAt: new Date(parsed.sessionSummary.createdAt),
        lastUpdated: new Date(parsed.sessionSummary.lastUpdated),
      };
      this.workingMemory = {
        ...parsed.workingMemory,
        lastReadFiles: new Map(parsed.workingMemory.lastReadFiles),
      };
    } catch (error) {
      console.error('导入记忆数据失败:', error);
    }
  }

  /**
   * 結束會話並保存記憶
   */
  endSession(summary: string = ''): void {
    if (this.enhancedMemory) {
      this.enhancedMemory.endSession(summary);
    }
  }

  /**
   * 獲取緩存統計信息
   */
  getCacheStats(): { size: number; hitRate: number } {
    if (this.enhancedMemory) {
      return this.enhancedMemory.getCacheStats();
    }
    return { size: this.workingMemory.lastReadFiles.size, hitRate: 0 };
  }
}
