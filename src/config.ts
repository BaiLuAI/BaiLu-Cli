import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { findGitRoot, getProjectRoot } from "./utils/git.js";

export interface BailuCliConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  safetyMode?: "dry-run" | "review" | "auto-apply";
  maxIterations?: number;
  autoCompress?: boolean;
  verbose?: boolean;
}

function getConfigDir(): string {
  const home = os.homedir();
  const envDir = process.env.BAILU_CONFIG_DIR;
  if (envDir) return envDir;

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "bailu-cli");
  }

  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, "bailu-cli");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

/**
 * 获取命令历史文件路径
 */
export function getHistoryPath(): string {
  return path.join(getConfigDir(), "history.txt");
}

/**
 * 导出 Git 工具函数供其他模块使用
 */
export { findGitRoot, getProjectRoot, isInGitRepo } from "./utils/git.js";

/**
 * 获取项目级配置文件路径
 * 优先在 Git 根目录查找，否则在当前目录向上查找
 */
function findProjectConfig(startDir: string = process.cwd()): string | null {
  const configFilenames = [".bailu.config.json", ".bailurc.json", ".bailurc"];
  
  // 优先检查 Git 根目录
  const gitRoot = findGitRoot(startDir);
  if (gitRoot) {
    for (const filename of configFilenames) {
      const configPath = path.join(gitRoot, filename);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
  }
  
  // 如果 Git 根目录没有，向上查找
  let currentDir = startDir;
  while (true) {
    // 跳过 Git 根目录（已经检查过）
    if (currentDir !== gitRoot) {
      for (const filename of configFilenames) {
        const configPath = path.join(currentDir, filename);
        if (fs.existsSync(configPath)) {
          return configPath;
        }
      }
    }
    
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // 已到根目录
      break;
    }
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * 加载项目级配置
 */
export function loadProjectConfig(): BailuCliConfig {
  const configPath = findProjectConfig();
  if (!configPath) return {};
  
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as BailuCliConfig;
    return parsed || {};
  } catch {
    return {};
  }
}

/**
 * 合并所有配置源
 * 优先级：CLI 参数 > 项目配置 > 用户配置 > 环境变量 > 默认值
 */
export function mergeConfigs(cliArgs: Partial<BailuCliConfig> = {}): BailuCliConfig {
  // 默认值
  const defaults: BailuCliConfig = {
    baseUrl: "https://bailucode.com/openapi/v1",
    model: "bailu-2.6-preview",
    safetyMode: "review",
    maxIterations: 10,
    autoCompress: true,
    verbose: false,
  };
  
  // 环境变量
  const envConfig: BailuCliConfig = {};
  if (process.env.BAILU_API_KEY) envConfig.apiKey = process.env.BAILU_API_KEY;
  if (process.env.BAILU_BASE_URL) envConfig.baseUrl = process.env.BAILU_BASE_URL;
  if (process.env.BAILU_MODEL) envConfig.model = process.env.BAILU_MODEL;
  
  // 验证 BAILU_MODE 环境变量
  if (process.env.BAILU_MODE) {
    const validModes = ['dry-run', 'review', 'auto-apply'] as const;
    const mode = process.env.BAILU_MODE;
    if (validModes.includes(mode as typeof validModes[number])) {
      envConfig.safetyMode = mode as typeof validModes[number];
    } else {
      console.warn(`警告: BAILU_MODE 环境变量值 "${mode}" 无效，有效值为: ${validModes.join(', ')}`);
    }
  }
  
  // 用户级配置
  const userConfig = loadCliConfig();
  
  // 项目级配置
  const projectConfig = loadProjectConfig();
  
  // 合并（后者覆盖前者）
  return {
    ...defaults,
    ...envConfig,
    ...userConfig,
    ...projectConfig,
    ...cliArgs,
  };
}

export function loadCliConfig(): BailuCliConfig {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as BailuCliConfig;
    return parsed || {};
  } catch {
    return {};
  }
}

export function saveCliConfig(config: BailuCliConfig) {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existing = loadCliConfig();
  const merged = { ...existing, ...config };
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), "utf8");
}

/**
 * 獲取當前配置（供斜線命令使用）
 */
export async function getConfig(): Promise<BailuCliConfig> {
  return loadCliConfig();
}

/**
 * 保存配置（供斜線命令使用）
 */
export async function saveConfig(config: BailuCliConfig): Promise<void> {
  saveCliConfig(config);
}

export async function ensureApiKeyInteractive(): Promise<string> {
  const fromEnv = process.env.BAILU_API_KEY;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  const cfg = loadCliConfig();
  if (cfg.apiKey && cfg.apiKey.trim()) {
    return cfg.apiKey.trim();
  }

  if (!process.stdin.isTTY) {
    throw new Error("未找到 BAILU_API_KEY，且無法交互輸入。請設置環境變量或使用可交互終端。");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const apiKey = await new Promise<string>((resolve) => {
    rl.question("請輸入你的白鹿 API Key（將保存在本機配置中）：", (answer) => {
      resolve(answer.trim());
    });
  });

  rl.close();

  if (!apiKey) {
    throw new Error("未輸入 API Key。");
  }

  saveCliConfig({ apiKey });
  return apiKey;
}
