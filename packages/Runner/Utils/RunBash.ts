import { spawn } from "child_process";
import { MAX_OUTPUT_BYTES } from "../Config";
import { truncateToBytes } from "./OutputTruncation";
import { withoutRunnerOwnEnvironment } from "./RunnerOwnEnvironment";

/*
 * Running a script with bash on this Runner's host: what a Bash step does,
 * and what a kubectl step does with KUBECONFIG pointing at its cluster
 * (KubectlScriptExecutor).
 *
 * `bash -c <script>`, killed with SIGKILL at the step's timeout. stdout and
 * stderr are kept apart, each to MAX_OUTPUT_BYTES, and reported as
 * "[stdout]" then "[stderr]"; a non-zero exit code fails the step.
 *
 * The script runs with the Runner's environment - or the one a step built
 * from it, with the run's inputs - less the Runner's own settings, its id
 * and key among them (RunnerOwnEnvironment): a step is written by the
 * project, and nothing it does talks to OneUptime as this Runner.
 */

export interface BashRunResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

export function truncateOutput(s: string): string {
  return truncateToBytes(s, MAX_OUTPUT_BYTES);
}

export function runBash(data: {
  script: string;
  timeoutInMs: number;
  /*
   * Left out: the Runner's own environment. Either way without the
   * Runner's own settings (withoutRunnerOwnEnvironment).
   */
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
      env: withoutRunnerOwnEnvironment(data.environment || process.env),
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
