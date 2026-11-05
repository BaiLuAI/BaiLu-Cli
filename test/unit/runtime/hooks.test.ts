/**
 * Hooks 鉤子系統測試：PreToolUse 攔截、PostToolUse、Stop、Notification
 */

import { describe, it, expect, jest } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import os from 'os';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock = {
    cyan: fn, green: fn, yellow: fn, red: fn, gray: fn, blue: fn,
    bold: Object.assign(fn, { cyan: fn }),
  };
  return { __esModule: true, default: chalkMock, ...chalkMock };
});

import { HookRunner } from '../../../src/runtime/hooks.js';
import { ToolExecutor } from '../../../src/tools/executor.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { builtinTools } from '../../../src/tools/implementations/index.js';
import { resetReadTracker } from '../../../src/tools/read-tracker.js';
import { ToolCall, ToolExecutionContext } from '../../../src/tools/types.js';

// Windows 用 node -e，Unix 用 true/false 更簡潔；統一用 node 保證跨平台
const NODE = `node`;

describe('HookRunner', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));

  it('退出碼 0 應該允許', async () => {
    const runner = new HookRunner(
      { PreToolUse: [{ command: `${NODE} -e "process.exit(0)"` }] },
      tmpDir
    );
    const result = await runner.runPreToolUse({ tool: 'read_file', params: { path: 'x' } });
    expect(result.blocked).toBe(false);
  });

  it('退出碼 2 應該阻止並回傳 stderr 作為原因', async () => {
    const runner = new HookRunner(
      { PreToolUse: [{ command: `${NODE} -e "console.error('不允許刪除'); process.exit(2)"` }] },
      tmpDir
    );
    const result = await runner.runPreToolUse({ tool: 'run_command', params: { command: 'rm -rf /' } });
    expect(result.blocked).toBe(true);
    expect(result.message).toContain('不允許刪除');
  });

  it('其他非零退出碼應該警告但不阻止', async () => {
    const runner = new HookRunner(
      { PreToolUse: [{ command: `${NODE} -e "console.error('warn'); process.exit(1)"` }] },
      tmpDir
    );
    const result = await runner.runPreToolUse({ tool: 'read_file', params: { path: 'x' } });
    expect(result.blocked).toBe(false);
    expect(result.message).toContain('warn');
  });

  it('matcher 應該過濾工具名', async () => {
    let executed = false;
    const runner = new HookRunner(
      {
        PreToolUse: [
          {
            matcher: 'write_file|edit_file',
            command: `${NODE} -e "process.exit(2)"`,
          },
        ],
      },
      tmpDir
    );

    // read_file 不匹配 matcher → 不執行鉤子 → 不阻止
    const r1 = await runner.runPreToolUse({ tool: 'read_file', params: { path: 'x' } });
    expect(r1.blocked).toBe(false);

    // write_file 匹配 → 阻止
    const r2 = await runner.runPreToolUse({ tool: 'write_file', params: { path: 'x' } });
    expect(r2.blocked).toBe(true);
  });

  it('stdin 應該收到 JSON payload', async () => {
    let received = '';
    const runner = new HookRunner(
      {
        PreToolUse: [
          {
            command: `${NODE} -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);console.error('TOOL='+p.tool);process.exit(0)})"`,
          },
        ],
      },
      tmpDir
    );

    const result = await runner.runPreToolUse({ tool: 'grep_search', params: { pattern: 'x' } });
    expect(result.blocked).toBe(false);
    expect(result.message).toContain('TOOL=grep_search');
  });

  it('鉤子超時應該安全返回', async () => {
    const runner = new HookRunner(
      { PreToolUse: [{ command: `${NODE} -e "setInterval(()=>{},100)"`, timeout: 1 }] },
      tmpDir
    );
    const result = await runner.runPreToolUse({ tool: 'read_file', params: { path: 'x' } });
    expect(result.blocked).toBe(false); // 超時不阻止（退出碼 -1 ≠ 2）
  }, 10000);

  it('Stop 與 Notification 應該正常執行', async () => {
    const runner = new HookRunner(
      {
        Stop: [{ command: `${NODE} -e "console.log('stopped')"` }],
        Notification: [{ command: `${NODE} -e "console.log('notified')"` }],
      },
      tmpDir
    );
    const stop = await runner.runStop('done');
    expect(stop.message).toContain('stopped');
    const notif = await runner.runNotification('hello');
    expect(notif.message).toContain('notified');
  });
});

describe('ToolExecutor + Hooks 整合', () => {
  it('PreToolUse 阻止時工具不執行', async () => {
    resetReadTracker();
    const registry = new ToolRegistry();
    registry.registerAll(builtinTools);

    const ctx: ToolExecutionContext = {
      workspaceRoot: process.cwd(),
      safetyMode: 'auto-apply',
      hooks: {
        PreToolUse: [{ command: `${NODE} -e "process.exit(2)"` }],
      },
    };
    const executor = new ToolExecutor(registry, ctx);

    const result = await executor.execute({
      tool: 'list_directory',
      params: { path: '.' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Hook 阻止');
  });
});
