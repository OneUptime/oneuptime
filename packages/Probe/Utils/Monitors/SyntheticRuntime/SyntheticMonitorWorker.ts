import os from "os";
import path from "path";
import { Browser } from "playwright";
import WorkerController from "./WorkerController";
import SyntheticBrowser, { SyntheticBrowserSession } from "./SyntheticBrowser";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerConfig,
} from "./SyntheticMonitorWorkerTypes";
import {
  SyntheticWorkerStartEnvelope,
  createWorkerFailureEnvelope,
  createWorkerSuccessEnvelope,
  isWorkerStartEnvelope,
} from "./WorkerProtocol";
import { SandboxExecutionResult } from "./RpcProtocol";

let hasHandledMessage: boolean = false;
let activeBrowser: Browser | null = null;
let isShuttingDown: boolean = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, (): void => {
    void closeForSignal(signal);
  });
}

process.once("message", (message: unknown): void => {
  if (hasHandledMessage) {
    return;
  }
  hasHandledMessage = true;

  const validation: {
    value: unknown;
    validateConfig: typeof isSyntheticMonitorWorkerConfig;
  } = {
    value: message,
    validateConfig: isSyntheticMonitorWorkerConfig,
  };

  if (!isWorkerStartEnvelope<SyntheticMonitorWorkerConfig>(validation)) {
    process.exitCode = 1;
    process.disconnect?.();
    return;
  }

  void runAndReply(validation.value);
});

async function runAndReply(
  envelope: SyntheticWorkerStartEnvelope<SyntheticMonitorWorkerConfig>,
): Promise<void> {
  try {
    const result: SyntheticMonitorWorkerResult = await executeMonitor(
      envelope.config,
    );
    await sendMessage(
      createWorkerSuccessEnvelope({
        nonce: envelope.nonce,
        result,
      }),
    );
  } catch (error: unknown) {
    await sendMessage(
      createWorkerFailureEnvelope({
        nonce: envelope.nonce,
        error,
      }),
    );
  } finally {
    /*
     * Reply first, close second. The result is complete before the browser
     * closes, and closing used to come first: on storage that is slow to
     * acknowledge writes, a finished check then spent its last half-minute
     * waiting for the browser to flush, and could run out its deadline with
     * the answer already in hand.
     */
    const browser: Browser | null = activeBrowser;
    activeBrowser = null;
    if (browser) {
      await SyntheticBrowser.close({ browser });
    }
    process.disconnect?.();
  }
}

async function executeMonitor(
  config: SyntheticMonitorWorkerConfig,
): Promise<SyntheticMonitorWorkerResult> {
  const runDirectory: string | undefined = process.env["HOME"];
  if (!runDirectory || !path.isAbsolute(runDirectory)) {
    throw new Error("Synthetic worker run directory is unavailable.");
  }
  /*
   * Playwright creates the browser's temporary profile and artifacts under
   * os.tmpdir(). The disk watchdog and the cleanup only see the run
   * directory, so everything the browser writes is accounted for only while
   * the two are the same directory -- which ProcessRunner arranges, and which
   * is checked here rather than assumed.
   */
  if (path.resolve(os.tmpdir()) !== path.resolve(runDirectory)) {
    throw new Error(
      "Synthetic worker temporary directory is not its run directory.",
    );
  }

  const session: SyntheticBrowserSession = await SyntheticBrowser.start({
    config,
    onLaunched: (browser: Browser): void => {
      activeBrowser = browser;
    },
  });

  const execution: SandboxExecutionResult = await WorkerController.execute({
    browserContext: session.browserContext,
    page: session.page,
    code: config.code,
    browserType: config.browserType,
    screenSizeType: config.screenSizeType,
    args: config.args,
    timeoutInMs: config.timeoutInMs,
  });

  const screenshots: Record<string, string> = {};
  for (const [name, screenshot] of Object.entries(execution.screenshots)) {
    screenshots[name] = screenshot.toString("base64");
  }

  return {
    returnValue: execution.returnValue,
    logMessages: execution.logMessages,
    capturedMetrics: execution.capturedMetrics,
    screenshots,
    scriptError: execution.scriptError,
  };
}

async function closeForSignal(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    await activeBrowser?.close();
  } catch {
    // The parent follows with SIGKILL if graceful browser cleanup stalls.
  } finally {
    process.exit(signal === "SIGTERM" ? 0 : 1);
  }
}

async function sendMessage(message: unknown): Promise<void> {
  if (!process.send || !process.connected) {
    return;
  }

  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      process.send?.(message, (error: Error | null): void => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    },
  );
}
