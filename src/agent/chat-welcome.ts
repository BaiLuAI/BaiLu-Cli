/**
 * 歡迎畫面與環境檢測（從 chat.ts 抽出）
 */

import chalk from "chalk";
import { execSync } from "child_process";
import { LLMClient } from "../llm/client.js";
import { WorkspaceContext } from "./types.js";

/**
 * 顯示歡迎信息
 */
export function printWelcome(llmClient: LLMClient, workspaceContext: WorkspaceContext): void {
  // ASCII Art Banner
  console.log(chalk.cyan(`
                                        ,--,                                          ,--,             
                                     ,---.'|                                       ,---.'|             
    ,---,.     ,---,           ,---, |   | :                             ,----..   |   | :       ,---, 
  ,'  .'  \\   '  .' \\       ,\`--.' | :   : |             ,--,           /   /   \\  :   : |    ,\`--.' | 
,---.' .' |  /  ;    '.     |   :  : |   ' :           ,'_ /|          |   :     : |   ' :    |   :  : 
|   |  |: | :  :       \\    :   |  ' ;   ; '      .--. |  | :          .   |  ;. / ;   ; '    :   |  ' 
:   :  :  / :  |   /\\   \\   |   :  | '   | |__  ,'_ /| :  . |          .   |  ;. / ;   ; '    :   |  ' 
:   |    ;  |  :  ' ;.   :  '   '  ; |   | :.'| |  ' | |  . .          ;   | ;     |   | :.'| '   '  ; 
|   :     \\ |  |  ;/  \\   \\ |   |  | '   :    ; |  | ' |  | |          |   : |     '   :    ; |   |  | 
|   |   . | '  :  | \\  \\ ,' '   :  ; |   |  ./  :  | | :  ' ;          .   | '___  |   |  ./  '   :  ; 
'   :  '; | |  |  '  '--'   |   |  ' ;   : ;    |  ; ' |  | '          '   ; : .'| ;   : ;    |   |  ' 
|   |  | ;  |  :  :         '   :  | |   ,/     :  | : ;  ; |          '   | '/  : |   ,/     '   :  | 
|   :   /   |  | ,'         ;   |.'  '---'      '  :  \`--'   \\         |   :    /  '---'      ;   |.'  
|   | ,'    \`--''           '---'               :  ,      .-./          \\   \\ .'              '---'    
\`----'                                           \`--\`----'               \`---\`                         
    `));

  console.log(chalk.green("\n╔════════════════════════════════════════════════════╗"));
  console.log(chalk.green("║") + chalk.bold.cyan("      Bailu Chat - AI 交互模式                      ") + chalk.green("║"));
  console.log(chalk.green("╚════════════════════════════════════════════════════╝"));

  console.log(chalk.gray("\n💡 快速開始："));
  console.log(chalk.cyan("  • 直接輸入問題或需求，AI 會自動處理"));
  console.log(chalk.cyan("  • 輸入 ") + chalk.green("/") + chalk.cyan(" 顯示所有斜線命令（可用上下鍵選擇）"));
  console.log(chalk.cyan("  • 輸入 ") + chalk.green("/help") + chalk.cyan(" 查看命令說明"));
  console.log(chalk.cyan("  • 輸入 ") + chalk.green("/add <文件>") + chalk.cyan(" 添加文件到上下文"));
  console.log(chalk.cyan("  • 多行輸入：每行行尾加 ") + chalk.green("\\") + chalk.cyan(" 繼續，不加則提交"));
  console.log(chalk.yellow("  • 📋 貼上多行文字後，") + chalk.green("請按一次 Enter") + chalk.yellow(" 確保完整"));
  console.log(chalk.cyan("  • 輸入 ") + chalk.green("exit") + chalk.cyan(" 退出"));
  console.log(chalk.gray("  • ⌨️  處理中按 ") + chalk.green("Esc") + chalk.gray(" 中斷當前回合；直接打字 + Enter 可排隊訊息"));
  console.log(chalk.gray("  • 💾 對話會自動保存（每 60 秒）"));

  const currentModel = llmClient.getModelName();
  const safetyMode = process.env.BAILU_MODE || "review";

  console.log(chalk.gray("\n⚙️  當前配置："));
  console.log(chalk.gray(`  模型: ${chalk.yellow(currentModel)}`));
  console.log(chalk.gray(`  模式: ${chalk.yellow(safetyMode)}`));
  console.log(chalk.gray(`  工作區: ${chalk.yellow(workspaceContext.rootPath)}`));
  console.log();
}

/**
 * 檢測環境中可用的開發工具
 * 用於告訴模型該用 python 還是 python3，npm 還是 yarn
 */
export function detectEnvironmentTools(): string {
  // 定義我們要檢查的常用工具列表
  const toolsToCheck = [
    'python', 'python3',
    'pip', 'pip3',
    'node', 'npm', 'yarn', 'pnpm',
    'git', 'docker',
    'go', 'cargo', 'rustc',
    'java', 'javac',
    'gcc', 'clang', 'make'
  ];

  const availableTools: string[] = [];

  for (const tool of toolsToCheck) {
    try {
      // Windows 用 'where', Mac/Linux 用 'which'
      const checkCmd = process.platform === 'win32' ? `where ${tool}` : `which ${tool}`;

      // stdio: 'ignore' 防止命令輸出干擾終端
      execSync(checkCmd, { stdio: 'ignore' });
      availableTools.push(tool);
    } catch {
      // 指令執行失敗代表工具不存在，忽略即可
    }
  }

  return availableTools.length > 0 ? availableTools.join(', ') : "未檢測到常用開發工具";
}
