import { spawn } from "child_process";
import { JOB_HEARTBEAT_INTERVAL_MS, MAX_OUTPUT_BYTES } from "../Config";
import AgentClient, { ClaimedJob } from "./AgentClient";
import logger from "Common/Server/Utils/Logger";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";

interface ExecResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }
  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

function runBashLocally(data: {
  script: string;
  timeoutInMs: number;
}): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve: (v: ExecResult) => void) => {
    let stdout: string = "";
    let stderr: string = "";
    let stdoutBytes: number = 0;
    let stderrBytes: number = 0;
    let settled: boolean = false;

    const child: ReturnType<typeof spawn> = spawn("bash", ["-c", data.script], {
      timeout: data.timeoutInMs,
      killSignal: "SIGKILL",
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
          output: truncate(combined),
          errorMessage: `Killed (timeout ${data.timeoutInMs}ms)`,
        });
        return;
      }
      if (code === 0) {
        resolve({ success: true, output: truncate(combined), exitCode: 0 });
        return;
      }
      resolve({
        success: false,
        output: truncate(combined),
        exitCode: code ?? undefined,
        errorMessage: `Exit code ${code ?? "?"}`,
      });
    });
  });
}

/*
 * JavaScript runs inside the same isolated-vm sandbox the server used to use,
 * but now on the agent's machine rather than on the OneUptime Worker. The
 * sandbox blocks fs/network/process access and is killed at the timeout.
 */
async function runJavaScriptLocally(data: {
  script: string;
  timeoutInMs: number;
}): Promise<ExecResult> {
  try {
    const result: ReturnResult = await VMUtil.runCodeInSandbox({
      code: data.script,
      options: { args: {}, timeout: data.timeoutInMs },
    });

    const lines: string[] = [...(result.logMessages || [])];
    if (result.returnValue !== undefined) {
      lines.push(
        `Return: ${
          typeof result.returnValue === "string"
            ? result.returnValue
            : JSON.stringify(result.returnValue, null, 2)
        }`,
      );
    }
    const output: string = truncate(lines.join("\n"));

    if (result.scriptError) {
      return {
        success: false,
        output,
        errorMessage: result.scriptError.message,
      };
    }
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runJob(job: ClaimedJob): Promise<ExecResult> {
  if (job.stepType === "JavaScript") {
    return runJavaScriptLocally({
      script: job.script,
      timeoutInMs: job.timeoutInMs,
    });
  }
  if (job.stepType === "Bash") {
    return runBashLocally({
      script: job.script,
      timeoutInMs: job.timeoutInMs,
    });
  }
  return {
    success: false,
    output: "",
    errorMessage: `Unsupported step type: ${String(job.stepType)}`,
  };
}

export default class Executor {
  public static async executeAndReport(job: ClaimedJob): Promise<void> {
    /*
     * Refresh the lease in the background so a long-running script
     * doesn't get reclaimed by another agent or marked TimedOut by the
     * Worker. Cleared in finally to stop the timer.
     */
    const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
      AgentClient.jobHeartbeat(job.jobId).catch((err: unknown) => {
        logger.warn(
          `Job heartbeat for ${job.jobId} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }, JOB_HEARTBEAT_INTERVAL_MS);

    try {
      logger.info(
        `Executing ${job.stepType} job ${job.jobId} (step ${job.stepId})`,
      );
      const result: ExecResult = await runJob(job);

      const submitted: boolean = await AgentClient.submitJobResult({
        jobId: job.jobId,
        success: result.success,
        ...(typeof result.output === "string" ? { output: result.output } : {}),
        ...(typeof result.exitCode === "number"
          ? { exitCode: result.exitCode }
          : {}),
        ...(typeof result.errorMessage === "string"
          ? { errorMessage: result.errorMessage }
          : {}),
      });

      if (!submitted) {
        logger.error(
          `Server did not accept result for job ${job.jobId}. Lease may have lapsed.`,
        );
      }
    } catch (err) {
      logger.error(`Executor error for job ${job.jobId}`);
      logger.error(err);
      try {
        await AgentClient.submitJobResult({
          jobId: job.jobId,
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // Best effort.
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}
