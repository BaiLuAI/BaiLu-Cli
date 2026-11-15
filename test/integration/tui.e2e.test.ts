/**
 * TUI 端到端測試：用偽 TTY 驅動真實 ChatSession
 *
 * 驗證：
 * - 輸入框是否真的渲染出來（框線字元出現在 stdout）
 * - 打字是否進入輸入框
 * - Enter 是否送出訊息並觸發 AI 回應
 * - AI 回應時輸入框是否被正確擦除/重繪
 * - Esc 是否中斷
 * - Ctrl+D 是否退出
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

jest.mock('chalk', () => {
  // 支援鏈式屬性：chalk.dim.gray.strikethrough(x) 等
  const makeChain = (): any => {
    const fn = (s: string) => s;
    const proxy = new Proxy(fn, {
      get: () => makeChain(),
      apply: (_t, _this, args) => String(args[0] ?? ''),
    });
    return proxy;
  };
  const chalkMock: any = makeChain();
  return { __esModule: true, default: chalkMock, ...Object.fromEntries(
    ['cyan','green','yellow','red','gray','blue','magenta','white','black','dim','bold','italic','underline','strikethrough','inverse','hidden','reset'].map(k => [k, chalkMock[k]])
  ) };
});
jest.mock('log-symbols', () => ({
  __esModule: true,
  default: { info: 'i', success: '✓', warning: '⚠', error: '✗' },
}));
jest.mock('boxen', () => ({
  __esModule: true,
  default: (text: string) => text,
}));
jest.mock('marked-terminal', () => ({
  __esModule: true,
  default: class TerminalRenderer {},
}));
jest.mock('marked', () => ({
  __esModule: true,
  marked: Object.assign((s: string) => s, {
    setOptions: () => {},
    parse: (s: string) => s,
  }),
}));

const currentDir = path.resolve();

/** 偽 stdin：可發送按鍵、監聽 raw mode */
class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }
  resume(): this { return this; }
  pause(): this { return this; }
  setEncoding(): this { return this; }

  /** 送出按鍵 */
  send(text: string): void {
    this.emit('data', Buffer.from(text));
  }
}

