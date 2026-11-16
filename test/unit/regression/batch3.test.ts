/**
 * 第三批（P2/P3）修復回歸測試
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock: any = new Proxy(fn, { get: () => chalkMock, apply: (_t, _th, a) => String(a[0] ?? '') });
  return { __esModule: true, default: chalkMock, ...chalkMock };
});
jest.mock('log-symbols', () => ({ __esModule: true, default: { info: 'i', success: '✓', warning: '⚠', error: '✗' } }));

import { InputBox } from '../../../src/tui/input-box.js';
import { getStringWidth } from '../../../src/utils/terminal-width.js';
import { readFileTool } from '../../../src/tools/implementations/read_file.js';
import { listDirectoryTool } from '../../../src/tools/implementations/list_directory.js';
import { grepSearchTool } from '../../../src/tools/implementations/grep_search.js';
import { resetReadTracker } from '../../../src/tools/read-tracker.js';
import { ContextCompactor } from '../../../src/agent/context-compactor.js';
import { extractMentions } from '../../../src/agent/file-mentions.js';
import { getOutputOptions, setOutputOptions } from '../../../src/utils/output.js';
import { mergeConfigs } from '../../../src/config.js';
import { buildWorkspaceContext } from '../../../src/agent/context.js';
import { ToolExecutionContext } from '../../../src/tools/types.js';

const currentDir = path.resolve();

describe('InputBox 窄終端（回歸）', () => {
  it('處理中狀態在窄終端不超寬', () => {
    for (const width of [24, 30, 39, 42]) {
      const box = new InputBox({ width });
      let last: any = null;
      box.onRedraw((r) => { last = r; });
      box.start();
      box.pause();
      expect(getStringWidth(last.top)).toBeLessThanOrEqual(width);
      expect(getStringWidth(last.bottom)).toBeLessThanOrEqual(width);
    }
  });
});

describe('read_file 行數與越界（回歸）', () => {
  let tmpDir: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    resetReadTracker();
    tmpDir = path.join(currentDir, '.tmp-b3-read-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    ctx = { workspaceRoot: tmpDir, safetyMode: 'auto-apply' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('以換行結尾的檔案行數不應多算 1', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'l1\nl2\nl3\n');
    const result = await readFileTool.handler({ path: 'a.txt' }, ctx);
    expect(result.success).toBe(true);
    expect(result.metadata?.totalLines).toBe(3);
  });

  it('start_line 越界應報錯', async () => {
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'l1\nl2\n');
    const result = await readFileTool.handler({ path: 'b.txt', start_line: 100 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('超出');
  });
});

describe('list_directory max_depth（回歸）', () => {
  let tmpDir: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.tmp-b3-ls-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(path.join(tmpDir, 'a', 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a', 'b', 'c', 'deep.txt'), '');
    ctx = { workspaceRoot: tmpDir, safetyMode: 'auto-apply' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('max_depth=1 不應列出更深層', async () => {
    const result = await listDirectoryTool.handler({ path: '.', recursive: true, max_depth: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('deep.txt');
  });

  it('max_depth 足夠時列出深層', async () => {
    const result = await listDirectoryTool.handler({ path: '.', recursive: true, max_depth: 5 }, ctx);
    expect(result.output).toContain('deep.txt');
  });
});

describe('grep_search 上下文行（回歸）', () => {
  let tmpDir: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.tmp-b3-grep-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'before1\nbefore2\nMATCH\n');
    ctx = { workspaceRoot: tmpDir, safetyMode: 'auto-apply' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('應輸出匹配行之前的上下文', async () => {
    const result = await grepSearchTool.handler({ pattern: 'MATCH' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain('MATCH');
    expect(result.output).toContain('before1');
  });
});

describe('compressNow 防變大（回歸）', () => {
  it('壓縮後不變小應回 null 並還原訊息', async () => {
    const fakeLLM = { chat: async () => '摘要內容' } as never;
    const compactor = new ContextCompactor(fakeLLM, false);
    const messages: any[] = [
      { role: 'system', content: 's' },
      ...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })),
    ];
    const before = messages.map((m) => m.content);
    const result = await compactor.compressNow(messages, 'bailu-2.8');
    // 極短訊息壓縮後可能不變小 → null，且訊息被還原
    if (result === null) {
      expect(messages.map((m) => m.content)).toEqual(before);
    } else {
      expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    }
  });
});

describe('@ 提及中文無空格（回歸）', () => {
  it('「看@src/a.ts」應觸發', () => {
    expect(extractMentions('看@src/a.ts')).toEqual(['src/a.ts']);
  });
  it('括號包覆應觸發', () => {
    expect(extractMentions('(@file.ts)')).toEqual(['file.ts']);
  });
  it('郵箱仍不誤觸發', () => {
    expect(extractMentions('user@example.com')).toEqual([]);
  });
});

describe('getOutputOptions 回傳副本（回歸）', () => {
  it('修改回傳值不應污染全局', () => {
    setOutputOptions({ quiet: false, json: false });
    const opts = getOutputOptions();
    opts.quiet = true;
    expect(getOutputOptions().quiet).toBe(false);
  });
});

describe('maxIterations NaN 降級（回歸）', () => {
  it('NaN 應回退為 50', () => {
    const config = mergeConfigs({ maxIterations: NaN });
    expect(config.maxIterations).toBe(50);
  });
  it('負數應回退為 50', () => {
    expect(mergeConfigs({ maxIterations: -1 }).maxIterations).toBe(50);
  });
});

describe('.bailu.local.yml 深合併（回歸）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.tmp-b3-ctx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('permissions 應深合併而非整個替換', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.bailu.yml'),
      'permissions:\n  allow:\n    - "Bash(npm test:*)"\n  deny:\n    - "Bash(rm:*)"\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.bailu.local.yml'),
      'permissions:\n  allow:\n    - "Bash(git status)"\n'
    );
    const ctx = buildWorkspaceContext(tmpDir);
    // local 覆蓋 allow，但 deny 應保留
    expect(ctx.config.permissions?.allow).toEqual(['Bash(git status)']);
    expect(ctx.config.permissions?.deny).toEqual(['Bash(rm:*)']);
  });
});
