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

  constructor(options: LLMClientOptions) {
    const envKey = process.env.BAILU_API_KEY;
    const modelEnv = process.env.BAILU_MODEL;
    const baseEnv = process.env.BAILU_BASE_URL;

    const apiKey = options.apiKey ?? envKey;
    if (!apiKey) {
      throw new Error("缺少白鹿 API Key。請設置 BAILU_API_KEY 或通過 CLI 互動輸入。");
    }

    this.apiKey = apiKey;
    this.model = options.model ?? modelEnv ?? "bailu-chat";
    this.baseUrl = options.baseUrl ?? baseEnv ?? "https://bailucode.com/openapi/v1";
  }

  async chat(messages: ChatMessage[], stream = false): Promise<string> {
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



