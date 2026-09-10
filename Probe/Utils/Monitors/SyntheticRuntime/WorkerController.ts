import crypto from "crypto";
import { BrowserContext, Page, Route } from "playwright";
import PlaywrightCapabilityBroker from "./PlaywrightCapabilityBroker";
import {
  MAX_RPC_RESULT_BYTES,
  MAX_SANDBOX_LOG_BYTES,
  MAX_SANDBOX_LOG_MESSAGES,
  MAX_SANDBOX_METRICS,
  SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
  SandboxExecutionResult,
  SandboxMetric,
  byteLengthOfJson,
  createExecutionId,
  isRecord,
} from "./RpcProtocol";
import { getSyntheticMonitorWorkerBootstrapSource } from "./WorkerBootstrap";
import SyntheticRuntimeFault from "./SyntheticRuntimeFault";
import { SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN } from "./ControllerOrigin";
import { SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS } from "./Limits";

const MAX_SCRIPT_BYTES: number = 1_000_000;
const MAX_SCRIPT_ERROR_BYTES: number = 4_000;
const RUNTIME_STARTUP_TIMEOUT_IN_MS: number = 30_000;
/*
 * The controller document never touches the network: page.route fulfils it
 * from memory, with no socket, no DNS lookup, and no proxy hop. On an idle
 * probe the navigation completes in about a tenth of a second. The per-attempt
 * budget is in seconds only to absorb a probe that is briefly saturated --
 * which it is, predictably, whenever monitor intervals align on a wall-clock
 * boundary.
 *
 * When even that is not enough, the answer is another attempt, not a bigger
 * number. A navigation that stalls leaves its request paused inside a page
 * that will never recover, but the browser around it is healthy: a fresh page
 * navigates in roughly a hundred milliseconds. Without this retry a single
 * stalled bootstrap discarded a check that still had minutes of its deadline
 * unspent, and handed the tenant a Playwright timeout naming an internal URL
 * as though their own script had failed.
 */
const CONTROLLER_BOOTSTRAP_TIMEOUT_IN_MS: number = 20_000;
const CONTROLLER_BOOTSTRAP_ATTEMPTS: number = 3;
const CONTROLLER_BOOTSTRAP_RETRY_DELAY_IN_MS: number = 250;
const MAX_CONTROLLER_BOOTSTRAP_ATTEMPTS: number = 10;
/*
 * Retrying has to stay inside the budget the supervisor already set aside for
 * starting a worker, or a bootstrap that keeps stalling stops being reported
 * as a bootstrap failure at all: the supervisor's own deadline fires first and
 * the check dies as a bare execution timeout, which says nothing about why.
 *
 * The startup allowance covers everything before the tenant's script -- fork,
 * ts-node, browser launch, this navigation, sandbox init. Half of it is this
 * step's share; the rest belongs to the browser launch and the sandbox, which
 * carry their own 30-second budgets on either side of it.
 */
const CONTROLLER_BOOTSTRAP_TOTAL_BUDGET_IN_MS: number = Math.floor(
  SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS / 2,
);

interface WorkerCompletionResult {
  returnValue?: unknown;
  logMessages: unknown;
  capturedMetrics: unknown;
  screenshotAssignments: unknown;
  scriptError?: unknown;
}

export interface WorkerControllerOptions {
  browserContext: BrowserContext;
  page: Page;
  code: string;
  browserType: string;
  screenSizeType: string;
  args?: Record<string, unknown> | undefined;
  timeoutInMs: number;
  /*
   * Bootstrap budget for the internal controller page, separate from the
   * tenant's script deadline above. Exposed so tests can drive the retry path
   * without spending half a minute per attempt.
   */
  bootstrapTimeoutInMs?: number | undefined;
  bootstrapAttempts?: number | undefined;
}

interface ControllerPayload {
  version: number;
  executionId: string;
  code: string;
  browserType: string;
  screenSizeType: string;
  args: Record<string, unknown>;
  capabilities: ReturnType<
    PlaywrightCapabilityBroker["getBootstrapCapabilities"]
  >;
}

