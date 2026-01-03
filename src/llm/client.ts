export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * Retryable errors that should trigger a retry
 */
const RETRYABLE_ERROR_PATTERNS = [
  /network/i,
  /timeout/i,
  /econnreset/i,
  /enotfound/i,
  /503/,
  /502/,
  /504/,
  /429/,  // Rate limit
  /rate.?limit/i,
];

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error): boolean {
  const errorMessage = error.message;
  return RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(errorMessage));
}

/**
 * 带重试的 fetch 封装
 * @param fn 要执行的异步函数
 * @param maxRetries 最大重试次数（不包括初始尝试）
 * @param retryDelay 初始重试延迟（毫秒）
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  const totalAttempts = maxRetries + 1; // 1 initial + maxRetries retries
  
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // 最后一次尝试失败，不再重试
      const isLastAttempt = attempt === totalAttempts - 1;
      if (isLastAttempt) {
        break;
      }
      
      // 检查是否是可重试的错误
      if (!isRetryableError(lastError)) {
        // 不可重试的错误（如 401, 403, 400），直接抛出
        throw lastError;
      }
      
      // 指数退避：每次重试延迟加倍，并添加随机抖动
      const exponentialDelay = retryDelay * Math.pow(2, attempt);
      // 添加 ±25% 的随机抖动以避免并发请求同时重试
      const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5) * 2;
      const delay = Math.max(0, exponentialDelay + jitter);
      
      console.log(`\n⚠️  请求失败 (尝试 ${attempt + 1}/${totalAttempts})，${(delay / 1000).toFixed(1)}秒后重试...\n`);
      console.log(`错误: ${lastError.message}\n`);
      
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  // 所有重试都失败了
  throw new Error(
    `API 请求在 ${totalAttempts} 次尝试后仍然失败\n最后错误: ${lastError?.message || "未知错误"}`
  );
}

export interface LLMClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: ChatRole;
      content: string;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name: string;
          arguments: string | Record<string, any>;
        };
        name?: string;
        arguments?: Record<string, any>;
      }>;
    };
    finish_reason?: string;
  }>;
}

export interface StreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: ChatRole;
      content?: string;
    };
    finish_reason?: string | null;
  }>;
}

export interface ModelsResponse {
  data?: Array<{ id: string }>;
  models?: Array<{ id: string }>;
}

export class LLMClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private modelInitialized: boolean = false;
  private testedModels: Map<string, boolean> = new Map(); // Cache model test results

  constructor(options: LLMClientOptions) {
    const envKey = process.env.BAILU_API_KEY;
    const modelEnv = process.env.BAILU_MODEL;
    const baseEnv = process.env.BAILU_BASE_URL;

    const apiKey = options.apiKey ?? envKey;
    if (!apiKey) {
      throw new Error("缺少白鹿 API Key。請設置 BAILU_API_KEY 或通過 CLI 互動輸入。");
    }

    this.apiKey = apiKey;
    this.model = options.model ?? modelEnv ?? "bailu-Edge";
    this.baseUrl = options.baseUrl ?? baseEnv ?? "https://bailucode.com/openapi/v1";
  }

  /**
   * 獲取當前使用的模型名稱
   */
  getModelName(): string {
    return this.model;
  }

  /**
   * 自動初始化模型：如果當前模型不可用，自動選擇第一個可用模型
   */
  private async ensureModelAvailable(): Promise<void> {
    if (this.modelInitialized) {
      return;
    }

    try {
      // 獲取可用模型列表
      const models = await this.listModels();
      
      if (models.length === 0) {
        throw new Error("未找到任何可用模型");
      }

      // 測試當前模型是否真的可用（可能因為計劃限制而不可用）
      const isCurrentModelUsable = await this.testModel(this.model);
      
      if (!isCurrentModelUsable) {
        const oldModel = this.model;
        
        // Personal 計劃優先推薦模型（免費/基礎模型）
        const preferredModels = [
          "bailu-2.6-preview",       // 預覽版，最新功能，工具調用最佳（推薦）
          "bailu-2.6",               // 穩定版
          "bailu-2.6-fast-thinking", // 快速思考版
          "bailu-Minimum-free",      // 免費模型
          "bailu-Edge",              // Edge 模型
          "bailu-2.6-mini",          // Mini 版本
          "bailu-2.5-lite-code",     // 輕量代碼版
          "bailu-2.5-pro",           // Pro 版本（可能需要付費）
          "bailu-2.5-code-cc",       // 代碼審查
        ];

        // 逐個測試推薦模型
        let selectedModel: string | null = null;
        for (const model of preferredModels) {
          if (models.includes(model)) {
            const usable = await this.testModel(model);
            if (usable) {
              selectedModel = model;
              break;
            }
          }
        }

        // 如果推薦列表都不行，測試所有可用模型
        if (!selectedModel) {
          for (const model of models) {
            const usable = await this.testModel(model);
            if (usable) {
              selectedModel = model;
              break;
            }
          }
        }

        if (selectedModel) {
          this.model = selectedModel;
          console.log(`⚠️  模型 "${oldModel}" 不可用（可能需要 Enterprise 計劃），自動切換到 "${this.model}"`);
        } else {
          throw new Error("未找到任何可用的模型，請檢查你的白鹿賬號計劃");
        }
      }

      this.modelInitialized = true;
    } catch (error) {
      // 如果獲取模型列表失敗，繼續使用當前模型（會在實際調用時報錯）
      this.modelInitialized = true;
    }
  }

  /**
   * 測試模型是否真的可用（發送一個簡單請求）
   * Results are cached to avoid redundant API calls
   */
  private async testModel(modelId: string): Promise<boolean> {
    // Check cache first
    if (this.testedModels.has(modelId)) {
      return this.testedModels.get(modelId)!;
    }

    try {
      const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5,
        }),
      });

      // 200-299 表示成功
      const isUsable = response.ok;
      
      // Cache the result
      this.testedModels.set(modelId, isUsable);
      
      return isUsable;
    } catch {
      // Cache failed result as well
      this.testedModels.set(modelId, false);
      return false;
    }
  }

  async chat(messages: ChatMessage[], stream = false, tools?: any[]): Promise<string> {
    // 確保使用可用的模型
    await this.ensureModelAvailable();

    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const body: any = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };
    
    // 如果提供了工具定義，添加到請求中
    if (tools && tools.length > 0) {
      body.tools = tools;
      // 讓模型自動決定是否調用工具（OpenAI 標準）
      body.tool_choice = "auto";
      
      // 調試：記錄工具數量
      if (process.env.DEBUG_TOOLS || process.env.BAILU_DEBUG) {
        console.log(`[DEBUG] 發送 ${tools.length} 個工具到 API`);
        console.log(`[DEBUG] 工具名稱: ${tools.map((t: any) => t.function?.name).join(', ')}`);
        console.log(`[DEBUG] tool_choice: auto`);
      }
    }

    // 使用重试机制发送请求
    const response = await fetchWithRetry(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      
      // 检查响应状态
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let errorMsg = `${res.status} ${res.statusText}`;
        
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string; type?: string } };
          if (parsed.error?.message) {
            errorMsg = parsed.error.message;
            if (parsed.error.type === "invalid_model") {
              errorMsg += `\n請確認當前模型 ID 是否正確（目前為 "${this.model}"）。`;
            }
          }
        } catch {
          if (text) errorMsg += `\n${text}`;
        }
        
        throw new Error(errorMsg);
      }
      
      return res;
    });

    // 解析响应
    let data: ChatCompletionResponse;
    try {
      data = (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      // JSON 解析失敗，可能是 API 返回了錯誤格式
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`白鹿 API 返回了無效的 JSON 響應。\n可能原因：\n1. API 在非流式模式下意外返回了流式數據格式\n2. 網絡傳輸中斷或損壞\n3. API 服務異常\n\n建議：使用流式模式 (stream=true) 或檢查網絡連接\n\n原始錯誤: ${errorMsg}`);
    }
    const choice = data.choices?.[0];
    
    // 如果模型返回了結構化的 tool_calls，將其轉換為 XML 格式
    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
      let content = choice.message.content || "";
      content += "\n<action>\n";
      
      for (const toolCall of choice.message.tool_calls) {
        const funcName = toolCall.function?.name || toolCall.name;
        const args = typeof toolCall.function?.arguments === 'string' 
          ? JSON.parse(toolCall.function.arguments)
          : (toolCall.function?.arguments || toolCall.arguments || {});
        
        content += `<invoke tool="${funcName}">\n`;
        for (const [key, value] of Object.entries(args)) {
          content += `  <param name="${key}">${value}</param>\n`;
        }
        content += `</invoke>\n`;
      }
      
      content += "</action>";
      return content;
    }
    
    const content = choice?.message?.content ?? "";
    return content;
  }

  async *chatStream(messages: ChatMessage[], tools?: any[]): AsyncGenerator<string, void, unknown> {
    // 確保使用可用的模型
    await this.ensureModelAvailable();

    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const body: any = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    
    // 如果提供了工具定義，添加到請求中
    if (tools && tools.length > 0) {
      body.tools = tools;
      // 讓模型自動決定是否調用工具（OpenAI 標準）
      body.tool_choice = "auto";
      
      // 調試：記錄工具數量（流式模式）
      if (process.env.DEBUG_TOOLS || process.env.BAILU_DEBUG) {
        console.log(`[DEBUG STREAM] 發送 ${tools.length} 個工具到 API`);
        
        // 記錄完整請求到文件
        import('fs').then((fs) => {
          const debugRequest = {
            model: this.model,
            messages: messages.map((m: any) => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content.substring(0, 500) + (m.content.length > 500 ? '...(truncated)' : '') : m.content
            })),
            tools: tools.length,
            stream: true,
          };
          fs.appendFileSync('debug-api-request.log', `\n=== API 請求 ===\n${JSON.stringify(debugRequest, null, 2)}\n`, 'utf-8');
        });
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");

      let extra = "";
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string; type?: string } };
        if (parsed.error?.message) {
          extra = parsed.error.message;
          if (parsed.error.type === "invalid_model") {
            extra += `\n請確認當前模型 ID 是否正確（目前為 "${this.model}"）。`;
            extra += `\n你可以設置環境變量 BAILU_MODEL 或在本機配置中修改模型，並可通過 "bailu models" 查看可用模型。`;
          }
        }
      } catch {
        // ignore JSON parse error
      }

      const baseMsg = `白鹿 API 請求失敗：${response.status} ${response.statusText}`;
      const detail = extra || text;
      throw new Error(detail ? `${baseMsg}\n${detail}` : baseMsg);
    }

    if (!response.body) {
      throw new Error("白鹿 API 流式響應缺少 body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6);
            try {
              const chunk = JSON.parse(jsonStr) as StreamChunk;
              const delta = chunk.choices?.[0]?.delta;
              if (delta?.content) {
                yield delta.content;
              }
            } catch (e) {
              // 忽略解析錯誤的行
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/models`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`白鹿 API 模型列表請求失敗：${response.status} ${response.statusText} ${text}`);
    }

    const data = (await response.json()) as ModelsResponse;
    const list = data.data ?? data.models ?? [];
    return list.map((m) => m.id);
  }
}
