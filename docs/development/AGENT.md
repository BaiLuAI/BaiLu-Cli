# Bailu CLI - Agent 指引文件

> 本文件面向 AI / Agent，描述 Bailu CLI 專案的技術細節、開發規範和工作流程。

## 📋 專案概覽

**Bailu CLI** 是一個基於白鹿大模型的終端智能體（Agent），對標 OpenAI Codex。它能夠：
- 理解自然語言指令
- 自動讀取和修改代碼文件
- 執行 shell 命令
- 生成和應用代碼補丁
- 在多輪對話中保持上下文

## 🏗️ 技術棧

- **語言**: TypeScript
- **運行時**: Node.js (>= 18)
- **LLM**: 白鹿 API (`https://bailucode.com/openapi/v1`)
- **CLI 框架**: Commander.js
- **Diff 引擎**: diff.js
- **構建工具**: tsc (TypeScript Compiler)

## 📁 目錄結構

```
白鹿cli/
├── src/
│   ├── cli.ts                 # CLI 入口，命令定義
│   ├── config.ts              # 配置管理（API Key 等）
│   ├── agent/                 # Agent 核心
│   │   ├── types.ts           # Task/Run/Step 資料模型
│   │   ├── core.ts            # BailuAgent 類（任務管理）
│   │   ├── context.ts         # 工作空間上下文構建
│   │   ├── orchestrator.ts    # Agent 編排器（LLM ↔ 工具循環）
│   │   ├── session.ts         # 會話持久化
│   │   └── chat.ts            # 交互式對話
│   ├── llm/                   # LLM 層
│   │   ├── client.ts          # LLMClient（白鹿 API 調用）
│   │   └── prompts.ts         # 提示詞模板
│   ├── tools/                 # 工具系統
│   │   ├── types.ts           # 工具介面定義
│   │   ├── registry.ts        # 工具註冊中心
│   │   ├── executor.ts        # 工具執行器（含安全策略）
│   │   ├── parser.ts          # XML 格式工具調用解析
│   │   └── implementations/   # 內建工具
│   │       ├── read_file.ts   # 讀取文件
│   │       ├── write_file.ts  # 寫入文件
│   │       ├── list_directory.ts  # 列出目錄
│   │       ├── run_command.ts     # 執行命令
│   │       └── apply_diff.ts      # 應用補丁
│   ├── fs/                    # 文件系統
│   │   ├── workspace.ts       # 文件讀寫工具
│   │   └── diff.ts            # Diff 生成（彩色輸出）
│   ├── git/                   # Git 集成
│   │   └── integration.ts     # Git 狀態查詢
│   └── runtime/               # 執行與安全
│       ├── policy.ts          # 安全策略
│       └── runner.ts          # 命令執行器
├── dist/                      # 構建輸出（tsc）
├── .bailu/                    # 本地數據
│   └── sessions/              # 會話記錄（JSON）
├── BAILU CLI.txt              # ASCII Logo
├── AGENT.md                   # 本文件（AI 指引）
├── README.md                  # 用戶文檔
├── package.json               # Node.js 專案配置
├── tsconfig.json              # TypeScript 配置
└── .bailu.yml                 # 專案配置（測試/構建命令）
```

## 🔧 開發工作流

### 本地開發

```bash
# 安裝依賴
npm install

# 開發模式（使用 ts-node，無需構建）
npm run dev ask "測試問題"

# 構建（輸出到 dist/）
npm run build

# 運行構建後的版本
node dist/cli.js ask "測試問題"
```

### 構建流程

1. `tsc` 讀取 `tsconfig.json`
2. 編譯 `src/` 下所有 `.ts` 文件
3. 輸出到 `dist/`，保持相同目錄結構
4. `dist/cli.js` 被標記為可執行（`#!/usr/bin/env node`）

### 發布流程

1. 更新 `package.json` 中的 `version`
2. `npm run build`
3. 測試：`node dist/cli.js ask "測試"`
4. 提交到 Git
5. （未來）`npm publish` 發布到 npm registry

## 📐 架構設計

### 核心概念

#### 1. Agent 編排器（Orchestrator）
負責協調 LLM 和工具之間的循環：

```
用戶指令
  ↓
LLM 生成回應（可能包含工具調用）
  ↓
解析工具調用（XML 格式）
  ↓
執行工具（讀文件/寫文件/跑命令）
  ↓
將結果回饋給 LLM
  ↓
LLM 繼續思考或結束任務
```

**關鍵文件**: `src/agent/orchestrator.ts`

#### 2. 工具系統（Tools）
所有工具必須實現 `Tool` 介面：

```typescript
interface Tool {
  definition: ToolDefinition;  // 名稱、描述、參數
  handler: ToolHandler;        // 實際執行邏輯
}
```

