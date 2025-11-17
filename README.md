# Bailu CLI

**一個由 AI 驅動的終端智能體，讓代碼自己會改代碼。**

Bailu CLI 是對標 OpenAI Codex 的本地化 Agent 工具，集成白鹿大模型，支持工具調用、多輪對話、自動編碼和測試驗證。

```
                                        ,--,                                          ,--,             
                                     ,---.'|                                       ,---.'|             
    ,---,.     ,---,           ,---, |   | :                             ,----..   |   | :       ,---, 
  ,'  .'  \   '  .' \       ,`--.' | :   : |             ,--,           /   /   \  :   : |    ,`--.' | 
,---.' .' |  /  ;    '.     |   :  : |   ' :           ,'_ /|          |   :     : |   ' :    |   :  : 
|   |  |: | :  :       \    :   |  ' ;   ; '      .--. |  | :          .   |  ;. / ;   ; '    :   |  ' 
:   :  :  / :  |   /\   \   |   :  | '   | |__  ,'_ /| :  . |          .   ; /--`  '   | |__  |   :  | 
:   |    ;  |  :  ' ;.   :  '   '  ; |   | :.'| |  ' | |  . .          ;   | ;     |   | :.'| '   '  ; 
|   :     \ |  |  ;/  \   \ |   |  | '   :    ; |  | ' |  | |          |   : |     '   :    ; |   |  | 
|   |   . | '  :  | \  \ ,' '   :  ; |   |  ./  :  | | :  ' ;          .   | '___  |   |  ./  '   :  ; 
'   :  '; | |  |  '  '--'   |   |  ' ;   : ;    |  ; ' |  | '          '   ; : .'| ;   : ;    |   |  ' 
|   |  | ;  |  :  :         '   :  | |   ,/     :  | : ;  ; |          '   | '/  : |   ,/     '   :  | 
|   :   /   |  | ,'         ;   |.'  '---'      '  :  `--'   \         |   :    /  '---'      ;   |.'  
|   | ,'    `--''           '---'               :  ,      .-./          \   \ .'              '---'    
`----'                                           `--`----'               `---`                         
```

## ✨ 主要功能

### 🤖 工具調用系統
- **read_file** - 讀取文件內容
- **write_file** - 寫入文件（支持 diff 預覽）
- **list_directory** - 遞迴列出目錄
- **run_command** - 安全執行 shell 命令
- **apply_diff** - 應用 unified diff 補丁

### 🛡️ 三種安全模式
- **dry-run** - 僅顯示計畫，不實際執行
- **review** - 每個操作前需要用戶確認（默認）
- **auto-apply** - 自動執行（僅用於可信環境）

### 💬 交互模式
- **bailu ask** - 單次問答（只讀）
- **bailu fix** - 自動修改代碼（支持工具調用）
- **bailu chat** - 多輪對話模式
- **bailu run** - 複雜任務執行（支持暫停/恢復）

### 🔍 智能 Diff
- 使用真正的 unified diff 算法
- 彩色高亮顯示（+綠色、-紅色）
- 自動統計增刪行數

### 📦 會話管理
- 任務自動保存到 `.bailu/sessions/`
- 支持 `--resume` 恢復中斷的任務
- `--list` 查看所有歷史會話

---

## 🚀 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 構建

```bash
npm run build
```

### 3. 配置 API Key

第一次運行時會自動提示輸入白鹿 API Key，並保存到本地配置：

```bash
node dist/cli.js ask "這個專案是做什麼的？"
```

或者設置環境變量：

```bash
# Windows PowerShell
$env:BAILU_API_KEY="sk-你的白鹿Key"

# macOS / Linux
export BAILU_API_KEY="sk-你的白鹿Key"
```

### 4. 基本使用

```bash
# 問答模式（只讀）
node dist/cli.js ask "這個專案的主要入口文件是什麼？"

# 自動修改代碼（會調用工具）
node dist/cli.js fix "把 README 的安裝步驟改成 pnpm"

# 進入交互對話
node dist/cli.js chat

# 執行複雜任務
node dist/cli.js run "重構 auth 模組，分離驗證邏輯"

# 列出歷史會話
node dist/cli.js run --list

# 恢復中斷的任務
node dist/cli.js run --resume session_xxx
```

---

## 📚 命令詳解

### `bailu ask [問題]`
純問答模式，不會修改任何文件。適合：
- 了解代碼庫結構
- 詢問技術實現
- 獲取開發建議

**示例：**
```bash
bailu ask "這個專案用了哪些依賴？"
bailu ask "auth 模組的工作原理是什麼？"
```

### `bailu fix [需求描述]`
AI 自動修改代碼，支持工具調用。會：
1. 分析當前代碼庫
2. 規劃修改步驟
3. 調用工具（讀文件、寫文件、跑命令）
4. 在 review 模式下展示 diff 並請求確認

**示例：**
```bash
bailu fix "優化 package.json 的腳本，加上 lint 命令"
bailu fix "把所有 var 改成 const 或 let"
```

**安全控制：**
```bash
# dry-run：只看計畫，不執行
BAILU_MODE=dry-run bailu fix "刪除所有 console.log"

# review：每個操作前確認（默認）
BAILU_MODE=review bailu fix "重構代碼"

# auto-apply：自動執行（危險）
BAILU_MODE=auto-apply bailu fix "格式化代碼"
```

### `bailu chat`
進入交互式對話，可以：
- 多輪對話記憶上下文
- 隨時調用工具
- 輸入 `clear` 清空歷史
- 輸入 `exit` 退出

