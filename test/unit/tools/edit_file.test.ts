/**
 * edit_file 工具與先讀後寫強制的單元測試
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { editFileTool } from '../../../src/tools/implementations/edit_file.js';
import { readFileTool } from '../../../src/tools/implementations/read_file.js';
import { resetReadTracker, wasFileRead } from '../../../src/tools/read-tracker.js';
import { ToolExecutionContext } from '../../../src/tools/types.js';

const currentDir = path.resolve();

// Mock chalk（ESM-only，Jest 無法直接載入）
jest.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    gray: (s: string) => s,
    bold: (s: string) => s,
    blue: (s: string) => s,
  },
}));

describe('edit_file 工具', () => {
  let tmpDir: string;
  let testFile: string;
  const ctx: ToolExecutionContext = {
    workspaceRoot: '',
    safetyMode: 'auto-apply',
  };

  beforeEach(() => {
    resetReadTracker();
    // 注意：不能用 os.tmpdir()（位於 LocalAppData，會被路徑驗證的敏感目錄檢查擋掉）
    tmpDir = path.join(currentDir, '.tmp-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    ctx.workspaceRoot = tmpDir;
    testFile = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(testFile, 'function hello() {\n  console.log("hello");\n}\n\nfunction world() {\n  console.log("world");\n}\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('應該成功替換唯一匹配', async () => {
    await readFileTool.handler({ path: 'test.ts' }, ctx);

    const result = await editFileTool.handler(
      { path: 'test.ts', old_string: 'console.log("hello");', new_string: 'console.log("hi");' },
      ctx
    );

    expect(result.success).toBe(true);
    const updated = fs.readFileSync(testFile, 'utf8');
    expect(updated).toContain('console.log("hi");');
    expect(updated).not.toContain('console.log("hello");');
    expect(updated).toContain('console.log("world");'); // 其他內容不變
  });

  it('未先讀取時應該拒絕編輯（先讀後寫強制）', async () => {
    const result = await editFileTool.handler(
      { path: 'test.ts', old_string: 'hello', new_string: 'hi' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('先讀取');
    // 檔案未被修改
    expect(fs.readFileSync(testFile, 'utf8')).toContain('hello');
  });

  it('old_string 找不到匹配時應該報錯', async () => {
    await readFileTool.handler({ path: 'test.ts' }, ctx);

    const result = await editFileTool.handler(
      { path: 'test.ts', old_string: '不存在的內容', new_string: 'x' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('找不到匹配');
  });

  it('匹配多處且未設 replace_all 時應該報錯', async () => {
    fs.writeFileSync(testFile, 'foo\nfoo\nfoo\n');
    await readFileTool.handler({ path: 'test.ts' }, ctx);

    const result = await editFileTool.handler(
      { path: 'test.ts', old_string: 'foo', new_string: 'bar' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('3');
    expect(fs.readFileSync(testFile, 'utf8')).toBe('foo\nfoo\nfoo\n');
  });

  it('replace_all=true 應該替換所有匹配', async () => {
    fs.writeFileSync(testFile, 'foo\nfoo\nfoo\n');
    await readFileTool.handler({ path: 'test.ts' }, ctx);

    const result = await editFileTool.handler(
      { path: 'test.ts', old_string: 'foo', new_string: 'bar', replace_all: true },
      ctx
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf8')).toBe('bar\nbar\nbar\n');
  });

  it('new_string 為空字串應該刪除文本', async () => {
    await readFileTool.handler({ path: 'test.ts' }, ctx);

    const result = await editFileTool.handler(
      { path: 'test.ts', old_string: '\nfunction world() {\n  console.log("world");\n}\n', new_string: '' },
      ctx
    );

    expect(result.success).toBe(true);
    const updated = fs.readFileSync(testFile, 'utf8');
    expect(updated).not.toContain('world');
    expect(updated).toContain('hello');
  });

  it('old_string 等於 new_string 時應該報錯', async () => {
    await readFileTool.handler({ path: 'test.ts' }, ctx);

    const result = await editFileTool.handler(
      { path: 'test.ts', old_string: 'same', new_string: 'same' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('相同');
  });

  it('檔案不存在時應該提示用 write_file', async () => {
    await readFileTool.handler({ path: 'test.ts' }, ctx).catch(() => undefined);

    const result = await editFileTool.handler(
      { path: 'not-exist.ts', old_string: 'a', new_string: 'b' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('write_file');
  });

  it('read-tracker 應該正確標記與查詢', async () => {
    resetReadTracker();
    expect(wasFileRead(testFile)).toBe(false);

    await readFileTool.handler({ path: 'test.ts' }, ctx);
    expect(wasFileRead(testFile)).toBe(true);
  });
});
