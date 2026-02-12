export type ExecutionMode = "dry-run" | "review" | "auto-apply";

export interface SafetyPolicy {
  mode: ExecutionMode;
  allowedCommands?: string[];
  blockedCommands?: string[];
  maxCommandDurationMs?: number;
}

export function getDefaultPolicy(): SafetyPolicy {
  const modeEnv = process.env.BAILU_MODE as ExecutionMode | undefined;
  const mode: ExecutionMode = modeEnv ?? "review";
  return {
    mode,
    // Comprehensive list of dangerous commands
    blockedCommands: [
      // File system destructive operations
      "rm",
      "rm -rf",
      "rmdir",
      "del",
      "format",
      "mkfs",
      "dd",
      
      // System operations
      "shutdown",
      "reboot",
      "poweroff",
      "halt",
      "init",
      
      // Package managers (prevent unauthorized installations)
      "apt-get",
      "yum",
      "dnf",
      "pacman",
      "brew",
      "choco",
      
      // User/permission changes
      "chmod",
      "chown",
      "chgrp",
      "passwd",
      "sudo",
      "su",
      
      // Network operations (potential data exfiltration)
      "curl",
      "wget",
      "nc",
      "netcat",
      "telnet",
      
      // Disk operations
      "fdisk",
      "parted",
      "mount",
      "umount",
      
      // Process manipulation
      "kill",
      "killall",
      "pkill",
    ],
    maxCommandDurationMs: 5 * 60 * 1000,
  };
}

/**
 * 危险的 shell 操作符列表
 */
const DANGEROUS_SHELL_OPERATORS = [
  ';',      // 命令分隔符
  '&&',     // AND 操作符
  '||',     // OR 操作符
  '|',      // 管道
  '`',      // 命令替换
  '$(',     // 命令替换
  '>',      // 重定向
  '<',      // 重定向
  '>>',     // 追加重定向
  '2>',     // 错误重定向
  '&',      // 后台执行
];

/**
 * 从命令字符串中提取基础命令名
 * 处理路径前缀如 /bin/rm, ./script.sh 等
 */
function extractCommandName(command: string): string {
  const trimmed = command.trim();
  // 获取第一个空格前的部分作为命令
  const firstPart = trimmed.split(/\s+/)[0] || '';
  // 提取路径中的最后一部分（命令名）
  const baseName = firstPart.replace(/\\/g, '/').split('/').pop() || '';
  // 移除可能的扩展名（如 .exe, .bat, .sh）
  return baseName.replace(/\.(exe|bat|cmd|sh|ps1)$/i, '').toLowerCase();
}

/**
 * 检查命令是否包含危险的 shell 操作符
 */
function containsDangerousOperators(command: string): boolean {
  for (const op of DANGEROUS_SHELL_OPERATORS) {
    if (command.includes(op)) {
      return true;
    }
  }
  return false;
}

export function isCommandAllowed(policy: SafetyPolicy, command: string): boolean {
  // 首先检查危险操作符
  if (containsDangerousOperators(command)) {
    return false;
  }

  // 提取命令基础名称进行检查
  const cmdName = extractCommandName(command);
  
  if (policy.blockedCommands) {
    for (const banned of policy.blockedCommands) {
      const bannedName = extractCommandName(banned);
      // 检查命令名是否匹配（忽略路径）
      if (cmdName === bannedName) {
        return false;
      }
      // 也检查原始匹配以保持向后兼容
      if (command === banned || command.startsWith(`${banned} `)) {
        return false;
      }
    }
  }
  if (policy.allowedCommands && policy.allowedCommands.length > 0) {
    return policy.allowedCommands.some((allowed) => {
      const allowedName = extractCommandName(allowed);
      return cmdName === allowedName || command === allowed || command.startsWith(`${allowed} `);
    });
  }
  return true;
}


