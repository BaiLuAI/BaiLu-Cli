import { spawn } from "child_process";
import { SafetyPolicy, getDefaultPolicy, isCommandAllowed } from "./policy.js";

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

  const timeoutMs = policy.maxCommandDurationMs ?? 5 * 60 * 1000;

  return new Promise<CommandResult>((resolve, reject) => {
    let finished = false;
    let stdout = '';
    let stderr = '';

    // 使用 spawn 替代 exec，更安全地处理参数
    const child = spawn(command, args, {
      cwd,
      shell: true, // 保持 shell 兼容性
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
