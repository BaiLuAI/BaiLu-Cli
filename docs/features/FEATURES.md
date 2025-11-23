# 🚀 v0.2.1 新功能详解

## 1. ♾️ 无限多轮执行

### 之前的限制
```
❌ 最多 10 轮迭代
❌ 达到限制后强制停止
❌ 无法完成复杂任务
```

### 现在的体验
```
✅ 无限制迭代，直到任务完成
✅ 智能检测死循环（同一工具连续失败 5 次）
✅ 可以处理任意复杂度的任务
✅ 自动压缩上下文，避免 token 超限
```

### 使用示例
```powershell
node dist/cli.js

你: 帮我创建一个完整的天气网站，包括：
    - 响应式 HTML 结构
    - 完整的 CSS 样式
    - JavaScript 交互功能
    - 天气 API 集成
    - 错误处理
    
# AI 会持续工作，完成所有步骤，不会在中途停止
```

---

## 2. 📦 自动上下文压缩（80% 阈值）

### 工作原理
- 估算当前对话的 token 数
- 当超过 80% 阈值（默认 8000 tokens 的 80% = 6400）时自动触发
- 保留 system message + 最近 3 轮对话
- 添加压缩标记，告知 AI 历史已压缩

### 压缩效果
```
压缩前: 6500 tokens (100 条消息)
         ↓ 自动压缩
压缩后: 1200 tokens (8 条消息)
```

### 可见提示
```
📦 自動壓縮：6500 tokens → 1200 tokens (超過 6400 閾值)
```

### 手动压缩
你仍然可以使用 `/compress` 手动触发：
```
你: /compress
✓ 對話歷史已壓縮：從 50 條消息減少到 8 條
```

---

## 3. ✅ 自动代码审查

### AI 现在会主动做什么

完成文件修改后，AI 会：
1. **重新读取修改的文件**
2. **检查代码完整性**
   - 所有 import 是否存在
   - 函数调用是否正确
   - 变量引用是否完整
3. **检查语法正确性**
   - HTML 标签是否闭合
   - CSS 语法是否正确
   - JavaScript 是否有明显错误
4. **检查关联文件**
   - HTML 中的 CSS 引用是否存在
   - HTML 中的 JS 引用是否存在
   - CSS 类名是否在 HTML 中使用
   - JS 事件绑定的元素是否存在
5. **报告发现的问题**
   - 如果发现问题，立即修复
   - 修复后再次审查
   - 直到确认无误才告知用户完成

### 审查示例

```
你: 为网站添加导航栏

Bailu: 
[执行工具调用：write_file index.html]
✓ 已更新 index.html，添加导航栏

[自动审查...]
📖 正在读取 index.html 验证完整性...
✓ HTML 结构完整，标签已正确闭合

📖 正在读取 css/style.css 检查样式...
⚠️ 发现问题：.navbar 类在 HTML 中使用，但 CSS 中未定义

[自动修复...]
✍️ 正在更新 css/style.css，添加 .navbar 样式...
✓ 样式已补充

[再次审查...]
✓ 代码审查通过：
  - HTML 结构完整
  - CSS 样式完整
  - 所有类名都有对应样式
  - 无明显语法错误
  
✅ 任务完成！导航栏已成功添加并通过审查。
```

---

## 4. 🛡️ 智能死循环检测

### 检测逻辑
- 追踪每个工具的执行状态
- 检测同一工具是否连续失败
- 连续失败 5 次则自动停止

### 示例场景

```
迭代 1: write_file 失败（缺少参数）
迭代 2: write_file 失败（缺少参数）
迭代 3: write_file 失败（缺少参数）
迭代 4: write_file 失败（缺少参数）
迭代 5: write_file 失败（缺少参数）

⚠️ 工具 "write_file" 連續失敗 5 次，停止執行

建議：
  1. 檢查工具參數是否正確
  2. 嘗試更明確的指令
  3. 切換到其他模型或手動完成
```

### 成功场景
```
迭代 1: write_file 失败
迭代 2: read_file 成功 ← 不同工具，重置计数
迭代 3: write_file 成功 ← 成功，重置计数
✓ 任務完成
```

---

## 对比表

| 特性 | v0.2.0 | v0.2.1 |
|-----|--------|--------|
| **最大迭代次数** | 10 轮 | ♾️ 无限 |
| **失败停止条件** | 任意 3 次失败 | 同一工具连续 5 次失败 |
| **上下文管理** | 手动 `/compress` | 自动压缩（80% 阈值） |
| **代码审查** | ❌ 无 | ✅ 自动审查 |
| **死循环保护** | ❌ 仅次数限制 | ✅ 智能检测 |
| **复杂任务** | ⚠️ 可能中断 | ✅ 可完成 |

---

## 使用建议

### 适合无限多轮的场景
- ✅ 创建完整的多文件项目
- ✅ 重构大型模块
- ✅ 添加复杂功能（需要修改多个文件）
- ✅ 自动化测试编写

### 仍需要注意的情况
- ⚠️ 如果同一工具持续失败，尽快介入
- ⚠️ 定期查看 AI 的执行过程
- ⚠️ 在 `review` 模式下可以随时取消

### 最佳实践
```powershell
# 1. 启用调试模式，观察 AI 行为
$env:BAILU_DEBUG="1"
node dist/cli.js

# 2. 使用明确的指令
你: 创建天气网站，包括 index.html、style.css 和 main.js，
    确保所有文件之间的引用正确，并测试功能是否可用

# 3. 让 AI 自己审查
# （已自动开启，无需额外操作）

# 4. 遇到问题时使用斜线命令
你: /compress  # 压缩历史
你: /status    # 查看状态
你: /model     # 切换模型
```

---

## 技术实现

### 自动压缩算法
```typescript
function autoCompressMessages(messages, maxTokens = 8000) {
  const currentTokens = estimateTokens(messages);
  const threshold = maxTokens * 0.8; // 80% 阈值
  
  if (currentTokens > threshold && messages.length > 10) {
    // 保留 system + 最近 3 轮
    const systemMsg = messages[0];
    const recentMessages = messages.slice(-6);
    
    // 重建消息数组
    messages.length = 0;
    messages.push(systemMsg);
    messages.push({
      role: "system",
      content: "[對話歷史已自動壓縮]"
    });
    messages.push(...recentMessages);
  }
}
```

### 死循环检测
```typescript
let consecutiveFailures = 0;
let lastFailedTool = "";

for (const toolCall of toolCalls) {
  const result = await execute(toolCall);
  
  if (result.success) {
    consecutiveFailures = 0; // 重置
    lastFailedTool = "";
  } else {
    if (lastFailedTool === toolCall.tool) {
      consecutiveFailures++;
    } else {
      consecutiveFailures = 1;
      lastFailedTool = toolCall.tool;
    }
  }
  
  if (consecutiveFailures >= 5) {
    console.log("停止：同一工具连续失败 5 次");
    break;
  }
}
```

---

## 反馈和建议

如果你觉得：
- 80% 阈值太高或太低
- 连续失败 5 次的限制需要调整
- 需要其他智能停止条件

欢迎提出建议！我们会持续优化这些参数。
