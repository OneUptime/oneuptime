import crypto from "crypto";
import { BrowserContext, Frame, Page, Route } from "playwright";
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
 * An attempt that fails is retried on a fresh page, which recovers a stall
 * confined to one page: an interception round-trip that was lost, a renderer
 * that wedged. It was once assumed that every stall here was of that kind --
 * that "the browser around it is healthy" -- and that was wrong. Every attempt
 * shares the browser's network service and storage, so a browser that cannot
 * serve one page serves none, and all three attempts fail identically. The
 * stall customers actually hit was of that second kind: a fresh on-disk
 * profile waiting on slow storage before Chromium would hand the navigation to
 * page.route. SyntheticMonitorWorker therefore runs every check in an
 * ephemeral context, so the bootstrap never waits on the disk; the retry stays
 * for the stalls that really are confined to a page.
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
/*
 * Tearing the controller page down must never be what a check waits on. A
 * page that has lost its JavaScript context -- Firefox has been seen to drop
 * it after the controller document's process switch -- never settles an
 * evaluate or a close, and whatever fault was already on its way out is then
 * swallowed while the worker waits for the supervisor to kill it.
 */
const CONTROLLER_TEARDOWN_TIMEOUT_IN_MS: number = 5_000;
/*
 * How long a bootstrap attempt waits, once the controller document has
 * loaded, for that document's JavaScript to answer. An idle probe answers in
 * milliseconds.
 *
 * Firefox sometimes never tells Playwright about the new document's
 * main-world context after the controller document's process switch. The
 * navigation still completes, but every evaluate on that page then waits
 * forever -- starting the sandbox included -- so the check used to spend the
 * whole sandbox start-up budget and then a second worker. A page in that state
 * never recovers, and a fresh page in the same browser does not inherit it, so
 * it is treated like any other stall confined to one page: the attempt fails
 * and the retry opens a new page. The cap keeps that detour to seconds even
 * when the attempt still has most of its budget left.
 */
const CONTROLLER_RUNTIME_PROBE_TIMEOUT_IN_MS: number = 5_000;

/*
 * How far one bootstrap attempt got, for the probe's logs.
 *
 * Playwright's timeout for this navigation names the URL and nothing else --
 * its call log is always the same single line -- so a request the browser
 * never handed to the route, a document that was served but never committed,
 * and a document that committed but never reached DOMContentLoaded all read
 * identically. They have different causes: the browser's network or storage
 * layer, a renderer that could not start, a renderer that is busy. The marks
 * say which one it was.
 */
class ControllerBootstrapTrace {
  private readonly startedAtInMs: number = Date.now();
  private readonly marks: Map<string, number> = new Map<string, number>();

  public mark(step: string): void {
    if (!this.marks.has(step)) {
      this.marks.set(step, Date.now() - this.startedAtInMs);
    }
  }

  public describeFailure(data: {
    attempt: number;
    attempts: number;
    timeoutInMs: number;
    error: unknown;
  }): string {
    const reached: string =
      this.marks.size > 0
        ? Array.from(this.marks.entries())
            .map(([step, elapsedInMs]: [string, number]): string => {
              return `${step} (+${elapsedInMs} ms)`;
            })
            .join(", ")
        : "nothing";

    return `Bootstrap attempt ${data.attempt}/${data.attempts} failed after ${Date.now() - this.startedAtInMs} ms of its ${data.timeoutInMs} ms budget. Reached: ${reached}. Error: ${firstLineOf(data.error)}`;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function firstLineOf(error: unknown): string {
  const text: string = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] || text;
}

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
  /*
   * How long tearing down a controller page may take -- stopping its worker,
   * closing it -- before it is left to the browser's own teardown. Exposed so
   * tests can prove the bound without waiting out the production value.
   */
  teardownTimeoutInMs?: number | undefined;
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
      /*
       * Every page the bootstrap opens, including the attempts it gave up on.
       * An abandoned attempt's page is closed, but that close is bounded and
       * can outlive the bootstrap, so the broker keeps all of them out of what
       * the tenant can see -- not only the page the bootstrap settled on.
       */
      const bootstrapPages: Set<Page> = new Set<Page>();

