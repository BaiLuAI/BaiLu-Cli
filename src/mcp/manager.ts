/**
 * MCP 伺服器管理器
 * 從 .bailu.yml 讀取 MCP 伺服器配置，連接並註冊工具
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

// MCP 命令白名單：只允許已知安全的執行器
const MCP_COMMAND_ALLOWLIST = new Set([
  'npx', 'node', 'python', 'python3', 'deno', 'bun',
  'uvx', 'uv',
]);

export class McpManager {
  private clients: Map<string, McpClient> = new Map();
  private registeredTools: Tool[] = [];

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
   * 從 .bailu.yml 載入 MCP 配置並連接所有伺服器
   */
  async initialize(workspaceRoot: string, registry: ToolRegistry): Promise<void> {
    const config = this.loadConfig(workspaceRoot);

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      logger.debug("未配置 MCP 伺服器");
      return;
    }

    console.log(chalk.cyan(`[MCP] 正在連接 ${Object.keys(config.mcpServers).length} 個 MCP 伺服器...`));

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        // 安全檢查：命令白名單驗證
        if (!this.isCommandSafe(serverConfig.command)) {
          const allowed = await this.confirmUnsafeCommand(name, serverConfig);
          if (!allowed) {
            console.log(chalk.yellow(`[MCP] ✗ ${name}: 用戶拒絕或命令不安全，跳過`));
            continue;
          }
        }

        const client = new McpClient(name, serverConfig);
        await client.connect();
        this.clients.set(name, client);

        // 發現並註冊工具
        const tools = await client.discoverTools();
        for (const tool of tools) {
          try {
            registry.register(tool);
            this.registeredTools.push(tool);
          } catch (err) {
            logger.warn(`MCP 工具 ${tool.definition.name} 註冊失敗: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        console.log(chalk.green(`[MCP] ✓ ${name}: 已註冊 ${tools.length} 個工具`));
      } catch (error) {
        console.log(chalk.yellow(`[MCP] ✗ ${name}: 連接失敗 — ${error instanceof Error ? error.message : String(error)}`));
      }
    }
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

  private loadConfig(workspaceRoot: string): McpConfig {
    const configPath = path.join(workspaceRoot, ".bailu.yml");
    if (!fs.existsSync(configPath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = YAML.parse(raw);
      return parsed || {};
    } catch {
      return {};
    }
  }
}
