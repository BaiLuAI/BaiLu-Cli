/**
 * 工具定義注入（共用）
 *
 * 白鹿 chat template 不一定會把 API 的 tools 參數渲染進提示文本，
 * 因此需要把工具定義顯式注入 system message（orchestrator 與子代理共用）。
 */

/**
 * 將工具定義注入到 system message（匹配白鹿 chat template 的 <tool_definition> 格式）
 */
export function injectToolDefinitions(systemContent: string, openaiTools: any[]): string {
  let toolDefs = "";
  for (const tool of openaiTools) {
    toolDefs += `<tool_definition>\n${JSON.stringify(tool.function, null, 2)}\n</tool_definition>\n`;
  }

  return `${systemContent}

## 工具能力
您可以调用以下工具来协助完成任务。工具定义采用 JSONSchema 格式：

${toolDefs}
## 工具调用规范
使用以下 XML 格式调用工具：

<action>
<invoke tool="工具名称">
  <param name="参数名1">参数值1</param>
  <param name="参数名2">参数值2</param>
</invoke>
</action>`;
}
