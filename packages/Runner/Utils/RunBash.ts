import { spawn } from "child_process";
import { MAX_OUTPUT_BYTES } from "../Config";

/*
 * Running a script with bash on this Runner's host: what a Bash step does,
 * and what a kubectl step does with KUBECONFIG pointing at its cluster
 * (KubectlScriptExecutor).
 *
 * `bash -c <script>`, killed with SIGKILL at the step's timeout. stdout and
 * stderr are kept apart, each to MAX_OUTPUT_BYTES, and reported as
 * "[stdout]" then "[stderr]"; a non-zero exit code fails the step.
 */

export interface BashRunResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

export function truncateOutput(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }
  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

export function runBash(data: {
  script: string;
  timeoutInMs: number;
  // Left out: the Runner's own environment, as it always was.
  environment?: NodeJS.ProcessEnv | undefined;
}): Promise<BashRunResult> {
  return new Promise<BashRunResult>((resolve: (v: BashRunResult) => void) => {
    let stdout: string = "";
    let stderr: string = "";
    let stdoutBytes: number = 0;
    let stderrBytes: number = 0;
    let settled: boolean = false;

    const child: ReturnType<typeof spawn> = spawn("bash", ["-c", data.script], {
      timeout: data.timeoutInMs,
      killSignal: "SIGKILL",
      ...(data.environment ? { env: data.environment } : {}),
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        stdoutBytes += chunk.length;
        stdout += chunk.toString("utf8");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        stderrBytes += chunk.length;
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ success: false, output: "", errorMessage: err.message });
    });

    child.on("close", (code: number | null, signal: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      const combined: string = [
        stdout && `[stdout]\n${stdout}`,
        stderr && `[stderr]\n${stderr}`,
      ]
        .filter(Boolean)
        .join("\n");

      if (signal === "SIGKILL") {
        resolve({
          success: false,
          output: truncateOutput(combined),
          errorMessage: `Killed (timeout ${data.timeoutInMs}ms)`,
        });
        return;
      }
      if (code === 0) {
        resolve({
          success: true,
          output: truncateOutput(combined),
          exitCode: 0,
        });
        return;
      }
      resolve({
        success: false,
        output: truncateOutput(combined),
        exitCode: code ?? undefined,
        errorMessage: `Exit code ${code ?? "?"}`,
      });
    });
  });
}
