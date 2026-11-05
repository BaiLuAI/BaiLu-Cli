/**
 * MCP 伺服器管理器
 * 從 .bailu.yml 與 .mcp.json 讀取 MCP 伺服器配置，連接並註冊工具
 * 支援 stdio / http / sse 三種 transport
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import YAML from "yaml";
import chalk from "chalk";
import { McpClient, McpServerConfig } from "./client.js";
import { ToolRegistry } from "../tools/registry.js";
import { Tool } from "../tools/types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('MCP');

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface McpServerStatus {
  name: string;
  transport: string;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  error?: string;
}

// MCP 命令白名單：只允許已知安全的執行器
const MCP_COMMAND_ALLOWLIST = new Set([
  'npx', 'node', 'python', 'python3', 'deno', 'bun',
  'uvx', 'uv',
]);

export class McpManager {
  private clients: Map<string, McpClient> = new Map();
  private registeredTools: Tool[] = [];
  private configs: Map<string, McpServerConfig> = new Map();
  private workspaceRoot: string = process.cwd();

  /**
   * 檢查 MCP 命令是否在白名單內
   */
  private isCommandSafe(command: string): boolean {
    const baseName = path.basename(command).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
    return MCP_COMMAND_ALLOWLIST.has(baseName);
  }

  /**
   * 當命令不在白名單時，詢問用戶是否允許
   */
  private async confirmUnsafeCommand(name: string, config: McpServerConfig): Promise<boolean> {
    if (!process.stdin.isTTY) {
      console.log(chalk.yellow(`[MCP] ✗ ${name}: 命令 "${config.command}" 不在白名單中，非互動模式下自動跳過`));
      return false;
    }

    const fullCmd = [config.command, ...(config.args || [])].join(' ');
    console.log(chalk.yellow(`\n⚠️  MCP 伺服器 "${name}" 使用未知命令：`));
    console.log(chalk.gray(`   ${fullCmd}`));

    return new Promise<boolean>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(chalk.cyan('   是否允許執行？ [y/N]: '), (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }

  /**
   * 從 .bailu.yml 與 .mcp.json 載入 MCP 配置並連接所有伺服器
   */
  async initialize(workspaceRoot: string, registry: ToolRegistry): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    const config = this.loadConfig(workspaceRoot);

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      logger.debug("未配置 MCP 伺服器");
      return;
    }

    console.log(chalk.cyan(`[MCP] 正在連接 ${Object.keys(config.mcpServers).length} 個 MCP 伺服器...`));

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      await this.connectServer(name, serverConfig, registry);
    }
  }

  /** 連接單個伺服器並註冊工具 */
  private async connectServer(name: string, serverConfig: McpServerConfig, registry: ToolRegistry): Promise<boolean> {
    try {
      // 安全檢查：僅 stdio 需要命令白名單驗證
      const transport = serverConfig.type ?? (serverConfig.url ? "http" : "stdio");
      if (transport === "stdio" && serverConfig.command && !this.isCommandSafe(serverConfig.command)) {
        const allowed = await this.confirmUnsafeCommand(name, serverConfig);
        if (!allowed) {
          console.log(chalk.yellow(`[MCP] ✗ ${name}: 用戶拒絕或命令不安全，跳過`));
          return false;
        }
      }

      const client = new McpClient(name, serverConfig);
      await client.connect();
      this.clients.set(name, client);
      this.configs.set(name, serverConfig);

      // 發現並註冊工具（含資源/提示存取工具）
      const tools = await client.discoverTools();
      for (const tool of tools) {
        try {
          registry.register(tool);
          this.registeredTools.push(tool);
        } catch (err) {
          logger.warn(`MCP 工具 ${tool.definition.name} 註冊失敗: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      console.log(chalk.green(`[MCP] ✓ ${name} (${transport}): 已註冊 ${tools.length} 個工具`));
      return true;
    } catch (error) {
      console.log(chalk.yellow(`[MCP] ✗ ${name}: 連接失敗 — ${error instanceof Error ? error.message : String(error)}`));
      return false;
    }
  }

  /**
   * 列出所有伺服器狀態（/mcp 命令用）
   */
  async listServers(): Promise<McpServerStatus[]> {
    const statuses: McpServerStatus[] = [];

    // 已連接的
    for (const [name, client] of this.clients) {
      const [resources, prompts] = await Promise.all([
        client.listResources().catch(() => []),
        client.listPrompts().catch(() => []),
      ]);
      statuses.push({
        name,
        transport: client.transport,
        connected: client.isConnected,
        toolCount: this.registeredTools.filter((t) => t.definition.name.startsWith(`mcp_${name}_`)).length,
        resourceCount: resources.length,
        promptCount: prompts.length,
      });
    }

    // 已配置但未連接的
    for (const [name, config] of this.configs) {
      if (!this.clients.has(name)) {
        statuses.push({
          name,
          transport: config.type ?? (config.url ? "http" : "stdio"),
          connected: false,
          toolCount: 0,
          resourceCount: 0,
          promptCount: 0,
          error: "未連接",
        });
      }
    }

    return statuses;
  }

  /**
   * 重連指定伺服器（斷開 → 移除舊工具 → 重新連接 → 重新註冊）
   */
  async reconnect(name: string, registry: ToolRegistry): Promise<{ success: boolean; message: string }> {
    // 斷開舊連接並移除舊工具
    const oldClient = this.clients.get(name);
    if (oldClient) {
      oldClient.disconnect();
      this.clients.delete(name);
    }
    this.registeredTools = this.registeredTools.filter((t) => !t.definition.name.startsWith(`mcp_${name}_`));
    for (const def of registry.getAllDefinitions()) {
      if (def.name.startsWith(`mcp_${name}_`)) {
        registry.unregister(def.name);
      }
    }

    const config = this.configs.get(name);
    if (!config) {
      return { success: false, message: `找不到伺服器配置: ${name}` };
    }

    const ok = await this.connectServer(name, config, registry);
    return ok
      ? { success: true, message: `已重新連接 ${name}` }
      : { success: false, message: `重連失敗: ${name}` };
  }

  /**
   * 斷開所有 MCP 伺服器
   */
  disconnectAll(): void {
    for (const [name, client] of this.clients) {
      try {
        client.disconnect();
        logger.debug(`[MCP] ${name} 已斷開`);
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }

  /**
   * 獲取已連接的伺服器數量
   */
  getConnectedCount(): number {
    return this.clients.size;
  }

  /**
   * 獲取已註冊的 MCP 工具數量
   */
  getToolCount(): number {
    return this.registeredTools.length;
  }

  /**
   * 載入配置：.bailu.yml + .mcp.json（Claude Code 項目級 MCP 配置，兩者合併）
   */
  private loadConfig(workspaceRoot: string): McpConfig {
    const merged: Record<string, McpServerConfig> = {};

    // 1. .mcp.json（Claude Code 標準位置）
    const mcpJsonPath = path.join(workspaceRoot, ".mcp.json");
    if (fs.existsSync(mcpJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
        if (parsed?.mcpServers) {
          Object.assign(merged, parsed.mcpServers);
        }
      } catch (error) {
        logger.warn(`.mcp.json 解析失敗: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 2. .bailu.yml（優先級更高，覆蓋同名）
    const bailuPath = path.join(workspaceRoot, ".bailu.yml");
    if (fs.existsSync(bailuPath)) {
      try {
        const parsed = YAML.parse(fs.readFileSync(bailuPath, "utf8"));
        if (parsed?.mcpServers) {
          Object.assign(merged, parsed.mcpServers);
        }
      } catch {
        // ignore
      }
    }

    return { mcpServers: merged };
  }
}
