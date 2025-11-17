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


