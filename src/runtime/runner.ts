import { spawn } from "child_process";
import { SafetyPolicy, getDefaultPolicy, isCommandAllowed } from "./policy";

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
  const full = [command, ...args].join(" ");
  if (!isCommandAllowed(policy, full)) {
    return Promise.reject(new Error(`命令被安全策略阻止：${full}`));
  }

  const timeoutMs = policy.maxCommandDurationMs ?? 5 * 60 * 1000;

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: {
        ...process.env,
        BAILU_MODE: policy.mode,
      },
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      if (!finished) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const result: CommandResult = {
        command,
        args,
        exitCode: code,
        timedOut,
        stdout,
        stderr,
      };
      resolve(result);
    });
  });
}