      controllerPage = await this.openControllerPage({
        browserContext: options.browserContext,
        controllerUrl,
        bindingName,
        abortSignal: abortController.signal,
        timeoutInMs: this.getBootstrapTimeoutInMs(options),
        attempts: this.getBootstrapAttempts(options),
        totalBudgetInMs: this.getBootstrapTotalBudgetInMs(options),
        teardownTimeoutInMs: this.getTeardownTimeoutInMs(options),
        bootstrapPages,
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
        internalPages: bootstrapPages,
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
          await this.withinDeadline({
            operation: this.stopWorker(controllerPage, controlKey),
            timeoutInMs: this.getTeardownTimeoutInMs(options),
            step: "stop the sandbox worker",
          });
        } catch {
          // The controller page is closed below even if the worker crashed.
        }
      }
      if (controllerPage && !controllerPage.isClosed()) {
        await this.closePageQuietly({
          page: controllerPage,
          timeoutInMs: this.getTeardownTimeoutInMs(options),
        });
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
    /*
     * Capped as well as floored: Node clamps a timer above 2^31-1 ms to 1 ms,
     * so an enormous bound would give up on teardown at once -- the opposite
     * of what it asks for. Nothing may wait longer than the whole start-up
     * allowance anyway.
     */
    if (
      options.teardownTimeoutInMs !== undefined &&
      (!Number.isSafeInteger(options.teardownTimeoutInMs) ||
        options.teardownTimeoutInMs <= 0 ||
        options.teardownTimeoutInMs >
          SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS)
    ) {
      throw new Error("Synthetic runtime teardown timeout is invalid.");
    }
  }

  /**
   * Opens the internal controller page and navigates it to the sentinel
   * document, retrying on a fresh page when an attempt fails.
   *
   * Every attempt gets its own page, and the whole attempt -- opening the
   * page, installing the route and the binding, and the navigation -- shares
   * one deadline. Only the navigation used to be bounded: a page that never
   * opened hung until the supervisor killed the worker, and a page that was
   * slow to open quietly spent the budget of the attempts after it.
   *
   * A fresh page recovers a stall that belongs to one page -- an interception
   * round-trip that was lost, a renderer that wedged. It does not recover a
   * stall that belongs to the whole browser, because every attempt shares the
   * browser's network and storage layers. Each attempt's trace therefore goes
   * into the fault's internal detail, so the probe's logs say which kind of
   * stall it was.
   */
  private static async openControllerPage(data: {
    browserContext: BrowserContext;
    controllerUrl: string;
    bindingName: string;
    abortSignal: AbortSignal;
    timeoutInMs: number;
    attempts: number;
    totalBudgetInMs: number;
    teardownTimeoutInMs: number;
    bootstrapPages: Set<Page>;
    dispatch: (request: unknown) => Promise<unknown>;
  }): Promise<Page> {
    let lastError: unknown;
    let attemptsMade: number = 0;
    const attemptReports: string[] = [];
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
      const trace: ControllerBootstrapTrace = new ControllerBootstrapTrace();

      try {
        return await this.openControllerPageAttempt({
          browserContext: data.browserContext,
          controllerUrl: data.controllerUrl,
          bindingName: data.bindingName,
          abortSignal: data.abortSignal,
          dispatch: data.dispatch,
          timeoutInMs: attemptTimeoutInMs,
          teardownTimeoutInMs: data.teardownTimeoutInMs,
          bootstrapPages: data.bootstrapPages,
          trace,
        });
      } catch (error: unknown) {
        lastError = error;
        attemptReports.push(
          trace.describeFailure({
            attempt,
            attempts: data.attempts,
            timeoutInMs: attemptTimeoutInMs,
            error,
          }),
        );

        if (attempt < data.attempts) {
          await this.delay(CONTROLLER_BOOTSTRAP_RETRY_DELAY_IN_MS);
        }
      }
    }

