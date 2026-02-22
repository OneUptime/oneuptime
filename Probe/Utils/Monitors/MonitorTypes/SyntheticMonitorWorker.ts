/*
 * This script is executed via child_process.fork() with a sanitized environment
 * It launches Playwright, runs user code with node:vm (safe because env is stripped),
 * and sends results back via IPC.
 */

import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import BrowserUtil from "Common/Server/Utils/Browser";
import vm, { Context } from "node:vm";
import { Browser, BrowserContext, Page, chromium, firefox } from "playwright";

interface WorkerConfig {
  script: string;
  browserType: BrowserType;
  screenSizeType: ScreenSizeType;
  timeout: number;
  proxy?:
    | {
        server: string;
        username?: string | undefined;
        password?: string | undefined;
      }
    | undefined;
}

interface WorkerResult {
  logMessages: string[];
  scriptError?: string | undefined;
  result?: unknown | undefined;
  screenshots: Record<string, string>;
  executionTimeInMS: number;
}

interface ProxyOptions {
  server: string;
  username?: string | undefined;
  password?: string | undefined;
}

async function launchBrowserOnce(
  config: WorkerConfig,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const viewport: { height: number; width: number } =
    BrowserUtil.getViewportHeightAndWidth({
      screenSizeType: config.screenSizeType,
    });

  let proxyOptions: ProxyOptions | undefined;

  if (config.proxy) {
    proxyOptions = {
      server: config.proxy.server,
    };

    if (config.proxy.username && config.proxy.password) {
      proxyOptions.username = config.proxy.username;
      proxyOptions.password = config.proxy.password;
    }
  }

  let browser: Browser;

  if (config.browserType === BrowserType.Chromium) {
    const launchOptions: Record<string, unknown> = {
      executablePath: await BrowserUtil.getChromeExecutablePath(),
      headless: true,
      args: BrowserUtil.chromiumStabilityArgs,
    };

    if (proxyOptions) {
      launchOptions["proxy"] = proxyOptions;
    }

    browser = await chromium.launch(launchOptions);
  } else if (config.browserType === BrowserType.Firefox) {
    const launchOptions: Record<string, unknown> = {
      executablePath: await BrowserUtil.getFirefoxExecutablePath(),
      headless: true,
      firefoxUserPrefs: BrowserUtil.firefoxStabilityPrefs,
    };

    if (proxyOptions) {
      launchOptions["proxy"] = proxyOptions;
    }

    browser = await firefox.launch(launchOptions);
  } else {
    throw new Error("Invalid Browser Type.");
  }

  const context: BrowserContext = await browser.newContext({
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
  });

  const page: Page = await context.newPage();

  // Set default timeouts so page operations don't hang indefinitely
  page.setDefaultTimeout(config.timeout);
  page.setDefaultNavigationTimeout(config.timeout);

  return { browser, context, page };
}

const MAX_BROWSER_LAUNCH_RETRIES: number = 3;
const BROWSER_LAUNCH_RETRY_DELAY_MS: number = 2000;

async function launchBrowser(
  config: WorkerConfig,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  let lastError: Error | undefined;

  for (
    let attempt: number = 1;
    attempt <= MAX_BROWSER_LAUNCH_RETRIES;
    attempt++
  ) {
    try {
      return await launchBrowserOnce(config);
    } catch (err: unknown) {
      lastError = err as Error;

      // If this is not the last attempt, wait before retrying
      if (attempt < MAX_BROWSER_LAUNCH_RETRIES) {
        await new Promise((resolve: (value: void) => void) => {
          setTimeout(resolve, BROWSER_LAUNCH_RETRY_DELAY_MS);
        });
      }
    }
  }

  throw new Error(
    `Failed to launch browser after ${MAX_BROWSER_LAUNCH_RETRIES} attempts. ` +
      `This is usually caused by insufficient memory in the container. ` +
      `Last error: ${lastError?.message || String(lastError)}`,
  );
}

