# Bracketed Paste Mode 完整解决方案

## 🎯 什么是 Bracketed Paste Mode？

Bracketed Paste Mode 是终端的标准功能，被广泛支持：
- xterm
- iTerm2  
- Terminal.app (macOS)
- gnome-terminal
- Windows Terminal
- 等等...

### 工作原理

```
1. 程序启动时发送: \e[?2004h (启用 bracketed paste)
2. 用户粘贴内容
3. 终端自动包装内容:
   \e[200~ + 粘贴的文本 + \e[201~
4. 程序检测这些序列，准确识别粘贴
5. 程序退出时发送: \e[?2004l (禁用)
```

## 📊 对比定时器方案

| 特性 | 定时器方案 | Bracketed Paste |
|------|-----------|-----------------|
| **精确性** | ❌ 猜测（基于时间） | ✅ 精确（终端告知） |
| **延迟** | ❌ 50ms+ | ✅ 0ms |
| **可靠性** | ⚠️ 可能误判 | ✅ 100%准确 |
| **兼容性** | ✅ 所有终端 | ✅ 现代终端 |
| **标准** | ❌ 自制方案 | ✅ 业界标准 |

## 🔧 完整实现

### 1. 添加 Bracketed Paste 支持类

创建 `src/utils/bracketed-paste.ts`:

```typescript
/**
 * Bracketed Paste Mode 支持
 * 终端标准功能，用于准确检测粘贴行为
 */

export class BracketedPasteHandler {
  private isEnabled = false;
  private isPasting = false;
  private pasteBuffer: string[] = [];
  private onPasteCallback: ((content: string) => void) | null = null;

  // ANSI 转义序列
  private readonly ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
  private readonly DISABLE_BRACKETED_PASTE = '\x1b[?2004l';
  private readonly PASTE_START = '\x1b[200~';
  private readonly PASTE_END = '\x1b[201~';

  constructor() {}

  /**
   * 启用 Bracketed Paste Mode
   */
  enable(): void {
    if (!this.isEnabled && process.stdout.isTTY) {
      process.stdout.write(this.ENABLE_BRACKETED_PASTE);
      this.isEnabled = true;
      console.debug('[BracketedPaste] 已启用');
    }
  }

  /**
   * 禁用 Bracketed Paste Mode
   */
  disable(): void {
    if (this.isEnabled && process.stdout.isTTY) {
      process.stdout.write(this.DISABLE_BRACKETED_PASTE);
      this.isEnabled = false;
      console.debug('[BracketedPaste] 已禁用');
    }
  }

  /**
   * 设置粘贴回调
   */
  onPaste(callback: (content: string) => void): void {
    this.onPasteCallback = callback;
  }

  /**
   * 处理输入数据
   * @param data 原始输入数据
   * @returns 处理后的数据（去除粘贴标记）
   */
  handleInput(data: string): { 
    data: string; 
    isPaste: boolean; 
    pasteContent?: string;
  } {
    // 检测粘贴开始
    if (data.includes(this.PASTE_START)) {
      this.isPasting = true;
      this.pasteBuffer = [];
      
      // 移除粘贴开始标记
      const cleanData = data.replace(this.PASTE_START, '');
      
      // 检查是否在同一个数据块中结束
      if (cleanData.includes(this.PASTE_END)) {
        return this.finalizePaste(cleanData);
      }
      
      this.pasteBuffer.push(cleanData);
      return { data: '', isPaste: true };
    }

    // 粘贴进行中
    if (this.isPasting) {
      // 检测粘贴结束
      if (data.includes(this.PASTE_END)) {
        return this.finalizePaste(data);
      }
      
      // 继续累积粘贴内容
      this.pasteBuffer.push(data);
      return { data: '', isPaste: true };
    }

    // 正常输入（非粘贴）
    return { data, isPaste: false };
  }

  /**
   * 完成粘贴
   */
  private finalizePaste(data: string): {
    data: string;
    isPaste: boolean;
    pasteContent: string;
  } {
    // 移除粘贴结束标记
    const cleanData = data.replace(this.PASTE_END, '');
    this.pasteBuffer.push(cleanData);
    
    const pasteContent = this.pasteBuffer.join('');
    this.pasteBuffer = [];
    this.isPasting = false;

    // 调用回调
    if (this.onPasteCallback) {
      this.onPasteCallback(pasteContent);
    }

    return { 
      data: '', 
      isPaste: true, 
      pasteContent 
    };
  }

  /**
   * 是否正在粘贴
   */
  isCurrentlyPasting(): boolean {
    return this.isPasting;
  }
}
```

### 2. 集成到 ChatSession

修改 `src/agent/chat.ts`:

