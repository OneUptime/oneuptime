import {
  SYNTHETIC_MONITOR_RETRY_DELAY_IN_MS,
  SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
} from "../Config";
import BadDataException from "Common/Types/Exception/BadDataException";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import Screenshots from "Common/Types/Monitor/SyntheticMonitors/Screenshot";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import axios from "axios";
import crypto from "crypto";
import http from "http";
import https from "https";
import os from "os";
import { Browser, BrowserContext, Page, chromium, firefox } from "playwright";
import { SyntheticMonitorExecutionRequest } from "../Types/SyntheticMonitorExecution";

const MAX_LOG_BYTES: number = 1_000_000;

type AsyncFunctionConstructor = new (
  ...args: Array<string>
) => (...runtimeArgs: Array<unknown>) => Promise<unknown>;

const AsyncFunctionImpl: AsyncFunctionConstructor = Object.getPrototypeOf(
  async function (): Promise<void> {},
).constructor as AsyncFunctionConstructor;

interface BrowserLaunchOptions {
  executablePath?: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
    bypass?: string;
  };
  timeout?: number;
}

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

interface ScriptReturnValue {
  data?: SyntheticMonitorResponse["result"] | undefined;
  screenshots?: Record<string, unknown> | undefined;
}

type ConsoleMethod = (...args: Array<unknown>) => void;

interface ScriptConsole {
  log: ConsoleMethod;
  info: ConsoleMethod;
  warn: ConsoleMethod;
  error: ConsoleMethod;
  debug: ConsoleMethod;
}

export default class SyntheticMonitorExecutor {
  public static async execute(
    options: SyntheticMonitorExecutionRequest,
  ): Promise<Array<SyntheticMonitorResponse>> {
    const results: Array<SyntheticMonitorResponse> = [];

    for (const browserType of options.browserTypes || []) {
      for (const screenSizeType of options.screenSizeTypes || []) {
        logger.debug(
          `Running Synthetic Monitor: ${options.monitorId || "unknown"}, Screen Size: ${screenSizeType}, Browser: ${browserType}`,
        );

        const result: SyntheticMonitorResponse | null =
          await this.executeWithRetry({
            monitorId: options.monitorId,
            script: options.script,
            browserType: browserType,
            screenSizeType: screenSizeType,
            retryCountOnError: options.retryCountOnError || 0,
          });

        if (result) {
          result.browserType = browserType;
          result.screenSizeType = screenSizeType;
          results.push(result);
        }
      }
    }

    return results;
  }

  private static async executeWithRetry(options: {
    monitorId?: string | undefined;
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
    retryCountOnError: number;
    currentRetry?: number | undefined;
  }): Promise<SyntheticMonitorResponse | null> {
    const currentRetry: number = options.currentRetry || 0;
    const maxRetries: number = options.retryCountOnError;

    const result: SyntheticMonitorResponse | null =
      await this.executeByBrowserAndScreenSize({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
      });

    if (result?.scriptError && currentRetry < maxRetries) {
      logger.debug(
        `Synthetic Monitor script error, retrying (${currentRetry + 1}/${maxRetries}): ${result.scriptError}`,
      );

      await this.sleep(SYNTHETIC_MONITOR_RETRY_DELAY_IN_MS);

      return this.executeWithRetry({
        monitorId: options.monitorId,
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        retryCountOnError: maxRetries,
        currentRetry: currentRetry + 1,
      });
    }

    return result;
  }

  private static async executeByBrowserAndScreenSize(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<SyntheticMonitorResponse | null> {
    const scriptResult: SyntheticMonitorResponse = {
      logMessages: [],
      scriptError: undefined,
      result: undefined,
      screenshots: {},
      executionTimeInMS: 0,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
    };

    let browserSession: BrowserSession | null = null;

    try {
      const startTime: [number, number] = process.hrtime();

      browserSession = await SyntheticMonitorExecutor.getPageByBrowserType({
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
      });

      const returnValue: unknown = await this.runScript({
        script: options.script,
        page: browserSession.page,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        logMessages: scriptResult.logMessages,
      });

      const endTime: [number, number] = process.hrtime(startTime);

      scriptResult.executionTimeInMS = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      scriptResult.screenshots = this.getScreenshots(returnValue);
      scriptResult.result = this.getResultData(returnValue);
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error)?.toString() || String(err);
    } finally {
      await SyntheticMonitorExecutor.disposeBrowserSession(browserSession);
    }

    return scriptResult;
  }

