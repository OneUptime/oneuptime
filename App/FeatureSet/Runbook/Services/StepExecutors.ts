import { spawn } from "child_process";
import axios, { AxiosResponse } from "axios";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import logger from "Common/Server/Utils/Logger";
import {
  BashStepConfig,
  HttpRequestStepConfig,
  JavaScriptStepConfig,
  RunbookStep,
} from "Common/Types/Runbook/RunbookStep";

export interface StepRunResult {
  success: boolean;
  output: string;
  errorMessage?: string;
}

const MAX_OUTPUT_BYTES: number = 50_000;
const DEFAULT_SCRIPT_TIMEOUT_MS: number = 30_000;
const DEFAULT_HTTP_TIMEOUT_MS: number = 30_000;

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }
  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

export async function runJavaScriptStep(
  step: RunbookStep,
): Promise<StepRunResult> {
  const config: JavaScriptStepConfig = step.config as JavaScriptStepConfig;
  const timeout: number = config.timeoutInMs || DEFAULT_SCRIPT_TIMEOUT_MS;
  try {
    const result: {
      returnValue: any;
      logMessages: string[];
      scriptError?: Error | undefined;
    } = await VMUtil.runCodeInSandbox({
      code: config.script || "",
      options: { args: {}, timeout },
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

    if (result.scriptError) {
      return {
        success: false,
        output: truncate(lines.join("\n")),
        errorMessage: result.scriptError.message,
      };
    }

    return { success: true, output: truncate(lines.join("\n")) };
  } catch (err) {
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runHttpStep(step: RunbookStep): Promise<StepRunResult> {
  const config: HttpRequestStepConfig = step.config as HttpRequestStepConfig;
  const timeout: number = config.timeoutInMs || DEFAULT_HTTP_TIMEOUT_MS;

  let headers: Record<string, string> = {};
  if (config.headersJson) {
    try {
      headers = JSON.parse(config.headersJson);
    } catch (err) {
      return {
        success: false,
        output: "",
        errorMessage: `Invalid headers JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  let parsedBody: unknown = config.body;
  if (config.body) {
    try {
      parsedBody = JSON.parse(config.body);
    } catch {
      parsedBody = config.body;
    }
  }

  try {
    const response: AxiosResponse = await axios.request({
      url: config.url,
      method: config.method,
      headers,
      data: parsedBody,
      timeout,
      validateStatus: () => {
        return true;
      },
    });

    const body: string =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data, null, 2);

    const output: string = [
      `Status: ${response.status} ${response.statusText}`,
      `Headers: ${JSON.stringify(response.headers, null, 2)}`,
      `Body: ${body}`,
    ].join("\n");

    if (response.status >= 200 && response.status < 400) {
      return { success: true, output: truncate(output) };
    }

    return {
      success: false,
      output: truncate(output),
      errorMessage: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runBashStep(step: RunbookStep): Promise<StepRunResult> {
  const config: BashStepConfig = step.config as BashStepConfig;
  const timeout: number = config.timeoutInMs || DEFAULT_SCRIPT_TIMEOUT_MS;
  const script: string = config.script || "";

  if (process.env["RUNBOOK_BASH_ENABLED"] !== "true") {
    return {
      success: false,
      output: "",
      errorMessage:
        "Bash steps are disabled. Set RUNBOOK_BASH_ENABLED=true on the Worker to enable.",
    };
  }

  return new Promise<StepRunResult>((resolve: (v: StepRunResult) => void) => {
    let stdout: string = "";
    let stderr: string = "";
    let stdoutBytes: number = 0;
    let stderrBytes: number = 0;
    let settled: boolean = false;

    const child: ReturnType<typeof spawn> = spawn("bash", ["-c", script], {
      env: {
        PATH: process.env["PATH"] || "/usr/local/bin:/usr/bin:/bin",
      },
      timeout,
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
          errorMessage: `Killed (timeout ${timeout}ms)`,
        });
        return;
      }
      if (code === 0) {
        resolve({ success: true, output: truncate(combined) });
        return;
      }
      resolve({
        success: false,
        output: truncate(combined),
        errorMessage: `Exit code ${code ?? "?"}`,
      });
    });
  }).catch((err: unknown) => {
    logger.error(err);
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  });
}
