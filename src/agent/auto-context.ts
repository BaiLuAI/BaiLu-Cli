/**
 * 自動上下文蒐集模組（類似 Cursor IDE 的 @codebase 功能）
 * 
 * 在用戶提問時，自動搜索工作區中可能相關的檔案，
 * 讀取關鍵內容並注入到對話上下文中，
 * 讓 AI 無需反問即可直接給出有根據的回答。
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import readline from "readline";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";

// ─── 配置 ───────────────────────────────────────────

const MAX_CONTEXT_FILES = 15;        // 最多注入幾個文件的內容 (從 8 增加到 15)
const MAX_LINES_PER_FILE = 200;     // 每個文件最多讀取的行數 (從 120 增加到 200)
const MAX_GREP_RESULTS = 50;        // grep 搜索最多返回多少匹配 (從 30 增加到 50)
const MAX_TOTAL_CONTEXT_CHARS = 50000; // 上下文總字符數上限 (從 15000 增加到 50000)

const EXCLUDED_DIRS = [
  "node_modules", ".git", "dist", "build", ".bailu",
  "coverage", ".next", ".nuxt", "__pycache__", ".venv",
  "vendor", ".DS_Store", "test-git-repo", "non-git-dir",
];

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cs", ".php", ".rb",
  ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
  ".vue", ".svelte", ".astro",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt",
  ".css", ".scss", ".less",
  ".html", ".xml",
  ".sh", ".bat", ".ps1",
  ".sql",
  ".dockerfile", ".docker-compose.yml",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".7z",
  ".pdf", ".exe", ".dll", ".so",
  ".mp3", ".mp4", ".wav",
  ".sqlite", ".db",
]);

// 中文停用詞
const STOP_WORDS_ZH = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一個",
  "上", "也", "很", "到", "說", "要", "去", "你", "會", "著", "沒有", "看", "好",
  "自己", "這", "他", "她", "它", "們", "那", "裡", "什麼", "怎麼", "為什麼",
  "可以", "這個", "那個", "還是", "或者", "以及", "但是", "然後", "所以",
  "如果", "因為", "已經", "應該", "可能", "需要", "使用", "進行",
  "幫我", "請", "能不能", "能否", "告訴我", "看看", "查看", "显示", "顯示",
  "幫", "吧", "嗎", "呢", "啊", "哦", "唄", "把",
]);

// 英文停用詞
const STOP_WORDS_EN = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "do", "does", "did", "will", "would", "could", "should", "can",
  "have", "has", "had", "having",
  "i", "me", "my", "you", "your", "we", "our", "they", "them",
  "it", "its", "this", "that", "these", "those",
  "what", "which", "who", "whom", "where", "when", "why", "how",
  "and", "or", "but", "not", "no", "so", "if", "then",
  "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "about", "into", "through", "during", "before", "after",
  "all", "each", "every", "both", "few", "more", "most",
  "some", "any", "other", "than", "too", "very",
  "just", "also", "now", "here", "there",
  "please", "help", "show", "tell", "look", "check", "find",
  "want", "need", "like",
]);

// ─── 核心接口 ───────────────────────────────────────

export interface AutoContextResult {
  /** 蒐集到的上下文內容（格式化好的字串，可直接注入到 user message） */
  contextText: string;
  /** 找到的相關文件列表 */
  relevantFiles: string[];
  /** 搜索過程耗時（毫秒） */
  searchTimeMs: number;
  /** 是否找到了有意義的上下文 */
  hasContext: boolean;
}

interface ScoredFile {
  filePath: string;        // 相對路徑
  score: number;           // 相關性分數
  matchReasons: string[];  // 匹配原因
}

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

// ─── 主函數 ─────────────────────────────────────────

/**
 * 根據用戶提問自動蒐集相關代碼上下文
 */
