import path from "path";
import {
  BrowserContext,
  BrowserType as PlaywrightBrowserType,
  Page,
  chromium,
  firefox,
} from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import WorkerController from "./WorkerController";
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
let activeBrowserContext: BrowserContext | null = null;
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
    process.disconnect?.();
  }
}

async function executeMonitor(
  config: SyntheticMonitorWorkerConfig,
): Promise<SyntheticMonitorWorkerResult> {
  let browserContext: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browserLauncher: PlaywrightBrowserType =
      config.browserType === BrowserType.Chromium ? chromium : firefox;
    const proxyOptions: {
      proxy?: {
        server: string;
        username?: string;
        password?: string;
        bypass?: string;
      };
    } = config.proxy
      ? {
          proxy: {
            server: config.proxy.server,
            ...(config.proxy.username !== undefined
              ? { username: config.proxy.username }
              : {}),
            ...(config.proxy.password !== undefined
              ? { password: config.proxy.password }
              : {}),
            ...(config.proxy.bypass !== undefined
              ? { bypass: config.proxy.bypass }
              : {}),
          },
        }
      : {};
    const runDirectory: string | undefined = process.env["HOME"];
    if (!runDirectory || !path.isAbsolute(runDirectory)) {
      throw new Error("Synthetic worker run directory is unavailable.");
    }

    browserContext = await browserLauncher.launchPersistentContext(
      path.join(runDirectory, "browser-profile"),
      {
        executablePath: config.executablePath,
        acceptDownloads: false,
        viewport: config.viewport,
        ...proxyOptions,
        ...(config.browserType === BrowserType.Chromium
          ? { chromiumSandbox: config.chromiumSandboxEnabled }
          : {}),
      },
    );
    activeBrowserContext = browserContext;
    page = browserContext.pages()[0] || (await browserContext.newPage());

    const execution: SandboxExecutionResult = await WorkerController.execute({
      browserContext,
      page,
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
  } finally {
    if (page && !page.isClosed()) {
      try {
        await page.close();
      } catch {
        // Closing the browser below is the final in-process cleanup step.
      }
    }
    if (browserContext) {
      try {
        await browserContext.close();
      } catch {
        // The parent process supervisor kills the full process group.
      }
    }
    activeBrowserContext = null;
  }
}

async function closeForSignal(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    await activeBrowserContext?.close();
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
