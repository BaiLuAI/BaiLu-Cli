/**
 * 路徑邊界檢查（共用）
 *
 * 正確判斷「絕對路徑是否在工作區內」，避免純字串前綴比對的漏洞：
 *   root = /a/ws
 *   /a/ws-evil/x  ← 字串前綴會誤判為「在內」，實際是兄弟目錄
 *
 * 規則：必須等於 root，或以 root + 路徑分隔符開頭。
 * Windows 大小寫不敏感，比對時統一轉小寫。
 */

import path from "path";

/** 正規化路徑（Windows 轉小寫，統一分隔符） */
function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * 判斷 absolutePath 是否位於 workspaceRoot 之內（含等於）
 */
export function isWithinWorkspace(workspaceRoot: string, absolutePath: string): boolean {
  const root = normalizeForCompare(workspaceRoot);
  const target = normalizeForCompare(absolutePath);

  if (target === root) return true;

  // 用 path.relative 判斷（跨磁碟機會回傳絕對路徑）
  const rel = path.relative(root, target);
  if (!rel) return true; // 同一路徑
  if (path.isAbsolute(rel)) return false; // 不同磁碟機
  return !rel.startsWith("..") && !rel.includes(`..${path.sep}`);
}

/**
 * 判斷 child 是否為 parent 的子路徑（用於 cwd 檢查，語義同 isWithinWorkspace）
 */
export function isSubPath(parent: string, child: string): boolean {
  return isWithinWorkspace(parent, child);
}