export async function gatherAutoContext(
  query: string,
  workspaceRoot: string,
  recentFiles?: string[],
): Promise<AutoContextResult> {
  const startTime = Date.now();

  // 1. 從查詢中提取關鍵詞
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return { contextText: "", relevantFiles: [], searchTimeMs: Date.now() - startTime, hasContext: false };
  }

  // 2. 獲取工作區文件索引（快速掃描）
  const allFiles = await listWorkspaceFiles(workspaceRoot);

  // 3. 多策略搜索，給文件打分
  const scoredFiles = await scoreFiles(keywords, query, allFiles, workspaceRoot, recentFiles || []);

  // 4. 取得分最高的文件
  const topFiles = scoredFiles
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONTEXT_FILES);

  if (topFiles.length === 0 || topFiles[0].score === 0) {
    return { contextText: "", relevantFiles: [], searchTimeMs: Date.now() - startTime, hasContext: false };
  }

  // 5. 讀取相關文件內容
  const contextParts: string[] = [];
  let totalChars = 0;
  const relevantFiles: string[] = [];

  for (const scored of topFiles) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) break;
    if (scored.score <= 0) break;

    const fullPath = path.join(workspaceRoot, scored.filePath);
    const content = await readFileHead(fullPath, MAX_LINES_PER_FILE);

    if (!content) continue;

    const remaining = MAX_TOTAL_CONTEXT_CHARS - totalChars;
    const truncatedContent = content.length > remaining ? content.substring(0, remaining) + "\n... (已截斷)" : content;

    contextParts.push(
      `--- ${scored.filePath} (相關度: ${scored.matchReasons.join(", ")}) ---\n${truncatedContent}`
    );
    totalChars += truncatedContent.length;
    relevantFiles.push(scored.filePath);
  }

  const contextText = contextParts.length > 0
    ? `[自動蒐集的相關代碼上下文 - ${relevantFiles.length} 個文件]\n\n${contextParts.join("\n\n")}\n\n[上下文結束]`
    : "";

  return {
    contextText,
    relevantFiles,
    searchTimeMs: Date.now() - startTime,
    hasContext: contextParts.length > 0,
  };
}

// ─── 關鍵詞提取 ─────────────────────────────────────

