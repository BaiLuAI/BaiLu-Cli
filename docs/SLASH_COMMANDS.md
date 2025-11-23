# Bailu CLI 斜线命令完整参考

斜线命令是在 `bailu chat` 模式下使用的本地命令，不会发送给 AI。

---

## 📋 命令分类

### 基本命令
- `/help` or `/h` - 显示帮助信息
- `/exit` or `/quit` or `/q` - 退出 CLI
- `/clear` or `/c` - 清空对话历史

### 模型管理
- `/model [模型ID]` or `/m` - 切换或查看当前模型
- `/models` - 列出所有可用模型

### 状态与信息
- `/status` or `/s` - 查看 CLI 状态
- `/tokens` or `/t` - 查看 token 使用详情
- `/history` - 显示对话历史摘要
- `/workspace` - 查看工作区信息

### 配置管理
- `/settings` - 查看当前配置
- `/settings set <key> <value>` - 修改配置
- `/mode [模式]` - 切换安全模式

### 进阶功能
- `/compress` - 压缩对话上下文
- `/undo` or `/u` - 回滚文件修改
- `/commit` - AI 生成提交信息并自动提交

---

## 📖 命令详解

### /help

显示所有可用命令的帮助信息。

**用法**：
```
/help
/h
```

**输出**：
```
可用的斜線命令：
...
```

---

### /model

切换或查看当前使用的模型。

**用法**：
```
/model                  # 查看当前模型
/model bailu-Edge      # 切换到 bailu-Edge
/m bailu-2.6-preview   # 使用简写
```

**可用模型**：
- `bailu-Edge` - 快速模型（默认）
- `bailu-2.6-preview` - 标准模型
- `bailu-Max` - 最强模型

**输出**：
```
✓ 已切換到模型: bailu-Edge
```

---

### /models

列出所有可用的模型及其描述。

**用法**：
```
/models
```

**输出**：
```
可用的模型：
  1. bailu-Edge - 快速響應模型
  2. bailu-2.6-preview - 平衡性能模型
  3. bailu-Max - 最強模型
```

---

### /status

查看 CLI 的当前状态，包括模型、token 使用、会话统计等。

**用法**：
```
/status
/s
```

**输出**：
```
📊 Bailu CLI 狀態:

當前模型: bailu-Edge
API 地址: https://bailucode.com/openapi/v1
安全模式: review

會話統計:
  消息數: 15
  工具調用: 8
  運行時間: 25m 30s

工作區:
  路徑: /path/to/project
  Git 分支: main
  未提交變更: 3 個文件
```

---

### /tokens

查看 token 使用的详细信息。

**用法**：
```
/tokens
/t
```

**输出**：
```
📊 Token 使用統計:

本次會話:
  輸入: 1,250 tokens
  輸出: 850 tokens
  總計: 2,100 tokens

平均每條消息: 140 tokens
```

---

### /history

显示对话历史的摘要。

**用法**：
```
/history
```

**输出**：
```
📜 對話歷史（最近 10 條）:

1. [你] 列出目錄中的文件
2. [Bailu] 好的，我來查看...
3. [你] 讀取 README.md
...
```

---

### /workspace

查看工作区信息，包括路径、Git 状态、文件统计等。

**用法**：
```
/workspace
```

**输出**：
```
📁 工作區信息:

路徑: /path/to/project
類型: Node.js 项目

Git 信息:
  分支: main
  未提交變更: 3 個文件
  - src/index.ts
  - README.md
  - package.json

文件統計:
  總文件數: 42
  TypeScript: 25
  JavaScript: 10
  Markdown: 7
```

---

### /clear

清空对话历史，但保留系统提示。

**用法**：
```
/clear
/c
```

**输出**：
```
✓ 對話歷史已清空
```

**注意**：
- 清空后无法恢复
- 工具调用记录也会清空

---

### /compress

压缩对话上下文，保留重要信息，减少 token 使用。

**用法**：
```
/compress
```

**工作原理**：
1. 分析对话历史
2. 提取关键信息
3. 生成摘要
4. 替换原始对话

**输出**：
```
🗜️ 正在壓縮對話上下文...
✓ 壓縮完成
  原始: 15 條消息, 2,500 tokens
  壓縮後: 3 條消息, 800 tokens
  節省: 68%
```

---

### /settings

查看或修改配置。

**用法**：
```
/settings                    # 查看所有配置
/settings set model bailu-Edge  # 修改配置
```

