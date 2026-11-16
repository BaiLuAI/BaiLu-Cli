/**
 * PlanMode 回歸測試：拒絕/修改/回退、executePlan 守衛
 * （子代理發現：reject 造成無限迴圈、fallback 假成功）
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock: any = new Proxy(fn, { get: () => chalkMock, apply: (_t, _th, a) => String(a[0] ?? '') });
  return { __esModule: true, default: chalkMock, ...chalkMock };
});
jest.mock('log-symbols', () => ({ __esModule: true, default: { info: 'i', success: '✓', warning: '⚠', error: '✗' } }));

// inquirer 用 mock 控制用戶選擇
jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
}));

import { PlanMode } from '../../../src/agent/plan-mode.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { ToolExecutionContext } from '../../../src/tools/types.js';

function makeFakeLLM(responses: string[]) {
  let i = 0;
  return {
    getModelName: () => 'bailu-2.8',
    getBaseUrl: () => 'x',
    setModel: () => {},
    ensureModelAvailable: async () => {},
    async chat(): Promise<string> {
      return responses[Math.min(i++, responses.length - 1)] ?? '';
    },
    async *chatStream(): AsyncGenerator<string> {
      yield responses[Math.min(i++, responses.length - 1)] ?? '';
    },
  };
}

const ctx: ToolExecutionContext = { workspaceRoot: process.cwd(), safetyMode: 'auto-apply' };

async function makePlanMode(responses: string[]) {
  return new PlanMode({
    llmClient: makeFakeLLM(responses) as never,
    toolRegistry: new ToolRegistry(),
    executionContext: ctx,
    verbose: false,
  });
}

const validPlanJson = '```json\n' + JSON.stringify({
  title: '重構 auth 模組',
  description: '分離驗證邏輯',
  steps: [
    { id: 1, description: '分析現有 auth 代碼' },
    { id: 2, description: '提取驗證邏輯' },
  ],
}) + '\n```';

describe('PlanMode 解析與回退', () => {
  it('有效 JSON 應解析出步驟', async () => {
    const pm = await makePlanMode([validPlanJson]);
    const plan = await pm.generatePlan('重構 auth', 'workspace info');
    expect(plan.steps.length).toBe(2);
    expect(plan.title).toBe('重構 auth 模組');
    expect(plan.isFallback).toBeFalsy();
  });

  it('LLM 回無效內容應標記 isFallback（不再假裝成功）', async () => {
    const pm = await makePlanMode(['這不是 JSON']);
    const plan = await pm.generatePlan('x', 'y');
    expect(plan.isFallback).toBe(true);
    expect(plan.title).toContain('回退');
  });
});

describe('PlanMode displayAndConfirmPlan 三態回傳', () => {
  async function pick(action: string, pm: PlanMode) {
    const inquirer = (await import('inquirer')) as any;
    inquirer.default.prompt.mockResolvedValue({ action });
    const plan = await pm.generatePlan('x', 'y');
    return pm.displayAndConfirmPlan(plan);
  }

  it('批准 → approved', async () => {
    const pm = await makePlanMode([validPlanJson]);
    expect(await pick('approve', pm)).toBe('approved');
  });

  it('拒絕 → rejected（不再無限迴圈）', async () => {
    const pm = await makePlanMode([validPlanJson]);
    expect(await pick('reject', pm)).toBe('rejected');
  });

  it('修改 → modify', async () => {
    const pm = await makePlanMode([validPlanJson]);
    expect(await pick('modify', pm)).toBe('modify');
  });
});

describe('PlanMode executePlan 守衛', () => {
  it('未批准的計劃應拋錯', async () => {
    const pm = await makePlanMode([validPlanJson]);
    const plan = await pm.generatePlan('x', 'y'); // status = draft
    await expect(pm.executePlan(plan)).rejects.toThrow(/approved|批准/);
  });

  it('已批准且無工具的步驟應標記完成', async () => {
    const pm = await makePlanMode([validPlanJson]);
    const plan = await pm.generatePlan('x', 'y');
    plan.status = 'approved';
    const result = await pm.executePlan(plan);
    expect(result.success).toBe(true);
    expect(plan.status).toBe('completed');
  });
});
