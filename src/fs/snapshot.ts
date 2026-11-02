/**
 * Agent 工作區快照。
 *
 * 只記錄由 Agent 工具造成的修改，避免 /undo 誤傷使用者原本未提交的變更。
 * 快照保存在工作區 .bailu/backups 中，並以 manifest 索引。
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface FileSnapshot {
  id: string;
  relativePath: string;
  absolutePath: string;
  createdAt: string;
  existed: boolean;
  backupFile?: string;
  size: number;
}

interface SnapshotManifest {
  version: 1;
  snapshots: FileSnapshot[];
}

export class SnapshotStore {
  private readonly root: string;
  private readonly backupDir: string;
  private readonly manifestPath: string;

  constructor(workspaceRoot: string) {
    this.root = path.resolve(workspaceRoot);
    this.backupDir = path.join(this.root, ".bailu", "backups");
    this.manifestPath = path.join(this.backupDir, "manifest.json");
  }

  private async readManifest(): Promise<SnapshotManifest> {
    try {
      const raw = await fs.readFile(this.manifestPath, "utf8");
      const parsed = JSON.parse(raw) as SnapshotManifest;
      if (!parsed || !Array.isArray(parsed.snapshots)) {
        return { version: 1, snapshots: [] };
      }
      return parsed;
    } catch {
      return { version: 1, snapshots: [] };
    }
  }

  private async writeManifest(manifest: SnapshotManifest): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true });
    const tempPath = `${this.manifestPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), "utf8");
    await fs.rename(tempPath, this.manifestPath);
  }

  /** 在修改檔案前建立快照；新檔案也會記錄 existed=false。 */
  async create(absolutePath: string): Promise<FileSnapshot> {
    const resolved = path.resolve(absolutePath);
    const relativePath = path.relative(this.root, resolved).replace(/\\/g, "/");
    const id = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    let existed = true;
    let size = 0;
    let backupFile: string | undefined;

    try {
      const content = await fs.readFile(resolved);
      size = content.length;
      backupFile = path.join(this.backupDir, `${id}.bak`);
      await fs.mkdir(this.backupDir, { recursive: true });
      await fs.writeFile(backupFile, content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        existed = false;
      } else {
        throw error;
      }
    }

    const snapshot: FileSnapshot = {
      id,
      relativePath,
      absolutePath: resolved,
      createdAt: new Date().toISOString(),
      existed,
      backupFile,
      size,
    };

    const manifest = await this.readManifest();
    manifest.snapshots.push(snapshot);
    await this.writeManifest(manifest);
    return snapshot;
  }

  async list(): Promise<FileSnapshot[]> {
    const manifest = await this.readManifest();
    return [...manifest.snapshots].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /** 還原最近一次快照；回傳 null 表示沒有可還原項目。 */
  async restoreLatest(): Promise<FileSnapshot | null> {
    const manifest = await this.readManifest();
    const snapshot = manifest.snapshots.pop();
    if (!snapshot) return null;

    if (snapshot.existed && snapshot.backupFile) {
      await fs.mkdir(path.dirname(snapshot.absolutePath), { recursive: true });
      await fs.copyFile(snapshot.backupFile, snapshot.absolutePath);
    } else {
      try {
        await fs.unlink(snapshot.absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    await this.writeManifest(manifest);
    return snapshot;
  }

  /** 還原指定快照，並移除它及其後續快照。 */
  async restoreById(id: string): Promise<FileSnapshot | null> {
    const manifest = await this.readManifest();
    const index = manifest.snapshots.findIndex((item) => item.id === id);
    if (index < 0) return null;

    const snapshot = manifest.snapshots[index];
    if (snapshot.existed && snapshot.backupFile) {
      await fs.mkdir(path.dirname(snapshot.absolutePath), { recursive: true });
      await fs.copyFile(snapshot.backupFile, snapshot.absolutePath);
    } else {
      try {
        await fs.unlink(snapshot.absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    manifest.snapshots.splice(index);
    await this.writeManifest(manifest);
    return snapshot;
  }

  async clear(): Promise<void> {
    await fs.rm(this.backupDir, { recursive: true, force: true });
  }
}
