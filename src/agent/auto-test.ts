/**
 * 自動測試驗證（從 orchestrator 抽出）
 *
 * 讀取 .bailu.yml 的 testCommand，在檔案被修改後自動執行，
 * 失敗時把錯誤輸出回饋給 AI 修復（edit → test → fix 循環）。
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import YAML from "yaml";
import { runCommandSafe } from "../runtime/runner.js";
import { getDefaultPolicy } from "../runtime/policy.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("AutoTest");

/**
 * 執行 .bailu.yml 配置的 testCommand
 * @returns 測試結果字串（用於反饋給 AI），若無 testCommand 則返回 null
 */
export async function runAutoTest(workspaceRoot: string): Promise<string | null> {
  try {
    const configPath = path.join(workspaceRoot, ".bailu.yml");
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const config = YAML.parse(raw);
    const testCommand = config?.testCommand;

    if (!testCommand || typeof testCommand !== "string") {
      return null;
    }

    console.log(chalk.cyan(`\n[AUTO-TEST] 正在執行測試: ${testCommand}`));

    const policy = getDefaultPolicy();
    policy.maxCommandDurationMs = 60 * 1000; // 測試最多 60 秒

    const result = await runCommandSafe(workspaceRoot, testCommand, [], policy);

    if (result.exitCode === 0) {
      console.log(chalk.green(`[AUTO-TEST] ✓ 測試通過`));
      return `[自動測試驗證]\n命令: ${testCommand}\n結果: ✓ 測試通過`;
    }

    const output = (result.stderr || result.stdout || "").slice(-2000);
    console.log(chalk.red(`[AUTO-TEST] ✗ 測試失敗 (退出碼: ${result.exitCode})`));
    if (output.trim()) {
      console.log(chalk.gray(output.trim().split("\n").slice(-10).join("\n")));
    }
    return `[自動測試驗證 — 失敗]\n命令: ${testCommand}\n退出碼: ${result.exitCode}\n錯誤輸出:\n${output}\n\n[重要] 測試失敗！請分析錯誤輸出並修復代碼，然後重新運行測試。`;
  } catch (error) {
    logger.warn(`自動測試執行失敗: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
