import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LLMClient } from '../../../src/llm/client.js';

// Mock fetch globally
global.fetch = jest.fn() as any;

describe('LLMClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear environment variables
    delete process.env.BAILU_API_KEY;
    delete process.env.BAILU_MODEL;
    delete process.env.BAILU_BASE_URL;
  });

  describe('constructor', () => {
    it('應該使用提供的 API Key 創建客戶端', () => {
      const client = new LLMClient({ apiKey: 'test-key' });
      expect(client).toBeDefined();
      expect(client.getModelName()).toBe('bailu-Edge');
    });

    it('應該使用環境變量中的 API Key', () => {
      process.env.BAILU_API_KEY = 'env-key';
      const client = new LLMClient({});
      expect(client).toBeDefined();
    });

    it('應該使用自定義模型', () => {
      const client = new LLMClient({ apiKey: 'test-key', model: 'bailu-2.6' });
      expect(client.getModelName()).toBe('bailu-2.6');
    });

    it('應該使用自定義 baseUrl', () => {
      const client = new LLMClient({ 
        apiKey: 'test-key', 
        baseUrl: 'https://custom.example.com/v1' 
      });
      expect(client).toBeDefined();
    });

    it('缺少 API Key 時應該拋出錯誤', () => {
      expect(() => new LLMClient({})).toThrow('缺少白鹿 API Key');
    });
  });

  describe('chat', () => {
    it('應該成功發送聊天請求並返回響應', async () => {
      const mockResponse = {
        id: 'test-id',
        model: 'bailu-Edge',
        choices: [{
          index: 0,
          message: {
            role: 'assistant' as const,
            content: '這是測試響應'
          },
          finish_reason: 'stop'
        }]
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementation(async () => ({
        ok: true,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        status: 200,
        statusText: 'OK',
      } as Response));

      const client = new LLMClient({ apiKey: 'test-key' });
      const messages = [{ role: 'user' as const, content: '你好' }];
      const response = await client.chat(messages);

      expect(response).toBe('這是測試響應');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat/completions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-key',
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('應該處理帶工具的請求', async () => {
      const mockResponse = {
        id: 'test-id',
        model: 'bailu-Edge',
        choices: [{
          index: 0,
          message: {
            role: 'assistant' as const,
            content: '使用工具'
          }
        }]
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementation(async () => ({
        ok: true,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        status: 200,
        statusText: 'OK',
      } as Response));

      const client = new LLMClient({ apiKey: 'test-key' });
      const messages = [{ role: 'user' as const, content: '執行任務' }];
      const tools = [{
        type: 'function',
        function: {
          name: 'test_tool',
          description: '測試工具',
          parameters: { type: 'object', properties: {} }
        }
      }];

      const response = await client.chat(messages, false, tools);
      expect(response).toBe('使用工具');
    });

    it('應該處理 API 錯誤', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementation(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => JSON.stringify({ error: { message: 'Invalid API Key' } }),
        json: async () => ({ error: { message: 'Invalid API Key' } }),
      } as Response));

      const client = new LLMClient({ apiKey: 'invalid-key' });
      const messages = [{ role: 'user' as const, content: '你好' }];

      await expect(client.chat(messages)).rejects.toThrow('Invalid API Key');
    });

    it('應該處理工具調用響應', async () => {
      const mockResponse = {
        id: 'test-id',
        model: 'bailu-Edge',
        choices: [{
          index: 0,
          message: {
            role: 'assistant' as const,
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: 'test.txt' })
              }
            }]
          }
        }]
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementation(async () => ({
        ok: true,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        status: 200,
        statusText: 'OK',
      } as Response));

      const client = new LLMClient({ apiKey: 'test-key' });
      const messages = [{ role: 'user' as const, content: '讀取文件' }];
      const response = await client.chat(messages);

      expect(response).toContain('<action>');
      expect(response).toContain('invoke tool="read_file"');
      expect(response).toContain('param name="path">test.txt</param>');
    });
  });

  describe('listModels', () => {
    it('應該成功獲取模型列表', async () => {
      const mockResponse = {
        data: [
          { id: 'bailu-2.6' },
          { id: 'bailu-Edge' },
          { id: 'bailu-2.6-preview' }
        ]
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const client = new LLMClient({ apiKey: 'test-key' });
      const models = await client.listModels();

      expect(models).toEqual(['bailu-2.6', 'bailu-Edge', 'bailu-2.6-preview']);
    });

    it('應該處理空的模型列表', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response);

      const client = new LLMClient({ apiKey: 'test-key' });
      const models = await client.listModels();

      expect(models).toEqual([]);
    });

    it('應該處理 API 錯誤', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server Error'
      } as Response);

      const client = new LLMClient({ apiKey: 'test-key' });

      await expect(client.listModels()).rejects.toThrow('白鹿 API 模型列表請求失敗');
    });
  });

  describe('getModelName', () => {
    it('應該返回當前使用的模型名稱', () => {
      const client = new LLMClient({ apiKey: 'test-key', model: 'bailu-2.6' });
      expect(client.getModelName()).toBe('bailu-2.6');
    });

    it('應該返回默認模型名稱', () => {
      const client = new LLMClient({ apiKey: 'test-key' });
      expect(client.getModelName()).toBe('bailu-Edge');
    });
  });
});
