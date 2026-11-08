# 架構總覽

Bailu CLI 是一個終端 AI 編程智能體，架構對標 Claude Code 的行為與設計。

## 分層結構

```
┌─────────────────────────────────────────────────────┐
│  入口層  src/cli.ts                                  │
│  Commander 命令註冊（ask / fix / plan / chat / run）  │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  交互層  src/tui/                                    │
│  InputBox（常駐輸入框）／OutputManager（輸出共存）    │
│  picker（列表選擇器）／ChatInput（TUI/readline 雙實現）│
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  編排層  src/agent/                                  │
│  orchestrator（Agent 循環）／chat（會話）            │
│  context-compactor（上下文壓縮）／memory（記憶）      │
│  auto-test（自動測試）／file-mentions（@提及）        │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  能力層                                              │
│  src/llm/     LLM 客戶端（流式／工具定義注入）        │
│  src/tools/   15 個工具 + 執行器（權限/快照/hooks）   │
│  src/mcp/     MCP 客戶端（stdio/http/sse）           │
│  src/runtime/ 安全策略／權限規則／Hooks 鉤子          │
│  src/fs/      檔案快照／diff                          │
│  src/git/     Git 整合                                │
└─────────────────────────────────────────────────────┘
```

## Agent 循環（orchestrator）

```
用戶輸入
   ↓
┌─→ 注入工具定義到 system message
│    ↓
│   調用 LLM（流式輸出到面板）
│    ↓
│   解析 <action><invoke tool="..."> 工具調用
│    ↓
│   執行工具（權限檢查 → PreToolUse Hook → 快照 → 執行 → PostToolUse Hook）
│    ↓
│   結果回饋給 LLM（作為 user 消息）
│    ↓
│   有工具調用？──是──┐
│                    │
└────────────────────┘
        否 ↓
      輸出最終回應（Stop Hook）
```

關鍵機制：
- **智能停止**：同一工具連續失敗 3 次即停止（防死循環）
- **自動壓縮**：對話超過 context window 80% 時用 AI 摘要壓縮
- **中斷**：AbortSignal（Esc）中止當前回合，保留部分回應
- **並行**：多個只讀工具並行執行

## 工具執行管線（executor）

每個工具調用依序經過：

```
1. 工具存在性檢查
2. 權限規則檢查（permissions.deny 在所有模式生效）
3. Plan 模式檢查（只允許唯讀工具）
4. 安全模式判斷（dry-run 模擬 / review 確認 / auto-apply 直接執行）
   └─ review：safe 工具自動放行；否則請求批准（y/n/a/d/q）
5. PreToolUse Hook（退出碼 2 = 阻止）
6. 寫入類工具：先讀後寫強制 + 快照備份
7. 執行工具 handler
8. PostToolUse Hook
9. 失敗時自動還原快照
```

## 安全模型

| 層次 | 機制 |
|---|---|
| 路徑 | 工作區邊界檢查、symlink 解析、敏感目錄黑名單 |
| 命令 | 黑名單、shell 注入檢查、cwd 限制在工作區 |
| 權限 | `.bailu.yml` permissions.allow/deny 規則引擎 |
| 模式 | dry-run / plan / review / auto-apply |
| 檔案 | 先讀後寫強制、寫入前快照、失敗自動還原 |
| 鉤子 | PreToolUse 可攔截（退出碼 2） |
| MCP | 命令白名單 + 未知命令互動確認 |

## 上下文管理

| 機制 | 說明 |
|---|---|
| 分層記憶 | 全域 `~/.config/bailu-cli/BAILU.md` + 專案 `BAILU.md` |
| 自動上下文 | 提問時自動搜尋工作區相關代碼注入 |
| @ 提及 | `@path` 精確附加檔案/目錄 |
| 圖片 | `/image` 附加（多模態，需 vision 模型） |
| 壓縮 | `/compress` 或自動（80% 閾值），AI 摘要 |
| 落盤 | 超長工具輸出存 `.bailu/tool-outputs/`，可分段讀取 |

## 目錄速查

```
src/
├── cli.ts                  命令註冊與入口
├── config.ts               配置載入與合併（三層）
├── types/cli.ts            CLI 選項類型
├── tui/
│   ├── input-box.ts        常駐輸入框（行編輯/歷史/滾動）
│   ├── output-manager.ts   輸出與輸入框共存
│   ├── picker.ts           列表選擇器
│   └── chat-input.ts       TUI/readline 統一介面
├── agent/
│   ├── orchestrator.ts     Agent 循環核心
│   ├── chat.ts             會話管理與斜線命令分發
│   ├── context.ts          工作區上下文構建
│   ├── context-compactor.ts token 估算與壓縮
│   ├── memory.ts           上下文記憶
│   ├── memory-files.ts     分層記憶檔案
│   ├── auto-test.ts        自動測試驗證
│   ├── file-mentions.ts    @ 提及解析與補全
│   ├── system-prompt.ts    System prompt 構建
│   ├── chat-welcome.ts     歡迎畫面與環境檢測
│   ├── tool-display.ts     工具人性化描述
│   ├── session.ts / chat-session-manager.ts  會話持久化
│   ├── plan-mode.ts        計劃模式
│   ├── sub-agents.ts       子代理（explore/plan/verification）
│   └── commands/           33+ 斜線命令處理器
├── llm/
│   ├── client.ts           LLM 客戶端（流式/多模態）
│   ├── prompts.ts          提示詞模板
│   └── tool-injection.ts   工具定義注入
├── tools/
│   ├── registry.ts         工具註冊表
│   ├── executor.ts         執行器（權限/快照/hooks）
│   ├── parser.ts           工具調用解析
│   ├── read-tracker.ts     先讀後寫追蹤
│   ├── todo-store.ts       任務清單
│   ├── background-tasks.ts 後台任務
│   └── implementations/    15 個工具實現
├── mcp/
│   ├── client.ts           MCP 客戶端（三種傳輸）
│   └── manager.ts          MCP 管理器
├── runtime/
│   ├── policy.ts           安全策略
│   ├── runner.ts           命令執行
│   ├── permissions.ts      權限規則引擎
│   └── hooks.ts            Hooks 鉤子系統
├── fs/                     快照、diff
├── git/                    Git 整合
└── utils/                  日誌、輸出、寬度計算等
```

## 工具清單（15 個）

| 工具 | 用途 | 唯讀 |
|---|---|---|
| read_file | 讀取檔案（分段） | ✅ |
| edit_file | 精確替換編輯 | |
| write_file | 建立/重寫檔案 | |
| apply_diff | 應用 unified diff | |
| list_directory | 列出目錄 | ✅ |
| grep_search | 內容搜索 | ✅ |
| file_search | 檔名搜索 | ✅ |
| run_command | 執行命令（支援後台） | |
| task_output | 後台任務輸出輪詢 | ✅ |
| task_kill | 終止後台任務 | |
| todo_write | 任務清單 | ✅ |
| dispatch_agent | 子代理調度 | |
| web_fetch | 抓取網頁 | ✅ |
| web_search | 網頁搜索 | ✅ |
| mcp_* | MCP 外部工具（動態） | |
