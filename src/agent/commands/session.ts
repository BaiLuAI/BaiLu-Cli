/**
 * 會話管理命令處理器
 */

import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { formatTimeAgo } from "./utils.js";

/**
 * /save - 保存当前会话
 */
export async function handleSaveSession(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  if (!context.sessionManager) {
    return {
      handled: true,
      response: chalk.red("会话管理功能不可用"),
    };
  }

  const name = args.join(" ").trim();
  
  try {
    const sessionId = await context.sessionManager.saveCurrentSession(
      name || undefined
    );
    
    const displayName = name || sessionId;
    let response = chalk.green(`✓ 会话已保存: ${chalk.bold(displayName)}\n\n`);
    response += chalk.gray("使用以下命令加载:\n");
    response += chalk.cyan(`  /load ${displayName}`);
    
    return {
      handled: true,
      response,
    };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`保存会话失败: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * /load - 加载会话
 */
export async function handleLoadSession(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  if (!context.sessionManager) {
    return {
      handled: true,
      response: chalk.red("会话管理功能不可用"),
    };
  }

  const sessionIdOrName = args.join(" ").trim();
  
  if (!sessionIdOrName) {
    return {
      handled: true,
      response:
        chalk.yellow("请指定要加载的会话\n") +
        chalk.gray("用法: /load <会话名称或ID>\n") +
        chalk.gray("提示: 使用 ") +
        chalk.cyan("/sessions") +
        chalk.gray(" 查看所有会话"),
    };
  }

  try {
    const success = await context.sessionManager.loadSession(sessionIdOrName);
    
    if (success) {
      let response = chalk.green(`✓ 会话已加载: ${chalk.bold(sessionIdOrName)}\n\n`);
      response += chalk.gray(`消息数: ${context.sessionStats.messagesCount}\n`);
      response += chalk.gray(`工具调用: ${context.sessionStats.toolCallsCount}\n`);
      
      if (context.fileManager) {
        const activeFiles = context.fileManager.getActiveFiles();
        if (activeFiles.length > 0) {
          response += chalk.gray(`活跃文件: ${activeFiles.length}\n`);
        }
      }
      
      return {
        handled: true,
        response,
      };
    } else {
      return {
        handled: true,
        response:
          chalk.yellow(`未找到会话: ${sessionIdOrName}\n\n`) +
          chalk.gray("使用 ") +
          chalk.cyan("/sessions") +
          chalk.gray(" 查看所有可用会话"),
      };
    }
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`加载会话失败: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * /sessions - 列出所有会话
 */
export async function handleListSessions(
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  if (!context.sessionManager) {
    return {
      handled: true,
      response: chalk.red("会话管理功能不可用"),
    };
  }

  try {
    const sessions = await context.sessionManager.listSessions();
    
    if (sessions.length === 0) {
      return {
        handled: true,
        response:
          chalk.gray("没有保存的会话\n\n") +
          chalk.gray("使用 ") +
          chalk.cyan("/save <名称>") +
          chalk.gray(" 保存当前会话"),
      };
    }

    let response = chalk.cyan(`💾 已保存的会话 (${sessions.length}):\n\n`);
    
    sessions.forEach((session, index) => {
      const displayName = session.name || session.sessionId;
      const date = new Date(session.lastUpdatedAt);
      const timeAgo = formatTimeAgo(date);
      
      response += chalk.bold(`${index + 1}. ${displayName}\n`);
      response += chalk.gray(`   • 消息: ${session.stats.messagesCount}\n`);
      response += chalk.gray(`   • Token: ${session.stats.totalTokensUsed.toLocaleString()}\n`);
      response += chalk.gray(`   • 更新: ${timeAgo}\n`);
      
      if (session.activeFiles && session.activeFiles.length > 0) {
        response += chalk.gray(`   • 文件: ${session.activeFiles.length}\n`);
      }
      response += "\n";
    });
    
    response += chalk.gray("使用 ") + chalk.cyan("/load <名称>") + chalk.gray(" 加载会话");
    
    return {
      handled: true,
      response,
    };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`获取会话列表失败: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}
