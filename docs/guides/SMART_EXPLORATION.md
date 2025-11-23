# 🎯 智能项目探索功能

## 问题背景

**之前的行为**：
```
你: 帮我修改网页，添加导航栏

AI: 
[需要確認]
✍️ 寫入檔案: index.html
是否執行此操作? [y/n]: 

❌ 问题：AI 假设 index.html 存在，但可能：
   - 文件名是 home.html
   - HTML 在 src/ 目录下
   - 或者根本没有 HTML 文件
```

**现在的行为**：
```
你: 帮我修改网页，添加导航栏

AI: 
[自動執行] 📂 列出目錄內容: 當前目錄

✓ 工具執行成功

index.html
css/
  style.css
js/
  main.js

AI: 我看到项目结构如下：
    - index.html（主页面）
    - css/style.css（样式文件）
    - js/main.js（脚本文件）
    
    现在我来为你添加导航栏...

[自動執行] 📖 讀取檔案: index.html

✓ 工具執行成功

<!DOCTYPE html>...

[需要確認]
✍️ 寫入檔案: index.html
是否執行此操作? [y/n]: y

✅ 正确：AI 已经确认了项目结构
```

---

## 核心改进

### 1. **自动项目探索**

AI 在处理以下请求时，会先自动检查项目结构：
- "修改网页"
- "继续写"
- "添加功能"
- "更新代码"

**探索流程**：
```
1. 接收用户请求
2. 自动执行 list_directory "." 
3. 分析项目结构
4. 确定文件位置和命名
5. 再开始读取和修改
```

### 2. **只读工具自动批准**

在 `review` 模式下：
- ✅ `list_directory` - 自动执行，无需确认
- ✅ `read_file` - 自动执行，无需确认
- ⚠️ `write_file` - 仍需确认（涉及文件修改）
- ⚠️ `run_command` - 仍需确认（涉及命令执行）

**显示效果**：
```
[自動執行] 📂 列出目錄內容: 當前目錄
✓ 工具執行成功

[自動執行] 📖 讀取檔案: index.html
✓ 工具執行成功

[需要確認]
✍️ 寫入檔案: index.html
是否執行此操作? [y/n]:
```

---

## 实际应用场景

### 场景 1：修改现有网页

```powershell
你: 为网站添加一个关于我们的页面

AI 的执行流程：
1. [自動執行] list_directory "."
   → 发现 index.html, about.html 不存在
   
2. [自動執行] read_file "index.html"
   → 了解现有结构和样式引用
   
3. [需要確認] write_file "about.html"
   → 创建新文件，请求确认
   
4. [自動執行] read_file "css/style.css"
   → 检查是否需要新增样式
   
5. [需要確認] write_file "css/style.css"
   → 添加样式，请求确认
```

### 场景 2：创建新项目

```powershell
你: 帮我创建一个简单的博客网站

AI 的执行流程：
1. [自動執行] list_directory "."
   → 发现目录为空
   
2. [需要確認] write_file "index.html"
   → 创建主页
   
3. [需要確認] write_file "css/style.css"
   → 创建样式表
   
4. [需要確認] write_file "js/main.js"
   → 创建脚本
   
5. [自動執行] list_directory "."
   → 验证文件已创建
   
6. [自動執行] read_file "index.html"
   → 审查代码完整性
```

### 场景 3：复杂项目结构

```powershell
你: 修改用户认证模块

AI 的执行流程：
1. [自動執行] list_directory "."
   → 发现 src/, lib/, components/ 等目录
   
2. [自動執行] list_directory "src"
   → 深入查看 src 目录结构
   
3. [自動執行] read_file "src/auth/login.ts"
   → 找到认证相关代码
   
4. [需要確認] write_file "src/auth/login.ts"
   → 修改代码
```

---

## 技术实现

### 1. System Prompt 引导

```typescript
工作流程指導：
1. **首次接觸項目時必須先探索結構**：
   - 用戶說「修改網頁」、「繼續寫」、「添加功能」時
   - 如果不確定項目結構，先用 list_directory 檢查當前目錄
   - 確認 HTML/CSS/JS 文件的位置和命名
   - 這個檢查**不需要用戶確認**，自動執行
   - 探索後再決定讀取哪些文件
```

