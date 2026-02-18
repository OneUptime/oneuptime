import { PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "../../../Config";
import ProxyConfig from "../../ProxyConfig";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import { ChildProcess, fork } from "child_process";
import path from "path";

export interface SyntheticMonitorOptions {
  monitorId?: ObjectID | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
  retryCountOnError?: number | undefined;
}

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

export default class SyntheticMonitor {
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
  }): Promise<SyntheticMonitorResponse | null> {
    const currentRetry: number = options.currentRetry || 0;
    const maxRetries: number = options.retryCountOnError;

    const result: SyntheticMonitorResponse | null =
      await this.executeByBrowserAndScreenSize({
        script: options.script,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
      });

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
      });
    }

    return result;
  }

  private static getSanitizedEnv(): Record<string, string> {
    // Only pass safe environment variables to the worker process.
    // Explicitly exclude all secrets (DATABASE_PASSWORD, REDIS_PASSWORD,
    // CLICKHOUSE_PASSWORD, ONEUPTIME_SECRET, ENCRYPTION_SECRET, BILLING_PRIVATE_KEY, etc.)
    const safeKeys: string[] = [
      "PATH",
      "HOME",
      "NODE_ENV",
      "PLAYWRIGHT_BROWSERS_PATH",
      "HTTP_PROXY_URL",
      "http_proxy",
      "HTTPS_PROXY_URL",
      "https_proxy",
      "NO_PROXY",
      "no_proxy",
    ];

    const env: Record<string, string> = {};

    for (const key of safeKeys) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }

    return env;
  }

  private static getProxyConfig(): WorkerConfig["proxy"] | undefined {
    if (!ProxyConfig.isProxyConfigured()) {
      return undefined;
    }

    const httpsProxyUrl: string | null = ProxyConfig.getHttpsProxyUrl();
    const httpProxyUrl: string | null = ProxyConfig.getHttpProxyUrl();
    const proxyUrl: string | null = httpsProxyUrl || httpProxyUrl;

    if (!proxyUrl) {
      return undefined;
    }

    const proxyConfig: WorkerConfig["proxy"] = {
      server: proxyUrl,
    };

    try {
      const parsedUrl: globalThis.URL = new URL(proxyUrl);
      if (parsedUrl.username && parsedUrl.password) {
        proxyConfig.username = parsedUrl.username;
        proxyConfig.password = parsedUrl.password;
      }
    } catch (error) {
      logger.warn(`Failed to parse proxy URL for authentication: ${error}`);
    }

    return proxyConfig;
  }

  private static async executeByBrowserAndScreenSize(options: {
    script: string;
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
  }): Promise<SyntheticMonitorResponse | null> {
    if (!options) {
      options = {
        script: "",
        browserType: BrowserType.Chromium,
        screenSizeType: ScreenSizeType.Desktop,
      };
    }

    const scriptResult: SyntheticMonitorResponse = {
      logMessages: [],
      scriptError: undefined,
      result: undefined,
      screenshots: {},
      executionTimeInMS: 0,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
    };

    const timeout: number = PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS;

    const workerConfig: WorkerConfig = {
      script: options.script,
      browserType: options.browserType,
      screenSizeType: options.screenSizeType,
      timeout: timeout,
      proxy: this.getProxyConfig(),
    };

    try {
      const workerResult: WorkerResult = await this.forkWorker(
        workerConfig,
        timeout,
      );

      scriptResult.logMessages = workerResult.logMessages;
      scriptResult.scriptError = workerResult.scriptError;
      scriptResult.result = workerResult.result as typeof scriptResult.result;
      scriptResult.screenshots = workerResult.screenshots;
      scriptResult.executionTimeInMS = workerResult.executionTimeInMS;
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error).toString();
    }

    return scriptResult;
  }

  private static async forkWorker(
    config: WorkerConfig,
    timeout: number,
  ): Promise<WorkerResult> {
    return new Promise(
      (
        resolve: (value: WorkerResult) => void,
        reject: (reason: Error) => void,
      ) => {
        // The worker file path. At runtime the compiled JS will be at the same
        // relative location under the build output directory.
        const workerPath: string = path.resolve(
          __dirname,
          "SyntheticMonitorWorker",
        );

        const child: ChildProcess = fork(workerPath, [], {
          env: this.getSanitizedEnv(),
          timeout: timeout + 30000, // fork-level timeout: script timeout + 30s for browser startup/shutdown
          stdio: ["pipe", "pipe", "pipe", "ipc"],
        });

        let resolved: boolean = false;

        // Explicit kill timer as final safety net
        const killTimer: ReturnType<typeof setTimeout> = global.setTimeout(
          () => {
            if (!resolved) {
              resolved = true;
              child.kill("SIGKILL");
              reject(
                new Error(
                  "Synthetic monitor worker killed after timeout",
                ),
              );
            }
          },
          timeout + 60000, // kill after script timeout + 60s
        );

        child.on("message", (result: WorkerResult) => {
          if (!resolved) {
            resolved = true;
            global.clearTimeout(killTimer);
            resolve(result);
          }
        });

        child.on("error", (err: Error) => {
          if (!resolved) {
            resolved = true;
            global.clearTimeout(killTimer);
            reject(err);
          }
        });

        child.on("exit", (exitCode: number | null) => {
          if (!resolved) {
            resolved = true;
            global.clearTimeout(killTimer);
            if (exitCode !== 0) {
              reject(
                new Error(
                  `Synthetic monitor worker exited with code ${exitCode}`,
                ),
              );
            } else {
              // Worker exited cleanly but didn't send a message — shouldn't happen
              reject(
                new Error(
                  "Synthetic monitor worker exited without sending results",
                ),
              );
            }
          }
        });

        // Send config to worker via IPC
        child.send(config);
      },
    );
  }
}
