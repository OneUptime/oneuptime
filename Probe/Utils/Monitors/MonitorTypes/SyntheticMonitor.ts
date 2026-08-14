import {
  PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED,
  PROBE_SYNTHETIC_MONITOR_MAX_DISK_BYTES,
  PROBE_SYNTHETIC_MONITOR_MAX_CONCURRENCY,
  PROBE_SYNTHETIC_MONITOR_MAX_PROCESS_TREE_RSS_BYTES,
  PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
  NO_PROXY,
} from "../../../Config";
import ProxyConfig from "../../ProxyConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  CustomCodeMonitorResult,
  RetryAttempt,
} from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import LocalFile from "Common/Server/Utils/LocalFile";
import os from "os";
import path from "path";
import { SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS } from "../SyntheticRuntime/Limits";
import ProcessRunner from "../SyntheticRuntime/ProcessRunner";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerProxy,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerResult,
} from "../SyntheticRuntime/SyntheticMonitorWorkerTypes";

export interface SyntheticMonitorOptions {
  monitorId?: ObjectID | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
  retryCountOnError?: number | undefined;
}

export default class SyntheticMonitor {
  private static readonly processRunner: ProcessRunner = new ProcessRunner({
    workerEntryPath: path.join(
      __dirname,
      "../SyntheticRuntime",
      `SyntheticMonitorWorker${path.extname(__filename)}`,
    ),
    concurrencyLimit: PROBE_SYNTHETIC_MONITOR_MAX_CONCURRENCY,
    maxDiskBytes: PROBE_SYNTHETIC_MONITOR_MAX_DISK_BYTES,
    maxProcessTreeRssBytes: PROBE_SYNTHETIC_MONITOR_MAX_PROCESS_TREE_RSS_BYTES,
    workingDirectory: path.resolve(__dirname, "../../.."),
  });

