// This script is executed via child_process.fork() with a sanitized environment
// It launches Playwright, runs user code with node:vm (safe because env is stripped),
// and sends results back via IPC.

import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import vm, { Context } from "node:vm";
import { Browser, BrowserContext, Page, chromium, firefox } from "playwright";
import LocalFile from "Common/Server/Utils/LocalFile";
import os from "os";

interface WorkerConfig {
  script: string;
  browserType: BrowserType;
  screenSizeType: ScreenSizeType;
  timeout: number;
  proxy?: {
    server: string;
    username?: string | undefined;
    password?: string | undefined;
  } | undefined;
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

function getViewportHeightAndWidth(screenSizeType: ScreenSizeType): {
  height: number;
  width: number;
} {
  switch (screenSizeType) {
    case ScreenSizeType.Desktop:
      return { height: 1080, width: 1920 };
    case ScreenSizeType.Mobile:
      return { height: 640, width: 360 };
    case ScreenSizeType.Tablet:
      return { height: 768, width: 1024 };
    default:
      return { height: 1080, width: 1920 };
  }
}

function getPlaywrightBrowsersPath(): string {
  return (
    process.env["PLAYWRIGHT_BROWSERS_PATH"] ||
    `${os.homedir()}/.cache/ms-playwright`
  );
}

async function getChromeExecutablePath(): Promise<string> {
  const browsersPath: string = getPlaywrightBrowsersPath();

  const doesDirectoryExist: boolean =
    await LocalFile.doesDirectoryExist(browsersPath);
  if (!doesDirectoryExist) {
    throw new Error("Chrome executable path not found.");
  }

  const directories: string[] =
    await LocalFile.getListOfDirectories(browsersPath);

  if (directories.length === 0) {
    throw new Error("Chrome executable path not found.");
  }

  const chromeInstallationName: string | undefined = directories.find(
    (directory: string) => {
      return directory.includes("chromium");
    },
  );

  if (!chromeInstallationName) {
    throw new Error("Chrome executable path not found.");
  }

  const candidates: Array<string> = [
    `${browsersPath}/${chromeInstallationName}/chrome-linux/chrome`,
    `${browsersPath}/${chromeInstallationName}/chrome-linux64/chrome`,
    `${browsersPath}/${chromeInstallationName}/chrome64/chrome`,
    `${browsersPath}/${chromeInstallationName}/chrome/chrome`,
  ];

  for (const executablePath of candidates) {
    if (await LocalFile.doesFileExist(executablePath)) {
      return executablePath;
    }
  }

  throw new Error("Chrome executable path not found.");
}

async function getFirefoxExecutablePath(): Promise<string> {
  const browsersPath: string = getPlaywrightBrowsersPath();

  const doesDirectoryExist: boolean =
    await LocalFile.doesDirectoryExist(browsersPath);
  if (!doesDirectoryExist) {
    throw new Error("Firefox executable path not found.");
  }

  const directories: string[] =
    await LocalFile.getListOfDirectories(browsersPath);

  if (directories.length === 0) {
    throw new Error("Firefox executable path not found.");
  }

  const firefoxInstallationName: string | undefined = directories.find(
    (directory: string) => {
      return directory.includes("firefox");
    },
  );

  if (!firefoxInstallationName) {
    throw new Error("Firefox executable path not found.");
  }

  const candidates: Array<string> = [
    `${browsersPath}/${firefoxInstallationName}/firefox/firefox`,
    `${browsersPath}/${firefoxInstallationName}/firefox-linux64/firefox`,
    `${browsersPath}/${firefoxInstallationName}/firefox64/firefox`,
    `${browsersPath}/${firefoxInstallationName}/firefox-64/firefox`,
  ];

  for (const executablePath of candidates) {
    if (await LocalFile.doesFileExist(executablePath)) {
      return executablePath;
    }
  }

  throw new Error("Firefox executable path not found.");
}

async function launchBrowser(
  config: WorkerConfig,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const viewport: { height: number; width: number } =
    getViewportHeightAndWidth(config.screenSizeType);

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
      executablePath: await getChromeExecutablePath(),
    };

    if (proxyOptions) {
      launchOptions["proxy"] = proxyOptions;
    }

    browser = await chromium.launch(launchOptions);
  } else if (config.browserType === BrowserType.Firefox) {
    const launchOptions: Record<string, unknown> = {
      executablePath: await getFirefoxExecutablePath(),
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

  return { browser, context, page };
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

    const returnVal: unknown = await vm.runInContext(script, sandbox, {
      timeout: config.timeout,
    });

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

        const screenshotBuffer: Buffer = screenshots[
          screenshotName
        ] as Buffer;
        workerResult.screenshots[screenshotName] =
          screenshotBuffer.toString("base64");
      }
    }

    workerResult.result = returnObj["data"];
  } catch (err: unknown) {
    workerResult.scriptError =
      (err as Error)?.message || String(err);
  } finally {
    // Close browser
    if (browser) {
      try {
        const contexts: Array<BrowserContext> = browser.contexts();
        for (const ctx of contexts) {
          try {
            await ctx.close();
          } catch (_e: unknown) {
            // ignore
          }
        }
        if (browser.isConnected()) {
          await browser.close();
        }
      } catch (_e: unknown) {
        // ignore cleanup errors
      }
    }
  }

  return workerResult;
}

// Entry point: receive config via IPC message
process.on("message", (config: WorkerConfig) => {
  run(config)
    .then((result: WorkerResult) => {
      if (process.send) {
        process.send(result);
      }
      process.exit(0);
    })
    .catch((err: unknown) => {
      if (process.send) {
        process.send({
          logMessages: [],
          scriptError: (err as Error)?.message || String(err),
          result: undefined,
          screenshots: {},
          executionTimeInMS: 0,
        } as WorkerResult);
      }
      process.exit(1);
    });
});