/**
 * Runs untrusted monitor source in a browser Web Worker that has no ambient
 * network access. The worker can affect the monitored page only through the
 * copy-only, allowlisted capability broker.
 */
export default class WorkerController {
  public static async execute(
    options: WorkerControllerOptions,
  ): Promise<SandboxExecutionResult> {
    this.validateOptions(options);

    const executionId: string = createExecutionId();
    const bindingName: string = `__oneuptimeRpc_${crypto
      .randomBytes(16)
      .toString("hex")}`;
    const controlKey: string = `__oneuptimeWorker_${crypto
      .randomBytes(16)
      .toString("hex")}`;
    const abortController: AbortController = new AbortController();
    let controllerPage: Page | null = null;
    let timeout: NodeJS.Timeout | null = null;
    let startupTimeout: NodeJS.Timeout | null = null;

    try {
      const controllerUrl: string = `${SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN}/${executionId}`;

      let resolveRuntimeReady: (() => void) | null = null;
      const runtimeReadyPromise: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          resolveRuntimeReady = resolve;
        },
      );

      /*
       * The broker is built from the page that the bootstrap finally settles
       * on, so it cannot exist yet -- but the RPC binding has to be installed
       * on every attempt, before that page navigates. The binding therefore
       * closes over the broker slot rather than the broker, and reads it at
       * call time. Nothing can call it before the sandbox starts, which is
       * strictly after the assignment below.
       *
       * Constructing a broker per attempt would be the obvious alternative and
       * is wrong: each one subscribes to the shared browser context's "page"
       * event, so discarded attempts would leave their listeners behind.
       */
      let broker: PlaywrightCapabilityBroker | null = null;

      controllerPage = await this.openControllerPage({
        browserContext: options.browserContext,
        controllerUrl,
        bindingName,
        abortSignal: abortController.signal,
        timeoutInMs: this.getBootstrapTimeoutInMs(options),
        attempts: this.getBootstrapAttempts(options),
        totalBudgetInMs: this.getBootstrapTotalBudgetInMs(options),
        dispatch: async (request: unknown): Promise<unknown> => {
          if (!broker) {
            throw new Error(
              "Synthetic runtime RPC arrived before the sandbox was ready.",
            );
          }
          return await broker.dispatch(request);
        },
      });

      broker = new PlaywrightCapabilityBroker({
        executionId,
        page: options.page,
        browserContext: options.browserContext,
        controllerPage,
        signal: abortController.signal,
        onRuntimeReady: (): void => {
          resolveRuntimeReady?.();
        },
      });

      const payload: ControllerPayload = {
        version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
        executionId,
        code: options.code,
        browserType: options.browserType,
        screenSizeType: options.screenSizeType,
        args: options.args || {},
        capabilities: broker.getBootstrapCapabilities(),
      };

