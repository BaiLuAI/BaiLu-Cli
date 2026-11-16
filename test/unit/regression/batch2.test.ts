/**
 * 第二批子代理發現的 bug 回歸測試
 * - git 狀態首個檔案路徑吞字
 * - 分層記憶/配置未注入 system prompt
 * - StreamingMarkdownFormatter 未閉合標記回退（B2/B3）
 * - StreamingPanel ASCII 粗體上色（B1）
 * - web_fetch 段落換行保留 / XHTML / 負數 max_length
 * - web_search 分組型 RelatedTopics
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock: any = new Proxy(fn, { get: () => chalkMock, apply: (_t, _th, a) => String(a[0] ?? '') });
  return { __esModule: true, default: chalkMock, ...chalkMock };
});
jest.mock('log-symbols', () => ({ __esModule: true, default: { info: 'i', success: '✓', warning: '⚠', error: '✗' } }));

import { getGitSummary } from '../../../src/git/integration.js';
import { buildSystemPrompt } from '../../../src/agent/system-prompt.js';
import { StreamingMarkdownFormatter } from '../../../src/utils/markdown-stream.js';
import { StreamingPanel } from '../../../src/utils/streaming-panel.js';
import { webFetchTool } from '../../../src/tools/implementations/web_fetch.js';
import { webSearchTool } from '../../../src/tools/implementations/web_search.js';
import { WorkspaceContext } from '../../../src/agent/types.js';

const currentDir = path.resolve();

describe('git 狀態路徑（回歸）', () => {
  let repo: string;

  beforeEach(() => {
    repo = path.join(currentDir, '.tmp-git-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(repo, { recursive: true });
    execSync('git init -q', { cwd: repo });
    execSync('git config user.email t@t.t', { cwd: repo });
    execSync('git config user.name t', { cwd: repo });
    fs.writeFileSync(path.join(repo, 'a.ts'), 'x');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'y');
    execSync('git add . && git commit -q -m init', { cwd: repo });
    // 修改兩個檔案（未暫存）
    fs.writeFileSync(path.join(repo, 'a.ts'), 'xx');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'yy');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('首個變動檔案路徑不應被吞字', () => {
    const summary = getGitSummary(repo);
    const paths = summary.status.map((s) => s.path);
    expect(paths).toContain('a.ts');
    expect(paths).toContain('b.ts');
    // 不應出現被截斷的 ".ts"
    expect(paths).not.toContain('.ts');
  });
});

describe('system prompt 注入記憶與配置（回歸）', () => {
  const baseCtx: WorkspaceContext = {
    rootPath: currentDir,
    config: {},
    importantFiles: [],
  };

  it('應注入專案記憶 agentDoc', () => {
    const prompt = buildSystemPrompt({
      ...baseCtx,
      agentDoc: '專案規則：使用 pnpm，禁止 any。',
    });
    expect(prompt).toContain('專案記憶');
    expect(prompt).toContain('使用 pnpm');
  });

  it('應注入 .bailu.yml 的 testCommand', () => {
    const prompt = buildSystemPrompt({
      ...baseCtx,
      config: { testCommand: 'npm test', buildCommand: 'npm run build' },
    });
    expect(prompt).toContain('testCommand');
    expect(prompt).toContain('npm test');
  });

  it('應注入重要文件清單', () => {
    const prompt = buildSystemPrompt({
      ...baseCtx,
      importantFiles: ['src/index.ts', 'README.md'],
    });
    expect(prompt).toContain('重要文件');
    expect(prompt).toContain('src/index.ts');
  });
});

describe('StreamingMarkdownFormatter 未閉合回退（回歸 B2/B3）', () => {
  it('純 ** 結尾應保留', () => {
    const f = new StreamingMarkdownFormatter();
    const out = f.feed('x **') + f.flush();
    expect(out).toBe('x **');
  });

  it('未閉合行內代碼應保留開頭反引號', () => {
    const f = new StreamingMarkdownFormatter();
    const out = f.feed('未閉合 `code') + f.flush();
    expect(out).toContain('`code');
  });

  it('未閉合粗體應回退原文', () => {
    const f = new StreamingMarkdownFormatter();
    const out = f.feed('未閉合 **粗體') + f.flush();
    expect(out).toBe('未閉合 **粗體');
  });
});

describe('StreamingPanel ASCII 粗體上色（回歸 B1）', () => {
  it('ANSI 起始碼應緊接內容（不被單字緩衝打亂）', () => {
    const captured: string[] = [];
    const realWrite = process.stdout.write;
    process.stdout.write = ((c: any) => { captured.push(String(c)); return true; }) as any;
    try {
      const panel = new StreamingPanel({ title: 'AI', maxWidth: 60 });
      panel.start();
      panel.write('**bold**');
      panel.end();
    } finally {
      process.stdout.write = realWrite;
    }
    const out = captured.join('');
    // 正確順序：\x1b[1m 緊接 bold 再 \x1b[0m
    expect(out).toContain('\u001b[1mbold\u001b[0m');
    // 不應出現 RESET 插在起始碼與內容之間
    expect(out).not.toContain('\u001b[1m\u001b[0mbold');
  });
});

describe('web_fetch 段落結構與邊界（回歸）', () => {
  let server: any;
  let port: number;

  beforeEach(async () => {
    const http = await import('http');
    server = http.createServer((req, res) => {
      if (req.url === '/xhtml') {
        res.writeHead(200, { 'Content-Type': 'application/xhtml+xml' });
        res.end('<html><body><p>XHTML 段落一</p><p>段落二</p></body></html>');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>標題</h1><p>第一段</p><p>第二段</p><script>bad()</script></body></html>');
      }
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = server.address().port;
  });

  afterEach(() => {
    server?.close();
  });

  it('段落應保留換行（不壓成一行）', async () => {
    const result = await webFetchTool.handler({ url: `http://127.0.0.1:${port}/` });
    expect(result.success).toBe(true);
    expect(result.output).toContain('第一段');
    expect(result.output).toContain('第二段');
    // 兩段之間應有換行
    expect(result.output).toMatch(/第一段\s*\n\s*第二段/);
    // script 內容被移除
    expect(result.output).not.toContain('bad()');
  });

  it('XHTML 應可抓取', async () => {
    const result = await webFetchTool.handler({ url: `http://127.0.0.1:${port}/xhtml` });
    expect(result.success).toBe(true);
    expect(result.output).toContain('XHTML 段落一');
  });

  it('負數 max_length 不應清空內容', async () => {
    const result = await webFetchTool.handler({ url: `http://127.0.0.1:${port}/`, max_length: -5 });
    expect(result.success).toBe(true);
    expect(result.output).toContain('第一段');
  });
});

describe('web_search 分組型 RelatedTopics（回歸）', () => {
  it('分組 {Name, Topics} 應被展平輸出', async () => {
    const realFetch = global.fetch;
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        AbstractText: '',
        RelatedTopics: [
          { Name: 'Group A', Topics: [{ Text: '子主題一', FirstURL: 'https://a1' }, { Text: '子主題二', FirstURL: 'https://a2' }] },
          { Text: '單一主題', FirstURL: 'https://b1' },
        ],
        Results: [],
      }),
    })) as any;

    try {
      const result = await webSearchTool.handler({ query: 'test', num_results: 5 });
      expect(result.success).toBe(true);
      expect(result.output).toContain('子主題一');
      expect(result.output).toContain('子主題二');
      expect(result.output).toContain('單一主題');
    } finally {
      global.fetch = realFetch;
    }
  });
});
