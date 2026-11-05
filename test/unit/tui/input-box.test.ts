/**
 * InputBox（TUI 輸入框）單元測試：按鍵處理、歷史、水平滾動、渲染
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const chalkMock = {
    cyan: fn, green: fn, yellow: fn, red: fn, gray: fn, blue: fn,
    bold: Object.assign(fn, { cyan: fn }),
  };
  return { __esModule: true, default: chalkMock, ...chalkMock };
});

import { InputBox } from '../../../src/tui/input-box.js';

describe('InputBox 按鍵處理', () => {
  let box: InputBox;

  beforeEach(() => {
    box = new InputBox({ width: 80 });
    box.start();
  });

  it('可打印字符應該插入緩衝區', () => {
    box.handleKey('h');
    box.handleKey('i');
    expect(box.getText()).toBe('hi');
    expect(box.getCursor()).toBe(2);
  });

  it('Enter 應該提交並清空緩衝區', () => {
    const submitted: string[] = [];
    box.onSubmit((t) => submitted.push(t));

    box.handleKey('hello');
    box.handleKey('\r');

    expect(submitted).toEqual(['hello']);
    expect(box.getText()).toBe('');
  });

  it('空緩衝區 Enter 不提交', () => {
    const submitted: string[] = [];
    box.onSubmit((t) => submitted.push(t));

    box.handleKey('\r');
    expect(submitted).toHaveLength(0);
  });

  it('Backspace 應該刪除光標前字符', () => {
    box.handleKey('abc');
    box.handleKey('\u007f');
    expect(box.getText()).toBe('ab');
    expect(box.getCursor()).toBe(2);
  });

  it('光標移動後 Backspace 應該刪除光標前字符', () => {
    box.handleKey('abc');
    box.handleKey('\u001b[D'); // ←
    box.handleKey('\u001b[D'); // ←（光標在 a 和 b 之間）
    box.handleKey('\u007f'); // 刪除 a
    expect(box.getText()).toBe('bc');
    expect(box.getCursor()).toBe(0);
  });

  it('Delete 應該刪除光標處字符', () => {
    box.handleKey('abc');
    box.handleKey('\u001b[D');
    box.handleKey('\u001b[D');
    box.handleKey('\u001b[3~'); // Delete 刪除 b
    expect(box.getText()).toBe('ac');
    expect(box.getCursor()).toBe(1);
  });

  it('Home/End 應該移動光標到首尾', () => {
    box.handleKey('abc');
    box.handleKey('\u001b[H');
    expect(box.getCursor()).toBe(0);
    box.handleKey('\u001b[F');
    expect(box.getCursor()).toBe(3);
  });

  it('中文與 emoji 應該按碼點處理', () => {
    box.handleKey('你好');
    box.handleKey('\u{1F600}');
    expect(box.getText()).toBe('你好\u{1F600}');
    expect(box.getCursor()).toBe(3);
    box.handleKey('\u007f');
    expect(box.getText()).toBe('你好');
  });

  it('單獨 Esc 應該觸發中斷', () => {
    let interrupted = false;
    box.onInterrupt(() => { interrupted = true; });

    box.handleKey('\u001b');
    expect(interrupted).toBe(true);
  });

  it('方向鍵序列不應該誤觸發中斷', () => {
    let interrupted = false;
    box.onInterrupt(() => { interrupted = true; });

    box.handleKey('\u001b[A');
    box.handleKey('\u001b[B');
    box.handleKey('\u001b[C');
    box.handleKey('\u001b[D');
    expect(interrupted).toBe(false);
  });

  it('Ctrl+C 空緩衝區應該請求退出', () => {
    let exit = false;
    box.onExit(() => { exit = true; });

    box.handleKey('\u0003');
    expect(exit).toBe(true);
  });

  it('Ctrl+C 有內容時應該清空緩衝區', () => {
    box.handleKey('hello');
    box.handleKey('\u0003');
    expect(box.getText()).toBe('');
  });

  it('多行貼上應該整段提交為一則訊息', () => {
    const submitted: string[] = [];
    box.onSubmit((t) => submitted.push(t));

    box.handleKey('第一行\n第二行\n第三行');
    expect(submitted).toEqual(['第一行\n第二行\n第三行']);
  });

  it('未 start 時應該忽略按鍵', () => {
    const closed = new InputBox({ width: 80 });
    closed.handleKey('abc');
    expect(closed.getText()).toBe('');
  });
});

describe('InputBox 歷史記錄', () => {
  let box: InputBox;

  beforeEach(() => {
    box = new InputBox({ width: 80, history: ['first', 'second'] });
    box.start();
  });

  it('↑ 應該召回最後一條歷史', () => {
    box.handleKey('\u001b[A');
    expect(box.getText()).toBe('second');
  });

  it('↑↑ 應該召回倒數第二條', () => {
    box.handleKey('\u001b[A');
    box.handleKey('\u001b[A');
    expect(box.getText()).toBe('first');
  });

  it('↓ 回到末尾後應該恢復未保存的輸入', () => {
    box.handleKey('draft');
    box.handleKey('\u001b[A'); // second
    box.handleKey('\u001b[B'); // ↓ 回到 draft
    expect(box.getText()).toBe('draft');
  });

  it('提交後歷史應該更新', () => {
    box.handleKey('new entry');
    box.handleKey('\r');
    box.handleKey('\u001b[A');
    expect(box.getText()).toBe('new entry');
  });
});

describe('InputBox 渲染', () => {
  it('應該渲染三行框線與提示符', () => {
    const box = new InputBox({ width: 60 });
    const rendered: string[] = [];
    box.onRedraw((r) => rendered.push(`${r.top}\n${r.line}\n${r.bottom}`));

    box.start();
    box.handleKey('hello');

    expect(rendered.length).toBeGreaterThan(0);
    const last = rendered[rendered.length - 1];
    expect(last).toContain('╭─');
    expect(last).toContain('│ You: hello');
    expect(last).toContain('╰');
  });

  it('暫停狀態應該顯示處理中', () => {
    const box = new InputBox({ width: 60 });
    let lastRender = '';
    box.onRedraw((r) => { lastRender = r.top; });

    box.start();
    box.pause();
    expect(lastRender).toContain('處理中');
    box.resume();
    expect(lastRender).toContain('You');
  });

  it('長文本應該水平滾動且光標可見', () => {
    const box = new InputBox({ width: 40 });
    box.start();

    // 輸入超過寬度的文本
    const longText = 'a'.repeat(100);
    box.handleKey(longText);

    const { content, cursorCol } = box.computeContentLine();
    // 內容不超過可用寬度
    expect(content.length).toBeLessThan(50);
    // 光標在可見範圍內（包含省略號偏移）
    expect(cursorCol).toBeGreaterThan(0);
    expect(cursorCol).toBeLessThan(40);
  });
});