**示例：**
```
你: 列出 src 目錄下的所有文件
Bailu: (調用 list_directory 工具)

你: 讀取 src/index.ts
Bailu: (調用 read_file 工具)

你: 幫我加個日誌輸出
Bailu: (調用 write_file 工具，展示 diff，請求確認)
```

### `bailu run [任務描述]`
執行複雜的多步驟任務：
- 自動保存進度
- 支持中斷後恢復
- 完整的執行歷史

**示例：**
```bash
# 創建新任務
bailu run "實現用戶註冊功能：驗證郵箱、哈希密碼、寫入資料庫"

# 任務會自動保存，輸出類似：
# [創建新任務] ID: session_1234567_abc

# 如果中斷（Ctrl+C），稍後可以恢復：
bailu run --resume session_1234567_abc

# 查看所有歷史任務
bailu run --list
```

### `bailu models`
列出當前白鹿賬號可用的模型：

```bash
bailu models
```

---

## ⚙️ 環境變量

| 變量 | 說明 | 默認值 |
|------|------|--------|
| `BAILU_API_KEY` | 白鹿 API Key | 無（首次會提示輸入） |
| `BAILU_MODEL` | 模型 ID | `bailu-chat` |
| `BAILU_BASE_URL` | API 端點 | `https://bailucode.com/openapi/v1` |
| `BAILU_MODE` | 安全模式 | `review` |
| `BAILU_CONFIG_DIR` | 配置目錄 | `~/.config/bailu-cli` (Unix) / `%APPDATA%\bailu-cli` (Windows) |

---

## 🗂️ 項目配置

### `.bailu.yml`
在專案根目錄創建此文件，告訴 AI 如何處理你的專案：

```yaml
# 測試命令
testCommand: "npm test"

# 構建命令
buildCommand: "npm run build"

# AI 應該關注的目錄
includePaths:
  - "src"
  - "lib"

# AI 應該忽略的目錄
excludePaths:
  - "dist"
  - "node_modules"
  - ".git"

# 額外說明
notes: |
  這是一個 TypeScript 專案，使用 ESM 模組系統。
  修改代碼後請確保通過 TypeScript 編譯檢查。
```

### `AGENT.md`
更詳細的 AI 指引文件，類似 README 但是寫給 AI 看：

```markdown
# Bailu Agent 指引

## 專案架構
- src/cli.ts - CLI 入口
- src/agent/ - Agent 核心邏輯
- src/tools/ - 工具系統
- src/llm/ - LLM 客戶端

## 開發規範
- 所有 TypeScript 必須有類型標註
- 使用 2 空格縮排
- 註釋使用中文

## 測試
運行測試：`npm test`
測試框架：Jest

## 發布流程
1. 更新 package.json 版本號
2. npm run build
3. npm publish
```

---

## 🔧 常見問題

### Q: 為什麼第一次運行很慢？
A: 首次運行時 Bailu 會掃描整個代碼庫構建上下文。後續運行會快很多。

### Q: 如何停止 Agent 的操作？
A: 在 review 模式下，每個操作前都會詢問。直接輸入 `n` 拒絕，或 `q` 退出整個任務。

### Q: AI 改壞了我的代碼怎麼辦？
A: 
1. 所有 `write_file` 操作默認會創建 `.backup` 備份文件
2. 使用 Git：`git diff` 查看改動，`git restore` 回滾
3. 在 review 模式下，每次改動前都會展示 diff

### Q: 模型返回 "Model bailu-chat does not exist"？
A: 運行 `bailu models` 查看你賬號可用的模型，然後設置：
```bash
export BAILU_MODEL="你的模型ID"
```

### Q: 如何清除配置重新開始？
A: 刪除配置文件：
- Windows: `%APPDATA%\bailu-cli\config.json`
- macOS/Linux: `~/.config/bailu-cli/config.json`

---

## 🏗️ 架構概覽

```
Bailu CLI
├── CLI 層（commander）
│   ├── ask / fix / chat / run
│   └── 參數解析 + 啟動 Logo
├── Agent 核心
│   ├── BailuAgent - 任務模型與狀態機
│   ├── AgentOrchestrator - LLM ↔ 工具循環
│   ├── ChatSession - 多輪對話管理
│   └── SessionManager - 會話持久化
├── LLM 層
│   ├── LLMClient - 白鹿 API 調用（支持流式）
│   └── Prompts - 提示詞模板
├── 工具系統
│   ├── ToolRegistry - 工具註冊中心
│   ├── ToolExecutor - 工具執行器（含安全策略）
│   ├── ToolParser - 解析 XML 格式工具調用
│   └── 內建工具：read_file / write_file / list_directory / run_command / apply_diff
├── 文件與 Git
│   ├── Workspace - 文件讀寫
│   ├── Diff - unified diff 生成（彩色輸出）
│   └── GitIntegration - Git 狀態查詢
└── 安全與執行
    ├── SafetyPolicy - 三種模式 + 命令白黑名單
    └── CommandRunner - 安全的子進程執行
```

---

## 🤝 貢獻

歡迎提交 Issue 和 PR！

### 本地開發

```bash
# 安裝依賴
npm install

# 開發模式（不需要 build）
npm run dev ask "測試問題"

# 構建
npm run build

# 運行構建後的版本
npm start ask "測試問題"
```

---

## 📜 許可證

MIT License

---

## 🙏 致謝

- [OpenAI Codex](https://github.com/openai/codex) - 靈感來源
- [白鹿 AI](https://bailucode.com) - LLM 提供商
- [Commander.js](https://github.com/tj/commander.js) - CLI 框架
- [diff](https://github.com/kpdecker/jsdiff) - Diff 算法

---

**讓 AI 成為你的終端夥伴，從此代碼自己會改代碼。** 🚀
