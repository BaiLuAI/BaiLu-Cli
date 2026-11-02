/**
 * TodoWrite 與後台任務的單元測試
 */

import { describe, it, expect, jest } from '@jest/globals';
import { globalTodoStore } from '../../../src/tools/todo-store.js';
import { todoWriteTool } from '../../../src/tools/implementations/todo_write.js';
import { globalBackgroundTasks } from '../../../src/tools/background-tasks.js';
import path from 'path';
import fs from 'fs';

// Mock chalk（ESM-only）
jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock = {
    cyan: fn,
    green: fn,
    yellow: fn,
    red: fn,
    gray: fn,
    blue: fn,
    bold: { cyan: fn },
  };
  return { __esModule: true, default: chalkMock, ...chalkMock };
});

describe('todo_write 工具', () => {
  beforeEach(() => {
    globalTodoStore.clear();
  });

  it('應該建立有效清單', async () => {
    const result = await todoWriteTool.handler({
      todos: [
        { content: '任務A', status: 'completed' },
        { content: '任務B', status: 'in_progress' },
        { content: '任務C', status: 'pending' },
      ],
    });

    expect(result.success).toBe(true);
    expect(globalTodoStore.getAll()).toHaveLength(3);
  });

  it('多個 in_progress 應該被拒絕', async () => {
    const result = await todoWriteTool.handler({
      todos: [
        { content: 'A', status: 'in_progress' },
        { content: 'B', status: 'in_progress' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('in_progress');
  });

  it('無效狀態應該被拒絕', async () => {
    const result = await todoWriteTool.handler({
      todos: [{ content: 'A', status: 'doing' as never }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('無效的狀態');
  });

  it('空 content 應該被拒絕', async () => {
    const result = await todoWriteTool.handler({
      todos: [{ content: '  ', status: 'pending' }],
    });

    expect(result.success).toBe(false);
  });

  it('summarize 應該產生核取方塊格式', async () => {
    await todoWriteTool.handler({
      todos: [
        { content: '完成項', status: 'completed' },
        { content: '進行項', status: 'in_progress' },
      ],
    });

    const summary = globalTodoStore.summarize();
    expect(summary).toContain('[x] 完成項');
    expect(summary).toContain('[>] 進行項');
  });
});

describe('BackgroundTaskManager', () => {
  const tmpScript = path.join(process.cwd(), '.bg-test-tmp.js');

  afterEach(() => {
    // 清理所有任務
    for (const t of globalBackgroundTasks.list()) {
      if (t.status === 'running') globalBackgroundTasks.kill(t.id);
    }
    if (fs.existsSync(tmpScript)) fs.rmSync(tmpScript, { force: true });
  });

  it('應該啟動任務並回傳 ID', () => {
    fs.writeFileSync(tmpScript, 'console.log("hello-bg");');
    const started = globalBackgroundTasks.start(process.cwd(), 'node', [tmpScript]);

    expect(started.error).toBeUndefined();
    expect(started.taskId).toMatch(/^bg_\d+$/);
  });

  it('應該阻止危險命令', () => {
    const started = globalBackgroundTasks.start(process.cwd(), 'rm', ['-rf', '/']);
    expect(started.error).toContain('安全策略');
  });

  it('應該阻止 shell 注入', () => {
    const started = globalBackgroundTasks.start(process.cwd(), 'node', ['-e', 'a; b']);
    expect(started.error).toContain('不安全的 shell 字符');
  });

  it('任務完成後應該更新狀態與輸出', async () => {
    fs.writeFileSync(tmpScript, 'setTimeout(() => { console.log("done-marker"); }, 200);');
    const started = globalBackgroundTasks.start(process.cwd(), 'node', [tmpScript]);
    const id = started.taskId!;

    await new Promise((r) => setTimeout(r, 600));

    const task = globalBackgroundTasks.getOutput(id)!;
    expect(task).toBeDefined();
    expect(task.status).toBe('completed');
    expect(task.stdout).toContain('done-marker');
    expect(globalBackgroundTasks.formatOutput(task)).toContain('done-marker');
  }, 10000);

  it('kill 應該終止執行中的任務', async () => {
    fs.writeFileSync(tmpScript, 'setInterval(() => {}, 100);');
    const started = globalBackgroundTasks.start(process.cwd(), 'node', [tmpScript]);
    const id = started.taskId!;

    await new Promise((r) => setTimeout(r, 300));

    const killed = globalBackgroundTasks.kill(id);
    expect(killed.success).toBe(true);

    const task = globalBackgroundTasks.getOutput(id)!;
    expect(task.status).toBe('killed');
  }, 10000);

  it('kill 不存在的任務應該報錯', () => {
    const result = globalBackgroundTasks.kill('bg_99999');
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('list 應該回報所有任務', () => {
    fs.writeFileSync(tmpScript, 'setInterval(() => {}, 100);');
    globalBackgroundTasks.start(process.cwd(), 'node', [tmpScript]);

    const list = globalBackgroundTasks.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toMatch(/^bg_\d+$/);
  });
});
