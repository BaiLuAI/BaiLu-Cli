/**
 * OutputManager + InputBox 整合測試（用迷你 ANSI 終端模擬器驗證實際畫面）
 *
 * 重點驗證：多次重繪不會造成輸入框下移/殘留多個框（曾發生的真實 bug）
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  return {
    __esModule: true,
    default: {
      cyan: fn, green: fn, yellow: fn, red: fn, gray: fn, blue: fn, magenta: fn,
      bold: Object.assign(fn, { cyan: fn }),
    },
  };
});

import { InputBox } from '../../../src/tui/input-box.js';
import { OutputManager } from '../../../src/tui/output-manager.js';

/** 迷你 ANSI 終端模擬器：把輸出序列重放成螢幕 */
class TermEmu {
  rows: string[] = [''];
  row = 0;
  col = 0;

  private ensure(): void {
    while (this.rows.length <= this.row) this.rows.push('');
  }

  write(input: string): void {
    let i = 0;
    while (i < input.length) {
      const ch = input[i];

      if (ch === '\u001b') {
        // eslint-disable-next-line no-control-regex
        const m = /^\u001b\[([0-9;?]*)([A-Za-z])/.exec(input.slice(i));
        if (m) {
          i += m[0].length;
          const n = parseInt(m[1], 10) || 1;
          switch (m[2]) {
            case 'A': this.row = Math.max(0, this.row - n); break;
            case 'B': this.row += n; this.ensure(); break;
            case 'C': this.col += n; break;
            case 'D': this.col = Math.max(0, this.col - n); break;
            case 'G': this.col = Math.max(0, n - 1); break;
            case 'J':
              this.ensure();
              this.rows[this.row] = this.rows[this.row].slice(0, this.col);
              this.rows.length = this.row + 1;
              break;
            case 'K':
              this.ensure();
              this.rows[this.row] = '';
              break;
            default: break; // m/h/l 等忽略
          }
          continue;
        }
        i++;
        continue;
      }

      if (ch === '\n') { this.row++; this.col = 0; this.ensure(); i++; continue; }
      if (ch === '\r') { this.col = 0; i++; continue; }

      this.ensure();
      const line = this.rows[this.row];
      this.rows[this.row] = line.slice(0, this.col) + ch + line.slice(this.col + 1);
      this.col++;
      i++;
    }
  }

  /** 畫面上有幾個輸入框頂框 */
  countTopBorders(): number {
    return this.rows.filter((r) => /╭─( You| ⏸)/.test(r)).length;
  }

  /** 畫面上有幾個底框 */
  countBottomBorders(): number {
    return this.rows.filter((r) => r.startsWith('╰')).length;
  }

  screen(): string {
    return this.rows.join('\n');
  }
}

describe('OutputManager + InputBox（終端模擬器）', () => {
  let emu: TermEmu;
  let mgr: OutputManager;
  let box: InputBox;
  let realWrite: any;

  beforeEach(() => {
    emu = new TermEmu();
    realWrite = process.stdout.write;
    // originalWrite 必須指向模擬器
    process.stdout.write = ((s: any) => { emu.write(String(s)); return true; }) as any;
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true });

    mgr = new OutputManager();
    box = new InputBox({ width: 60, prompt: 'You: ' });
    mgr.install(box);
  });

  afterEach(() => {
    mgr.uninstall();
    process.stdout.write = realWrite;
  });

  it('啟動後畫面應恰好有一個框', () => {
    box.start();
    expect(emu.countTopBorders()).toBe(1);
    expect(emu.countBottomBorders()).toBe(1);
    expect(emu.screen()).toContain('│ You:');
  });

  it('【漂移回歸】打字 10 次後仍只有一個框，不殘留', () => {
    box.start();
    for (const c of 'abcdefghij') {
      box.handleKey(c);
    }

    expect(emu.countTopBorders()).toBe(1);
    expect(emu.countBottomBorders()).toBe(1);
    expect(emu.screen()).toContain('│ You: abcdefghij');
  });

  it('【漂移回歸】框的位置在多次重繪後保持穩定（不上移也不下移）', () => {
    box.start();
    const rowAfterStart = emu.rows.findIndex((r) => /╭─( You| ⏸)/.test(r));

    for (const c of 'abc') box.handleKey(c);
    const rowAfterTyping = emu.rows.findIndex((r) => /╭─( You| ⏸)/.test(r));

    expect(rowAfterTyping).toBe(rowAfterStart);
    // 框三行連續
    expect(emu.rows[rowAfterTyping]).toMatch(/^╭─/);
    expect(emu.rows[rowAfterTyping + 1]).toMatch(/^│ You:/);
    expect(emu.rows[rowAfterTyping + 2]).toMatch(/^╰/);
  });

  it('外部輸出（含換行）後應擦框、輸出、重繪，且只剩一個框', () => {
    box.start();
    box.handleKey('hi');

    // 模擬 console.log 輸出（走 hook）
    process.stdout.write('這是一段外部輸出\n');

    expect(emu.screen()).toContain('這是一段外部輸出');
    expect(emu.countTopBorders()).toBe(1);
    expect(emu.countBottomBorders()).toBe(1);
    // 輸出在框上方
    const outRow = emu.rows.findIndex((r) => r.includes('這是一段外部輸出'));
    const boxRow = emu.rows.findIndex((r) => /╭─( You| ⏸)/.test(r));
    expect(outRow).toBeLessThan(boxRow);
  });

  it('suspend 收起框、resume 重繪，且不殘留', () => {
    box.start();
    box.handleKey('x');

    mgr.suspend();
    expect(emu.countTopBorders()).toBe(0);

    // 串流內容直接輸出
    process.stdout.write('串流回答內容');

    mgr.resume();
    expect(emu.countTopBorders()).toBe(1);
    expect(emu.screen()).toContain('串流回答內容');
  });

  it('【退出回歸】uninstall 後不殘留空輸入框', () => {
    box.start();
    box.handleKey('bye');
    expect(emu.countTopBorders()).toBe(1);

    mgr.uninstall();

    expect(emu.countTopBorders()).toBe(0);
    expect(emu.countBottomBorders()).toBe(0);
  });
});