function extractKeywords(query: string): string[] {
  const keywords: string[] = [];

  // 提取引號內的精確詞
  const quoted = query.match(/["'`]([^"'`]+)["'`]/g);
  if (quoted) {
    for (const q of quoted) {
      keywords.push(q.slice(1, -1));
    }
  }

  // 提取明確的文件名/路徑模式
  const filePatterns = query.match(/[\w\-./\\]+\.\w{1,5}/g);
  if (filePatterns) {
    keywords.push(...filePatterns);
  }

  // 提取駝峰/蛇底線標識符（可能是函數名、類名等）
  const identifiers = query.match(/[a-zA-Z_]\w*(?:[A-Z]\w*)+|[a-zA-Z_]+(?:_[a-zA-Z_]+)+/g);
  if (identifiers) {
    keywords.push(...identifiers);
  }

  // 分詞：按空白和標點分割
  const tokens = query
    .replace(/[，。！？、；：""''（）【】《》\n\r]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (STOP_WORDS_ZH.has(token) || STOP_WORDS_EN.has(lower)) continue;
    if (token.length < 2) continue;
    keywords.push(token);
  }

  // 去重並保持順序
  return [...new Set(keywords)];
}

// ─── 文件掃描 ────────────────────────────────────────

async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const MAX_FILES = 2000;

  async function walk(dir: string) {
    if (files.length >= MAX_FILES) return;

    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootPath, fullPath).replace(/\\/g, "/");

      // 排除目錄
      if (EXCLUDED_DIRS.some(ex => relPath.startsWith(ex + "/") || relPath === ex)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext) && !BINARY_EXTENSIONS.has(ext)) {
          files.push(relPath);
        }
      }
    }
  }

  await walk(rootPath);
  return files;
}

// ─── 文件評分 ────────────────────────────────────────

async function scoreFiles(
  keywords: string[],
  query: string,
  allFiles: string[],
  workspaceRoot: string,
  recentFiles: string[],
): Promise<ScoredFile[]> {
  const scoreMap = new Map<string, ScoredFile>();

  function addScore(filePath: string, points: number, reason: string) {
    const existing = scoreMap.get(filePath);
    if (existing) {
      existing.score += points;
      if (!existing.matchReasons.includes(reason)) {
        existing.matchReasons.push(reason);
      }
    } else {
      scoreMap.set(filePath, { filePath, score: points, matchReasons: [reason] });
    }
  }

  // 策略 1：文件名匹配（高分）
  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    for (const file of allFiles) {
      const fileName = path.basename(file).toLowerCase();
      const fileLower = file.toLowerCase();

      if (fileName === lower || fileName === lower + ".ts" || fileName === lower + ".js") {
        addScore(file, 10, "文件名精確匹配");
      } else if (fileName.includes(lower)) {
        addScore(file, 6, "文件名包含關鍵詞");
      } else if (fileLower.includes(lower)) {
        addScore(file, 3, "路徑包含關鍵詞");
      }
    }
  }

  // 策略 2：grep 搜索文件內容（關鍵命中）
  for (const keyword of keywords.slice(0, 5)) { // 最多搜 5 個關鍵詞
    if (keyword.length < 3) continue; // 太短的詞不搜

    const matches = await grepInWorkspace(keyword, workspaceRoot);
    const fileHits = new Map<string, number>();

    for (const m of matches) {
      fileHits.set(m.file, (fileHits.get(m.file) || 0) + 1);
    }

    for (const [file, hitCount] of fileHits) {
      const score = Math.min(hitCount * 2, 8); // 每次命中 +2，上限 8
      addScore(file, score, `內容包含 "${keyword}"`);
    }
  }

  // 策略 3：最近訪問的文件加分
  for (const recent of recentFiles) {
    const normalized = recent.replace(/\\/g, "/");
    if (scoreMap.has(normalized)) {
      addScore(normalized, 3, "最近訪問");
    }
  }

  // 策略 4：重要文件加分（入口文件、配置文件等）
  const importantPatterns = [
    "readme", "package.json", "tsconfig", ".bailu",
    "index.ts", "index.js", "main.ts", "main.js",
    "cli.ts", "cli.js", "app.ts", "app.js",
  ];
  for (const file of allFiles) {
    const lower = path.basename(file).toLowerCase();
    if (importantPatterns.some(p => lower.includes(p))) {
      // 只有已經有其他分數的重要文件才加分
      if (scoreMap.has(file)) {
        addScore(file, 2, "重要文件");
      }
    }
  }

  return Array.from(scoreMap.values());
}

// ─── Grep 搜索 ──────────────────────────────────────

async function grepInWorkspace(keyword: string, workspaceRoot: string): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];

  // 用 escaped 關鍵詞做純文本搜索
  const searchPattern = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let regex: RegExp;
  try {
    regex = new RegExp(searchPattern, "i");
  } catch {
    return matches;
  }

  async function searchFile(filePath: string): Promise<void> {
    if (matches.length >= MAX_GREP_RESULTS) return;

    try {
      const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lineNum = 0;

      for await (const line of rl) {
        lineNum++;
        if (matches.length >= MAX_GREP_RESULTS) break;

        if (regex.test(line)) {
          matches.push({
            file: path.relative(workspaceRoot, filePath).replace(/\\/g, "/"),
            line: lineNum,
            content: line.substring(0, 200),
          });
        }
      }

      stream.destroy();
    } catch {
      // 忽略無法讀取的文件
    }
  }

  // 遍歷工作區文件
  const files = await listWorkspaceFiles(workspaceRoot);

  // 並行搜索（每批 20 個文件）
  const batchSize = 20;
  for (let i = 0; i < files.length; i += batchSize) {
    if (matches.length >= MAX_GREP_RESULTS) break;
    const batch = files.slice(i, i + batchSize);
    await Promise.all(batch.map(f => searchFile(path.join(workspaceRoot, f))));
  }

  return matches;
}

// ─── 文件讀取 ────────────────────────────────────────

async function readFileHead(filePath: string, maxLines: number): Promise<string | null> {
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    if (lines.length <= maxLines) {
      return lines.map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
    }

    const head = lines.slice(0, maxLines);
    return (
      head.map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n") +
      `\n  ... (共 ${lines.length} 行，已顯示前 ${maxLines} 行)`
    );
  } catch {
    return null;
  }
}

// ─── 對外便捷函數 ───────────────────────────────────

/**
 * 在 chat 流程中顯示搜索進度並蒐集上下文
 */
export async function gatherContextWithProgress(
  query: string,
  workspaceRoot: string,
  recentFiles?: string[],
): Promise<AutoContextResult> {
  const spinner = createSpinner("[CONTEXT] 正在搜索相關代碼...");
  spinner.start();

  try {
    const result = await gatherAutoContext(query, workspaceRoot, recentFiles);

    spinner.stop();

    if (result.hasContext) {
      console.log(
        chalk.cyan(`[CONTEXT]`) +
        chalk.gray(` 找到 ${result.relevantFiles.length} 個相關文件 (${result.searchTimeMs}ms)`)
      );
      for (const f of result.relevantFiles) {
        console.log(chalk.gray(`  • ${f}`));
      }
    } else {
      console.log(chalk.gray(`[CONTEXT] 未找到特別相關的文件`));
    }

    return result;
  } catch (error) {
    spinner.stop();
    console.log(chalk.gray(`[CONTEXT] 上下文蒐集跳過: ${error instanceof Error ? error.message : "未知錯誤"}`));
    return { contextText: "", relevantFiles: [], searchTimeMs: 0, hasContext: false };
  }
}
