export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
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

  constructor(options: LLMClientOptions) {
    const envKey = process.env.BAILU_API_KEY;
    const modelEnv = process.env.BAILU_MODEL;
    const baseEnv = process.env.BAILU_BASE_URL;

    const apiKey = options.apiKey ?? envKey;
    if (!apiKey) {
      throw new Error("缺少白鹿 API Key。請設置 BAILU_API_KEY 或通過 CLI 互動輸入。");
    }

    this.apiKey = apiKey;
    this.model = options.model ?? modelEnv ?? "Test-Hide";
    this.baseUrl = options.baseUrl ?? baseEnv ?? "https://bailucode.com/openapi/v1";
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
          "Test-Hide",               // 支持工具調用（推薦）
          "bailu-Minimum-free",      // 免費模型
          "bailu-Edge",              // Edge 模型
          "bailu-2.6-mini",          // Mini 版本
          "bailu-2.5-lite-code",     // 輕量代碼版
          "bailu-2.5-pro",           // Pro 版本（可能需要付費）
          "bailu-2.6-fast-thinking", // 快速思考
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
   */
  private async testModel(modelId: string): Promise<boolean> {
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
      return response.ok;
    } catch {
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

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
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



