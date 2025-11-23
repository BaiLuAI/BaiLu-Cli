import { execSync } from "child_process";
import path from "path";

export interface GitStatusEntry {
  path: string;
  statusCode: string;
}

export interface GitSummary {
  branch?: string;
  insideWorkTree: boolean;
  status: GitStatusEntry[];
}

function runGit(rootPath: string, args: string[]): string | null {
  try {
    const result = execSync(`git ${args.join(" ")}`, {
      cwd: rootPath,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return result.trim();
  } catch {
    return null;
  }
}

export function getGitSummary(rootPath: string): GitSummary {
  const inside = runGit(rootPath, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!inside) {
    return { insideWorkTree: false, status: [] };
  }

  const branch = runGit(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? undefined;
  const rawStatus = runGit(rootPath, ["status", "--porcelain"]) ?? "";

  const status: GitStatusEntry[] = rawStatus
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2).trim();
      const p = line.slice(3).trim();
      return { statusCode: code, path: p };
    });

  return {
    insideWorkTree: true,
    branch,
    status,
  };
}

/**
 * 检查是否有未提交的变更
 */
export function hasUncommittedChanges(rootPath: string): boolean {
  const summary = getGitSummary(rootPath);
  return summary.insideWorkTree && summary.status.length > 0;
}

/**
 * 获取变更的文件列表
 */
export function getChangedFiles(rootPath: string): string[] {
  const summary = getGitSummary(rootPath);
  return summary.status.map((s) => s.path);
}

/**
 * 获取文件的 diff
 */
export function getFileDiff(rootPath: string, filePath?: string): string {
  const args = filePath ? ["diff", "HEAD", filePath] : ["diff", "HEAD"];
  return runGit(rootPath, args) || "";
}

/**
 * 执行 git add
 */
export function gitAdd(rootPath: string, files?: string[]): boolean {
  try {
    const args = files && files.length > 0 ? ["add", ...files] : ["add", "-A"];
    execSync(`git ${args.join(" ")}`, {
      cwd: rootPath,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 执行 git commit
 */
export function gitCommit(rootPath: string, message: string): boolean {
  try {
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: rootPath,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 自动提交变更
 */
export function autoCommit(rootPath: string, message: string, files?: string[]): boolean {
  if (!hasUncommittedChanges(rootPath)) {
    return false;
  }

  const addSuccess = gitAdd(rootPath, files);
  if (!addSuccess) {
    return false;
  }

  return gitCommit(rootPath, message);
}