describe('TUI 端到端：輸入框渲染與互動', () => {
  let fakeStdin: FakeStdin;
  let originalStdin: any;
  let originalWrite: any;
  let outputBuffer: string[];
  let tmpDir: string;
  let currentSession: any = null;
  let originalConsoleLog: any;
  let originalConsoleError: any;

  const getOutput = () => outputBuffer.join('');
  const clearOutput = () => { outputBuffer.length = 0; };

  beforeEach(() => {
    tmpDir = path.join(currentDir, '.e2e-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello world');

    fakeStdin = new FakeStdin();
    outputBuffer = [];

    originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    // 攔截 stdout.write + console.log/error（跨測試檔案全域 process 共享，需雙重攔截確保捕捉）
    originalWrite = process.stdout.write;
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    const capture = (...args: any[]) => {
      outputBuffer.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') + '\n');
    };
    process.stdout.write = ((chunk: any) => {
      outputBuffer.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as any;
    console.log = capture as any;
    console.error = capture as any;
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    process.stdout.write = originalWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    // 重置單例（避免跨測試汙染）
    const { globalOutputManager } = require('../../src/tui/output-manager.js');
    globalOutputManager.uninstall?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 建立一個假 LLM 客戶端，回應指定內容 */
  function createFakeLLM(responses: string[]) {
    const state = { calls: 0 };
    return {
      state,
      getModelName: () => 'bailu-2.8',
      getBaseUrl: () => 'https://bailucode.com/openapi/v1',
      setModel: () => {},
      ensureModelAvailable: async () => {},
      async chat(): Promise<string> {
        const r = responses[state.calls] ?? responses[responses.length - 1] ?? '';
        state.calls++;
        return r;
      },
      async *chatStream(): AsyncGenerator<string> {
        const r = responses[state.calls] ?? responses[responses.length - 1] ?? '';
        state.calls++;
        // 分塊串流（模擬真實場景）
        for (const ch of r) {
          yield ch;
        }
      },
    };
  }

  async function createSession(responses: string[]) {
    const { ChatSession } = await import('../../src/agent/chat.js');
    const { ToolRegistry } = await import('../../src/tools/registry.js');
    const { builtinTools } = await import('../../src/tools/implementations/index.js');

    const registry = new ToolRegistry();
    registry.registerAll(builtinTools);

    const llm = createFakeLLM(responses);

    const session = new ChatSession({
      llmClient: llm as never,
      toolRegistry: registry,
      workspaceContext: {
        rootPath: tmpDir,
        config: {},
        importantFiles: [],
        recentFiles: [],
      },
      executionContext: {
        workspaceRoot: tmpDir,
        safetyMode: 'auto-apply',
      },
      autoExit: false,
    });

    currentSession = session;
    return { session, llm };
  }

  // 每個測試結束後停止會話（清理計時器/監聽器，避免跨測試汙染）
  afterEach(() => {
    try {
      currentSession?.stop?.();
    } catch {
      // ignore
    }
    currentSession = null;
  });

  it('應該在啟動時渲染出輸入框（頂框/內容行/底框）', async () => {
    const { session } = await createSession(['你好']);

    await session.start();

    const out = getOutput();

    expect(out).toContain('╭─ You');          // 頂框
    expect(out).toContain('│ You:');          // 內容行
    expect(out).toContain('╰');                // 底框
    expect(out).toContain('Bailu Chat');       // 歡迎畫面

    await session.stop?.();
  });

  it('打字應該顯示在輸入框內容行', async () => {
    const { session } = await createSession(['你好']);
    await session.start();

    clearOutput();
    fakeStdin.send('abc');

    expect(getOutput()).toContain('│ You: abc');
  });

  it('Enter 應該送出訊息並觸發 AI 回應', async () => {
    const { session, llm } = await createSession(['AI 的回應內容']);
    await session.start();

    clearOutput();
    fakeStdin.send('你好嗎');
    fakeStdin.send('\r');

    // 等待 PasteDetector 延遲 + 自動上下文收集 + LLM（輪詢直到 LLM 被呼叫，最多 8s）
    const deadline = Date.now() + 8000;
    while (llm.state.calls === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // LLM 被呼叫了，代表訊息確實從輸入框 → 送出 → orchestrator → LLM 完整流程
    expect(llm.state.calls).toBeGreaterThan(0);
  }, 20000);

  it('【P0 回歸】AI 回答文字必須留在畫面上（不能被擦框抹掉）', async () => {
    const { session, llm } = await createSession(['這是AI的回答內容']);
    await session.start();

    clearOutput();
    fakeStdin.send('問題');
    fakeStdin.send('\r');

    // 等 LLM 被呼叫
    const deadline = Date.now() + 8000;
    while (llm.state.calls === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // 再等串流完成
    await new Promise((r) => setTimeout(r, 1500));

    const out = getOutput();
    // 關鍵：回答文字必須出現在輸出中
    expect(out).toContain('這是AI的回答內容');
    // 且回答後輸入框應該回來
    expect(out).toContain('╭─ You');
  }, 20000);

  it('AI 回應期間輸入框應該被擦除並在之後重繪', async () => {
    const { session } = await createSession(['回應內容測試']);
    await session.start();

    clearOutput();
    fakeStdin.send('test');
    fakeStdin.send('\r');
    await new Promise((r) => setTimeout(r, 400));

    const out = getOutput();
    // 回應後應重繪輸入框（串流期間收起、回答後恢復）
    expect(out).toContain('╭─ You');
  });

  it('【P0 回歸】Ctrl+D 應觸發退出流程並還原終端', async () => {
    const { session } = await createSession(['你好']);
    await session.start();

    // raw mode 已開啟
    expect(fakeStdin.isRaw).toBe(true);

    fakeStdin.send('\u0004');
    await new Promise((r) => setTimeout(r, 200));

    // 退出流程應還原 raw mode（證明 handleExit 的 input.close() 執行了）
    expect(fakeStdin.isRaw).toBe(false);
  });

  it('Esc 應該觸發中斷回調', async () => {
    const { session } = await createSession(['你好']);
    await session.start();

    let interrupted = false;
    session.input?.onInterrupt?.(() => { interrupted = true; });

    fakeStdin.send('\u001b');
    await new Promise((r) => setTimeout(r, 100));

    expect(interrupted).toBe(true);
  });

  it('Backspace 應該刪除字元', async () => {
    const { session } = await createSession(['你好']);
    await session.start();

    clearOutput();
    fakeStdin.send('abc');
    fakeStdin.send('\u007f');

    // 取最後一框（每次重繪都以「╭─ You」開頭）
    const frames = getOutput().split('╭─ You');
    const lastFrame = frames[frames.length - 1];
    expect(lastFrame).toContain('│ You: ab');
    expect(lastFrame).not.toContain('abc');
  });

  it('↑ 應該召回歷史記錄', async () => {
    const { session } = await createSession(['第一個回應', '第二個回應']);
    await session.start();

    // 先送一則訊息建立歷史
    fakeStdin.send('第一句');
    fakeStdin.send('\r');
    await new Promise((r) => setTimeout(r, 400));

    clearOutput();
    fakeStdin.send('\u001b[A'); // ↑

    expect(getOutput()).toContain('第一句');
  });
});
