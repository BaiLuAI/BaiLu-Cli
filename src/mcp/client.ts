/**
 * MCP (Model Context Protocol) 客戶端
 * 支援 stdio transport，連接外部 MCP 伺服器並發現/調用工具
 */

import { spawn, ChildProcess } from "child_process";
import { createLogger } from "../utils/logger.js";
import { Tool, ToolResult, ToolParameter } from "../tools/types.js";

const logger = createLogger('MCP');

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export class McpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();
  private buffer = "";
  private serverName: string;
  private config: McpServerConfig;

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  /**
   * 連接到 MCP 伺服器
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.config.command, this.config.args || [], {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.process.stdout?.on("data", (data: Buffer) => {
          this.buffer += data.toString();
          this.processBuffer();
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          logger.debug(`[${this.serverName}] stderr: ${data.toString().trim()}`);
        });

        this.process.on("error", (err) => {
          logger.error(`[${this.serverName}] 進程錯誤:`, err);
          reject(err);
        });

        this.process.on("close", (code) => {
          logger.debug(`[${this.serverName}] 進程退出，代碼: ${code}`);
          this.cleanup();
        });

        // 發送 initialize 請求
        this.sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "bailu-cli",
            version: "0.2.8",
          },
        }).then((result) => {
          logger.info(`[${this.serverName}] MCP 伺服器已連接: ${result?.serverInfo?.name || "unknown"}`);
          // 發送 initialized 通知
          this.sendNotification("notifications/initialized");
          resolve();
        }).catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 發現伺服器提供的工具
   */
  async listTools(): Promise<McpToolSchema[]> {
    const result = await this.sendRequest("tools/list", {});
    return result?.tools || [];
  }

  /**
   * 調用伺服器上的工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await this.sendRequest("tools/call", { name, arguments: args });
    return result;
  }

  /**
   * 將 MCP 工具轉換為 Bailu CLI Tool 格式
   */
  async discoverTools(): Promise<Tool[]> {
    const mcpTools = await this.listTools();
    const tools: Tool[] = [];

    for (const mcpTool of mcpTools) {
      const parameters: ToolParameter[] = [];

      if (mcpTool.inputSchema?.properties) {
        const required = mcpTool.inputSchema.required || [];
        for (const [propName, propDef] of Object.entries(mcpTool.inputSchema.properties)) {
          parameters.push({
            name: propName,
            type: this.mapType(propDef.type),
            description: propDef.description || propName,
            required: required.includes(propName),
          });
        }
      }

      const serverName = this.serverName;
      const client = this;
      const toolName = `mcp_${serverName}_${mcpTool.name}`;

      tools.push({
        definition: {
          name: toolName,
          description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
          parameters,
          safe: false,
        },
        handler: async (params: Record<string, any>): Promise<ToolResult> => {
          try {
            const result = await client.callTool(mcpTool.name, params);

            // MCP 工具結果通常有 content 陣列
            if (result?.content) {
              const textContent = result.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");
              return { success: !result.isError, output: textContent || JSON.stringify(result.content) };
            }

            return { success: true, output: JSON.stringify(result) };
          } catch (error) {
            return {
              success: false,
              error: `MCP 工具 ${mcpTool.name} 調用失敗: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        },
      });
    }

    return tools;
  }

  /**
   * 斷開連接
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.cleanup();
    }
  }

  private mapType(jsonType: string): ToolParameter["type"] {
    switch (jsonType) {
      case "string": return "string";
      case "number":
      case "integer": return "number";
      case "boolean": return "boolean";
      case "array": return "array";
      case "object": return "object";
      default: return "string";
    }
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("MCP 伺服器未連接"));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      const msg = JSON.stringify(request);

      this.pendingRequests.set(id, { resolve, reject });

      // 設置超時
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP 請求超時: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (reason) => { clearTimeout(timeout); reject(reason); },
      });

      this.process.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
    });
  }

  private processBuffer(): void {
    while (true) {
      // 查找 Content-Length header
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // 嘗試直接解析 JSON（某些 MCP 伺服器不發 Content-Length）
        this.tryParseDirectJson();
        break;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.substring(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.substring(bodyStart + contentLength);

      this.handleMessage(body);
    }
  }

  private tryParseDirectJson(): void {
    // 某些 MCP 伺服器直接輸出 JSON 行
    const lines = this.buffer.split("\n");
    const remaining: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.jsonrpc === "2.0") {
          this.handleResponse(parsed);
        }
      } catch {
        remaining.push(line);
      }
    }

    this.buffer = remaining.join("\n");
  }

  private handleMessage(body: string): void {
    try {
      const msg = JSON.parse(body) as JsonRpcResponse;
      this.handleResponse(msg);
    } catch (error) {
      logger.debug(`[${this.serverName}] 無法解析消息: ${body.substring(0, 200)}`);
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(`MCP 錯誤 [${msg.error.code}]: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private cleanup(): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("MCP 連接已關閉"));
    }
    this.pendingRequests.clear();
    this.process = null;
  }
}