async function run(config: WorkerConfig): Promise<WorkerResult> {
  const workerResult: WorkerResult = {
    logMessages: [],
    scriptError: undefined,
    result: undefined,
    screenshots: {},
    executionTimeInMS: 0,
  };

  let browser: Browser | null = null;

  try {
    const startTime: [number, number] = process.hrtime();

    const session: { browser: Browser; context: BrowserContext; page: Page } =
      await launchBrowser(config);

    browser = session.browser;

    // Track browser disconnection so we can give a clear error
    let browserDisconnected: boolean = false;
    browser.on("disconnected", () => {
      browserDisconnected = true;
    });

    const logMessages: string[] = [];

    const sandbox: Context = {
      console: {
        log: (...args: unknown[]) => {
          logMessages.push(
            args
              .map((v: unknown) => {
                return typeof v === "object" ? JSON.stringify(v) : String(v);
              })
              .join(" "),
          );
        },
      },
      browser: session.browser,
      page: session.page,
      screenSizeType: config.screenSizeType,
      browserType: config.browserType,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
    };

    vm.createContext(sandbox);

    const script: string = `(async()=>{
      ${config.script}
    })()`;

    let returnVal: unknown;

    try {
      returnVal = await vm.runInContext(script, sandbox, {
        timeout: config.timeout,
      });
    } catch (scriptErr: unknown) {
      // If the browser crashed during script execution, provide a clearer error
      if (browserDisconnected) {
        throw new Error(
          "Browser crashed or was terminated during script execution. This is usually caused by high memory usage. Try simplifying the script or reducing the number of page navigations.",
        );
      }
      throw scriptErr;
    }

    const endTime: [number, number] = process.hrtime(startTime);
    const executionTimeInMS: number = Math.ceil(
      (endTime[0] * 1000000000 + endTime[1]) / 1000000,
    );

    workerResult.executionTimeInMS = executionTimeInMS;
    workerResult.logMessages = logMessages;

    // Convert screenshots from Buffer to base64
    const returnObj: Record<string, unknown> =
      returnVal && typeof returnVal === "object"
        ? (returnVal as Record<string, unknown>)
        : {};

    if (returnObj["screenshots"]) {
      const screenshots: Record<string, unknown> = returnObj[
        "screenshots"
      ] as Record<string, unknown>;

      for (const screenshotName in screenshots) {
        if (!screenshots[screenshotName]) {
          continue;
        }

        if (!(screenshots[screenshotName] instanceof Buffer)) {
          continue;
        }

        const screenshotBuffer: Buffer = screenshots[screenshotName] as Buffer;
        workerResult.screenshots[screenshotName] =
          screenshotBuffer.toString("base64");
      }
    }

    workerResult.result = returnObj["data"];
  } catch (err: unknown) {
    workerResult.scriptError = (err as Error)?.message || String(err);
  } finally {
    // Close browser
    if (browser) {
      try {
        const contexts: Array<BrowserContext> = browser.contexts();
        for (const ctx of contexts) {
          try {
            await ctx.close();
          } catch {
            // ignore
          }
        }
        if (browser.isConnected()) {
          await browser.close();
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }

  return workerResult;
}

/*
 * Safety timeout for process.send() callback — if the IPC channel closes
 * before the message is flushed, the callback never fires and the process
 * hangs until killed by the fork timeout (producing exit code null).
 */
const IPC_FLUSH_TIMEOUT_MS: number = 10000;

// Entry point: receive config via IPC message
process.on("message", (config: WorkerConfig) => {
  run(config)
    .then((result: WorkerResult) => {
      if (process.send) {
        /*
         * Wait for the IPC message to be flushed before exiting.
         * process.send() is async — calling process.exit() immediately
         * can kill the process before the message is delivered.
         */
        const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
          process.exit(0);
        }, IPC_FLUSH_TIMEOUT_MS);

        process.send(result, () => {
          clearTimeout(fallbackTimer);
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    })
    .catch((err: unknown) => {
      const errorResult: WorkerResult = {
        logMessages: [],
        scriptError: (err as Error)?.message || String(err),
        result: undefined,
        screenshots: {},
        executionTimeInMS: 0,
      };

      if (process.send) {
        const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
          process.exit(1);
        }, IPC_FLUSH_TIMEOUT_MS);

        process.send(errorResult, () => {
          clearTimeout(fallbackTimer);
          process.exit(1);
        });
      } else {
        process.exit(1);
      }
    });
});
