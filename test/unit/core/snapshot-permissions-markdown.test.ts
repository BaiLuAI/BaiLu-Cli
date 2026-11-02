/**
 * 核心模組單元測試：SnapshotStore、權限規則、Markdown 串流格式化器
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock chalk（ESM-only）
jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock = {
    cyan: fn, green: fn, yellow: fn, red: fn, gray: fn, blue: fn,
    bold: { cyan: fn },
  };
  return { __esModule: true, default: chalkMock, ...chalkMock };
});

import { SnapshotStore } from '../../../src/fs/snapshot.js';
import { parseRule, matchRule, checkPermissions } from '../../../src/runtime/permissions.js';
import { StreamingMarkdownFormatter } from '../../../src/utils/markdown-stream.js';

const currentDir = path.resolve();

describe('SnapshotStore', () => {
  let tmpDir: string;
  let store: SnapshotStore;
  let testFile: string;

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.snap-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new SnapshotStore(tmpDir);
    testFile = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(testFile, 'v1');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('建立快照並還原最新版本', async () => {
    await store.create(testFile);
    fs.writeFileSync(testFile, 'v2');
    await store.create(testFile);
    fs.writeFileSync(testFile, 'v3');

    const restored = await store.restoreLatest();
    expect(restored?.relativePath).toBe('a.txt');
    expect(fs.readFileSync(testFile, 'utf8')).toBe('v2');

    const restored2 = await store.restoreLatest();
    expect(fs.readFileSync(testFile, 'utf8')).toBe('v1');

    const restored3 = await store.restoreLatest();
    expect(restored3).toBeNull();
  });

  it('新檔案的快照還原時應該刪除檔案', async () => {
    const newFile = path.join(tmpDir, 'new.txt');
    await store.create(newFile); // 不存在 → existed=false
    fs.writeFileSync(newFile, 'created');

    await store.restoreLatest();
    expect(fs.existsSync(newFile)).toBe(false);
  });

  it('restoreById 應該還原指定快照並移除後續快照', async () => {
    const s1 = await store.create(testFile);
    fs.writeFileSync(testFile, 'v2');
    await store.create(testFile);
    fs.writeFileSync(testFile, 'v3');

    const restored = await store.restoreById(s1.id);
    expect(restored?.id).toBe(s1.id);
    expect(fs.readFileSync(testFile, 'utf8')).toBe('v1');

    // 快照清單應該只剩空
    const list = await store.list();
    expect(list).toHaveLength(0);
  });
});

describe('權限規則', () => {
  it('解析 Bash 前綴規則', () => {
    const rule = parseRule('Bash(npm test:*)');
    expect(rule).toEqual({ tool: 'run_command', pattern: 'npm test', isPrefix: true });
  });

  it('解析 Bash 精確規則', () => {
    const rule = parseRule('Bash(git status)');
    expect(rule).toEqual({ tool: 'run_command', pattern: 'git status', isPrefix: false });
  });

  it('解析純工具名規則', () => {
    expect(parseRule('read_file')).toEqual({ tool: 'read_file', pattern: '', isPrefix: false });
    expect(parseRule('')).toBeNull();
  });

  it('前綴規則匹配命令', () => {
    const rule = parseRule('Bash(npm test:*)')!;
    expect(matchRule(rule, { tool: 'run_command', params: { command: 'npm test' } })).toBe(true);
    expect(matchRule(rule, { tool: 'run_command', params: { command: 'npm test --watch' } })).toBe(true);
    expect(matchRule(rule, { tool: 'run_command', params: { command: 'npmx test' } })).toBe(false);
  });

  it('deny 優先於 allow', () => {
    const decision = checkPermissions(
      ['Bash(npm:*)'],
      ['Bash(npm publish)'],
      { tool: 'run_command', params: { command: 'npm publish' } }
    );
    expect(decision).toBe('denied');
  });

  it('allow 匹配時回傳 allowed', () => {
    const decision = checkPermissions(
      ['Bash(npm test:*)'],
      [],
      { tool: 'run_command', params: { command: 'npm test' } }
    );
    expect(decision).toBe('allowed');
  });

  it('未匹配時回傳 ask', () => {
    const decision = checkPermissions(
      ['Bash(npm test:*)'],
      [],
      { tool: 'run_command', params: { command: 'git push' } }
    );
    expect(decision).toBe('ask');
  });
});

describe('StreamingMarkdownFormatter', () => {
  it('渲染粗體', () => {
    const f = new StreamingMarkdownFormatter();
    expect(f.feed('**bold**')).toBe('\u001b[1mbold\u001b[0m');
  });

  it('跨 chunk 的粗體', () => {
    const f = new StreamingMarkdownFormatter();
    const out = f.feed('我是') + f.feed('**白鹿') + f.feed('**，你好');
    expect(out).toBe('我是\u001b[1m白鹿\u001b[0m，你好');
  });

  it('渲染行內代碼', () => {
    const f = new StreamingMarkdownFormatter();
    expect(f.feed('用 `npm test` 跑')).toBe('用 \u001b[36mnpm test\u001b[0m 跑');
  });

  it('未閉合標記 flush 時回退原文', () => {
    const f = new StreamingMarkdownFormatter();
    const out = f.feed('未閉合 **粗體') + f.flush();
    expect(out).toBe('未閉合 **粗體');
  });

  it('單個星號按原文輸出', () => {
    const f = new StreamingMarkdownFormatter();
    const out = f.feed('5 * 3 = 15') + f.flush();
    expect(out).toBe('5 * 3 = 15');
  });
});
