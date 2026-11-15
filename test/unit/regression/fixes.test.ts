/**
 * 回歸測試：8 個子代理獨立驗證發現的 bug 修復
 *
 * 涵蓋：
 * - 路徑前綴邊界繞過（安全）
 * - apply_diff 上下文不符靜默毀檔（資料）
 * - edit_file $& 替換字元（資料）
 * - file_search *x* glob（功能）
 * - list_directory 路徑驗證與工作區基準（安全/功能）
 * - InputBox Enter 合併 chunk 丟失內容（資料）
 * - hooks stdin EOF 崩潰（穩定性）
 * - run_command timeout 失效（功能）
 * - shell 注入 | & > <（安全）
 * - --mode 無效值降級（安全）
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock: any = new Proxy(fn, { get: () => chalkMock, apply: (_t, _th, a) => String(a[0] ?? '') });
  return { __esModule: true, default: chalkMock, ...chalkMock };
});
jest.mock('log-symbols', () => ({
  __esModule: true,
  default: { info: 'i', success: '✓', warning: '⚠', error: '✗' },
}));

import { isWithinWorkspace } from '../../../src/utils/path-boundary.js';
import { validatePath } from '../../../src/utils/path-validator.js';
import { applyDiffTool } from '../../../src/tools/implementations/apply_diff.js';
import { editFileTool } from '../../../src/tools/implementations/edit_file.js';
import { fileSearchTool } from '../../../src/tools/implementations/file_search.js';
import { listDirectoryTool } from '../../../src/tools/implementations/list_directory.js';
import { readFileTool } from '../../../src/tools/implementations/read_file.js';
import { resetReadTracker } from '../../../src/tools/read-tracker.js';
import { InputBox } from '../../../src/tui/input-box.js';
import { HookRunner } from '../../../src/runtime/hooks.js';
import { runCommandSafe } from '../../../src/runtime/runner.js';
import { containsShellInjection, getDefaultPolicy } from '../../../src/runtime/policy.js';
import { mergeConfigs } from '../../../src/config.js';
import { ToolExecutionContext } from '../../../src/tools/types.js';

const currentDir = path.resolve();

describe('路徑前綴邊界（安全）', () => {
  it('isWithinWorkspace 應拒絕同前綴的兄弟目錄', () => {
    const root = path.join(currentDir, '.ws');
    expect(isWithinWorkspace(root, path.join(root, 'a.txt'))).toBe(true);
    expect(isWithinWorkspace(root, root)).toBe(true);
    expect(isWithinWorkspace(root, `${root}-evil/a.txt`)).toBe(false);
    expect(isWithinWorkspace(root, path.join(currentDir, '.ws2', 'a.txt'))).toBe(false);
  });

  it('validatePath 應拒絕兄弟目錄逃逸', () => {
    const root = path.join(currentDir, '.ws-boundary');
    const evil = `${root}-evil`;
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(evil, { recursive: true });
    try {
      const result = validatePath(path.join(evil, 'secret.txt'), root);
      expect(result.valid).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(evil, { recursive: true, force: true });
    }
  });
});

describe('apply_diff 上下文校驗（資料）', () => {
  let tmpDir: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    resetReadTracker();
    tmpDir = path.join(currentDir, '.tmp-regress-diff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    ctx = { workspaceRoot: tmpDir, safetyMode: 'auto-apply' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('上下文不符時應報錯且不修改檔案', async () => {
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'x\ny\nz\n');
    await readFileTool.handler({ path: 'a.txt' }, ctx);

    const result = await applyDiffTool.handler(
      {
        path: 'a.txt',
        diff: '@@ -1,3 +1,3 @@\n aaa\n-bbb\n+BBB\n ccc\n',
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/上下文不符|套用失敗/);
    // 檔案內容未被破壞
    expect(fs.readFileSync(file, 'utf8')).toBe('x\ny\nz\n');
  });

  it('正確的 diff 仍應成功套用', async () => {
    const file = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(file, 'a\nb\nc\n');
    await readFileTool.handler({ path: 'b.txt' }, ctx);

    const result = await applyDiffTool.handler(
      { path: 'b.txt', diff: '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n' },
      ctx
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('a\nB\nc\n');
  });
});

describe('edit_file 替換字元（資料）', () => {
  let tmpDir: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    resetReadTracker();
    tmpDir = path.join(currentDir, '.tmp-regress-edit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    ctx = { workspaceRoot: tmpDir, safetyMode: 'auto-apply' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('new_string 中的 $& / $$ / $` 應按字面寫入', async () => {
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'X\n');
    await readFileTool.handler({ path: 'a.txt' }, ctx);

    const result = await editFileTool.handler(
      { path: 'a.txt', old_string: 'X', new_string: '價格 $& 元 $$ 與 $`' },
      ctx
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('價格 $& 元 $$ 與 $`\n');
  });
});

describe('file_search glob（功能）', () => {
  let tmpDir: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.tmp-regress-fs-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(path.join(tmpDir, 'lv1'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'low.txt'), '');
    fs.writeFileSync(path.join(tmpDir, 'lv1', 'low2.txt'), '');
    ctx = { workspaceRoot: tmpDir, safetyMode: 'auto-apply' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('*x* 中間匹配應生效', async () => {
    const result = await fileSearchTool.handler({ pattern: '*low*' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain('low.txt');
    expect(result.output).toContain('low2.txt');
  });

  it('*x* 對目錄也應匹配', async () => {
    const result = await fileSearchTool.handler({ pattern: '*lv*', type: 'directory' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain('lv1');
  });
});

describe('list_directory 路徑驗證（安全/功能）', () => {
  let tmpDir: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.tmp-regress-ls-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sub', 'inner.txt'), '');
    ctx = { workspaceRoot: tmpDir, safetyMode: 'auto-apply' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('相對路徑應以 workspaceRoot 為基準', async () => {
    const result = await listDirectoryTool.handler({ path: 'sub' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain('inner.txt');
  });

  it('工作區外絕對路徑應被拒絕', async () => {
    const result = await listDirectoryTool.handler({ path: 'C:\\Windows' }, ctx);
    expect(result.success).toBe(false);
  });

  it('.. 逃逸應被拒絕', async () => {
    const result = await listDirectoryTool.handler({ path: '../' }, ctx);
    expect(result.success).toBe(false);
  });
});

describe('InputBox Enter 合併 chunk（資料）', () => {
  it('已輸入內容 + 合併的 "x\\r" 應完整提交', () => {
    const box = new InputBox({ width: 80 });
    const submitted: string[] = [];
    box.onSubmit((t) => submitted.push(t));
    box.start();

    box.handleKey('hello');
    box.handleKey('x\r');

    expect(submitted).toEqual(['hellox']);
  });

  it('已輸入內容 + "\\r\\n" 應完整提交', () => {
    const box = new InputBox({ width: 80 });
    const submitted: string[] = [];
    box.onSubmit((t) => submitted.push(t));
    box.start();

    box.handleKey('hello');
    box.handleKey('\r\n');

    expect(submitted).toEqual(['hello']);
  });
});

describe('hooks stdin EOF（穩定性）', () => {
  it('鉤子不讀 stdin 就退出時不應崩潰', async () => {
    const tmpDir = path.join(currentDir, '.tmp-regress-hook-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const runner = new HookRunner(
        { PreToolUse: [{ command: 'node -e "process.exit(0)"' }] },
        tmpDir
      );
      // 大 payload 觸發 socket 寫入
      const big = 'x'.repeat(200_000);
      const result = await runner.runPreToolUse({ tool: 'write_file', params: { path: 'a', content: big } });
      expect(result.blocked).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});

describe('run_command timeout（功能）', () => {
  it('超時應在時限內返回並標記 timedOut', async () => {
    const tmpDir = path.join(currentDir, '.tmp-regress-timeout-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const script = path.join(tmpDir, 'slow.js');
    fs.writeFileSync(script, 'setTimeout(() => {}, 8000);');

    try {
      const policy = getDefaultPolicy();
      policy.maxCommandDurationMs = 500;

      const start = Date.now();
      const result = await runCommandSafe(tmpDir, 'node', [script], policy);
      const elapsed = Date.now() - start;

      expect(result.timedOut).toBe(true);
      expect(elapsed).toBeLessThan(3000); // 遠小於 8 秒
    } finally {
      // 被 taskkill 的進程可能短暫鎖住目錄，稍候再清理，失敗則忽略
      await new Promise((r) => setTimeout(r, 300));
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // 進程尚未完全退出，留待下次；不影響斷言
      }
    }
  }, 15000);
});

describe('shell 注入（安全）', () => {
  it('應攔截單一 | & > <', () => {
    expect(containsShellInjection('a|b')).toBe(true);
    expect(containsShellInjection('a&b')).toBe(true);
    expect(containsShellInjection('a > file')).toBe(true);
    expect(containsShellInjection('a < file')).toBe(true);
  });

  it('重定向字符無條件封鎖（含 => >= <= 繞過情境）', () => {
    // 安全取捨：無條件封鎖 > <，避免 =>file / >=file 在 cmd 中繞過重定向
    expect(containsShellInjection('()=>{}')).toBe(true);
    expect(containsShellInjection('a>=b')).toBe(true);
    expect(containsShellInjection('a<=b')).toBe(true);
    expect(containsShellInjection('=>pwned.txt')).toBe(true);
    expect(containsShellInjection('>=pwned.txt')).toBe(true);
  });

  it('一般命令不受影響', () => {
    expect(containsShellInjection('npm')).toBe(false);
    expect(containsShellInjection('test')).toBe(false);
    expect(containsShellInjection('--coverage')).toBe(false);
  });
});

describe('--mode 無效值降級（安全）', () => {
  it('無效 safetyMode 應降級為 review', () => {
    const config = mergeConfigs({ safetyMode: 'bogus-mode' as never });
    expect(config.safetyMode).toBe('review');
  });

  it('有效 safetyMode 應保留', () => {
    expect(mergeConfigs({ safetyMode: 'plan' }).safetyMode).toBe('plan');
    expect(mergeConfigs({ safetyMode: 'auto-apply' }).safetyMode).toBe('auto-apply');
  });
});
