/**
 * 計劃模式 - 讓 AI 先分析需求並生成實施計劃，確認後再執行
 * 類似 Claude Code 的 EnterPlanModeTool，避免盲目執行
 */

import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { parseToolCalls } from "../tools/parser.js";
import { ToolExecutionContext } from "../tools/types.js";
import { createSpinner } from "../utils/spinner.js";
import { renderMarkdown } from "../utils/markdown-renderer.js";

export interface PlanStep {
  id: number;
  description: string;
  tool?: string;
  params?: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
  result?: string;
}

export interface Plan {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  createdAt: Date;
  status: 'draft' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
}

export interface PlanModeOptions {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  executionContext: ToolExecutionContext;
  verbose?: boolean;
}

export class PlanMode {
  private llmClient: LLMClient;
  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;
  private verbose: boolean;

  constructor(options: PlanModeOptions) {
    this.llmClient = options.llmClient;
    this.toolRegistry = options.toolRegistry;
    this.toolExecutor = new ToolExecutor(options.toolRegistry, options.executionContext);
    this.verbose = options.verbose || false;
  }

  /**
   * 生成實施計劃
   */
  async generatePlan(instruction: string, workspaceContext: string): Promise<Plan> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 構建計劃生成提示
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `你是一個軟件工程計劃專家。用戶會給你一個任務描述，你需要分析這個任務並生成一個詳細的實施計劃。

## 規則
1. 仔細分析任務需求，理解用戶想要達成的目標
2. 將任務分解為具體的、可執行的步驟
3. 每個步驟應該明確說明要做什麼，使用什麼工具
4. 考慮可能的風險和錯誤處理
5. 計劃應該是安全的，不會破壞現有代碼

## 輸出格式
請使用以下 JSON 格式輸出計劃：

\`\`\`json
{
  "title": "計劃標題",
  "description": "計劃描述",
  "steps": [
    {
      "id": 1,
      "description": "步驟描述",
      "tool": "工具名稱（如果需要）",
      "params": {"參數名": "參數值"}
    }
  ]
}
\`\`\`

## 可用工具
${this.getToolDescriptions()}

## 工作區上下文
${workspaceContext}`,
      },
      {
        role: "user",
        content: `請為以下任務生成實施計劃：\n\n${instruction}`,
      },
    ];

    // 調用 LLM 生成計劃
    const spinner = createSpinner("[計劃生成中]");
    spinner.start();

    try {
      const response = await this.llmClient.chat(messages, false);
      spinner.stop();

      // 解析計劃
      const plan = this.parsePlanResponse(planId, instruction, response);
      return plan;
    } catch (error) {
      spinner.stop();
      throw new Error(`計劃生成失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 解析 LLM 響應為計劃
   */
  private parsePlanResponse(planId: string, instruction: string, response: string): Plan {
    try {
      // 嘗試從響應中提取 JSON
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) {
        throw new Error("無法從響應中提取計劃 JSON");
      }

      const planData = JSON.parse(jsonMatch[1]);

      // 驗證計劃結構
      if (!planData.title || !planData.steps || !Array.isArray(planData.steps)) {
        throw new Error("計劃格式無效");
      }

      // 構建步驟
      const steps: PlanStep[] = planData.steps.map((step: any, index: number) => ({
        id: step.id || index + 1,
        description: step.description || `步驟 ${index + 1}`,
        tool: step.tool,
        params: step.params,
        status: 'pending' as const,
      }));

      return {
        id: planId,
        title: planData.title,
        description: planData.description || instruction,
        steps,
        createdAt: new Date(),
        status: 'draft',
      };
    } catch (error) {
      // 如果解析失敗，創建一個簡單的計劃
      return {
        id: planId,
        title: "實施計劃",
        description: instruction,
        steps: [
          {
            id: 1,
            description: "分析任務需求",
            status: 'pending',
          },
          {
            id: 2,
            description: "執行任務",
            status: 'pending',
          },
        ],
        createdAt: new Date(),
        status: 'draft',
      };
    }
  }

  /**
   * 顯示計劃並請求用戶確認
   */
  async displayAndConfirmPlan(plan: Plan): Promise<boolean> {
    console.log(chalk.cyan("\n" + "═".repeat(60)));
    console.log(chalk.cyan.bold(`📋 實施計劃：${plan.title}`));
    console.log(chalk.cyan("═".repeat(60)));
    console.log(chalk.gray(`計劃 ID: ${plan.id}`));
    console.log(chalk.gray(`創建時間: ${plan.createdAt.toLocaleString()}`));
    console.log(chalk.cyan("─".repeat(60)));
    console.log(chalk.white(`\n${plan.description}\n`));
    console.log(chalk.cyan("─".repeat(60)));
    console.log(chalk.yellow.bold("\n📝 執行步驟：\n"));

    for (const step of plan.steps) {
      const statusIcon = this.getStepStatusIcon(step.status);
      console.log(chalk.white(`${statusIcon} ${step.id}. ${step.description}`));
      if (step.tool) {
        console.log(chalk.gray(`   🔧 工具: ${step.tool}`));
        if (step.params) {
          console.log(chalk.gray(`   📦 參數: ${JSON.stringify(step.params)}`));
        }
      }
      console.log();
    }

    console.log(chalk.cyan("═".repeat(60)));

    // 請求用戶確認
    const inquirer = await import('inquirer');
    const { action } = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'action',
        message: '請選擇操作：',
        choices: [
          { name: '✅ 批准並執行計劃', value: 'approve' },
          { name: '❌ 拒絕計劃', value: 'reject' },
          { name: '📝 修改計劃（重新生成）', value: 'modify' },
          { name: '👁️ 顯示詳細信息', value: 'details' },
        ],
      },
    ]);

    switch (action) {
      case 'approve':
        plan.status = 'approved';
        return true;
      case 'reject':
        plan.status = 'rejected';
        return false;
      case 'modify':
        return false; // 返回 false，讓調用者重新生成計劃
      case 'details':
        await this.showPlanDetails(plan);
        return await this.displayAndConfirmPlan(plan); // 遞歸顯示確認
      default:
        return false;
    }
  }

  /**
   * 顯示計劃詳細信息
   */
  private async showPlanDetails(plan: Plan): Promise<void> {
    console.log(chalk.cyan("\n📊 計劃詳細信息：\n"));

    // 統計信息
    const totalSteps = plan.steps.length;
    const toolSteps = plan.steps.filter(s => s.tool).length;
    const manualSteps = totalSteps - toolSteps;

    console.log(chalk.white(`總步驟數: ${totalSteps}`));
    console.log(chalk.white(`工具執行步驟: ${toolSteps}`));
    console.log(chalk.white(`手動步驟: ${manualSteps}`));
    console.log();

    // 風險評估
    console.log(chalk.yellow.bold("⚠️ 風險評估："));
    const riskyTools = ['run_command', 'write_file', 'apply_diff'];
    const riskySteps = plan.steps.filter(s => s.tool && riskyTools.includes(s.tool));
    
    if (riskySteps.length > 0) {
      console.log(chalk.red(`發現 ${riskySteps.length} 個高風險步驟：`));
      for (const step of riskySteps) {
        console.log(chalk.red(`  - 步驟 ${step.id}: ${step.description} (${step.tool})`));
      }
    } else {
      console.log(chalk.green("未發現高風險步驟"));
    }

    console.log();
  }

  /**
   * 執行計劃
   */
  async executePlan(plan: Plan): Promise<{ success: boolean; results: string[] }> {
    if (plan.status !== 'approved') {
      throw new Error("計劃未被批准，無法執行");
    }

    plan.status = 'executing';
    const results: string[] = [];

    console.log(chalk.green("\n🚀 開始執行計劃...\n"));

    for (const step of plan.steps) {
      console.log(chalk.cyan(`\n📌 執行步驟 ${step.id}: ${step.description}`));

      try {
        if (step.tool) {
          // 使用工具執行
          const toolCall = {
            tool: step.tool,
            params: step.params || {},
          };

          const result = await this.toolExecutor.execute(toolCall);
          
          if (result.success) {
            step.status = 'completed';
            step.result = result.output || "執行成功";
            console.log(chalk.green(`✅ 步驟 ${step.id} 完成`));
            if (result.output && this.verbose) {
              console.log(chalk.gray(result.output.substring(0, 200) + (result.output.length > 200 ? '...' : '')));
            }
          } else {
            step.status = 'failed';
            step.result = result.error || "執行失敗";
            console.log(chalk.red(`❌ 步驟 ${step.id} 失敗: ${result.error}`));
            
            // 詢問用戶是否繼續
            const inquirer = await import('inquirer');
            const { continueExecution } = await inquirer.default.prompt([
              {
                type: 'confirm',
                name: 'continueExecution',
                message: '步驟執行失敗，是否繼續執行後續步驟？',
                default: false,
              },
            ]);

            if (!continueExecution) {
              plan.status = 'failed';
              return { success: false, results };
            }
          }

          results.push(`步驟 ${step.id}: ${step.result}`);
        } else {
          // 手動步驟，顯示說明
          step.status = 'completed';
          step.result = "手動步驟完成";
          console.log(chalk.yellow(`ℹ️ 步驟 ${step.id} 是手動步驟，請手動完成`));
          results.push(`步驟 ${step.id}: 手動步驟`);
        }
      } catch (error) {
        step.status = 'failed';
        step.result = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`❌ 步驟 ${step.id} 執行異常: ${step.result}`));
        results.push(`步驟 ${step.id}: 異常 - ${step.result}`);
      }
    }

    // 檢查所有步驟狀態
    const failedSteps = plan.steps.filter(s => s.status === 'failed');
    if (failedSteps.length > 0) {
      plan.status = 'failed';
      console.log(chalk.red(`\n❌ 計劃執行完成，但有 ${failedSteps.length} 個步驟失敗`));
      return { success: false, results };
    }

    plan.status = 'completed';
    console.log(chalk.green("\n✅ 計劃執行完成！"));
    return { success: true, results };
  }

  /**
   * 獲取步驟狀態圖標
   */
  private getStepStatusIcon(status: PlanStep['status']): string {
    switch (status) {
      case 'pending': return '⏳';
      case 'approved': return '✅';
      case 'rejected': return '❌';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '❓';
    }
  }

  /**
   * 獲取工具描述
   */
  private getToolDescriptions(): string {
    const tools = this.toolRegistry.getAllDefinitions();
    return tools.map(tool => {
      const params = tool.parameters.map(p => 
        `  - ${p.name} (${p.type}${p.required ? ', 必需' : ''}): ${p.description}`
      ).join('\n');
      
      return `### ${tool.name}\n${tool.description}\n參數:\n${params}`;
    }).join('\n\n');
  }
}
