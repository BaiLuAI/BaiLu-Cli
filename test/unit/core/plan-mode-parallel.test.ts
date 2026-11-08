/**
 * Plan 模式與並行工具執行測試
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock = {
    cyan: fn, green: fn, yellow: fn, red: fn, gray: fn, blue: fn,
    bold: Object.assign(fn, { cyan: fn }),
  };
  return { __esModule: true, default: chalkMock, ...chalkMock };
});
jest.mock('log-symbols', () => ({
  __esModule: true,
  default: { info: 'i', success: '✓', warning: '⚠', error: '✗' },
}));

import { ToolExecutor } from '../../../src/tools/executor.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { builtinTools } from '../../../src/tools/implementations/index.js';
import { resetReadTracker } from '../../../src/tools/read-tracker.js';
import { ToolExecutionContext } from '../../../src/tools/types.js';

const currentDir = path.resolve();

describe('Plan 模式', () => {
  let tmpDir: string;
  let registry: ToolRegistry;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    resetReadTracker();
    tmpDir = path.join(currentDir, '.plan-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'content');

    registry = new ToolRegistry();
    registry.registerAll(builtinTools);
    ctx = { workspaceRoot: tmpDir, safetyMode: 'plan' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('應該允許唯讀工具（read_file）', async () => {
    const executor = new ToolExecutor(registry, ctx);
    const result = await executor.execute({ tool: 'read_file', params: { path: 'a.txt' } });

    expect(result.success).toBe(true);
    expect(result.output).toContain('content');
  });

  it('應該允許 list_directory', async () => {
    const executor = new ToolExecutor(registry, ctx);
    const result = await executor.execute({ tool: 'list_directory', params: { path: '.' } });
    expect(result.success).toBe(true);
  });

  it('應該阻止 write_file', async () => {
    const executor = new ToolExecutor(registry, ctx);
    const result = await executor.execute({
      tool: 'write_file',
      params: { path: 'new.txt', content: 'x' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Plan 模式');
    expect(fs.existsSync(path.join(tmpDir, 'new.txt'))).toBe(false);
  });

  it('應該阻止 edit_file', async () => {
    const executor = new ToolExecutor(registry, ctx);
    const result = await executor.execute({
      tool: 'edit_file',
      params: { path: 'a.txt', old_string: 'content', new_string: 'changed' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Plan 模式');
    expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')).toBe('content');
  });

  it('應該阻止 run_command', async () => {
    const executor = new ToolExecutor(registry, ctx);
    const result = await executor.execute({
      tool: 'run_command',
      params: { command: 'node', args: ['-e', 'console.log(1)'] },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Plan 模式');
  });

  it('切換到 auto-apply 後應該恢復寫入', async () => {
    const planExecutor = new ToolExecutor(registry, ctx);
    const blocked = await planExecutor.execute({
      tool: 'write_file',
      params: { path: 'x.txt', content: 'v' },
    });
    expect(blocked.success).toBe(false);

    // 切換模式
    planExecutor.updateContext({ safetyMode: 'auto-apply' });
    ctx.safetyMode = 'auto-apply';
    const allowed = await planExecutor.execute({
      tool: 'write_file',
      params: { path: 'x.txt', content: 'v' },
    });
    expect(allowed.success).toBe(true);
  });
});

describe('並行工具執行', () => {
  it('多個唯讀工具應該並行執行（總耗時接近單個耗時）', async () => {
    const registry = new ToolRegistry();
    // 三個各耗時 100ms 的唯讀工具
    for (let i = 0; i < 3; i++) {
      registry.register({
        definition: {
          name: `slow_read_${i}`,
          description: 'slow',
          parameters: [],
          safe: true,
        },
        handler: async () => {
          await new Promise((r) => setTimeout(r, 100));
          return { success: true, output: `done_${i}` };
        },
      });
    }

    const ctx: ToolExecutionContext = { workspaceRoot: currentDir, safetyMode: 'auto-apply' };
    const executor = new ToolExecutor(registry, ctx);

    const start = Date.now();
    const results = await Promise.all([
      executor.execute({ tool: 'slow_read_0', params: {} }),
      executor.execute({ tool: 'slow_read_1', params: {} }),
      executor.execute({ tool: 'slow_read_2', params: {} }),
    ]);
    const elapsed = Date.now() - start;

    expect(results.every((r) => r.success)).toBe(true);
    // 並行：應接近 100ms 而非 300ms（留寬鬆餘量給 CI）
    expect(elapsed).toBeLessThan(280);
  });
});
