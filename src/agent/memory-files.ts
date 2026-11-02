/**
 * 分層記憶系統（比照 Claude Code 的 CLAUDE.md 層級）
 *
 * - 全域記憶：~/.config/bailu-cli/BAILU.md（跨專案共享的偏好與習慣）
 * - 專案記憶：<root>/BAILU.md（專案約定；相容既有的 AGENT.md / AGENTS.md）
 *
 * 每次啟動自動載入並注入 system prompt；/memory 命令可查看與編輯。
 */

import fs from "fs";
import path from "path";
import os from "os";

export interface MemoryLayer {
  name: string;
  filePath: string;
  exists: boolean;
  content: string;
}

/** 取得全域記憶檔路徑（與 config.ts 的配置目錄一致） */
export function getGlobalMemoryPath(): string {
  const envDir = process.env.BAILU_CONFIG_DIR;
  let dir: string;
  if (envDir) {
    dir = envDir;
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    dir = path.join(appData, "bailu-cli");
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    dir = path.join(xdg, "bailu-cli");
  }
  return path.join(dir, "BAILU.md");
}

/** 取得專案記憶檔路徑（優先 BAILU.md，相容 AGENT.md / AGENTS.md） */
export function getProjectMemoryPath(rootPath: string): string {
  const candidates = ["BAILU.md", "AGENT.md", "AGENTS.md"];
  for (const name of candidates) {
    const p = path.join(rootPath, name);
    if (fs.existsSync(p)) return p;
  }
  // 都不存在時，回傳建議路徑（BAILU.md）
  return path.join(rootPath, "BAILU.md");
}

function readLayer(name: string, filePath: string): MemoryLayer {
  let exists = false;
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
    exists = true;
  } catch {
    exists = false;
  }
  return { name, filePath, exists, content };
}

/** 載入所有記憶層 */
export function loadMemoryLayers(rootPath: string): MemoryLayer[] {
  return [
    readLayer("全域記憶（跨專案）", getGlobalMemoryPath()),
    readLayer("專案記憶", getProjectMemoryPath(rootPath)),
  ];
}

/** 合併所有記憶層內容（注入 system prompt 用） */
export function loadMergedMemory(rootPath: string): string {
  const layers = loadMemoryLayers(rootPath);
  const parts: string[] = [];
  for (const layer of layers) {
    if (layer.exists && layer.content.trim()) {
      parts.push(`### ${layer.name}（${layer.filePath}）\n${layer.content.trim()}`);
    }
  }
  return parts.join("\n\n");
}

/** 附加記憶到指定層（/memory add 用） */
export function appendMemory(filePath: string, text: string): void {
  const line = `- ${text.trim()}\n`;
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + line, "utf8");
}
