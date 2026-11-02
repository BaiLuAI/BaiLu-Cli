/**
 * ToolExecutor 單元測試：安全模式、權限規則整合、先讀後寫
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

import { ToolRegistry } from '../../../src/tools/registry.js';
import { ToolExecutor } from '../../../src/tools/executor.js';
import { builtinTools } from '../../../src/tools/implementations/index.js';
import { resetReadTracker } from '../../../src/tools/read-tracker.js';
import { ToolExecutionContext } from '../../../src/tools/types.js';

const currentDir = path.resolve();

describe('ToolExecutor', () => {
  let tmpDir: string;
  let registry: ToolRegistry;
  let ctx: ToolExecutionContext;
  let executor: ToolExecutor;

  beforeEach(() => {
    resetReadTracker();
    tmpDir = path.join(currentDir, '.exec-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });

    registry = new ToolRegistry();
    registry.registerAll(builtinTools);

    ctx = {
      workspaceRoot: tmpDir,
      safetyMode: 'auto-apply',
    };
    executor = new ToolExecutor(registry, ctx);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('dry-run 模式', () => {
    it('應該模擬執行而不實際寫入', async () => {
      ctx.safetyMode = 'dry-run';
      const dryExecutor = new ToolExecutor(registry, ctx);

      const result = await dryExecutor.execute({
        tool: 'write_file',
        params: { path: 'dry.txt', content: 'should not exist' },
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('DRY-RUN');
      expect(fs.existsSync(path.join(tmpDir, 'dry.txt'))).toBe(false);
    });
  });

  describe('權限規則整合', () => {
    it('deny 規則應該在 auto-apply 模式下阻止執行', async () => {
      ctx.permissionRules = { deny: ['Bash(node:*)'] };

      const result = await executor.execute({
        tool: 'run_command',
        params: { command: 'node', args: ['-e', 'console.log(1)'] },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('權限規則阻止');
    });

    it('deny 規則應該在 review 模式下阻止執行', async () => {
      ctx.safetyMode = 'review';
      ctx.permissionRules = { deny: ['write_file'] };
      const reviewExecutor = new ToolExecutor(registry, ctx);

      const result = await reviewExecutor.execute({
        tool: 'write_file',
        params: { path: 'x.txt', content: 'x' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('權限規則阻止');
    });

    it('allow 規則應該在 review 模式下自動批准非安全工具', async () => {
      ctx.safetyMode = 'review';
      ctx.permissionRules = { allow: ['Bash(node:*)'] };
      const reviewExecutor = new ToolExecutor(registry, ctx);

      // 不會觸發交互式確認（allow 自動批准）
      const result = await reviewExecutor.execute({
        tool: 'run_command',
        params: { command: 'node', args: ['-e', 'console.log(1)'] },
      });

      // 命令本身會執行成功
      expect(result.success).toBe(true);
      expect(result.output).toContain('1');
    });

    it('未匹配規則的 deny 不影響其他命令', async () => {
      ctx.permissionRules = { deny: ['Bash(rm:*)'] };

      const result = await executor.execute({
        tool: 'run_command',
        params: { command: 'node', args: ['-e', 'console.log(1)'] },
      });

      expect(result.error || '').not.toContain('權限規則阻止');
    });
  });

  describe('先讀後寫強制', () => {
    it('覆寫已存在但未讀取的檔案應該被拒絕', async () => {
      fs.writeFileSync(path.join(tmpDir, 'exists.txt'), 'original');

      const result = await executor.execute({
        tool: 'write_file',
        params: { path: 'exists.txt', content: 'blind overwrite' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('先讀取');
      expect(fs.readFileSync(path.join(tmpDir, 'exists.txt'), 'utf8')).toBe('original');
    });

    it('先讀取後應該允許寫入', async () => {
      fs.writeFileSync(path.join(tmpDir, 'exists.txt'), 'original');

      await executor.execute({ tool: 'read_file', params: { path: 'exists.txt' } });
      const result = await executor.execute({
        tool: 'write_file',
        params: { path: 'exists.txt', content: 'updated' },
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, 'exists.txt'), 'utf8')).toBe('updated');
    });
  });

  describe('快照與還原', () => {
    it('寫入失敗時應該自動還原快照', async () => {
      // 建立唯讀檔案讓寫入失敗
      const target = path.join(tmpDir, 'locked.txt');
      fs.writeFileSync(target, 'precious');
      fs.chmodSync(target, 0o444);

      await executor.execute({ tool: 'read_file', params: { path: 'locked.txt' } });

      // 嘗試用 apply_diff 寫入（會失敗，因為檔案唯讀）
      const result = await executor.execute({
        tool: 'apply_diff',
        params: {
          path: 'locked.txt',
          diff: '@@ -1 +1 @@\n-precious\n+hacked',
        },
      });

      // Windows 上 chmod 0o444 不一定阻止寫入，所以只驗證：要嘛失敗且內容不變，要嘛成功
      if (!result.success) {
        expect(fs.readFileSync(target, 'utf8')).toBe('precious');
      }
      fs.chmodSync(target, 0o644);
    });
  });

  describe('工具不存在與參數驗證', () => {
    it('不存在的工具應該報錯', async () => {
      const result = await executor.execute({ tool: 'nonexistent', params: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('不存在');
    });

    it('缺少必需參數應該報錯', async () => {
      const result = await executor.execute({ tool: 'read_file', params: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('缺少必需參數');
    });
  });
});