**可配置项**：
- `model` - 默认模型
- `baseUrl` - API 地址
- `safetyMode` - 安全模式
- `maxIterations` - 最大迭代次数
- `verbose` - 详细输出

**输出**：
```
⚙️ 當前配置:

API 配置:
  Base URL: https://bailucode.com/openapi/v1
  模型: bailu-Edge

執行配置:
  安全模式: review
  最大迭代: 10
  自動壓縮: true
  詳細輸出: false
```

---

### /mode

切换安全模式。

**用法**：
```
/mode                  # 查看当前模式
/mode dry-run         # 切换到演习模式
/mode review          # 切换到审查模式
/mode auto-apply      # 切换到自动模式
```

**模式说明**：

**dry-run（演习）**：
- 只显示计划，不执行任何操作
- 用于查看 AI 的意图

**review（审查）** - 默认：
- 危险操作需要确认
- 安全操作自动执行

**auto-apply（自动）**：
- 所有操作自动执行
- ⚠️ 谨慎使用

**输出**：
```
✓ 已切換到 review 模式
```

---

### /undo

查看和回滚文件修改。

**用法**：
```
/undo          # 查看可回滚的文件
/undo 1        # 回滚第一个备份
/u             # 简写
```

**输出（查看）**：
```
可回滾的文件（按時間排序）：

  1. src/index.ts
     備份時間: 2025/11/23 19:30:45

  2. README.md
     備份時間: 2025/11/23 19:25:12

使用方法: /undo <數字> 來恢復指定的文件
```

**输出（恢复）**：
```
✓ 已恢復文件: src/index.ts
```

---

### /commit

使用 AI 生成描述性的提交信息并自动提交变更。

**用法**：
```
/commit
```

**工作流程**：
1. 检查是否有未提交的变更
2. 显示变更的文件列表
3. 使用 AI 分析 diff
4. 生成符合 Conventional Commits 的提交信息
5. 执行 git add 和 git commit

**输出**：
```
變更的文件:
  - src/index.ts
  - README.md

🤖 正在使用 AI 生成提交信息...
提交信息: feat: 添加自动提交功能并更新文档

✓ 提交成功
提交信息: feat: 添加自动提交功能并更新文档
```

**提交信息格式**：
使用 Conventional Commits 标准：
- `feat:` - 新功能
- `fix:` - 修复 bug
- `docs:` - 文档更新
- `style:` - 代码格式
- `refactor:` - 重构
- `test:` - 测试相关
- `chore:` - 构建/工具变动

---

### /exit, /quit, /q

退出 Bailu CLI。

**用法**：
```
/exit
/quit
/q
```

**输出**：
```
再見！
```

**注意**：
- 也可以使用 `exit` 或 `quit`（不带斜线）
- 或者按 Ctrl+C 两次

---

## 🎯 使用技巧

### 1. 命令别名
大多数命令都有简写：
```
/help → /h
/model → /m
/status → /s
/tokens → /t
/clear → /c
/undo → /u
/exit → /q
```

### 2. Tab 补全
输入 `/` 后按 Tab 键可以查看所有命令。

### 3. 命令链
某些命令可以连续使用：
```
/clear        # 清空历史
/model bailu-Edge  # 切换模型
/mode review  # 设置模式
```

### 4. 快速查看
使用简写快速查看状态：
```
/s    # 查看状态
/t    # 查看 tokens
```

### 5. 工作流程
推荐的工作流程：
```
1. /status     # 检查状态
2. [与 AI 对话]
3. /undo       # 需要时回滚
4. /commit     # 提交变更
5. /tokens     # 查看使用量
```

---

## ⚠️ 注意事项

### 命令 vs 普通输入
- 以 `/` 开头的是命令
- 其他输入会发送给 AI

### 命令不会发送给 AI
```
你: /status          ← 本地处理
你: 查看项目状态     ← 发送给 AI
```

### 清空操作不可恢复
```
/clear    # ⚠️ 无法恢复对话历史
/undo     # ✅ 可以恢复文件
```

### 提交前检查
```
/status   # 查看未提交的文件
/commit   # 确认后再提交
```

---

## 🔗 相关文档

- [工具系统文档](tools/TOOLS_OVERVIEW.md)
- [配置文件说明](CONFIG.md)
- [最佳实践](BEST_PRACTICES.md)

---

**最后更新**: 2025-11-23
**版本**: 0.2.4