### 2. 工具定義标记

```typescript
// src/tools/implementations/list_directory.ts
export const listDirectoryTool: Tool = {
  definition: {
    name: "list_directory",
    description: "列出指定目錄下的文件和子目錄",
    safe: true, // 标记为安全的只读工具
    parameters: [...]
  },
  handler: async (params) => {...}
};
```

### 3. Executor 自动批准逻辑

```typescript
// src/tools/executor.ts
if (this.context.safetyMode === "review") {
  // 安全工具（只读操作）自动批准
  if (tool.definition.safe) {
    console.log(chalk.gray(`[自動執行] ${this.humanizeToolCall(toolCall)}`));
  } else {
    // 非安全工具需要用户确认
    const approved = await this.requestApproval(toolCall);
    if (!approved) {
      return { success: false, error: "用戶取消了操作" };
    }
  }
}
```

---

## 用户体验对比

### 之前（v0.2.0）

```
你: 修改网页添加导航栏

AI: 
[需要確認] ✍️ 寫入檔案: index.html
→ 用户需要确认

你: y

❌ 错误：文件名应该是 home.html
💥 操作失败
```

**用户需要**：
1. 手动告知 AI 文件名
2. 手动告知目录结构
3. 多次重试

### 现在（v0.2.1）

```
你: 修改网页添加导航栏

AI: 
[自動執行] 📂 列出目錄內容
→ 自动探索，无需确认

发现：home.html, css/, js/

[自動執行] 📖 讀取檔案: home.html
→ 自动读取，无需确认

[需要確認] ✍️ 寫入檔案: home.html
→ 修改时才需要确认

✅ 一次成功
```

**用户体验**：
1. ✅ 无需手动说明项目结构
2. ✅ AI 自动适应不同的命名和结构
3. ✅ 减少确认次数（只读操作自动）
4. ✅ 提高成功率

---

## 适用场景

### ✅ 适合自动探索的情况

- 首次接触项目
- 不确定文件位置
- 项目结构复杂
- 多种可能的命名方式
- 需要查找特定文件

### ⚠️ 不需要探索的情况

- 用户明确指定了文件路径
  ```
  你: 修改 src/components/Header.tsx，添加导航栏
  → AI 直接读取指定文件
  ```

- 连续对话，已知项目结构
  ```
  你: 修改网页
  AI: [探索并修改]
  
  你: 再加个页脚
  → AI 已知结构，直接修改
  ```

---

## 配置选项

### 禁用自动探索（如果需要）

在未来版本中，你可以通过配置控制：

```yaml
# .bailu.yml
autoExplore: false  # 禁用自动项目探索
```

### 只在特定模式下启用

```yaml
# .bailu.yml
autoExplore:
  review: true      # review 模式启用
  auto-apply: false # auto-apply 模式禁用
```

---

## 性能影响

### 额外的工具调用

- 平均每个任务增加 1-2 次 `list_directory` 调用
- 每次调用耗时 < 50ms
- 对整体性能影响可忽略

### Token 使用

- 每次 `list_directory` 约 50-200 tokens（取决于项目大小）
- 自动压缩机制会管理总 token 使用
- 实际节省的 token（避免错误重试）> 额外使用

---

## 总结

### 核心优势

1. **智能化**：AI 不再盲目假设，会先了解项目
2. **自动化**：只读操作自动执行，无需频繁确认
3. **准确性**：减少因文件路径错误导致的失败
4. **用户体验**：更流畅的交互，更少的干预

### 实现要点

- ✅ System prompt 引导 AI 探索
- ✅ 工具定义添加 `safe` 标记
- ✅ Executor 自动批准只读工具
- ✅ 保持 review 模式的安全性

### 未来改进

- 🔮 缓存项目结构，避免重复探索
- 🔮 智能判断何时需要重新探索
- 🔮 支持用户自定义探索策略
- 🔮 项目结构变化检测
