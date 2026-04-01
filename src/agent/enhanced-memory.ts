/**
 * 增強版上下文管理器
 * 改進點：
 * 1. 更大的上下文窗口
 * 2. 持久化記憶
 * 3. 更智能的文件評分
 * 4. 文件內容緩存優化
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

// ─── 配置 ───────────────────────────────────────────

const ENHANCED_CONFIG = {
  // 上下文窗口設置
  MAX_CONTEXT_CHARS: 50000,           // 從 15000 增加到 50000
  MAX_CONTEXT_FILES: 15,              // 從 8 增加到 15
  MAX_LINES_PER_FILE: 200,            // 從 120 增加到 200
  
  // 緩存設置
  MAX_FILE_CACHE: 20,                 // 從 5 增加到 20
  CACHE_TTL_MS: 10 * 60 * 1000,      // 10分鐘緩存過期
  
  // 記憶設置
  MAX_DECISIONS: 50,                  // 最多記錄50個重要決定
  MAX_MODIFIED_FILES: 100,            // 最多記錄100個修改文件
  
  // 持久化設置
  MEMORY_DIR: ".bailu/memory",
  AUTO_SAVE_INTERVAL_MS: 30 * 1000,   // 30秒自動保存
};

// ─── 持久化記憶存儲 ─────────────────────────────────

interface PersistentMemory {
  sessionId: string;
  projectPath: string;
  createdAt: string;
  lastUpdated: string;
  
  // 項目信息
  projectStructure?: {
    files: string[];
    directories: string[];
    scannedAt: string;
  };
  
  // 會話記錄
  sessions: Array<{
    id: string;
    startTime: string;
    endTime?: string;
    summary: string;
    modifiedFiles: string[];
    decisions: string[];
  }>;
  
  // 用戶偏好（跨會話保留）
  userPreferences: Record<string, any>;
  
  // 學習到的模式
  learnedPatterns: Array<{
    pattern: string;
    context: string;
    frequency: number;
    lastSeen: string;
  }>;
}

// ─── 增強版文件緩存 ─────────────────────────────────

interface CachedFile {
  content: string;
  lines: string[];
  timestamp: number;
  accessCount: number;
}

class EnhancedFileCache {
  private cache: Map<string, CachedFile> = new Map();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  async get(filePath: string): Promise<{ content: string; lines: string[] } | null> {
    const cached = this.cache.get(filePath);
    
    if (!cached) return null;
    
    // 檢查是否過期
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(filePath);
      return null;
    }
    
    // 更新訪問計數和時間
    cached.accessCount++;
    cached.timestamp = Date.now();
    
    return { content: cached.content, lines: cached.lines };
  }

  set(filePath: string, content: string): void {
    // 如果緩存已滿，刪除最不常用的
    if (this.cache.size >= this.maxSize) {
      let leastUsed: string | null = null;
      let minAccess = Infinity;
      
      for (const [key, value] of this.cache) {
        if (value.accessCount < minAccess) {
          minAccess = value.accessCount;
          leastUsed = key;
        }
      }
      
      if (leastUsed) {
        this.cache.delete(leastUsed);
      }
    }
    
    this.cache.set(filePath, {
      content,
      lines: content.split('\n'),
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; hitRate: number } {
    let totalAccess = 0;
    for (const value of this.cache.values()) {
      totalAccess += value.accessCount;
    }
    return {
      size: this.cache.size,
      hitRate: this.cache.size > 0 ? totalAccess / this.cache.size : 0,
    };
  }
}

// ─── 增強版記憶管理器 ───────────────────────────────

export class EnhancedMemoryManager {
  private memory: PersistentMemory;
  private memoryDir: string;
  private fileCache: EnhancedFileCache;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private currentSessionId: string;

  constructor(projectPath: string) {
    this.memoryDir = path.join(projectPath, ENHANCED_CONFIG.MEMORY_DIR);
    this.currentSessionId = `session_${Date.now()}`;
    this.fileCache = new EnhancedFileCache(
      ENHANCED_CONFIG.MAX_FILE_CACHE,
      ENHANCED_CONFIG.CACHE_TTL_MS
    );
    
    // 初始化記憶結構
    this.memory = {
      sessionId: this.currentSessionId,
      projectPath,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      sessions: [],
      userPreferences: {},
      learnedPatterns: [],
    };
    
    // 嘗試加載現有記憶
    this.loadMemory();
    
    // 啟動自動保存
    this.startAutoSave();
  }

  // ─── 持久化操作 ─────────────────────────────────

  private async ensureMemoryDir(): Promise<void> {
    try {
      await fsPromises.mkdir(this.memoryDir, { recursive: true });
    } catch {
      // 目錄可能已存在
    }
  }

  private getMemoryFilePath(): string {
    // 使用項目路徑的哈希作為文件名
    const hash = this.simpleHash(this.memory.projectPath);
    return path.join(this.memoryDir, `memory_${hash}.json`);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }

  private async loadMemory(): Promise<void> {
    try {
      await this.ensureMemoryDir();
      const filePath = this.getMemoryFilePath();
      const data = await fsPromises.readFile(filePath, 'utf-8');
      const loaded = JSON.parse(data) as PersistentMemory;
      
      // 合併加載的記憶，保留當前會話
      this.memory = {
        ...loaded,
        sessionId: this.currentSessionId,
        lastUpdated: new Date().toISOString(),
      };
      
      console.log(`[Memory] 已加載持久化記憶 (${loaded.sessions.length} 個歷史會話)`);
    } catch {
      // 沒有現有記憶或加載失敗，使用新的
    }
  }

  async saveMemory(): Promise<void> {
    try {
      await this.ensureMemoryDir();
      this.memory.lastUpdated = new Date().toISOString();
      const filePath = this.getMemoryFilePath();
      await fsPromises.writeFile(
        filePath,
        JSON.stringify(this.memory, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[Memory] 保存記憶失敗:', error);
    }
  }

  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(() => {
      this.saveMemory();
    }, ENHANCED_CONFIG.AUTO_SAVE_INTERVAL_MS);
  }

  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // ─── 記錄操作 ───────────────────────────────────

  recordProjectStructure(files: string[], directories: string[]): void {
    this.memory.projectStructure = {
      files,
      directories,
      scannedAt: new Date().toISOString(),
    };
  }

  recordModification(filePath: string): void {
    const currentSession = this.getCurrentSession();
    if (!currentSession.modifiedFiles.includes(filePath)) {
      currentSession.modifiedFiles.push(filePath);
      
      // 限制數量
      if (currentSession.modifiedFiles.length > ENHANCED_CONFIG.MAX_MODIFIED_FILES) {
        currentSession.modifiedFiles.shift();
      }
    }
  }

  recordDecision(decision: string): void {
    const currentSession = this.getCurrentSession();
    currentSession.decisions.push(decision);
    
    // 限制數量
    if (currentSession.decisions.length > ENHANCED_CONFIG.MAX_DECISIONS) {
      currentSession.decisions.shift();
    }
  }

  recordLearnedPattern(pattern: string, context: string): void {
    const existing = this.memory.learnedPatterns.find(p => p.pattern === pattern);
    
    if (existing) {
      existing.frequency++;
      existing.lastSeen = new Date().toISOString();
      existing.context = context; // 更新上下文
    } else {
      this.memory.learnedPatterns.push({
        pattern,
        context,
        frequency: 1,
        lastSeen: new Date().toISOString(),
      });
    }
    
    // 限制數量，保留最常用的
    if (this.memory.learnedPatterns.length > 100) {
      this.memory.learnedPatterns.sort((a, b) => b.frequency - a.frequency);
      this.memory.learnedPatterns = this.memory.learnedPatterns.slice(0, 100);
    }
  }

  updateUserPreference(key: string, value: any): void {
    this.memory.userPreferences[key] = value;
  }

  // ─── 查詢操作 ───────────────────────────────────

  private getCurrentSession(): PersistentMemory['sessions'][0] {
    let session = this.memory.sessions.find(s => s.id === this.currentSessionId);
    
    if (!session) {
      session = {
        id: this.currentSessionId,
        startTime: new Date().toISOString(),
        summary: '',
        modifiedFiles: [],
        decisions: [],
      };
      this.memory.sessions.push(session);
    }
    
    return session;
  }

  getRecentSessions(count: number = 5): PersistentMemory['sessions'] {
    return this.memory.sessions.slice(-count);
  }

  getModifiedFiles(): string[] {
    return this.getCurrentSession().modifiedFiles;
  }

  getDecisions(): string[] {
    return this.getCurrentSession().decisions;
  }

  getLearnedPatterns(): PersistentMemory['learnedPatterns'] {
    return this.memory.learnedPatterns;
  }

  getUserPreferences(): PersistentMemory['userPreferences'] {
    return this.memory.userPreferences;
  }

  getProjectStructure(): PersistentMemory['projectStructure'] | undefined {
    return this.memory.projectStructure;
  }

  // ─── 文件緩存操作 ───────────────────────────────

  async getCachedFile(filePath: string): Promise<{ content: string; lines: string[] } | null> {
    return this.fileCache.get(filePath);
  }

  cacheFile(filePath: string, content: string): void {
    this.fileCache.set(filePath, content);
  }

  getCacheStats(): { size: number; hitRate: number } {
    return this.fileCache.getStats();
  }

  // ─── 生成上下文摘要 ─────────────────────────────

  generateContextSummary(): string {
    const parts: string[] = [];
    
    // 項目結構
    if (this.memory.projectStructure) {
      const { files, directories, scannedAt } = this.memory.projectStructure;
      const scanDate = new Date(scannedAt).toLocaleString();
      parts.push(`📁 項目結構 (掃描於 ${scanDate}):`);
      parts.push(`   文件: ${files.slice(0, 15).join(', ')}${files.length > 15 ? '...' : ''}`);
      if (directories.length > 0) {
        parts.push(`   目錄: ${directories.slice(0, 8).join(', ')}${directories.length > 8 ? '...' : ''}`);
      }
    }
    
    // 當前會話修改的文件
    const modifiedFiles = this.getModifiedFiles();
    if (modifiedFiles.length > 0) {
      parts.push(`\n✏️ 本次會話修改的文件:`);
      modifiedFiles.slice(-10).forEach(file => {
        parts.push(`   - ${file}`);
      });
    }
    
    // 重要決定
    const decisions = this.getDecisions();
    if (decisions.length > 0) {
      parts.push(`\n📝 重要決定:`);
      decisions.slice(-5).forEach((decision, i) => {
        parts.push(`   ${i + 1}. ${decision}`);
      });
    }
    
    // 用戶偏好
    const prefs = this.getUserPreferences();
    if (Object.keys(prefs).length > 0) {
      parts.push(`\n⚙️ 用戶偏好:`);
      if (prefs.codeStyle) {
        parts.push(`   代碼風格: ${JSON.stringify(prefs.codeStyle)}`);
      }
      if (prefs.frameworks) {
        parts.push(`   框架: ${prefs.frameworks.join(', ')}`);
      }
      if (prefs.languages) {
        parts.push(`   語言: ${prefs.languages.join(', ')}`);
      }
    }
    
    // 學習到的模式
    const patterns = this.getLearnedPatterns();
    if (patterns.length > 0) {
      parts.push(`\n🧠 學習到的模式:`);
      patterns.slice(0, 5).forEach(p => {
        parts.push(`   - ${p.pattern} (出現 ${p.frequency} 次)`);
      });
    }
    
    // 歷史會話摘要
    const recentSessions = this.getRecentSessions(3);
    if (recentSessions.length > 1) { // 排除當前會話
      parts.push(`\n📚 歷史會話:`);
      recentSessions.slice(0, -1).forEach(session => {
        const date = new Date(session.startTime).toLocaleDateString();
        parts.push(`   ${date}: ${session.modifiedFiles.length} 個文件修改, ${session.decisions.length} 個決定`);
      });
    }
    
    return parts.join('\n');
  }

  // ─── 會話結束處理 ───────────────────────────────

  endSession(summary: string): void {
    const currentSession = this.getCurrentSession();
    currentSession.endTime = new Date().toISOString();
    currentSession.summary = summary;
    
    // 保存記憶
    this.saveMemory();
    this.stopAutoSave();
    
    console.log(`[Memory] 會話結束，已保存記憶`);
  }

  // ─── 清理操作 ───────────────────────────────────

  clearCurrentSession(): void {
    const currentSession = this.getCurrentSession();
    currentSession.modifiedFiles = [];
    currentSession.decisions = [];
    this.fileCache.clear();
  }

  async clearAllMemory(): Promise<void> {
    this.memory.sessions = [];
    this.memory.learnedPatterns = [];
    this.fileCache.clear();
    await this.saveMemory();
  }
}

// ─── 導出便捷函數 ─────────────────────────────────

let globalMemoryManager: EnhancedMemoryManager | null = null;

export function getMemoryManager(projectPath: string): EnhancedMemoryManager {
  if (!globalMemoryManager || globalMemoryManager['memory'].projectPath !== projectPath) {
    globalMemoryManager = new EnhancedMemoryManager(projectPath);
  }
  return globalMemoryManager;
}

export function clearGlobalMemoryManager(): void {
  if (globalMemoryManager) {
    globalMemoryManager.stopAutoSave();
    globalMemoryManager = null;
  }
}