  private static async runScript(data: {
    script: string;
    page: Page;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
    logMessages: Array<string>;
  }): Promise<unknown> {
    const sandboxConsole: ScriptConsole = this.createConsole(data.logMessages);
    const asyncFunction: (...runtimeArgs: Array<unknown>) => Promise<unknown> =
      new AsyncFunctionImpl(
        "axios",
        "page",
        "browserType",
        "screenSizeType",
        "crypto",
        "http",
        "https",
        "console",
        "sleep",
        `"use strict";\n${data.script}`,
      );

    let timeoutHandle: NodeJS.Timeout | undefined = undefined;

    const executionPromise: Promise<unknown> = asyncFunction(
      axios,
      data.page,
      data.browserType,
      data.screenSizeType,
      crypto,
      http,
      https,
      sandboxConsole,
      this.sleep,
    );

    const timeoutPromise: Promise<never> = new Promise(
      (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
        timeoutHandle = global.setTimeout(() => {
          reject(new Error("Script execution timed out"));
        }, SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS);
      },
    );

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        global.clearTimeout(timeoutHandle);
      }
    }
  }

  private static createConsole(logMessages: Array<string>): ScriptConsole {
    let totalLogBytes: number = 0;

    const writeLog: ConsoleMethod = (...args: Array<unknown>): void => {
      const message: string = args
        .map((value: unknown) => {
          return this.serializeLogValue(value);
        })
        .join(" ");

      totalLogBytes += message.length;

      if (totalLogBytes <= MAX_LOG_BYTES) {
        logMessages.push(message);
      }
    };

    return {
      log: writeLog,
      info: writeLog,
      warn: writeLog,
      error: writeLog,
      debug: writeLog,
    };
  }

  private static serializeLogValue(value: unknown): string {
    if (value instanceof Error) {
      return value.stack || value.message;
    }

    if (typeof value === "string") {
      return value;
    }

    try {
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    } catch {
      return String(value);
    }
  }

  private static getResultData(
    returnValue: unknown,
  ): SyntheticMonitorResponse["result"] {
    if (!returnValue || typeof returnValue !== "object") {
      return undefined;
    }

    return (returnValue as ScriptReturnValue).data;
  }

  private static getScreenshots(returnValue: unknown): Screenshots {
    const screenshots: Screenshots = {};

    if (!returnValue || typeof returnValue !== "object") {
      return screenshots;
    }

    const screenshotValues: Record<string, unknown> | undefined = (
      returnValue as ScriptReturnValue
    ).screenshots;

    if (!screenshotValues) {
      return screenshots;
    }

    for (const screenshotName of Object.keys(screenshotValues)) {
      const screenshotValue: unknown = screenshotValues[screenshotName];

      if (!Buffer.isBuffer(screenshotValue)) {
        continue;
      }

      screenshots[screenshotName] = screenshotValue.toString("base64");
    }

    return screenshots;
  }

  private static getViewportHeightAndWidth(options: {
    screenSizeType: ScreenSizeType;
  }): {
    height: number;
    width: number;
  } {
    let viewPortHeight: number = 0;
    let viewPortWidth: number = 0;

    switch (options.screenSizeType) {
      case ScreenSizeType.Desktop:
        viewPortHeight = 1080;
        viewPortWidth = 1920;
        break;
      case ScreenSizeType.Mobile:
        viewPortHeight = 640;
        viewPortWidth = 360;
        break;
      case ScreenSizeType.Tablet:
        viewPortHeight = 768;
        viewPortWidth = 1024;
        break;
      default:
        viewPortHeight = 1080;
        viewPortWidth = 1920;
        break;
    }

    return {
      height: viewPortHeight,
      width: viewPortWidth,
    };
  }

  private static getPlaywrightBrowsersPath(): string {
    return (
      process.env["PLAYWRIGHT_BROWSERS_PATH"] ||
      `${os.homedir()}/.cache/ms-playwright`
    );
  }

  public static async getChromeExecutablePath(): Promise<string> {
    const browsersPath: string = this.getPlaywrightBrowsersPath();

    const doesDirectoryExist: boolean =
      await LocalFile.doesDirectoryExist(browsersPath);
    if (!doesDirectoryExist) {
      throw new BadDataException("Chrome executable path not found.");
    }

    const directories: string[] =
      await LocalFile.getListOfDirectories(browsersPath);

    if (directories.length === 0) {
      throw new BadDataException("Chrome executable path not found.");
    }

    const chromeInstallationName: string | undefined = directories.find(
      (directory: string) => {
        return directory.includes("chromium");
      },
    );

    if (!chromeInstallationName) {
      throw new BadDataException("Chrome executable path not found.");
    }

    const chromeExecutableCandidates: Array<string> = [
      `${browsersPath}/${chromeInstallationName}/chrome-linux/chrome`,
      `${browsersPath}/${chromeInstallationName}/chrome-linux64/chrome`,
      `${browsersPath}/${chromeInstallationName}/chrome64/chrome`,
      `${browsersPath}/${chromeInstallationName}/chrome/chrome`,
    ];

    for (const executablePath of chromeExecutableCandidates) {
      if (await LocalFile.doesFileExist(executablePath)) {
        return executablePath;
      }
    }

    throw new BadDataException("Chrome executable path not found.");
  }

  public static async getFirefoxExecutablePath(): Promise<string> {
    const browsersPath: string = this.getPlaywrightBrowsersPath();

    const doesDirectoryExist: boolean =
      await LocalFile.doesDirectoryExist(browsersPath);
    if (!doesDirectoryExist) {
      throw new BadDataException("Firefox executable path not found.");
    }

    const directories: string[] =
      await LocalFile.getListOfDirectories(browsersPath);

    if (directories.length === 0) {
      throw new BadDataException("Firefox executable path not found.");
    }

    const firefoxInstallationName: string | undefined = directories.find(
      (directory: string) => {
        return directory.includes("firefox");
      },
    );

    if (!firefoxInstallationName) {
      throw new BadDataException("Firefox executable path not found.");
    }

    const firefoxExecutableCandidates: Array<string> = [
      `${browsersPath}/${firefoxInstallationName}/firefox/firefox`,
      `${browsersPath}/${firefoxInstallationName}/firefox-linux64/firefox`,
      `${browsersPath}/${firefoxInstallationName}/firefox64/firefox`,
      `${browsersPath}/${firefoxInstallationName}/firefox-64/firefox`,
    ];

    for (const executablePath of firefoxExecutableCandidates) {
      if (await LocalFile.doesFileExist(executablePath)) {
        return executablePath;
      }
    }

    throw new BadDataException("Firefox executable path not found.");
  }

  private static async getPageByBrowserType(data: {
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<BrowserSession> {
    const viewport: {
      height: number;
      width: number;
    } = SyntheticMonitorExecutor.getViewportHeightAndWidth({
      screenSizeType: data.screenSizeType,
    });

    const baseOptions: BrowserLaunchOptions = {
      timeout: Math.min(SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS, 30000),
    };

    const proxyOptions: BrowserLaunchOptions["proxy"] | undefined =
      this.getBrowserProxyOptions();

    if (proxyOptions) {
      baseOptions.proxy = proxyOptions;

      logger.debug(
        `Synthetic Monitor using proxy: ${proxyOptions.server} (HTTPS: ${Boolean(process.env["HTTPS_PROXY_URL"] || process.env["https_proxy"])}, HTTP: ${Boolean(process.env["HTTP_PROXY_URL"] || process.env["http_proxy"])})`,
      );
    }

    if (data.browserType === BrowserType.Chromium) {
      const browser: Browser = await chromium.launch({
        executablePath: await this.getChromeExecutablePath(),
        ...baseOptions,
      });

      const context: BrowserContext = await browser.newContext({
        viewport: {
          width: viewport.width,
          height: viewport.height,
        },
      });

      const page: Page = await context.newPage();

      return {
        browser,
        context,
        page,
      };
    }

    if (data.browserType === BrowserType.Firefox) {
      const browser: Browser = await firefox.launch({
        executablePath: await this.getFirefoxExecutablePath(),
        ...baseOptions,
      });

      let context: BrowserContext | null = null;

      try {
        context = await browser.newContext({
          viewport: {
            width: viewport.width,
            height: viewport.height,
          },
        });

        const page: Page = await context.newPage();

        return {
          browser,
          context,
          page,
        };
      } catch (error: unknown) {
        await SyntheticMonitorExecutor.safeCloseBrowserContext(context);
        await SyntheticMonitorExecutor.safeCloseBrowser(browser);
        throw error;
      }
    }

    throw new BadDataException("Invalid Browser Type.");
  }

  private static getBrowserProxyOptions():
    | BrowserLaunchOptions["proxy"]
    | undefined {
    const httpsProxyUrl: string | undefined =
      process.env["HTTPS_PROXY_URL"] || process.env["https_proxy"] || undefined;
    const httpProxyUrl: string | undefined =
      process.env["HTTP_PROXY_URL"] || process.env["http_proxy"] || undefined;
    const noProxy: string | undefined =
      process.env["NO_PROXY"] || process.env["no_proxy"] || undefined;
    const proxyUrl: string | undefined = httpsProxyUrl || httpProxyUrl;

    if (!proxyUrl) {
      return undefined;
    }

    const proxyOptions: NonNullable<BrowserLaunchOptions["proxy"]> = {
      server: proxyUrl,
    };

    if (noProxy) {
      proxyOptions.bypass = noProxy;
    }

    try {
      const parsedUrl: URL = new URL(proxyUrl);

      if (parsedUrl.username && parsedUrl.password) {
        proxyOptions.username = parsedUrl.username;
        proxyOptions.password = parsedUrl.password;
      }
    } catch (error: unknown) {
      logger.warn(`Failed to parse proxy URL for authentication: ${error}`);
    }

    return proxyOptions;
  }

  private static async disposeBrowserSession(
    session: BrowserSession | null,
  ): Promise<void> {
    if (!session) {
      return;
    }

    await SyntheticMonitorExecutor.safeClosePage(session.page);
    await SyntheticMonitorExecutor.safeCloseBrowserContexts({
      browser: session.browser,
    });
    await SyntheticMonitorExecutor.safeCloseBrowser(session.browser);
  }

  private static async safeClosePage(page?: Page | null): Promise<void> {
    if (!page) {
      return;
    }

    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (error: unknown) {
      logger.warn(
        `Failed to close Playwright page: ${(error as Error)?.message || error}`,
      );
    }
  }

  private static async safeCloseBrowserContext(
    context?: BrowserContext | null,
  ): Promise<void> {
    if (!context) {
      return;
    }

    try {
      await context.close();
    } catch (error: unknown) {
      logger.warn(
        `Failed to close Playwright browser context: ${(error as Error)?.message || error}`,
      );
    }
  }

  private static async safeCloseBrowser(
    browser?: Browser | null,
  ): Promise<void> {
    if (!browser) {
      return;
    }

    try {
      if (browser.isConnected()) {
        await browser.close();
      }
    } catch (error: unknown) {
      logger.warn(
        `Failed to close Playwright browser: ${(error as Error)?.message || error}`,
      );
    }
  }

  private static async safeCloseBrowserContexts(data: {
    browser: Browser;
  }): Promise<void> {
    const contexts: Array<BrowserContext> = data.browser.contexts();

    for (const context of contexts) {
      await SyntheticMonitorExecutor.safeCloseBrowserContext(context);
    }
  }

  private static async sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void) => {
      global.setTimeout(resolve, ms);
    });
  }
}