```typescript
import { BracketedPasteHandler } from "../utils/bracketed-paste";

export class ChatSession {
  // ... 其他属性
  private bracketedPaste: BracketedPasteHandler;

  constructor(options: ChatSessionOptions) {
    // ... 其他初始化

    // 初始化 Bracketed Paste
    this.bracketedPaste = new BracketedPasteHandler();
    
    // 设置粘贴回调
    this.bracketedPaste.onPaste((content) => {
      console.log(chalk.cyan(`\n📋 检测到粘贴 (${content.split('\n').length} 行)\n`));
      // 处理粘贴内容
      this.handlePastedInput(content);
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("\n你: "),
      terminal: true,
      crlfDelay: Infinity,
    });
  }

  async start(): Promise<void> {
    this.printWelcome();

    // 启用 Bracketed Paste Mode
    this.bracketedPaste.enable();

    // 确保退出时禁用
    process.on('exit', () => {
      this.bracketedPaste.disable();
    });

    // Ctrl+C 处理
    process.on('SIGINT', () => {
      this.bracketedPaste.disable();
      // ... 其他退出逻辑
    });

    this.rl.on("line", async (input) => {
      // Bracketed Paste 处理
      const result = this.bracketedPaste.handleInput(input);
      
      if (result.isPaste) {
        // 粘贴内容会通过 onPaste 回调处理
        if (result.pasteContent) {
          // 同步粘贴（在一个事件中完成）
          await this.handlePastedInput(result.pasteContent);
        }
        // 异步粘贴会在后续事件中完成
        return;
      }

      // 正常单行输入
      await this.handleNormalInput(result.data);
    });

    this.rl.prompt();
  }

  /**
   * 处理正常输入
   */
  private async handleNormalInput(input: string): Promise<void> {
    // Windows 终端处理
    if (process.platform === 'win32' && input && process.stdout.isTTY) {
      process.stdout.write(
        this.ANSI_MOVE_UP + this.ANSI_CLEAR_LINE + this.ANSI_CARRIAGE_RETURN
      );
      console.log(chalk.cyan("你: ") + input);
    }

    // 多行模式处理
    if (this.isMultiLineMode) {
      // ... 现有多行逻辑
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      this.rl.prompt();
      return;
    }

    // 检查续行符
    if (input.endsWith('\\')) {
      this.isMultiLineMode = true;
      this.multiLineBuffer = [input.slice(0, -1)];
      this.rl.setPrompt(chalk.gray("... "));
      this.rl.prompt();
      return;
    }

    // 处理正常输入
    await this.processInput(trimmed);
  }

  /**
   * 处理粘贴输入
   */
  private async handlePastedInput(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) {
      this.rl.prompt();
      return;
    }

    // 显示粘贴内容预览
    const lines = content.split('\n');
    console.log(chalk.gray(`粘贴内容预览 (${lines.length} 行):`));
    lines.slice(0, 3).forEach(line => {
      console.log(chalk.gray(`  ${line.substring(0, 60)}${line.length > 60 ? '...' : ''}`));
    });
    if (lines.length > 3) {
      console.log(chalk.gray(`  ... 还有 ${lines.length - 3} 行`));
    }
    console.log();

    // 处理粘贴内容（作为单个请求）
    await this.processInput(trimmed);
  }

  /**
   * 处理输入（统一入口）
   */
  private async processInput(input: string): Promise<void> {
    this.historyManager.add(input);
    this.rl.pause();

    // ... 原有的处理逻辑（斜线命令、AI请求等）

    this.rl.resume();
    this.rl.prompt();
  }
}
```

## 🎁 额外功能

### 粘贴内容预览

```typescript
private async handlePastedInput(content: string): Promise<void> {
  const lines = content.split('\n');
  
  // 显示粘贴内容摘要
  console.log(chalk.cyan(`\n📋 粘贴检测:`));
  console.log(chalk.gray(`  总行数: ${lines.length}`));
  console.log(chalk.gray(`  字符数: ${content.length}`));
  
  // 预览前几行
  console.log(chalk.yellow('\n预览:'));
  lines.slice(0, 5).forEach((line, i) => {
    console.log(chalk.gray(`  ${i+1}. ${line.substring(0, 70)}...`));
  });
  
  if (lines.length > 5) {
    console.log(chalk.gray(`  ... 还有 ${lines.length - 5} 行\n`));
  }

  // 处理...
}
```

### 降级方案（旧终端不支持）

```typescript
export class BracketedPasteHandler {
  private fallbackToTimer = false;
  private readonly PASTE_DELAY = 50;
  private pasteTimer: NodeJS.Timeout | null = null;
  private lineBuffer: string[] = [];

  enable(): void {
    if (!process.stdout.isTTY) {
      console.warn('[BracketedPaste] 非TTY终端，使用定时器降级方案');
      this.fallbackToTimer = true;
      return;
    }

    try {
      process.stdout.write(this.ENABLE_BRACKETED_PASTE);
      this.isEnabled = true;
    } catch (err) {
      console.warn('[BracketedPaste] 终端不支持，使用定时器降级方案');
      this.fallbackToTimer = true;
    }
  }

  handleInput(data: string): any {
    // 如果使用降级方案
    if (this.fallbackToTimer) {
      return this.handleInputWithTimer(data);
    }

    // 使用 Bracketed Paste
    return this.handleInputWithBrackets(data);
  }

  private handleInputWithTimer(data: string): any {
    // 定时器逻辑（作为降级方案）
    // ...
  }
}
```

## 🧪 测试

### 测试1：粘贴多行

```bash
# 粘贴以下内容：
你好
这是第二行
这是第三行

# 期望输出：
📋 检测到粘贴 (3 行)

粘贴内容预览 (3 行):
  你好
  这是第二行
  这是第三行

[AI回复...]
```

### 测试2：正常单行输入

```bash
你: 你好

# 正常处理，无粘贴检测
```

### 测试3：续行符

```bash
你: 第一行 \
... 第二行

# 使用原有多行模式
```

## ✅ 优势总结

1. ✅ **精确检测** - 终端级别支持，100%准确
2. ✅ **零延迟** - 实时检测，无需等待
3. ✅ **业界标准** - Node.js、Bash、Zsh 都在用
4. ✅ **广泛兼容** - 现代终端全支持
5. ✅ **优雅降级** - 旧终端自动fallback到定时器

## 📝 注意事项

1. **退出清理**：必须在程序退出时发送禁用序列
2. **TTY检查**：只在TTY模式下启用
3. **错误处理**：某些终端可能不支持，需要降级方案
4. **调试模式**：可以添加环境变量控制是否启用

---

**这就是业界标准的完整解决方案！** 🎉
