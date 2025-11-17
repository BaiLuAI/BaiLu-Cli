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
    this.model = options.model ?? modelEnv ?? "bailu-2.6-preview";
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
      // 嘗試使用當前模型發起一個簡單請求
      // 如果失敗，則獲取可用模型列表並選擇第一個
      const models = await this.listModels();
      
      if (models.length === 0) {
        throw new Error("未找到任何可用模型");
      }

      // 檢查當前模型是否在列表中
      if (!models.includes(this.model)) {
        const oldModel = this.model;
        // 優先選擇推薦模型
        const preferredModels = [
          "bailu-2.6-preview",
          "bailu-2.5-pro",
          "bailu-2.6-fast-thinking",
          "bailu-2.5-code-cc",
        ];

        // 嘗試使用推薦模型
        const preferredAvailable = preferredModels.find(m => models.includes(m));
        this.model = preferredAvailable || models[0];

        console.log(`⚠️  模型 "${oldModel}" 不可用，自動切換到 "${this.model}"`);
      }

      this.modelInitialized = true;
    } catch (error) {
      // 如果獲取模型列表失敗，繼續使用當前模型（會在實際調用時報錯）
      this.modelInitialized = true;
    }
  }

  async chat(messages: ChatMessage[], stream = false): Promise<string> {
    // 確保使用可用的模型
    await this.ensureModelAvailable();

    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };

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

  async *chatStream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    // 確保使用可用的模型
    await this.ensureModelAvailable();

    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };

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



