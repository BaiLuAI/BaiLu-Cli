# 粘贴检测修复方案

## 🐛 问题描述

当用户从外部复制多行文字并粘贴到 CLI 时，readline 会将每一行视为独立的输入事件，导致：

```
用户粘贴：
第一行文本
第二行文本
第三行文本

实际效果：
→ 触发3次 `line` 事件
→ 发送3个独立的请求
→ AI 分别回复3次 ❌
```

## 📊 期望行为

```
用户粘贴多行 
→ 检测到粘贴行为（快速连续的多个 line 事件）
→ 合并成一个请求
→ AI 回复一次 ✅
```

## 🔧 解决方案

### 核心思路

使用**定时器缓冲机制**检测粘贴：

1. 每次收到 `line` 事件时，将内容添加到缓冲区
2. 启动/重置一个短暂的定时器（50ms）
3. 定时器到期时，处理缓冲区中的所有行：
   - 如果只有1行 = 正常输入
   - 如果有多行 = 粘贴行为，合并处理

### 实现代码

```typescript
export class ChatSession {
  // ... 其他属性

  // 粘贴检测
  private pasteBuffer: string[] = [];
  private pasteTimer: NodeJS.Timeout | null = null;
  private readonly PASTE_DELAY = 50; // 50ms

  async start() {
    // ... 初始化代码

    this.rl.on("line", async (input) => {
      // 多行模式处理（保持原有逻辑）
      if (this.isMultiLineMode) {
        // ... 原有多行处理逻辑
        return;
      }

      // 粘贴检测
      this.pasteBuffer.push(input);
      
      if (this.pasteTimer) {
        clearTimeout(this.pasteTimer);
      }
      
      this.pasteTimer = setTimeout(async () => {
        const lines = [...this.pasteBuffer];
        this.pasteBuffer = [];
        this.pasteTimer = null;
        
        if (lines.length === 1) {
          // 单行：正常处理
          await this.handleSingleInput(lines[0]);
        } else {
          // 多行：粘贴检测
          console.log(chalk.cyan(`\n📋 检测到粘贴 ${lines.length} 行\n`));
          const combined = lines.join('\n');
          await this.handleSingleInput(combined);
        }
      }, this.PASTE_DELAY);
    });
  }

  private async handleSingleInput(input: string) {
    // 将原有的 line 事件处理逻辑移到这里
    const trimmed = input.trim();
    if (!trimmed) {
      this.rl.prompt();
      return;
    }
    
    // ... 其余处理逻辑
  }
}
```

## ⚡ 优势

1. ✅ 无需改变用户交互方式
2. ✅ 自动检测粘贴行为
3. ✅ 50ms 延迟几乎无感知
4. ✅ 兼容现有多行模式（`\` 续行符）
5. ✅ 单行输入不受影响

## 🧪 测试场景

### 场景1：正常单行输入
```
你: 你好
[等待 50ms，只有1行]
→ 正常处理
```

### 场景2：粘贴多行
```
粘贴：
你好
这是第二行
这是第三行

[0ms] 收到"你好" → 添加到缓冲区，启动定时器
[5ms] 收到"这是第二行" → 添加到缓冲区，重置定时器
[10ms] 收到"这是第三行" → 添加到缓冲区，重置定时器
[60ms] 定时器到期，缓冲区有3行 → 合并处理
→ 📋 检测到粘贴 3 行
→ 发送合并后的文本
```

### 场景3：续行符（保持原有行为）
```
你: 第一行 \
... 第二行 \
... 第三行

→ 使用原有多行模式处理
```

## 📝 注意事项

1. **延迟时间**：50ms 是一个平衡值
   - 太短：可能误判快速输入的单行
   - 太长：用户会感到延迟

2. **兼容性**：粘贴检测在多行模式（`isMultiLineMode`）激活时不工作

3. **Windows 终端**：现有的 Windows 重复显示处理逻辑保持不变

## 🎯 下一步

1. 实现上述代码修改
2. 测试单行输入
3. 测试粘贴多行
4. 测试续行符
5. 提交修复
