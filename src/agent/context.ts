import fs from "fs";
import path from "path";
import YAML from "yaml";
import { BailuConfig, WorkspaceContext } from "./types";

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
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const raw = fs.readFileSync(configPath, "utf8");
  try {
    const parsed = YAML.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as BailuConfig;
    }
  } catch {
    // ignore parse errors; fall back to empty config
  }
  return {};
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

export function buildWorkspaceContext(rootPath: string): WorkspaceContext {
  const config = readBailuConfig(rootPath);
  const agentDoc = readAgentDoc(rootPath);
  const importantFiles = listImportantFiles(rootPath);

  return {
    rootPath,
    config,
    agentDoc,
    importantFiles,
  };
}


