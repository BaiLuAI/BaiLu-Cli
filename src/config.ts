import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";

export interface BailuCliConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
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