    /*
     * Deliberately free of the sentinel URL and of internal file paths: this
     * string is what the tenant reads on their monitor. The Playwright error,
     * and how far each attempt got, travel separately in internalDetail for
     * the probe's own logs.
     */
    throw new SyntheticRuntimeFault({
      message: `Synthetic monitor could not start on this probe: the browser runtime did not finish starting up after ${attemptsMade} attempt(s) of up to ${data.timeoutInMs} ms. The monitored page was never opened, so this does not reflect the health of the monitored site.`,
      internalDetail: [
        ...attemptReports,
        `Last error: ${describeError(lastError)}`,
      ].join("\n"),
    });
  }

  private static async openControllerPageAttempt(data: {
    browserContext: BrowserContext;
    controllerUrl: string;
    bindingName: string;
    abortSignal: AbortSignal;
    dispatch: (request: unknown) => Promise<unknown>;
    timeoutInMs: number;
    teardownTimeoutInMs: number;
    bootstrapPages: Set<Page>;
    trace: ControllerBootstrapTrace;
  }): Promise<Page> {
    const deadlineAtInMs: number = Date.now() + data.timeoutInMs;
    /*
     * Set once this attempt has been given up on. Its binding refuses calls
     * from then on: the page can stay alive while its bounded close runs out,
     * and nothing running in it may reach the broker.
     */
    let isAbandoned: boolean = false;
    const getRemainingInMs: () => number = (): number => {
      return Math.max(1, deadlineAtInMs - Date.now());
    };
    const pagePromise: Promise<Page> = data.browserContext.newPage();
    let openedPage: Page | null = null;
    const onFrameNavigated: (frame: Frame) => void = (frame: Frame): void => {
      if (openedPage && frame === openedPage.mainFrame()) {
        data.trace.mark("sentinel document committed");
      }
    };
    const onDomContentLoaded: () => void = (): void => {
      data.trace.mark("DOMContentLoaded");
    };

    try {
      const page: Page = await this.withinDeadline({
        operation: pagePromise,
        timeoutInMs: getRemainingInMs(),
        step: "open the controller page",
      });
      openedPage = page;
      data.bootstrapPages.add(page);
      data.trace.mark("page opened");

      await this.withinDeadline({
        operation: page.route("**/*", async (route: Route) => {
          try {
            if (
              route.request().url() === data.controllerUrl &&
              route.request().resourceType() === "document"
            ) {
              data.trace.mark("sentinel request intercepted");
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
              data.trace.mark("sentinel document served");
              return;
            }

            await route.abort("blockedbyclient");
          } catch {
            /*
             * A handler that returns without settling its route leaves the
             * request paused in the browser with nothing to end it but the
             * navigation timeout. Abort so the navigation fails fast instead;
             * a route belonging to a page that has already gone away ignores
             * this too.
             */
            await route.abort("failed").catch((): void => {
              // The attempt is abandoned either way.
            });
          }
        }),
        timeoutInMs: getRemainingInMs(),
        step: "install the sentinel route",
      });
      data.trace.mark("route installed");

      await this.withinDeadline({
        operation: page.exposeBinding(
          data.bindingName,
          async (source: { page: Page; frame: unknown }, request: unknown) => {
            if (
              isAbandoned ||
              source.page !== page ||
              source.frame !== page.mainFrame() ||
              data.abortSignal.aborted
            ) {
              throw new Error("Rejected synthetic runtime RPC source.");
            }
            return await data.dispatch(request);
          },
        ),
        timeoutInMs: getRemainingInMs(),
        step: "install the runtime binding",
      });
      data.trace.mark("binding installed");

      page.on("framenavigated", onFrameNavigated);
      page.on("domcontentloaded", onDomContentLoaded);
      data.trace.mark("navigation started");
      await page.goto(data.controllerUrl, {
        waitUntil: "domcontentloaded",
        timeout: getRemainingInMs(),
      });

      await this.withinDeadline({
        operation: page.evaluate((): boolean => {
          return true;
        }),
        timeoutInMs: Math.min(
          getRemainingInMs(),
          CONTROLLER_RUNTIME_PROBE_TIMEOUT_IN_MS,
        ),
        step: "reach the controller page's JavaScript context",
      });

      return page;
    } catch (error: unknown) {
      isAbandoned = true;
      if (openedPage) {
        await this.closePageQuietly({
          page: openedPage,
          timeoutInMs: data.teardownTimeoutInMs,
        });
      } else {
        /*
         * The page can still arrive after the attempt has given up on it.
         * Nothing will ever use it, so close it whenever it does -- and until
         * then it is one of the bootstrap's pages, hidden from the tenant.
         */
        void pagePromise.then(
          async (latePage: Page): Promise<void> => {
            data.bootstrapPages.add(latePage);
            await this.closePageQuietly({
              page: latePage,
              timeoutInMs: data.teardownTimeoutInMs,
            });
          },
          (): void => {
            // A page that never opened needs no cleanup.
          },
        );
      }
      throw error;
    } finally {
      openedPage?.off("framenavigated", onFrameNavigated);
      openedPage?.off("domcontentloaded", onDomContentLoaded);
    }
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

  private static getTeardownTimeoutInMs(
    options: WorkerControllerOptions,
  ): number {
    return options.teardownTimeoutInMs ?? CONTROLLER_TEARDOWN_TIMEOUT_IN_MS;
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
      this.getBootstrapTimeoutInMs(options) *
        this.getBootstrapAttempts(options),
    );
  }

  /**
   * Waits for an operation that Playwright would otherwise wait on forever --
   * newPage, route, exposeBinding, close and evaluate take no timeout -- and
   * fails with the step's name once the deadline passes. The operation itself
   * cannot be cancelled; whoever calls this owns cleaning up after it.
   */
  private static async withinDeadline<Value>(data: {
    operation: Promise<Value>;
    timeoutInMs: number;
    step: string;
  }): Promise<Value> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        data.operation,
        new Promise<never>(
          (
            _resolve: (value: never) => void,
            reject: (error: Error) => void,
          ) => {
            timer = setTimeout((): void => {
              reject(
                new Error(
                  `Timed out after ${data.timeoutInMs} ms waiting to ${data.step}.`,
                ),
              );
            }, data.timeoutInMs);
            timer.unref?.();
          },
        ),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private static async closePageQuietly(data: {
    page: Page;
    timeoutInMs: number;
  }): Promise<void> {
    try {
      await this.withinDeadline({
        operation: data.page.close(),
        timeoutInMs: data.timeoutInMs,
        step: "close the controller page",
      });
    } catch {
      // The browser is torn down with the worker; nothing here may block it.
    }
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