  public static async execute(
    options: SyntheticMonitorOptions,
  ): Promise<Array<SyntheticMonitorResponse> | null> {
    const results: Array<SyntheticMonitorResponse> = [];

    for (const browserType of options.browserTypes || []) {
      for (const screenSizeType of options.screenSizeTypes || []) {
        logger.debug(
          `Running Synthetic Monitor: ${options?.monitorId?.toString()}, Screen Size: ${screenSizeType}, Browser: ${browserType}`,
        );

        const result: SyntheticMonitorResponse | null =
          await this.executeWithRetry({
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
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
    retryCountOnError: number;
    currentRetry?: number;
    attemptHistory?: Array<RetryAttempt>;
  }): Promise<SyntheticMonitorResponse | null> {
    const currentRetry: number = options.currentRetry || 0;
    const maxRetries: number = options.retryCountOnError;
    const attemptHistory: Array<RetryAttempt> = options.attemptHistory || [];

    const result: SyntheticMonitorResponse | null =
      await this.executeByBrowserAndScreenSize({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
      });

    if (result) {
      attemptHistory.push({
        attemptNumber: currentRetry + 1,
        scriptError: result.scriptError,
        executionTimeInMS: result.executionTimeInMS,
      });
    }

    // If there's an error and we haven't exceeded retry count, retry
    if (result?.scriptError && currentRetry < maxRetries) {
      logger.debug(
        `Synthetic Monitor script error, retrying (${currentRetry + 1}/${maxRetries}): ${result.scriptError}`,
      );

      // Wait a bit before retrying
      await new Promise((resolve: (value: void) => void) => {
        setTimeout(resolve, 1000);
      });

      return this.executeWithRetry({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        retryCountOnError: maxRetries,
        currentRetry: currentRetry + 1,
        attemptHistory: attemptHistory,
      });
    }

    if (result) {
      result.totalAttempts = attemptHistory.length;
      /*
       * Per-attempt history is only useful when more than one attempt occurred.
       * Skip populating it for clean single-attempt runs to keep the log payload small.
       */
      if (attemptHistory.length > 1) {
        result.retryAttempts = attemptHistory;
      }
    }

    return result;
  }

  private static async executeByBrowserAndScreenSize(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<SyntheticMonitorResponse | null> {
    if (!options) {
      // this should never happen
      options = {
        script: "",
        browserType: BrowserType.Chromium,
        screenSizeType: ScreenSizeType.Desktop,
      };
    }

    const scriptResult: SyntheticMonitorResponse = {
      logMessages: [],
      capturedMetrics: [],
      scriptError: undefined,
      result: undefined,
      screenshots: {},
      executionTimeInMS: 0,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
    };

    try {
      const startTime: [number, number] = process.hrtime();
      const workerConfig: SyntheticMonitorWorkerConfig = {
        code: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        executablePath:
          options.browserType === BrowserType.Chromium
            ? await this.getChromeExecutablePath()
            : await this.getFirefoxExecutablePath(),
        viewport: this.getViewportHeightAndWidth({
          screenSizeType: options.screenSizeType,
        }),
        timeoutInMs: PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
        chromiumSandboxEnabled:
          PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED,
        proxy: this.getBrowserProxy(),
        args: {},
      };

      const processResult: { result: SyntheticMonitorWorkerResult } =
        await this.processRunner.run<
          SyntheticMonitorWorkerConfig,
          SyntheticMonitorWorkerResult
        >({
          payload: workerConfig,
          timeoutInMs:
            PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS +
            SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS,
          queueTimeoutInMs: SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS,
          validateResult: isSyntheticMonitorWorkerResult,
        });
      const result: SyntheticMonitorWorkerResult = processResult.result;

      const endTime: [number, number] = process.hrtime(startTime);

      const executionTimeInMS: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      scriptResult.executionTimeInMS = executionTimeInMS;

      scriptResult.logMessages = result.logMessages;
      scriptResult.capturedMetrics = result.capturedMetrics || [];

      if (scriptResult.capturedMetrics.length > 0) {
        logger.debug(
          `Synthetic Monitor - Captured ${scriptResult.capturedMetrics.length} custom metrics`,
        );
      }

      scriptResult.screenshots = { ...result.screenshots };
      const returnedData: unknown = this.getReturnedData(result.returnValue);
      if (this.isJsonSafeResult(returnedData)) {
        scriptResult.result = returnedData;
      }

      if (result.scriptError) {
        logger.error(result.scriptError);
        scriptResult.scriptError = result.scriptError;
      }
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error).toString();
    }

    return scriptResult;
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

    return { height: viewPortHeight, width: viewPortWidth };
  }

  private static getReturnedData(returnValue: unknown): unknown {
    if (
      returnValue === null ||
      typeof returnValue !== "object" ||
      Array.isArray(returnValue) ||
      !Object.prototype.hasOwnProperty.call(returnValue, "data")
    ) {
      return undefined;
    }

    return (returnValue as Record<string, unknown>)["data"];
  }

  private static isJsonSafeResult(
    value: unknown,
    seen: WeakSet<WeakKey> = new WeakSet<WeakKey>(),
  ): value is CustomCodeMonitorResult {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      return true;
    }

    if (typeof value === "number") {
      return Number.isFinite(value);
    }

    if (typeof value !== "object" || seen.has(value)) {
      return false;
    }

    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      return false;
    }

    seen.add(value);
    const entries: unknown[] = Array.isArray(value)
      ? value
      : Object.values(value as Record<string, unknown>);
    const isJsonSafe: boolean = entries.every((entry: unknown) => {
      return this.isJsonSafeResult(entry, seen);
    });
    seen.delete(value);
    return isJsonSafe;
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

    // get list of files in the directory
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

    // get list of files in the directory
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

  private static getBrowserProxy(): SyntheticMonitorWorkerProxy | undefined {
    if (ProxyConfig.isProxyConfigured()) {
      const httpsProxyUrl: string | null = ProxyConfig.getHttpsProxyUrl();
      const httpProxyUrl: string | null = ProxyConfig.getHttpProxyUrl();

      // Prefer HTTPS proxy, fall back to HTTP proxy
      const proxyUrl: string | null = httpsProxyUrl || httpProxyUrl;

      if (proxyUrl) {
        const proxy: SyntheticMonitorWorkerProxy = {
          server: proxyUrl,
        };

        if (NO_PROXY.length > 0) {
          proxy.bypass = NO_PROXY.join(",");
        }

        // Extract username and password if present in proxy URL
        try {
          const parsedUrl: globalThis.URL = new URL(proxyUrl);
          if (parsedUrl.username && parsedUrl.password) {
            proxy.username = parsedUrl.username;
            proxy.password = parsedUrl.password;
          }
        } catch (error) {
          logger.warn(`Failed to parse proxy URL for authentication: ${error}`);
        }

        logger.debug(
          `Synthetic Monitor using proxy: ${proxyUrl} (HTTPS: ${Boolean(httpsProxyUrl)}, HTTP: ${Boolean(httpProxyUrl)})`,
        );

        return proxy;
      }
    }
    return undefined;
  }
}
