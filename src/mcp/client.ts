/**
 * MCP (Model Context Protocol) 客戶端
 * 支援三種 transport：stdio（本地子進程）、http（Streamable HTTP）、sse（HTTP+SSE）
 * 並支援 MCP resources（資源讀取）與 prompts（提示模板）
 */

import { spawn, ChildProcess } from "child_process";
import { Tool, ToolParameter, ToolResult } from "../tools/types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('MCP');

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
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
  /** stdio：執行命令；http/sse：不需要 */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** transport 類型：默認 stdio（有 command 時）或 http（有 url 時） */
  type?: "stdio" | "http" | "sse";
  /** http/sse：伺服器 URL */
  url?: string;
  /** http/sse：自訂 HTTP headers */
  headers?: Record<string, string>;
}

interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
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

  /** transport 類型 */
  readonly transport: "stdio" | "http" | "sse";
  /** 伺服器能力（initialize 回應） */
  private capabilities: Record<string, any> = {};
  /** http：Mcp-Session-Id */
  private httpSessionId: string | null = null;
  /** sse：訊息 POST 端點 */
  private sseEndpoint: string | null = null;
  /** sse：事件流中止控制器 */
  private sseAbort: AbortController | null = null;
  /** 已連接標記 */
  private connected = false;

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;
    this.config = config;
    this.transport = config.type ?? (config.url ? (config.type === "sse" ? "sse" : "http") : "stdio");
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get serverCapabilities(): Record<string, any> {
    return this.capabilities;
  }

  /**
   * 連接到 MCP 伺服器
   */
  async connect(): Promise<void> {
    if (this.transport === "stdio") {
      return this.connectStdio();
    }
    return this.connectRemote();
  }

  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error("stdio transport 需要 command 配置");
    }
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.config.command!, this.config.args || [], {
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
          this.connected = false;
          this.cleanup();
        });

        // 發送 initialize 請求
        this.sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "bailu-cli",
            version: "0.2.9",
          },
        }).then((result) => {
          this.capabilities = result?.capabilities || {};
          this.connected = true;
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

  /** 遠端連接（http / sse） */
  private async connectRemote(): Promise<void> {
    if (!this.config.url) {
      throw new Error(`${this.transport} transport 需要 url 配置`);
    }

    if (this.transport === "sse") {
      await this.openSseStream();
    }

    const result = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "bailu-cli", version: "0.2.9" },
    });

    this.capabilities = result?.capabilities || {};
    this.connected = true;
    logger.info(`[${this.serverName}] MCP 伺服器已連接 (${this.transport}): ${result?.serverInfo?.name || "unknown"}`);

    await this.sendNotification("notifications/initialized");
  }

  /** SSE：開啟事件流，等待 endpoint 事件 */
  private async openSseStream(): Promise<void> {
    this.sseAbort = new AbortController();
    const response = await fetch(this.config.url!, {
      headers: {
        Accept: "text/event-stream",
        ...this.config.headers,
      },
      signal: this.sseAbort.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE 連接失敗: HTTP ${response.status}`);
    }

    // 背景讀取事件流
    (async () => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          // 解析 SSE 事件（以空行分隔）
          const events = sseBuffer.split("\n\n");
          sseBuffer = events.pop() || "";
          for (const event of events) {
            const lines = event.split("\n");
            let eventName = "";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (eventName === "endpoint" && data) {
              // 相對 URL 解析
              this.sseEndpoint = new URL(data, this.config.url!).toString();
            } else if (eventName === "message" && data) {
              try {
                this.handleResponse(JSON.parse(data));
              } catch {
                // ignore
              }
            }
          }
        }
      } catch {
        // 串流中斷（abort 或網路錯誤）
        this.connected = false;
      }
    })();

    // 等待 endpoint 事件（最多 10 秒）
    const deadline = Date.now() + 10_000;
    while (!this.sseEndpoint && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!this.sseEndpoint) {
      throw new Error("SSE 連接超時：未收到 endpoint 事件");
    }
  }

  // ── 工具 / 資源 / 提示 ────────────────────────────────────

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

  /** 列出資源（伺服器需支援 resources 能力） */
  async listResources(): Promise<McpResource[]> {
    if (!this.capabilities.resources) return [];
    try {
      const result = await this.sendRequest("resources/list", {});
      return result?.resources || [];
    } catch {
      return [];
    }
  }

  /** 讀取資源內容 */
  async readResource(uri: string): Promise<string> {
    const result = await this.sendRequest("resources/read", { uri });
    const contents = result?.contents || [];
    return contents
      .map((c: any) => (c.text !== undefined ? c.text : `[${c.mimeType || "binary"} 資源: ${c.uri}]`))
      .join("\n");
  }

  /** 列出提示模板（伺服器需支援 prompts 能力） */
  async listPrompts(): Promise<McpPrompt[]> {
    if (!this.capabilities.prompts) return [];
    try {
      const result = await this.sendRequest("prompts/list", {});
      return result?.prompts || [];
    } catch {
      return [];
    }
  }

  /** 取得提示模板內容 */
  async getPrompt(name: string, args: Record<string, string> = {}): Promise<string> {
    const result = await this.sendRequest("prompts/get", { name, arguments: args });
    const msgs = result?.messages || [];
    return msgs
      .map((m: any) => {
        const content = m.content;
        if (content?.type === "text") return content.text;
        return JSON.stringify(content);
      })
      .join("\n");
  }

  /**
   * 將 MCP 工具轉換為 Bailu CLI Tool 格式（含資源與提示的存取工具）
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
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- 閉包內需要引用外層 this
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

    // 資源存取工具
    const resources = await this.listResources();
    if (resources.length > 0) {
      tools.push({
        definition: {
          name: `mcp_${this.serverName}_read_resource`,
          description: `[MCP:${this.serverName}] 讀取資源內容。可用資源: ${resources.map((r) => r.uri).join(", ")}`,
          parameters: [
            { name: "uri", type: "string", description: "資源 URI", required: true },
          ],
          safe: true,
        },
        handler: async (params: Record<string, any>): Promise<ToolResult> => {
          try {
            const content = await this.readResource(params.uri as string);
            return { success: true, output: content };
          } catch (error) {
            return {
              success: false,
              error: `讀取資源失敗: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        },
      });
    }

    // 提示模板存取工具
    const prompts = await this.listPrompts();
    if (prompts.length > 0) {
      tools.push({
        definition: {
          name: `mcp_${this.serverName}_get_prompt`,
          description: `[MCP:${this.serverName}] 取得提示模板。可用模板: ${prompts.map((p) => p.name).join(", ")}`,
          parameters: [
            { name: "name", type: "string", description: "模板名稱", required: true },
            { name: "arguments", type: "object", description: "模板參數", required: false },
          ],
          safe: true,
        },
        handler: async (params: Record<string, any>): Promise<ToolResult> => {
          try {
            const content = await this.getPrompt(params.name as string, (params.arguments as Record<string, string>) || {});
            return { success: true, output: content };
          } catch (error) {
            return {
              success: false,
              error: `取得提示失敗: ${error instanceof Error ? error.message : String(error)}`,
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
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
    this.connected = false;
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

  // ── 傳輸層 ────────────────────────────────────────────────

  private sendNotification(method: string, params?: Record<string, unknown>): void | Promise<void> {
    if (this.transport === "stdio") {
      if (!this.process?.stdin) return;
      const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
      this.process.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
      return;
    }
    // http/sse：通知不需要回應，fire-and-forget
    return this.remoteRpc(method, params, true).then(() => undefined);
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<any> {
    if (this.transport !== "stdio") {
      return this.remoteRpc(method, params, false);
    }
    return this.stdioRequest(method, params);
  }

  /** stdio 請求（原有邏輯） */
  private stdioRequest(method: string, params?: Record<string, unknown>): Promise<any> {
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

  /** 遠端請求（http / sse 共用） */
  private async remoteRpc(method: string, params: Record<string, unknown> | undefined, isNotification: boolean): Promise<any> {
    const id = isNotification ? undefined : ++this.requestId;
    const body = JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, params });

    const postUrl = this.transport === "sse" ? this.sseEndpoint! : this.config.url!;
    const response = await fetch(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.httpSessionId ? { "Mcp-Session-Id": this.httpSessionId } : {}),
        ...this.config.headers,
      },
      body,
    });

    // 保存會話 ID（streamable HTTP）
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) this.httpSessionId = sessionId;

    if (!response.ok) {
      throw new Error(`MCP HTTP 錯誤 ${response.status}: ${await response.text().catch(() => "")}`);
    }

    if (isNotification) {
      return undefined;
    }

    // 回應可能是 JSON 或 SSE 流
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("text/event-stream") && response.body) {
      // 從 SSE 流中讀取對應 id 的回應
      return this.readSseResponse(response.body, id!);
    }

    const json = (await response.json()) as JsonRpcResponse;
    if (json.error) {
      throw new Error(`MCP 錯誤 [${json.error.code}]: ${json.error.message}`);
    }
    return json.result;
  }

  /** 從 SSE 回應流中讀取指定 id 的 JSON-RPC 回應 */
  private async readSseResponse(body: ReadableStream<Uint8Array>, id: number): Promise<any> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reader.cancel().catch(() => undefined);
        reject(new Error("MCP SSE 回應超時"));
      }, 30_000);

      const processChunk = () => {
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const msg = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
              if (msg.id === id) {
                clearTimeout(timeout);
                reader.cancel().catch(() => undefined);
                if (msg.error) {
                  reject(new Error(`MCP 錯誤 [${msg.error.code}]: ${msg.error.message}`));
                } else {
                  resolve(msg.result);
                }
                return true;
              }
            } catch {
              // 非 JSON 行，忽略
            }
          }
        }
        return false;
      };

      const read = () => {
        reader.read().then(({ done, value }) => {
          if (done) {
            clearTimeout(timeout);
            reject(new Error("MCP SSE 串流提前結束"));
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          if (!processChunk()) read();
        }).catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
      };

      read();
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
    } catch {
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
