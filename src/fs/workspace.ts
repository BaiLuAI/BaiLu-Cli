import fs from "fs";
import path from "path";

export interface FileSnapshot {
  path: string;
  content: string;
}

export function resolveInWorkspace(rootPath: string, relativePath: string): string {
  return path.resolve(rootPath, relativePath);
}

export function readWorkspaceFile(rootPath: string, relativePath: string): string {
  const full = resolveInWorkspace(rootPath, relativePath);
  return fs.readFileSync(full, "utf8");
}

export function writeWorkspaceFile(rootPath: string, relativePath: string, content: string) {
  const full = resolveInWorkspace(rootPath, relativePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(full, content, "utf8");
}

export function tryReadWorkspaceFile(rootPath: string, relativePath: string): string | undefined {
  try {
    return readWorkspaceFile(rootPath, relativePath);
  } catch {
    return undefined;
  }
}

export function readWorkspaceFiles(
  rootPath: string,
  relativePaths: string[],
  maxBytesPerFile = 16_000
): FileSnapshot[] {
  const result: FileSnapshot[] = [];
  for (const rel of relativePaths) {
    const content = tryReadWorkspaceFile(rootPath, rel);
    if (content === undefined) continue;
    let truncated = content;
    if (Buffer.byteLength(content, "utf8") > maxBytesPerFile) {
      truncated = content.slice(0, maxBytesPerFile) + "\n\n/* truncated by Bailu for context */\n";
    }
    result.push({ path: rel, content: truncated });
  }
  return result;
}


