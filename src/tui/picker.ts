/**
 * 通用列表選擇器（方向鍵選擇，Enter 確認，Esc/Ctrl+C 取消）
 * 用於會話選擇等互動場景
 */

import chalk from "chalk";

export interface PickerItem {
  label: string;
  value: string;
  /** 右側的次要信息（如日期） */
  hint?: string;
}

/**
 * 顯示互動式列表選擇器
 * @returns 選中的 value，取消時回傳 null
 */
export function showListPicker(title: string, items: PickerItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    if (items.length === 0) {
      console.log(chalk.yellow("沒有可選擇的項目"));
      resolve(null);
      return;
    }

    const stdin = process.stdin;
    const pageSize = Math.min(15, items.length);
    let selected = 0;
    let scrollOffset = 0;

    // 需要滾動時的窗口
    if (selected < scrollOffset) scrollOffset = selected;
    if (selected >= scrollOffset + pageSize) scrollOffset = selected - pageSize + 1;

    const render = () => {
      let output = "";
      // 回到列表起始位置並清除（首次渲染不需要上移）
      if (rendered) {
        for (let i = 0; i < pageSize + 1; i++) {
          output += "\x1b[1A\x1b[2K";
        }
      }
      output += chalk.cyan(`${title} (↑↓ 選擇，Enter 確認，Esc 取消)`) + "\n";

      for (let i = scrollOffset; i < Math.min(scrollOffset + pageSize, items.length); i++) {
        const item = items[i];
        const isSelected = i === selected;
        const cursor = isSelected ? chalk.cyan("❯ ") : "  ";
        const label = isSelected ? chalk.bold.cyan(item.label) : item.label;
        const hint = item.hint ? chalk.gray(`  ${item.hint}`) : "";
        output += `${cursor}${label}${hint}\n`;
      }

      if (items.length > pageSize) {
        output += chalk.gray(`  (${selected + 1}/${items.length})\n`);
      }

      process.stdout.write(output);
      rendered = true;
    };

    let rendered = false;

    const cleanup = () => {
      stdin.removeListener("data", onData);
      try {
        stdin.setRawMode(wasRaw ?? false);
      } catch {
        // ignore
      }
    };

    const wasRaw = stdin.isRaw;
    try {
      stdin.setRawMode(true);
    } catch {
      // 非 TTY：直接回傳第一項
      resolve(items[0]?.value ?? null);
      return;
    }
    stdin.resume();

    const onData = (chunk: Buffer) => {
      const seq = chunk.toString();

      if (seq === "\u001b[A") { // ↑
        if (selected > 0) {
          selected--;
          if (selected < scrollOffset) scrollOffset = selected;
          render();
        }
      } else if (seq === "\u001b[B") { // ↓
        if (selected < items.length - 1) {
          selected++;
          if (selected >= scrollOffset + pageSize) scrollOffset = selected - pageSize + 1;
          render();
        }
      } else if (seq === "\r" || seq === "\n") { // Enter
        cleanup();
        // 清除選擇器顯示
        let clear = "";
        const lines = Math.min(pageSize, items.length) - scrollOffset + 1 + (items.length > pageSize ? 1 : 0);
        for (let i = 0; i < lines; i++) {
          clear += "\x1b[1A\x1b[2K";
        }
        process.stdout.write(clear);
        resolve(items[selected].value);
      } else if (seq === "\u001b" || seq === "\u0003") { // Esc / Ctrl+C
        cleanup();
        let clear = "";
        const lines = Math.min(pageSize, items.length) - scrollOffset + 1 + (items.length > pageSize ? 1 : 0);
        for (let i = 0; i < lines; i++) {
          clear += "\x1b[1A\x1b[2K";
        }
        process.stdout.write(clear);
        resolve(null);
      }
    };

    stdin.on("data", onData);
    render();
  });
}
