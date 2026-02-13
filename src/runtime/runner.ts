import { spawn } from "child_process";
import { SafetyPolicy, getDefaultPolicy, isCommandAllowed, containsShellInjection } from "./policy.js";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export function runCommandSafe(
  cwd: string,
  command: string,
  args: string[],
  policy: SafetyPolicy = getDefaultPolicy()
): Promise<CommandResult> {
  const full = args.length > 0 ? `${command} ${args.join(" ")}` : command;
  if (!isCommandAllowed(policy, full)) {
    return Promise.reject(new Error(`命令被安全策略阻止：${full}`));
  }

  // 逐一檢查 command 和每個 arg 是否含 shell 注入字符
  if (containsShellInjection(command)) {
    return Promise.reject(new Error(`命令包含不安全的 shell 字符：${command}`));
  }
  for (const arg of args) {
    if (containsShellInjection(arg)) {
      return Promise.reject(new Error(`命令參數包含不安全的 shell 字符：${arg}`));
    }
  }

  const timeoutMs = policy.maxCommandDurationMs ?? 5 * 60 * 1000;

  // Windows 需要 shell:true 以支持 .cmd/.bat（如 npm, npx）
  // 非 Windows 平台不使用 shell，避免命令注入
  const useShell = process.platform === 'win32';

  return new Promise<CommandResult>((resolve, reject) => {
    let finished = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, {
      cwd,
      shell: useShell,
      env: {
        ...process.env,
        BAILU_MODE: policy.mode,
      },
      timeout: timeoutMs,
    });

    // 设置超时处理
    const timeoutId = setTimeout(() => {
      if (!finished) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      // 限制输出大小
      if (stdout.length > 10 * 1024 * 1024) {
        stdout = stdout.slice(-5 * 1024 * 1024);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      // 限制输出大小
      if (stderr.length > 10 * 1024 * 1024) {
        stderr = stderr.slice(-5 * 1024 * 1024);
      }
    });

    child.on('close', (code: number | null, signal: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);

      const result: CommandResult = {
        command,
        args,
        exitCode: code,
        timedOut: signal === 'SIGTERM' || signal === 'SIGKILL',
        stdout,
        stderr,
      };

      resolve(result);
    });

    child.on('error', (err: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}
