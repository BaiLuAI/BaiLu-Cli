/**
 * 友好的错误处理工具
 * 提供清晰的错误信息和解决建议
 */
import chalk from "chalk";

export interface ErrorSuggestion {
  message: string;
  suggestions: string[];
  docs?: string;
}

/**
 * 常见错误类型及其解决方案
 */
const ERROR_SOLUTIONS: Record<string, ErrorSuggestion> = {
  // API 相关错误
  "ENOTFOUND": {
    message: "无法连接到 API 服务器",
    suggestions: [
      "检查网络连接是否正常",
      "确认 BAILU_BASE_URL 配置是否正确",
      "尝试使用 VPN 或更换网络",
    ],
  },
  "ETIMEDOUT": {
    message: "API 请求超时",
    suggestions: [
      "检查网络连接速度",
      "稍后重试",
      "考虑使用更快的模型（如 bailu-Edge）",
    ],
  },
  "ECONNREFUSED": {
    message: "API 服务器拒绝连接",
    suggestions: [
      "确认 API 服务器地址正确",
      "检查防火墙设置",
      "联系管理员确认服务状态",
    ],
  },
  
  // API Key 错误
  "401": {
    message: "API Key 无效或未授权",
    suggestions: [
      "检查 API Key 是否正确",
      "确认 API Key 是否已过期",
      "重新设置：BAILU_API_KEY=sk-your-key",
      "或运行 bailu chat 重新输入 API Key",
    ],
  },
  "403": {
    message: "没有权限访问此资源",
    suggestions: [
      "确认你的账户有足够的权限",
      "检查 API Key 的权限范围",
      "联系管理员确认访问权限",
    ],
  },
  
  // 配额错误
  "429": {
    message: "请求过于频繁或配额已用完",
    suggestions: [
      "等待一段时间后重试",
      "检查账户配额是否用完",
      "考虑升级账户或购买更多配额",
    ],
  },
  
  // 服务器错误
  "500": {
    message: "API 服务器内部错误",
    suggestions: [
      "这是服务器端问题，不是你的问题",
      "稍后重试",
      "如果持续出现，请联系技术支持",
    ],
  },
  "502": {
    message: "API 网关错误",
    suggestions: [
      "服务器暂时不可用",
      "稍后重试",
    ],
  },
  "503": {
    message: "服务暂时不可用",
    suggestions: [
      "服务器正在维护或过载",
      "稍后重试",
      "查看官方状态页面了解维护信息",
    ],
  },
  
  // 文件系统错误
  "ENOENT": {
    message: "文件或目录不存在",
    suggestions: [
      "检查文件路径是否正确",
      "确认文件是否已被删除",
      "使用绝对路径或相对于项目根目录的路径",
    ],
  },
  "EACCES": {
    message: "没有权限访问文件",
    suggestions: [
      "检查文件权限",
      "尝试以管理员身份运行",
      "确认文件未被其他程序占用",
    ],
  },
  "EISDIR": {
    message: "期望文件，但给定的是目录",
    suggestions: [
      "检查路径是否正确",
      "确保操作的是文件而非目录",
    ],
  },
  
  // JSON 解析错误
  "JSON": {
    message: "JSON 格式错误",
    suggestions: [
      "检查 JSON 文件格式是否正确",
      "使用 JSON 验证工具检查",
      "确认没有多余的逗号或引号",
    ],
  },
};

/**
 * 格式化并显示友好的错误信息
 */
export function displayFriendlyError(error: Error | unknown, context?: string): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  console.log(chalk.red("\n❌ 错误发生"));
  
  if (context) {
    console.log(chalk.gray(`上下文: ${context}`));
  }
  
  // 尝试匹配已知错误类型
  let suggestion: ErrorSuggestion | null = null;
  
  // 类型守卫：检查是否为带有 code 属性的错误对象
  const hasCode = (err: unknown): err is { code: string } => {
    return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
  };
  
  for (const [key, value] of Object.entries(ERROR_SOLUTIONS)) {
    if (errorMessage.includes(key) || (hasCode(error) && error.code === key)) {
      suggestion = value;
      break;
    }
  }
  
  if (suggestion) {
    console.log(chalk.yellow(`\n💡 ${suggestion.message}`));
    console.log(chalk.cyan("\n建议的解决方案:"));
    suggestion.suggestions.forEach((s, i) => {
      console.log(chalk.cyan(`  ${i + 1}. ${s}`));
    });
    if (suggestion.docs) {
      console.log(chalk.gray(`\n📖 文档: ${suggestion.docs}`));
    }
  } else {
    // 未知错误，显示原始信息
    console.log(chalk.yellow(`\n详细信息: ${errorMessage}`));
    console.log(chalk.cyan("\n建议:"));
    console.log(chalk.cyan("  1. 检查错误信息中的提示"));
    console.log(chalk.cyan("  2. 确认配置是否正确"));
    console.log(chalk.cyan("  3. 查看日志文件获取更多信息"));
  }
  
  // 显示原始错误（仅在 verbose 模式）
  if (process.env.BAILU_VERBOSE === "true" && error instanceof Error) {
    console.log(chalk.gray("\n调试信息:"));
    console.log(chalk.gray(error.stack || error.message));
  }
  
  console.log(); // 空行
}

/**
 * 创建带建议的错误
 */
export class FriendlyError extends Error {
  suggestions: string[];
  
  constructor(message: string, suggestions: string[]) {
    super(message);
    this.name = "FriendlyError";
    this.suggestions = suggestions;
  }
}

/**
 * API 错误类型
 */
interface ApiErrorResponse {
  response?: {
    status?: number;
    data?: {
      message?: string;
    };
  };
  status?: number;
  message?: string;
}

/**
 * API 错误包装器
 */
export function wrapApiError(error: unknown): FriendlyError {
  // 类型守卫：检查是否为 API 错误响应格式
  const isApiError = (err: unknown): err is ApiErrorResponse => {
    return typeof err === 'object' && err !== null;
  };

  if (!isApiError(error)) {
    return new FriendlyError(
      "未知错误",
      ["检查网络连接", "稍后重试", "查看详细错误信息"]
    );
  }

  const status = error.response?.status || error.status;
  const message = error.response?.data?.message || error.message;
  
  if (status && ERROR_SOLUTIONS[String(status)]) {
    const solution = ERROR_SOLUTIONS[String(status)];
    return new FriendlyError(
      `${solution.message}: ${message}`,
      solution.suggestions
    );
  }
  
  return new FriendlyError(
    message || "未知 API 错误",
    ["检查网络连接", "稍后重试", "查看详细错误信息"]
  );
}
