/**
 * @ 檔案提及單元測試：提取、解析、上下文組裝、路徑補全
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

import {
  extractMentions,
  resolveMentions,
  buildMentionContext,
  findPathCompletions,
} from '../../../src/agent/file-mentions.js';

const currentDir = path.resolve();

describe('extractMentions', () => {
  it('應該提取所有 @ 標記', () => {
    expect(extractMentions('看看 @src/config.ts 和 @README.md')).toEqual([
      'src/config.ts',
      'README.md',
    ]);
  });

  it('無提及時回傳空陣列', () => {
    expect(extractMentions('普通訊息，郵箱 user@example.com 不算')).toEqual([]);
  });

  it('重複提及保留原樣（去重在 resolve 階段）', () => {
    expect(extractMentions('@a.ts @a.ts')).toEqual(['a.ts', 'a.ts']);
  });
});

describe('resolveMentions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.mention-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('應該讀取檔案內容', () => {
    const results = resolveMentions(['src/a.ts'], tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].content).toContain('export const a = 1;');
    expect(results[0].relativePath).toBe('src/a.ts');
  });

  it('目錄應該列出結構', () => {
    const results = resolveMentions(['src'], tmpDir);
    expect(results[0].ok).toBe(true);
    expect(results[0].content).toContain('src/a.ts');
  });

  it('不存在的檔案應該報錯', () => {
    const results = resolveMentions(['nope.ts'], tmpDir);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('不存在');
  });

  it('工作區外的路徑應該被阻擋', () => {
    const results = resolveMentions(['../../../etc/passwd'], tmpDir);
    expect(results[0].ok).toBe(false);
  });

  it('重複提及應該去重', () => {
    const results = resolveMentions(['src/a.ts', 'src/a.ts'], tmpDir);
    expect(results).toHaveLength(1);
  });

  it('過長檔案應該截斷', () => {
    fs.writeFileSync(path.join(tmpDir, 'big.txt'), 'x'.repeat(60 * 1024));
    const results = resolveMentions(['big.txt'], tmpDir);
    expect(results[0].content!.length).toBeLessThan(60 * 1024);
    expect(results[0].content).toContain('已截斷');
  });
});

describe('buildMentionContext', () => {
  it('應該組裝成功與失敗的結果', () => {
    const context = buildMentionContext([
      { raw: 'a.ts', absolutePath: '/x/a.ts', relativePath: 'a.ts', ok: true, content: 'hello' },
      { raw: 'nope', absolutePath: '/x/nope', relativePath: 'nope', ok: false, error: '檔案不存在' },
    ]);
    expect(context).toContain('[附帶檔案: a.ts]');
    expect(context).toContain('hello');
    expect(context).toContain('⚠️ 檔案不存在');
  });
});

describe('findPathCompletions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.compl-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, 'src', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'config.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'deep', 'util.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('應該按部分路徑匹配', () => {
    const matches = findPathCompletions('config', tmpDir);
    expect(matches).toContain('src/config.ts');
  });

  it('應該排除 node_modules 與隱藏目錄', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'x.ts'), '');
    const matches = findPathCompletions('x', tmpDir);
    expect(matches.every((m) => !m.includes('node_modules'))).toBe(true);
  });

  it('目錄應該帶斜線後綴', () => {
    const matches = findPathCompletions('deep', tmpDir);
    expect(matches).toContain('src/deep/');
  });

  it('空部分路徑應該列出頂層項目', () => {
    const matches = findPathCompletions('', tmpDir, 5);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches).toContain('README.md');
  });
});
