/**
 * AgentOrchestrator 循環測試（mock LLM，不發真實請求）
 * 覆蓋：工具調用循環、結果回饋、連續失敗停止、最大迭代、中斷
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import path from 'path';
import fs from 'fs';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock = {
    cyan: fn, green: fn, yellow: fn, red: fn, gray: fn, blue: fn,
    bold: Object.assign(fn, { cyan: fn }),
  };
  return { __esModule: true, default: chalkMock, ...chalkMock };
});

import { AgentOrchestrator } from '../../../src/agent/orchestrator.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { Tool, ToolExecutionContext, ToolResult } from '../../../src/tools/types.js';
import { ChatMessage } from '../../../src/llm/client.js';

// log-symbols 是 ESM-only，Jest 無法解析，與 chalk 一併 mock
jest.mock('log-symbols', () => ({
  __esModule: true,
  default: { info: 'i', success: '✓', warning: '⚠', error: '✗' },
}));

const currentDir = path.resolve();

/** 可編程的假 LLM 客戶端 */
class FakeLLMClient {
  /** 每輪返回的回應序列 */
  public responses: string[] = [];
  public calls = 0;

  getModelName(): string {
    return 'bailu-2.8';
  }

  getBaseUrl(): string {
    return 'https://bailucode.com/openapi/v1';
  }

  setModel(): void {}

  async chat(): Promise<string> {
    const response = this.responses[this.calls] ?? this.responses[this.responses.length - 1] ?? '';
    this.calls++;
    return response;
  }

  async *chatStream(): AsyncGenerator<string> {
    yield this.responses[this.calls] ?? '';
    this.calls++;
  }

  async ensureModelAvailable(): Promise<void> {}
}

/** 建立可編程的測試工具 */
function makeTestTool(handler: (params: Record<string, unknown>) => Promise<ToolResult>): Tool {
  return {
    definition: {
      name: 'test_tool',
      description: '測試工具',
      parameters: [{ name: 'input', type: 'string', description: '輸入', required: true }],
    },
    handler: async (params) => handler(params),
  };
}

function makeOrchestrator(responses: string[], tool: Tool, maxIterations = 10) {
  const registry = new ToolRegistry();
  registry.register(tool);

  const ctx: ToolExecutionContext = {
    workspaceRoot: path.join(currentDir, '.orch-test'),
    safetyMode: 'auto-apply',
  };

  const fakeLLM = new FakeLLMClient();
  fakeLLM.responses = responses;

  const orchestrator = new AgentOrchestrator({
    llmClient: fakeLLM as never,
    toolRegistry: registry,
    executionContext: ctx,
    maxIterations,
    verbose: false,
  });

  return { orchestrator, fakeLLM };
}

const initialMessages: ChatMessage[] = [
  { role: 'system', content: 'test system' },
  { role: 'user', content: 'do something' },
];

describe('AgentOrchestrator 循環', () => {
  beforeEach(() => {
    fs.rmSync(path.join(currentDir, '.orch-test'), { recursive: true, force: true });
  });

  it('無工具調用時應該直接完成', async () => {
    const { orchestrator } = makeOrchestrator(['直接回答，不需要工具'], makeTestTool(async () => ({ success: true })));

    const result = await orchestrator.run(initialMessages, false);

    expect(result.success).toBe(true);
    expect(result.finalResponse).toBe('直接回答，不需要工具');
    expect(result.toolCallsExecuted).toBe(0);
    expect(result.iterations).toBe(1);
  });

  it('工具調用後應該把結果回饋並繼續', async () => {
    const { orchestrator, fakeLLM } = makeOrchestrator(
      [
        '<action><invoke tool="test_tool"><param name="input">hello</param></invoke></action>',
        '工具執行完成，答案是 42',
      ],
      makeTestTool(async (params) => ({
        success: true,
        output: `收到: ${params.input}，結果 42`,
      }))
    );

    const result = await orchestrator.run(initialMessages, false);

    expect(result.success).toBe(true);
    expect(result.toolCallsExecuted).toBe(1);
    expect(fakeLLM.calls).toBe(2); // 兩輪 LLM 調用

    // 工具結果應該作為 user 消息回饋
    const toolFeedback = result.messages?.find((m) => m.role === 'user' && m.content.includes('test_tool'));
    expect(toolFeedback).toBeDefined();
    expect(toolFeedback?.content).toContain('結果 42');
  });

  it('同一工具連續失敗 3 次應該停止循環', async () => {
    let failCount = 0;
    const { orchestrator } = makeOrchestrator(
      [
        '<action><invoke tool="test_tool"><param name="input">x</param></invoke></action>',
        '<action><invoke tool="test_tool"><param name="input">x</param></invoke></action>',
        '<action><invoke tool="test_tool"><param name="input">x</param></invoke></action>',
        '<action><invoke tool="test_tool"><param name="input">x</param></invoke></action>',
        '放棄',
      ],
      makeTestTool(async () => {
        failCount++;
        return { success: false, error: '模擬失敗 #' + failCount };
      })
    );

    const result = await orchestrator.run(initialMessages, false);

    // 連續失敗 3 次後停止（第 4 個回應不會被消費）
    expect(failCount).toBe(3);
    expect(result.toolCallsExecuted).toBe(3);
  });

  it('達到最大迭代次數應該停止並報錯', async () => {
    const loopResponse = '<action><invoke tool="test_tool"><param name="input">x</param></invoke></action>';
    const { orchestrator } = makeOrchestrator(
      Array(20).fill(loopResponse),
      makeTestTool(async () => ({ success: true, output: 'ok' })),
      3 // maxIterations = 3
    );

    const result = await orchestrator.run(initialMessages, false);

    expect(result.success).toBe(false);
    expect(result.error).toContain('最大迭代次數');
  });

  it('abort signal 應該中斷並標記 interrupted', async () => {
    const { orchestrator } = makeOrchestrator(
      [
        '<action><invoke tool="test_tool"><param name="input">x</param></invoke></action>',
        '不會到達',
      ],
      makeTestTool(async () => ({ success: true, output: 'ok' }))
    );

    const controller = new AbortController();
    // 立即中斷
    controller.abort();

    const result = await orchestrator.run(initialMessages, false, false, controller.signal);

    expect(result.interrupted).toBe(true);
    expect(result.success).toBe(true);
  });

  it('工具成功後應該重置連續失敗計數', async () => {
    let callCount = 0;
    const { orchestrator } = makeOrchestrator(
      [
        '<action><invoke tool="test_tool"><param name="input">1</param></invoke></action>',
        '<action><invoke tool="test_tool"><param name="input">2</param></invoke></action>',
        '<action><invoke tool="test_tool"><param name="input">3</param></invoke></action>',
        '<action><invoke tool="test_tool"><param name="input">4</param></invoke></action>',
        '完成',
      ],
      makeTestTool(async () => {
        callCount++;
        // 失敗、成功、失敗、成功 — 永遠不會連續失敗 3 次
        return callCount % 2 === 1
          ? { success: false, error: '間歇失敗' }
          : { success: true, output: 'ok' };
      })
    );

    const result = await orchestrator.run(initialMessages, false);

    expect(result.success).toBe(true);
    expect(callCount).toBe(4);
  });
});