      const executionPromise: Promise<unknown> = this.startWorker({
        controllerPage,
        bindingName,
        controlKey,
        bootstrapSource: getSyntheticMonitorWorkerBootstrapSource(),
        payload,
      });
      const readyMarker: Record<string, never> = {};
      const startupTimeoutMarker: Record<string, never> = {};
      const startupTimeoutPromise: Promise<unknown> = new Promise<unknown>(
        (resolve: (value: unknown) => void): void => {
          startupTimeout = setTimeout(() => {
            resolve(startupTimeoutMarker);
          }, RUNTIME_STARTUP_TIMEOUT_IN_MS);
          startupTimeout.unref();
        },
      );
      const startupResult: unknown = await Promise.race([
        executionPromise,
        runtimeReadyPromise.then((): Record<string, never> => {
          return readyMarker;
        }),
        startupTimeoutPromise,
      ]);
      if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
      }
      if (startupResult === startupTimeoutMarker) {
        /*
         * The controller page loaded, so the browser is alive, but the sandbox
         * never signalled ready. Nothing tenant-authored has run and the
         * monitored page has not been opened -- this is the probe's failure.
         */
        throw new SyntheticRuntimeFault({
          message: `Synthetic monitor could not start on this probe: the sandbox did not finish initializing within ${RUNTIME_STARTUP_TIMEOUT_IN_MS} ms. The monitored page was never opened, so this does not reflect the health of the monitored site.`,
        });
      }

      let rawResult: unknown = startupResult;
      if (startupResult === readyMarker) {
        const timeoutMarker: Record<string, never> = {};
        const timeoutPromise: Promise<unknown> = new Promise<unknown>(
          (resolve: (value: unknown) => void) => {
            timeout = setTimeout(() => {
              abortController.abort();
              resolve(timeoutMarker);
            }, options.timeoutInMs);
            timeout.unref();
          },
        );

        rawResult = await Promise.race([executionPromise, timeoutPromise]);
        if (rawResult === timeoutMarker) {
          return {
            returnValue: undefined,
            logMessages: broker.getLogMessages(),
            capturedMetrics: broker.getCapturedMetrics(),
            screenshots: broker.getScreenshots(),
            scriptError: `Synthetic monitor script timed out after ${options.timeoutInMs} ms.`,
          };
        }
      }
      const workerResult: WorkerCompletionResult =
        this.validateWorkerResult(rawResult);

      broker.collectScreenshotsFromReturnValue(workerResult.returnValue);
      broker.collectScreenshotAssignments(workerResult.screenshotAssignments);

      return {
        returnValue: workerResult.returnValue,
        logMessages: this.validateLogMessages(workerResult.logMessages),
        capturedMetrics: this.validateMetrics(workerResult.capturedMetrics),
        screenshots: broker.getScreenshots(),
        scriptError:
          typeof workerResult.scriptError === "string"
            ? workerResult.scriptError.substring(0, MAX_SCRIPT_ERROR_BYTES)
            : undefined,
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (startupTimeout) {
        clearTimeout(startupTimeout);
      }
      abortController.abort();
      if (controllerPage && !controllerPage.isClosed()) {
        try {
          await this.stopWorker(controllerPage, controlKey);
        } catch {
          // The controller page is closed below even if the worker crashed.
        }
      }
      if (controllerPage && !controllerPage.isClosed()) {
        try {
          await controllerPage.close();
        } catch {
          // The child process supervisor is the final cleanup boundary.
        }
      }
    }
  }

  private static validateOptions(options: WorkerControllerOptions): void {
    if (typeof options.code !== "string") {
      throw new Error("Synthetic monitor script must be a string.");
    }
    if (Buffer.byteLength(options.code, "utf8") > MAX_SCRIPT_BYTES) {
      throw new Error("Synthetic monitor script exceeded the size limit.");
    }
    if (
      !Number.isSafeInteger(options.timeoutInMs) ||
      options.timeoutInMs <= 0
    ) {
      throw new Error("Synthetic monitor timeout is invalid.");
    }
    if (byteLengthOfJson(options.args || {}) > MAX_RPC_RESULT_BYTES) {
      throw new Error("Synthetic monitor arguments exceeded the size limit.");
    }
    if (
      options.bootstrapTimeoutInMs !== undefined &&
      (!Number.isSafeInteger(options.bootstrapTimeoutInMs) ||
        options.bootstrapTimeoutInMs <= 0)
    ) {
      throw new Error("Synthetic runtime bootstrap timeout is invalid.");
    }
    if (
      options.bootstrapAttempts !== undefined &&
      (!Number.isSafeInteger(options.bootstrapAttempts) ||
        options.bootstrapAttempts < 1 ||
        options.bootstrapAttempts > MAX_CONTROLLER_BOOTSTRAP_ATTEMPTS)
    ) {
      throw new Error("Synthetic runtime bootstrap attempt count is invalid.");
    }
  }

  /**
   * Opens the internal controller page and navigates it to the sentinel
   * document, retrying on a fresh page when an attempt stalls.
   *
   * Every attempt gets its own page on purpose. The two ways this step fails
   * -- an interception round-trip that never comes back, and a renderer that
   * has wedged -- both leave the page unusable while the browser around it is
   * still fine, and a fresh page costs about a hundred milliseconds.
   */
  private static async openControllerPage(data: {
    browserContext: BrowserContext;
    controllerUrl: string;
    bindingName: string;
    abortSignal: AbortSignal;
    timeoutInMs: number;
    attempts: number;
    totalBudgetInMs: number;
    dispatch: (request: unknown) => Promise<unknown>;
  }): Promise<Page> {
    let lastError: unknown;
    let attemptsMade: number = 0;
    const startedAtInMs: number = Date.now();

    for (let attempt: number = 1; attempt <= data.attempts; attempt++) {
      const remainingBudgetInMs: number =
        data.totalBudgetInMs - (Date.now() - startedAtInMs);
      if (attempt > 1 && remainingBudgetInMs <= 0) {
        break;
      }

      const attemptTimeoutInMs: number = Math.max(
        1,
        Math.min(data.timeoutInMs, remainingBudgetInMs),
      );
      attemptsMade++;
      const page: Page = await data.browserContext.newPage();

      try {
        await page.route("**/*", async (route: Route) => {
          try {
            if (
              route.request().url() === data.controllerUrl &&
              route.request().resourceType() === "document"
            ) {
              await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                headers: {
                  "Cache-Control": "no-store",
                  "Content-Security-Policy": [
                    "default-src 'none'",
                    "base-uri 'none'",
                    "connect-src 'none'",
                    "form-action 'none'",
                    "frame-src 'none'",
                    "img-src data:",
                    "object-src 'none'",
                    "script-src 'unsafe-eval' blob:",
                    "worker-src blob:",
                  ].join("; "),
                  "Cross-Origin-Opener-Policy": "same-origin",
                  "Cross-Origin-Resource-Policy": "same-origin",
                  "Permissions-Policy":
                    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
                  "Referrer-Policy": "no-referrer",
                  "X-Content-Type-Options": "nosniff",
                },
                body: "<!doctype html><meta charset=utf-8><title>Synthetic Runtime</title>",
              });
              return;
            }

            await route.abort("blockedbyclient");
          } catch {
            /*
             * A handler that returns without settling its route leaves the
             * request paused in the browser with nothing to end it but the
             * navigation timeout -- the exact stall this retry exists for.
             * Abort so the navigation fails fast instead; a route belonging to
             * a page that has already gone away ignores this too.
             */
            await route.abort("failed").catch((): void => {
              // The attempt is abandoned either way.
            });
          }
        });

        await page.exposeBinding(
          data.bindingName,
          async (source: { page: Page; frame: unknown }, request: unknown) => {
            if (
              source.page !== page ||
              source.frame !== page.mainFrame() ||
              data.abortSignal.aborted
            ) {
              throw new Error("Rejected synthetic runtime RPC source.");
            }
            return await data.dispatch(request);
          },
        );

        await page.goto(data.controllerUrl, {
          waitUntil: "domcontentloaded",
          timeout: attemptTimeoutInMs,
        });

        return page;
      } catch (error: unknown) {
        lastError = error;

        try {
          await page.close();
        } catch {
          // The context teardown in the worker is the final cleanup boundary.
        }

        if (attempt < data.attempts) {
          await this.delay(CONTROLLER_BOOTSTRAP_RETRY_DELAY_IN_MS);
        }
      }
    }

    /*
     * Deliberately free of the sentinel URL and of internal file paths: this
     * string is what the tenant reads on their monitor. The Playwright error
     * travels separately, in internalDetail, for the probe's own logs.
     */
    throw new SyntheticRuntimeFault({
      message: `Synthetic monitor could not start on this probe: the browser runtime did not finish starting up after ${attemptsMade} attempt(s) of up to ${data.timeoutInMs} ms. The monitored page was never opened, so this does not reflect the health of the monitored site.`,
      internalDetail: lastError,
    });
  }

  private static getBootstrapTimeoutInMs(
    options: WorkerControllerOptions,
  ): number {
    return options.bootstrapTimeoutInMs ?? CONTROLLER_BOOTSTRAP_TIMEOUT_IN_MS;
  }

  private static getBootstrapAttempts(
    options: WorkerControllerOptions,
  ): number {
    return options.bootstrapAttempts ?? CONTROLLER_BOOTSTRAP_ATTEMPTS;
  }

  private static getBootstrapTotalBudgetInMs(
    options: WorkerControllerOptions,
  ): number {
    /*
     * A caller that shortens the per-attempt budget (tests do) means the whole
     * retry to be shorter too, not to keep the production ceiling.
     */
    return Math.min(
      CONTROLLER_BOOTSTRAP_TOTAL_BUDGET_IN_MS,
      this.getBootstrapTimeoutInMs(options) * this.getBootstrapAttempts(options),
    );
  }

  private static async delay(delayInMs: number): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      const timer: NodeJS.Timeout = setTimeout(resolve, delayInMs);
      timer.unref?.();
    });
  }

  private static async startWorker(data: {
    controllerPage: Page;
    bindingName: string;
    controlKey: string;
    bootstrapSource: string;
    payload: ControllerPayload;
  }): Promise<unknown> {
    return await data.controllerPage.evaluate(
      async (input: {
        bindingName: string;
        controlKey: string;
        bootstrapSource: string;
        payload: ControllerPayload;
      }): Promise<unknown> => {
        type RpcBinding = (request: unknown) => Promise<unknown>;
        interface RuntimeControl {
          terminate: () => void;
        }
        interface WorkerMessage {
          kind?: unknown;
          request?: unknown;
          result?: unknown;
        }

        const scope: typeof globalThis & Record<string, unknown> =
          globalThis as typeof globalThis & Record<string, unknown>;
        const rpcBinding: RpcBinding = scope[input.bindingName] as RpcBinding;
        if (typeof rpcBinding !== "function") {
          throw new Error("Synthetic runtime RPC binding is unavailable.");
        }

        return await new Promise<unknown>(
          (
            resolve: (value: unknown) => void,
            reject: (reason: Error) => void,
          ): void => {
            const objectUrl: string = URL.createObjectURL(
              new Blob([input.bootstrapSource], {
                type: "text/javascript",
              }),
            );
            const worker: Worker = new Worker(objectUrl, {
              name: "oneuptime-synthetic-monitor",
            });
            const channel: MessageChannel = new MessageChannel();
            let completed: boolean = false;

            const cleanup: () => void = (): void => {
              if (completed) {
                return;
              }
              completed = true;
              channel.port1.close();
              worker.terminate();
              URL.revokeObjectURL(objectUrl);
              delete scope[input.controlKey];
            };

            scope[input.controlKey] = {
              terminate: cleanup,
            } satisfies RuntimeControl;

            channel.port1.addEventListener(
              "message",
              (event: MessageEvent<WorkerMessage>): void => {
                const message: WorkerMessage = event.data;
                if (!message || typeof message !== "object") {
                  cleanup();
                  reject(
                    new Error("Synthetic runtime sent an invalid message."),
                  );
                  return;
                }

                if (message.kind === "complete") {
                  const result: unknown = message.result;
                  cleanup();
                  resolve(result);
                  return;
                }

                if (message.kind !== "rpc") {
                  cleanup();
                  reject(
                    new Error("Synthetic runtime sent an invalid message."),
                  );
                  return;
                }

                void rpcBinding(message.request)
                  .then((response: unknown): void => {
                    if (!completed) {
                      channel.port1.postMessage({
                        kind: "rpc-response",
                        response,
                      });
                    }
                  })
                  .catch((error: unknown): void => {
                    cleanup();
                    reject(
                      new Error(
                        error instanceof Error
                          ? error.message
                          : "Synthetic runtime RPC failed.",
                      ),
                    );
                  });
              },
            );
            channel.port1.start();

            worker.addEventListener("error", (event: ErrorEvent): void => {
              cleanup();
              reject(
                new Error(event.message || "Synthetic runtime worker crashed."),
              );
            });

            worker.postMessage(
              {
                kind: "initialize",
                payload: input.payload,
              },
              [channel.port2],
            );
          },
        );
      },
      {
        bindingName: data.bindingName,
        controlKey: data.controlKey,
        bootstrapSource: data.bootstrapSource,
        payload: data.payload,
      },
    );
  }

  private static async stopWorker(
    controllerPage: Page,
    controlKey: string,
  ): Promise<void> {
    await controllerPage.evaluate((key: string): void => {
      interface RuntimeControl {
        terminate?: (() => void) | undefined;
      }
      const scope: typeof globalThis & Record<string, unknown> =
        globalThis as typeof globalThis & Record<string, unknown>;
      const control: RuntimeControl | undefined = scope[key] as
        | RuntimeControl
        | undefined;
      control?.terminate?.();
    }, controlKey);
  }

  private static validateWorkerResult(value: unknown): WorkerCompletionResult {
    if (!isRecord(value)) {
      throw new Error("Synthetic runtime returned an invalid result.");
    }
    if (byteLengthOfJson(value) > MAX_RPC_RESULT_BYTES) {
      throw new Error("Synthetic runtime result exceeded the size limit.");
    }
    if (
      !Array.isArray(value["logMessages"]) ||
      !Array.isArray(value["capturedMetrics"]) ||
      !isRecord(value["screenshotAssignments"]) ||
      (value["scriptError"] !== undefined &&
        typeof value["scriptError"] !== "string")
    ) {
      throw new Error("Synthetic runtime returned an invalid result.");
    }

    return value as unknown as WorkerCompletionResult;
  }

  private static validateLogMessages(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new Error("Synthetic runtime logs are invalid.");
    }

    const result: string[] = [];
    let byteCount: number = 0;
    for (const entry of value.slice(0, MAX_SANDBOX_LOG_MESSAGES)) {
      if (typeof entry !== "string") {
        throw new Error("Synthetic runtime logs are invalid.");
      }
      const nextBytes: number = Buffer.byteLength(entry, "utf8");
      if (byteCount + nextBytes > MAX_SANDBOX_LOG_BYTES) {
        break;
      }
      byteCount += nextBytes;
      result.push(entry);
    }
    return result;
  }

  private static validateMetrics(value: unknown): SandboxMetric[] {
    if (!Array.isArray(value)) {
      throw new Error("Synthetic runtime metrics are invalid.");
    }

    const result: SandboxMetric[] = [];
    for (const entry of value.slice(0, MAX_SANDBOX_METRICS)) {
      if (
        !isRecord(entry) ||
        typeof entry["name"] !== "string" ||
        entry["name"].length < 1 ||
        entry["name"].length > 200 ||
        typeof entry["value"] !== "number" ||
        !Number.isFinite(entry["value"])
      ) {
        throw new Error("Synthetic runtime metric is invalid.");
      }

      const metric: SandboxMetric = {
        name: entry["name"],
        value: entry["value"],
      };
      if (entry["attributes"] !== undefined) {
        if (!isRecord(entry["attributes"])) {
          throw new Error("Synthetic runtime metric attributes are invalid.");
        }
        const attributes: Record<string, string> = {};
        for (const [key, attribute] of Object.entries(
          entry["attributes"],
        ).slice(0, 50)) {
          if (typeof attribute !== "string") {
            throw new Error("Synthetic runtime metric attributes are invalid.");
          }
          attributes[key.substring(0, 200)] = attribute.substring(0, 1_000);
        }
        if (Object.keys(attributes).length > 0) {
          metric.attributes = attributes;
        }
      }
      result.push(metric);
    }
    return result;
  }
}
