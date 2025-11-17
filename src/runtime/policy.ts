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
    blockedCommands: ["rm", "rm -rf", "mkfs", "shutdown", "reboot"],
    maxCommandDurationMs: 5 * 60 * 1000,
  };
}

export function isCommandAllowed(policy: SafetyPolicy, command: string): boolean {
  if (policy.blockedCommands) {
    for (const banned of policy.blockedCommands) {
      if (command === banned || command.startsWith(`${banned} `)) {
        return false;
      }
    }
  }
  if (policy.allowedCommands && policy.allowedCommands.length > 0) {
    return policy.allowedCommands.some((allowed) => command === allowed || command.startsWith(`${allowed} `));
  }
  return true;
}


