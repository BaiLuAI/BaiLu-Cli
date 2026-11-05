import fs from "fs";
import path from "path";
import YAML from "yaml";
import { BailuConfig, WorkspaceContext, GitStatus } from "./types.js";
import { getGitSummary } from "../git/integration.js";
import { loadMergedMemory } from "./memory-files.js";

function readAgentDoc(rootPath: string): string | undefined {
  const candidates = ["AGENT.md", "AGENTS.md"];
  for (const name of candidates) {
    const p = path.join(rootPath, name);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8");
    }
  }
  return undefined;
}

function readBailuConfig(rootPath: string): BailuConfig {
  const configPath = path.join(rootPath, ".bailu.yml");
  let config: BailuConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const parsed = YAML.parse(fs.readFileSync(configPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object") {
        config = parsed as BailuConfig;
      }
    } catch {
      // ignore parse errors; fall back to empty config
    }
  }

  // 本地覆蓋層：.bailu.local.yml（gitignore，個人偏好不進版本庫）
  const localPath = path.join(rootPath, ".bailu.local.yml");
  if (fs.existsSync(localPath)) {
    try {
      const local = YAML.parse(fs.readFileSync(localPath, "utf8")) as unknown;
      if (local && typeof local === "object") {
        config = { ...config, ...(local as BailuConfig) };
      }
    } catch {
      // ignore
    }
  }

  return config;
}

function listImportantFiles(rootPath: string, maxFiles = 64): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    if (results.length >= maxFiles) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootPath, full);
      if (rel.startsWith("node_modules") || rel.startsWith(".git")) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (/\.(ts|tsx|js|jsx|py|go|rs|java|cs|php|rb|md)$/.test(entry.name)) {
          results.push(rel);
          if (results.length >= maxFiles) return;
        }
      }
    }
  }

  walk(rootPath);
  return results;
}

function collectGitStatus(rootPath: string): GitStatus | undefined {
  const summary = getGitSummary(rootPath);
  if (!summary.insideWorkTree) {
    return undefined;
  }
  
  return {
    branch: summary.branch || "unknown",
    changes: summary.status.map(s => `[${s.statusCode}] ${s.path}`)
  };
}

export function buildWorkspaceContext(
  rootPath: string,
  recentFiles?: string[]
): WorkspaceContext {
  const config = readBailuConfig(rootPath);
  const agentDoc = readAgentDoc(rootPath);
  // 分層記憶：全域 + 專案（含 AGENT.md），合併注入
  const mergedMemory = loadMergedMemory(rootPath);
  const importantFiles = listImportantFiles(rootPath);
  const gitStatus = collectGitStatus(rootPath);

  return {
    rootPath,
    config,
    agentDoc: mergedMemory || agentDoc,
    importantFiles,
    gitStatus,
    recentFiles: recentFiles || []
  };
}
