#!/usr/bin/env node

// 加载 .env 文件（必须在最开始，优先级最低）
import dotenv from "dotenv";
dotenv.config(); // 从当前目录加载 .env

import { Command } from "commander";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { BailuAgent } from "./agent/core.js";
import { LLMClient } from "./llm/client.js";
import { buildAskPrompt, buildFixPrompt } from "./llm/prompts.js";
import { ensureApiKeyInteractive, mergeConfigs } from "./config.js";
import { AgentOrchestrator } from "./agent/orchestrator.js";
import { globalToolRegistry, builtinTools, ToolExecutionContext } from "./tools/index.js";
import { SessionManager } from "./agent/session.js";
import { ChatSession } from "./agent/chat.js";
import { FixCommandOptions, RunCommandOptions } from "./types/cli.js";
import { fileURLToPath } from "url";

// 动态读取 package.json 版本号
function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packagePath = path.resolve(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Basic handlers using Bailu LLM; more advanced behaviours (diff、命令執行等) 將在後續步驟中實現。
async function handleAsk(question: string | undefined) {
  if (!question) {
    console.log(chalk.yellow("請提供一個問題，例如："));
    console.log(chalk.cyan("  bailu ask \"這個專案的主要入口在哪裡？\""));
    return;
  }

  const apiKey = await ensureApiKeyInteractive();
  const config = mergeConfigs();
  const agent = new BailuAgent();
  const ctx = agent.getWorkspaceContext();
  const llm = new LLMClient({ apiKey, baseUrl: config.baseUrl, model: config.model });
  const messages = buildAskPrompt(ctx, question);

  console.log(chalk.cyan("\n[Bailu 回答]\n"));

  // 使用流式輸出
  for await (const chunk of llm.chatStream(messages)) {
    process.stdout.write(chunk);
  }
  console.log("\n"); // 結束後換行
}

async function handleFix(instruction: string | undefined, options: FixCommandOptions = {}) {
  if (!instruction) {
    console.log(chalk.yellow("請描述你想修改的內容，例如："));
    console.log(chalk.cyan("  bailu fix \"把 README 的安裝步驟改成 pnpm\""));
    console.log(chalk.cyan("  bailu fix \"重構 auth 模組，分離驗證邏輯\""));
    return;
  }

  const apiKey = await ensureApiKeyInteractive();
  
  // 合并所有配置源（CLI 参数 > 项目配置 > 用户配置 > 环境变量 > 默认值）
  const config = mergeConfigs({
    safetyMode: options.mode,
    maxIterations: options.maxIterations,
    verbose: options.verbose,
  });
  
  // 註冊所有內建工具
  globalToolRegistry.registerAll(builtinTools);

  // 構建執行上下文
  const executionContext: ToolExecutionContext = {
    workspaceRoot: process.cwd(),
    safetyMode: config.safetyMode!,
    verbose: config.verbose!,
  };

  // 創建 Agent 和 Orchestrator
  const agent = new BailuAgent();
  const ctx = agent.getWorkspaceContext();
  const llm = new LLMClient({ apiKey, baseUrl: config.baseUrl, model: config.model });
  const orchestrator = new AgentOrchestrator({
    llmClient: llm,
    toolRegistry: globalToolRegistry,
    executionContext,
    maxIterations: config.maxIterations!,
    verbose: config.verbose!,
  });

  // 構建初始消息
  const messages = buildFixPrompt(ctx, instruction);

  console.log(chalk.green(`\n[開始執行任務] 模式: ${config.safetyMode}`));
  console.log(chalk.gray(`工作目錄: ${process.cwd()}`));
  console.log(chalk.gray(`可用工具: ${globalToolRegistry.getAllNames().join(", ")}\n`));

  // 執行 Agent 循環
  const result = await orchestrator.run(messages, true);

  if (result.success) {
    console.log(chalk.green(`\n✓ 任務完成`));
    console.log(chalk.gray(`循環次數: ${result.iterations}`));
    console.log(chalk.gray(`工具調用: ${result.toolCallsExecuted} 次`));
    if (result.finalResponse) {
      console.log(chalk.cyan("\n[最終回應]"));
      console.log(result.finalResponse);
    }
  } else {
    console.log(chalk.red(`\n✗ 任務失敗: ${result.error}`));
  }
}

async function handlePlan(description: string | undefined) {
  console.log(chalk.cyan("[Bailu]"), "規劃模式尚在開發中。");
  if (description) {
    console.log("你的描述：", description);
  }
}

async function handleChat() {
  const apiKey = await ensureApiKeyInteractive();
  
  // 合并所有配置源（CLI 参数 > 项目配置 > 用户配置 > 环境变量 > 默认值）
  const config = mergeConfigs({
    verbose: false, // chat 模式默認不顯示詳細日誌
  });
  
  // 註冊工具
  globalToolRegistry.registerAll(builtinTools);

  const executionContext: ToolExecutionContext = {
    workspaceRoot: process.cwd(),
    safetyMode: config.safetyMode!,
    verbose: config.verbose!,
  };

  const agent = new BailuAgent();
  const ctx = agent.getWorkspaceContext();
  const llm = new LLMClient({ apiKey, baseUrl: config.baseUrl, model: config.model });

  const chatSession = new ChatSession({
    llmClient: llm,
    toolRegistry: globalToolRegistry,
    workspaceContext: ctx,
    executionContext,
  });

  await chatSession.start();
}

async function handleRun(description: string | undefined, options: RunCommandOptions) {
  const apiKey = await ensureApiKeyInteractive();
  const sessionManager = new SessionManager();

  // 如果提供 --resume 選項，恢復已有任務
  if (options.resume) {
    await handleResumeSession(options.resume, apiKey, sessionManager);
    return;
  }

  // 如果提供 --list，列出所有會話
  if (options.list) {
    await handleListSessions(sessionManager);
    return;
  }

  // 創建新任務
  if (!description) {
    console.log(chalk.yellow("請提供任務描述，例如："));
    console.log(chalk.cyan("  bailu run \"重構 auth 模組，提取驗證邏輯到獨立文件\""));
    console.log(chalk.cyan("  bailu run --resume session_xxx"));
    console.log(chalk.cyan("  bailu run --list"));
    return;
  }

  // 註冊工具
  globalToolRegistry.registerAll(builtinTools);

  // 創建任務
  const agent = new BailuAgent();
  const task = agent.createTask("run", description);
  const session = await sessionManager.createSession(task);

  console.log(chalk.green(`\n[創建新任務] ID: ${session.sessionId}`));
  console.log(chalk.gray(`任務描述: ${description}`));
  console.log(chalk.gray(`可以使用 "bailu run --resume ${session.sessionId}" 恢復此任務\n`));

  // 執行任務
  await executeTask(description, apiKey, session.sessionId, sessionManager);
}

async function handleResumeSession(sessionId: string, apiKey: string, sessionManager: SessionManager) {
  const session = await sessionManager.loadSession(sessionId);
  if (!session) {
    console.log(chalk.red(`會話 ${sessionId} 不存在`));
    return;
  }

  console.log(chalk.green(`\n[恢復任務] ID: ${session.sessionId}`));
  console.log(chalk.gray(`任務描述: ${session.task.description}`));
  console.log(chalk.gray(`已執行的 run 數: ${session.runs.length}\n`));

  // 繼續執行
  globalToolRegistry.registerAll(builtinTools);
  await executeTask(session.task.description, apiKey, session.sessionId, sessionManager);
}

async function handleListSessions(sessionManager: SessionManager) {
  const sessions = await sessionManager.listSessions();

  if (sessions.length === 0) {
    console.log(chalk.gray("沒有保存的會話"));
    return;
  }

  console.log(chalk.cyan("\n[保存的會話]\n"));
  for (const session of sessions) {
    const lastRun = session.runs[session.runs.length - 1];
    const status = lastRun?.status || session.task.status;
    const statusColor = status === "succeeded" ? chalk.green : status === "failed" ? chalk.red : chalk.yellow;

    console.log(chalk.bold(session.sessionId));
    console.log(chalk.gray(`  任務: ${session.task.description}`));
    console.log(statusColor(`  狀態: ${status}`));
    console.log(chalk.gray(`  最後更新: ${new Date(session.lastUpdatedAt).toLocaleString()}`));
    console.log(chalk.gray(`  執行次數: ${session.runs.length}`));
    console.log();
  }
}

async function executeTask(
  description: string,
  apiKey: string,
  sessionId: string,
  sessionManager: SessionManager
) {
  const config = mergeConfigs();
  const executionContext: ToolExecutionContext = {
    workspaceRoot: process.cwd(),
    safetyMode: config.safetyMode!,
    verbose: true,
  };

  const agent = new BailuAgent();
  const ctx = agent.getWorkspaceContext();
  const llm = new LLMClient({ apiKey, baseUrl: config.baseUrl, model: config.model });
  const orchestrator = new AgentOrchestrator({
    llmClient: llm,
    toolRegistry: globalToolRegistry,
    executionContext,
    maxIterations: config.maxIterations || 15,
    verbose: true,
  });

  const messages = buildFixPrompt(ctx, description);

  console.log(chalk.green(`[開始執行] 模式: ${config.safetyMode}\n`));

  const result = await orchestrator.run(messages, true);

  // 保存執行記錄
  const session = await sessionManager.loadSession(sessionId);
  if (session) {
    const run = agent.getRun(session.currentRunId || "");
    if (run) {
      run.status = result.success ? "succeeded" : "failed";
      run.finishedAt = new Date().toISOString();
      await sessionManager.updateSessionRun(sessionId, run);
    }
  }

  if (result.success) {
    console.log(chalk.green(`\n✓ 任務完成`));
    console.log(chalk.gray(`會話 ID: ${sessionId}`));
  } else {
    console.log(chalk.red(`\n✗ 任務失敗: ${result.error}`));
    console.log(chalk.yellow(`可以使用 "bailu run --resume ${sessionId}" 重試`));
  }
}

function loadLogo(): string | null {
  try {
    // 從 CLI 安裝目錄加載 logo（而不是用戶的工作目錄）
    const __filename_local = fileURLToPath(import.meta.url);
    const __dirname_local = path.dirname(__filename_local);
    const logoPath = path.resolve(__dirname_local, "..", "BAILU CLI.txt");
    if (fs.existsSync(logoPath)) {
      return fs.readFileSync(logoPath, "utf8");
    }
  } catch {
    // ignore
  }
  return null;
}

function printBanner() {
  const logo = loadLogo();
  if (logo) {
    console.log(chalk.green(logo));
  } else {
    console.log(chalk.green("Bailu CLI"));
  }
  console.log(chalk.gray("一個面向開發者的 AI 終端智能體 (beta)\n"));
}

async function main() {
  const program = new Command();
  program
    .name("bailu")
    .description("Bailu CLI - AI powered coding agent")
    .version(getPackageVersion());

  program
    .command("ask")
    .description("向 Bailu 詢問關於當前代碼庫的問題（只讀模式）")
    .argument("[question...]", "問題內容")
    .action(async (questionParts: string[]) => {
      const question = questionParts?.join(" ");
      await handleAsk(question);
    });

  program
    .command("fix")
    .description("讓 Bailu 幫助修改當前代碼庫（生成建議，不自動應用）")
    .argument("[instruction...]", "修改需求描述")
    .option("--mode <mode>", "安全模式: dry-run, review, auto-apply", "review")
    .option("--verbose", "顯示詳細日誌")
    .option("--max-iterations <n>", "最大迭代次數", parseInt)
    .action(async (instructionParts: string[], options: FixCommandOptions) => {
      const instruction = instructionParts?.join(" ");
      await handleFix(instruction, options);
    });

  program
    .command("plan")
    .description("生成對當前需求或問題的技術實施計畫")
    .argument("[description...]", "任務描述")
    .action(async (descriptionParts: string[]) => {
      const description = descriptionParts?.join(" ");
      await handlePlan(description);
    });

  program
    .command("chat")
    .description("進入交互式對話模式")
    .action(async () => {
      await handleChat();
    });

  program
    .command("run")
    .description("執行複雜的多步驟任務（支持暫停/恢復）")
    .argument("[description...]", "任務描述")
    .option("--resume <sessionId>", "恢復已有任務會話")
    .option("--list", "列出所有保存的會話")
    .action(async (descriptionParts: string[], options: RunCommandOptions) => {
      const description = descriptionParts?.join(" ");
      await handleRun(description, options);
    });

  program
    .command("models")
    .description("列出當前白鹿賬號可用的模型 ID")
    .action(async () => {
      try {
        const apiKey = await ensureApiKeyInteractive();
        const client = new LLMClient({ apiKey });
        console.log(chalk.gray("正在從白鹿獲取模型列表..."));
        const models = await client.listModels();
        if (!models.length) {
          console.log(chalk.yellow("未獲取到任何模型，請檢查賬號權限或 API Key。"));
          return;
        }
        console.log(chalk.cyan("\n可用模型："));
        for (const id of models) {
          const mark = id === process.env.BAILU_MODEL ? "*" : " ";
          console.log(`${mark} ${id}`);
        }
        console.log(
          chalk.gray(
            '\n可以通過設置環境變量 BAILU_MODEL 或修改本機配置，選擇默認使用的模型。'
          )
        );
      } catch (err) {
        console.error(chalk.red("獲取模型列表時出錯："), err);
      }
    });

  // 如果沒有提供任何命令，直接進入交互模式
  if (process.argv.length === 2) {
    printBanner();
    await handleChat();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(chalk.red("Bailu CLI 遇到錯誤："), err);
  process.exit(1);
});
