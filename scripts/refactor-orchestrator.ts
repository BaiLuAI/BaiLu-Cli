/**
 * Phase 0.2：從 orchestrator.ts 移除已抽出的方法（行級操作，縮排級別判定邊界）
 * 執行後刪除本檔案
 */
import fs from "fs";

const NL = "\n";
let s = fs.readFileSync("src/agent/orchestrator.ts", "utf8").replace(/\r\n/g, "\n"); // 正規化 CRLF
let lines = s.split(NL);

/** 找到包含 marker 的行號 */
function findLine(marker: string, from = 0): number {
  const idx = lines.findIndex((l, i) => i >= from && l.includes(marker));
  if (idx === -1) throw new Error("marker not found: " + marker);
  return idx;
}

/**
 * 移除一個區塊：從 startLine 往上找到 JSDoc 開頭（可選），
 * 往下找到指定縮排級別的結束行（endIndent 個空格 + "}"）
 */
function removeBlock(startMarker: string, endIndent: number, includeJsdoc: boolean): void {
  const sigIdx = findLine(startMarker);
  let endIdx = sigIdx;
  const closer = " ".repeat(endIndent) + "}";
  while (endIdx < lines.length && lines[endIdx] !== closer) endIdx++;
  if (endIdx >= lines.length) throw new Error("end not found for: " + startMarker);

  let start = sigIdx;
  if (includeJsdoc) {
    // 往上找緊鄰的 JSDoc（允許中間無空行）
    let i = sigIdx - 1;
    if (lines[i]?.trim() === "*/") {
      while (i >= 0 && lines[i].trim() !== "/**") i--;
      if (i >= 0) start = i;
    }
  }

  const removed = endIdx - start + 1;
  // 移除區塊及其後的空行（避免連續空行）
  let end = endIdx + 1;
  if (lines[end] === "") end++;
  lines.splice(start, end - start);
  console.log(`removed ${removed}+ lines for: ${startMarker}`);
}

// 1. 頂層 humanizeToolCall 函數（結束是第 0 縮排的 }）
removeBlock("function humanizeToolCall(toolCall: ToolCall): string {", 0, true);

// 2. 類內方法（結束是 2 縮排的 }）
removeBlock("private estimateTokens(messages: ChatMessage[]): number {", 2, true);
removeBlock("private getModelContextWindow(): number {", 2, true);
removeBlock("private async autoCompressMessages(messages: ChatMessage[], maxTokens?: number): Promise<void> {", 2, true);
removeBlock("private async runAutoTest(): Promise<string | null> {", 2, true);
removeBlock("private getToolActionDescription(toolCall: ToolCall): string {", 2, true);

// 3. 常量區塊（MODEL_CONTEXT_WINDOWS 到 DEFAULT_CONTEXT_WINDOW）
const mcStart = lines.findIndex((l) => l.includes("MODEL_CONTEXT_WINDOWS: Record<string, number>"));
if (mcStart === -1) throw new Error("mc");
// 往上含 JSDoc
let mcBegin = mcStart;
if (lines[mcBegin - 1]?.trim() === "*/") {
  let i = mcBegin - 1;
  while (i >= 0 && lines[i].trim() !== "/**") i--;
  mcBegin = i;
}
const dcIdx = lines.findIndex((l, i) => i >= mcStart && l.includes("const DEFAULT_CONTEXT_WINDOW = 16000;"));
if (dcIdx === -1) throw new Error("dc");
lines.splice(mcBegin, dcIdx - mcBegin + 1);
console.log("removed MODEL_CONTEXT_WINDOWS block");

s = lines.join(NL);

// 4. 呼叫點與欄位更新
s = s.replace(
  "        // 自动压缩对话历史（超过 80% 阈值时）\n        if (this.autoCompress) {\n          await this.autoCompressMessages(messages);\n        }",
  "        // 自动压缩对话历史（超过 80% 阈值时）\n        if (this.autoCompress) {\n          await this.compactor.maybeCompress(messages, modelName);\n        }"
);
s = s.replace("const testResult = await this.runAutoTest();", "const testResult = await runAutoTest(this.workspaceRoot);");
s = s.replace("const actionDesc = this.getToolActionDescription(toolCall);", "const actionDesc = getToolActionDescription(toolCall);");
s = s.replace("    this.autoCompress = true; // 自动压缩\n", "");
s = s.replace(
  "    this.memory = new ContextMemory(); // 初始化记忆系统\n",
  "    this.memory = new ContextMemory(); // 初始化记忆系统\n    this.compactor = new ContextCompactor(this.llmClient, options.verbose || false); // 上下文壓縮器\n"
);
s = s.replace(
  "  private memory: ContextMemory; // 上下文记忆\n",
  "  private memory: ContextMemory; // 上下文记忆\n  private compactor: ContextCompactor; // 上下文壓縮器\n"
);

// 5. imports
s = s.replace(
  'import { ContextMemory } from "./memory.js";',
  'import { ContextMemory } from "./memory.js";\nimport { ContextCompactor } from "./context-compactor.js";\nimport { runAutoTest } from "./auto-test.js";\nimport { getToolActionDescription } from "./tool-display.js";'
);

fs.writeFileSync("src/agent/orchestrator.ts", s);
console.log("done");
