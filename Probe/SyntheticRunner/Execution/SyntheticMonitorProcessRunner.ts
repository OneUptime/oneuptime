import {
  SYNTHETIC_MONITOR_ATTEMPT_PADDING_IN_MS,
  SYNTHETIC_MONITOR_CHILD_GROUP_ID,
  SYNTHETIC_MONITOR_CHILD_HOME_DIR,
  SYNTHETIC_MONITOR_CHILD_USER_ID,
  SYNTHETIC_MONITOR_RETRY_DELAY_IN_MS,
  SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
} from "../Config";
import {
  SyntheticMonitorExecutionChildMessage,
  SyntheticMonitorExecutionRequest,
  SyntheticMonitorExecutionResponse,
} from "../Types/SyntheticMonitorExecution";
import fs from "fs";
import logger from "Common/Server/Utils/Logger";
import path from "path";
import { fork, ForkOptions } from "child_process";

export default class SyntheticMonitorProcessRunner {
  public static async execute(
    request: SyntheticMonitorExecutionRequest,
  ): Promise<SyntheticMonitorExecutionResponse> {
    const childScriptPath: string = path.resolve(
      __dirname,
      `ExecuteSyntheticMonitorScript${path.extname(__filename) || ".js"}`,
    );

    this.ensureChildHomeDirectory();

    const forkOptions: ForkOptions = {
      cwd: process.cwd(),
      env: this.buildChildEnv(),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      detached: true,
    };

    if (
      typeof process.getuid === "function" &&
      process.getuid() === 0 &&
      typeof process.getgid === "function"
    ) {
      forkOptions.uid = SYNTHETIC_MONITOR_CHILD_USER_ID;
      forkOptions.gid = SYNTHETIC_MONITOR_CHILD_GROUP_ID;
    }

    const child = fork(childScriptPath, [], forkOptions);
    const timeoutInMS: number = this.getProcessTimeoutInMS(request);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string): void => {
      logger.debug(`[synthetic-runner-child] ${chunk.trim()}`);
    });

    child.stderr?.on("data", (chunk: string): void => {
      logger.warn(`[synthetic-runner-child] ${chunk.trim()}`);
    });

    return new Promise<SyntheticMonitorExecutionResponse>(
      (
        resolve: (value: SyntheticMonitorExecutionResponse) => void,
        reject: (reason: Error) => void,
      ) => {
        let settled: boolean = false;

        const finish = (
          callback: () => void,
          options?: {
            killChild?: boolean | undefined;
          },
        ): void => {
          if (settled) {
            return;
          }

          settled = true;
          global.clearTimeout(timeoutHandle);
          child.removeAllListeners();

          if (options?.killChild) {
            this.killChildProcessGroup(child.pid);
          }

          callback();
        };

        const timeoutHandle: NodeJS.Timeout = global.setTimeout(() => {
          finish(
            () => {
              reject(new Error("Synthetic monitor process timed out"));
            },
            {
              killChild: true,
            },
          );
        }, timeoutInMS);

        child.once("error", (error: Error) => {
          finish(
            () => {
              reject(error);
            },
            {
              killChild: true,
            },
          );
        });

        child.once(
          "message",
          (message: SyntheticMonitorExecutionChildMessage) => {
            if (message.type === "success") {
              finish(() => {
                resolve(message.payload);
              });

              return;
            }

            finish(
              () => {
                reject(
                  new Error(
                    message.error.stack
                      ? `${message.error.message}\n${message.error.stack}`
                      : message.error.message,
                  ),
                );
              },
              {
                killChild: true,
              },
            );
          },
        );

        child.once(
          "exit",
          (code: number | null, signal: NodeJS.Signals | null) => {
            if (settled) {
              return;
            }

            finish(() => {
              reject(
                new Error(
                  `Synthetic runner child exited before responding (code: ${
                    code === null ? "null" : code
                  }, signal: ${signal || "none"})`,
                ),
              );
            });
          },
        );

        child.send(request);
      },
    );
  }

  private static getProcessTimeoutInMS(
    request: SyntheticMonitorExecutionRequest,
  ): number {
    const browserCount: number = request.browserTypes?.length || 0;
    const screenSizeCount: number = request.screenSizeTypes?.length || 0;
    const combinationCount: number =
      browserCount > 0 && screenSizeCount > 0
        ? browserCount * screenSizeCount
        : 1;
    const attemptCount: number = (request.retryCountOnError || 0) + 1;
    const perAttemptTimeoutInMS: number =
      SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS +
      SYNTHETIC_MONITOR_ATTEMPT_PADDING_IN_MS;

    return (
      combinationCount *
        (attemptCount * perAttemptTimeoutInMS +
          (attemptCount - 1) * SYNTHETIC_MONITOR_RETRY_DELAY_IN_MS) +
      5000
    );
  }

  private static buildChildEnv(): NodeJS.ProcessEnv {
    const env: Record<string, string | undefined> = {
      HOME: SYNTHETIC_MONITOR_CHILD_HOME_DIR,
      XDG_CACHE_HOME: SYNTHETIC_MONITOR_CHILD_HOME_DIR,
      XDG_CONFIG_HOME: SYNTHETIC_MONITOR_CHILD_HOME_DIR,
      XDG_DATA_HOME: SYNTHETIC_MONITOR_CHILD_HOME_DIR,
      TMPDIR: "/tmp",
      TMP: "/tmp",
      TEMP: "/tmp",
      PATH: process.env["PATH"] || "",
      NODE_ENV: process.env["NODE_ENV"] || "production",
      NODE_OPTIONS: process.env["NODE_OPTIONS"],
      NODE_EXTRA_CA_CERTS: process.env["NODE_EXTRA_CA_CERTS"],
      SSL_CERT_FILE: process.env["SSL_CERT_FILE"],
      SSL_CERT_DIR: process.env["SSL_CERT_DIR"],
      PLAYWRIGHT_BROWSERS_PATH:
        process.env["PLAYWRIGHT_BROWSERS_PATH"] || "/ms-playwright-browsers",
      HTTP_PROXY_URL: process.env["HTTP_PROXY_URL"],
      HTTPS_PROXY_URL: process.env["HTTPS_PROXY_URL"],
      NO_PROXY: process.env["NO_PROXY"],
      http_proxy: process.env["http_proxy"],
      https_proxy: process.env["https_proxy"],
      no_proxy: process.env["no_proxy"],
      TZ: process.env["TZ"],
      LANG: process.env["LANG"],
      LANGUAGE: process.env["LANGUAGE"],
      LC_ALL: process.env["LC_ALL"],
    };

    return Object.fromEntries(
      Object.entries(env).filter(
        (entry: [string, string | undefined]): entry is [string, string] => {
          return typeof entry[1] === "string";
        },
      ),
    );
  }

  private static ensureChildHomeDirectory(): void {
    if (!fs.existsSync(SYNTHETIC_MONITOR_CHILD_HOME_DIR)) {
      fs.mkdirSync(SYNTHETIC_MONITOR_CHILD_HOME_DIR, {
        recursive: true,
        mode: 0o755,
      });
    }

    if (
      typeof process.getuid === "function" &&
      process.getuid() === 0 &&
      typeof process.getgid === "function"
    ) {
      fs.chownSync(
        SYNTHETIC_MONITOR_CHILD_HOME_DIR,
        SYNTHETIC_MONITOR_CHILD_USER_ID,
        SYNTHETIC_MONITOR_CHILD_GROUP_ID,
      );
    }
  }

  private static killChildProcessGroup(pid?: number): void {
    if (!pid) {
      return;
    }

    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        return;
      }
    }
  }
}
