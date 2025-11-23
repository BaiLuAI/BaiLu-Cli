# 調試指南

## 調試工具調用問題

如果 AI 不調用工具，使用以下步驟診斷：

### 1. 啟用調試模式

```powershell
# Windows PowerShell
$env:BAILU_DEBUG="1"
bailu

# 或單次命令
$env:BAILU_DEBUG="1"; bailu
```

```bash
# Linux/macOS
export BAILU_DEBUG=1
bailu
```

### 2. 檢查調試輸出

啟用後會顯示：
```
[DEBUG] 發送 5 個工具到 API
[DEBUG] 工具名稱: read_file, write_file, list_directory, run_command, apply_diff
[DEBUG] tool_choice: auto
```

### 3. 診斷問題

#### 情況 A：看到調試輸出
✅ 工具定義已發送到 API
❌ 模型選擇不調用工具

**可能原因：**
- Test-Hide 模型對 function calling 支持有限
- 白鹿 API 的 `tools` 參數格式與 OpenAI 不同
- 需要更明確的 system prompt

**解決方案：**
1. 切換模型：`/model` 或 `bailu models`
2. 使用 `bailu fix` 命令（使用不同的策略）
3. 明確指示：「請調用 write_file 工具來修改文件」

#### 情況 B：沒有看到調試輸出
❌ 工具定義沒有發送或代碼流程有問題

**檢查：**
```powershell
node test-agent-flow.js
```

### 4. 測試工具解析

```powershell
node test-parser.js
```

應該看到：
```
✅ 所有測試通過！
```

### 5. 測試特定模型

```powershell
# 設置模型
$env:BAILU_MODEL="bailu-2.5-pro"

# 啟用調試
$env:BAILU_DEBUG="1"

# 運行
bailu
```

## 常見問題

### Q: 調試輸出顯示工具已發送，但 AI 還是不調用？

**v0.2.0+ 默認使用 bailu-2.6**，工具調用支持較好。如果使用 Test-Hide 等舊模型遇到此問題：

**Test-Hide 模型的已知限制**：
- 不完全支持 OpenAI function calling 格式
- 更依賴 system prompt 中的文字說明
- 對工具調用的理解不夠準確

**建議：**
1. 使用默認的 `bailu-2.6` 模型（無需設置）
2. 或切換到 `bailu-2.6-preview`、`bailu-2.6-fast-thinking`
3. 使用 `bailu fix` 而非 `bailu chat`
4. 在提示中明確說明：「請使用 write_file 工具」

### Q: 如何查看發送給 API 的完整請求？

修改 `src/llm/client.ts`：

```typescript
if (process.env.BAILU_DEBUG) {
  console.log('[DEBUG] 完整請求體:');
  console.log(JSON.stringify(body, null, 2));
}
```

### Q: 白鹿 API 的 tools 格式是什麼？

代碼使用 OpenAI 標準格式：

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "write_file",
        "description": "...",
        "parameters": {
          "type": "object",
          "properties": { ... },
          "required": ["path", "content"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

如果白鹿 API 不支持此格式，可能需要：
1. 查閱白鹿官方文檔
2. 只依賴 system prompt 中的工具說明
3. 移除 `tools` 參數，只用 XML 格式提示

## 完整測試流程

```powershell
# 1. 構建
npm run build

# 2. 測試解析器
node test-parser.js

# 3. 測試 agent 流程
node test-agent-flow.js

# 4. 啟用調試運行
$env:BAILU_DEBUG="1"
bailu

# 5. 測試工具調用
你: 幫我列出當前目錄的文件
# 查看是否有 [DEBUG] 輸出
# 查看是否有 [將執行 X 個操作] 輸出
```
