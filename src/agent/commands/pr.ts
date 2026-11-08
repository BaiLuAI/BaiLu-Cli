/**
 * /pr 命令 — AI 生成 PR 描述，可選透過 gh CLI 建立
 *
 * 用法：
 *   /pr              生成 PR 標題與描述（列印出來）
 *   /pr --create     生成並透過 gh CLI 建立 PR
 */

import chalk from "chalk";
import { execSync } from "child_process";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export async function handlePr(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  const cwd = context.workspaceContext.rootPath;
  const create = args.includes("--create");

  // 1. 收集 diff 與提交記錄
  let diff = "";
  let commits = "";
  let baseBranch = "main";

  try {
    // 偵測主分支
    try {
      baseBranch = git("rev-parse --abbrev-ref origin/HEAD", cwd).replace("origin/", "");
    } catch {
      try {
        baseBranch = git("rev-parse --abbrev-ref HEAD", cwd) === "main" ? "main" : "master";
      } catch {
        // ignore
      }
    }

    diff = git(`diff ${baseBranch}...HEAD`, cwd).slice(0, 30_000);
    commits = git(`log ${baseBranch}..HEAD --oneline`, cwd);
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`收集 git 資訊失敗: ${error instanceof Error ? error.message : String(error)}\n確定目前分支有相對於 ${baseBranch} 的提交？`),
    };
  }

  if (!diff && !commits) {
    return {
      handled: true,
      response: chalk.yellow(`目前分支相對 ${baseBranch} 沒有變更，無法生成 PR`),
    };
  }

  // 2. AI 生成 PR 標題與描述
  if (!context.llmClient) {
    return { handled: true, response: chalk.red("LLM 客戶端未初始化") };
  }

  console.log(chalk.cyan("[PR] 正在生成 PR 描述..."));

  let generated: string;
  try {
    generated = await context.llmClient.chat(
      [
        {
          role: "system",
          content:
            "你是 PR 描述撰寫助手。根據 git diff 與提交記錄，輸出格式如下（不要其他內容）：\n" +
            "第一行：PR 標題（簡潔，一行）\n" +
            "然後空一行，之後是 Markdown 格式的 PR 描述，包含：## 變更摘要、## 主要修改、## 測試建議",
        },
        {
          role: "user",
          content: `提交記錄：\n${commits}\n\nDiff（可能截斷）：\n${diff}`,
        },
      ],
      false
    );
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`AI 生成失敗: ${error instanceof Error ? error.message : String(error)}`),
    };
  }

  const [title, ...bodyParts] = generated.split("\n");
  const prTitle = title.replace(/^#+\s*/, "").trim();
  const prBody = bodyParts.join("\n").trim();

  // 3. 輸出或建立
  if (!create) {
    return {
      handled: true,
      response:
        chalk.bold.cyan(`PR 標題：\n`) +
        `${prTitle}\n\n` +
        chalk.bold.cyan(`PR 描述：\n`) +
        prBody +
        chalk.gray(`\n\n建立 PR: /pr --create（需要 gh CLI）`),
    };
  }

  // 透過 gh CLI 建立
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch {
    return {
      handled: true,
      response:
        chalk.yellow("未安裝 gh CLI，無法自動建立 PR。\n") +
        chalk.gray("可手動複製上方標題與描述，或安裝: https://cli.github.com"),
    };
  }

  try {
    const escapedTitle = prTitle.replace(/"/g, '\\"');
    const escapedBody = prBody.replace(/"/g, '\\"').replace(/\$/g, "\\$");
    const output = execSync(`gh pr create --title "${escapedTitle}" --body "${escapedBody}"`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      handled: true,
      response: chalk.green(`✓ PR 已建立\n${output.trim()}`),
    };
  } catch (error) {
    return {
      handled: true,
      response:
        chalk.red(`gh pr create 失敗: ${error instanceof Error ? error.message : String(error)}\n`) +
        chalk.gray("標題與描述已在上方，可手動建立"),
    };
  }
}