工具通過 `ToolRegistry` 註冊，由 `ToolExecutor` 執行。

**白鹿工具調用格式**（XML）：
```xml
<action>
<invoke tool="read_file">
  <param name="path">src/index.ts</param>
</invoke>
</action>
```

#### 3. 安全策略（Safety Policy）
三種模式：
- **dry-run**: 只顯示計畫，不執行
- **review**: 每個工具調用前詢問用戶
- **auto-apply**: 自動執行（危險）

**關鍵文件**: `src/runtime/policy.ts`, `src/tools/executor.ts`

#### 4. 會話管理（Session）
長任務會自動保存到 `.bailu/sessions/`，包含：
- 任務描述
- 執行歷史
- 所有 Run 和 Step

支持 `--resume` 恢復中斷的任務。

**關鍵文件**: `src/agent/session.ts`

## 🎯 修改指南

### 添加新工具

1. 在 `src/tools/implementations/` 創建新文件：

```typescript
// my_tool.ts
import { Tool, ToolResult } from "../types";

export const myTool: Tool = {
  definition: {
    name: "my_tool",
    description: "做什麼事",
    parameters: [
      {
        name: "param1",
        type: "string",
        description: "參數說明",
        required: true,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      // 實現邏輯
      return {
        success: true,
        output: "結果",
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
};
```

2. 在 `src/tools/implementations/index.ts` 中導出並加入 `builtinTools`

### 添加新命令

在 `src/cli.ts` 中：

1. 創建 handler 函數：
```typescript
async function handleMyCommand(arg: string) {
  // 實現邏輯
}
```

2. 註冊命令：
```typescript
program
  .command("mycommand")
  .description("命令說明")
  .argument("[arg]", "參數說明")
  .action(handleMyCommand);
```

### 修改 LLM 行為

編輯 `src/llm/prompts.ts` 中的提示詞模板：
- `buildAskPrompt` - 問答模式
- `buildFixPrompt` - 修改模式

## 🔐 安全注意事項

### 命令執行
- 所有命令通過 `runCommandSafe` 執行
- 黑名單檢查（`rm -rf`, `:(){ :|:& };:` 等）
- 超時保護（默認 5 分鐘）

### 文件操作
- 路徑檢查（禁止 `..`）
- 自動備份（`.backup` 文件）
- Review 模式下顯示 diff

### API Key
- 存儲在本地配置文件
- Windows: `%APPDATA%\bailu-cli\config.json`
- Unix: `~/.config/bailu-cli/config.json`

## 🧪 測試策略

目前項目處於早期階段，主要依賴手動測試。未來計畫：
- 單元測試（Jest）
- 集成測試（測試工具調用循環）
- E2E 測試（測試完整命令）

## 📝 代碼風格

- **縮排**: 2 空格
- **分號**: 必須
- **引號**: 雙引號
- **命名**:
  - 類/介面: PascalCase (`BailuAgent`)
  - 函數/變量: camelCase (`buildPrompt`)
  - 常量: SCREAMING_SNAKE_CASE (`MAX_ITERATIONS`)
- **註釋**: 中文

## 🐛 常見問題

### Q: 為什麼 LLM 不調用工具？
A: 檢查：
1. 工具是否已註冊到 `ToolRegistry`
2. System prompt 是否包含工具定義（`injectToolDefinitions`）
3. LLM 回應格式是否符合 XML 規範

### Q: 如何調試工具執行？
A: 設置 `verbose: true` 在 `ToolExecutionContext`：
```typescript
const executionContext = {
  workspaceRoot: process.cwd(),
  safetyMode: "review",
  verbose: true,  // 顯示詳細日誌
};
```

### Q: 為什麼會話恢復失敗？
A: 檢查 `.bailu/sessions/` 目錄是否存在且有讀寫權限。

## 🚀 未來計畫

- [ ] 支持更多 LLM 提供商（OpenAI、Claude 等）
- [ ] 插件系統（允許用戶自定義工具）
- [ ] 圖形化界面（Electron / Web UI）
- [ ] 測試生成與驗證循環
- [ ] Git 自動提交與 PR 生成
- [ ] 團隊協作功能（共享會話）

## 🔗 相關資源

- [白鹿 API 文檔](https://bailucode.com/openapi)
- [白鹿 Chat Template](./bailu_chat_template.jinja)
- [Commander.js 文檔](https://github.com/tj/commander.js)
- [TypeScript 手冊](https://www.typescriptlang.org/docs/)

---

**記住：這是一個 Agent 工具，所以你（AI）可以自己修改自己的代碼。請謹慎操作，並確保通過測試。** 🤖
