import { BrowserContext, Page, Route } from "playwright";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import { SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN } from "../../../../Utils/Monitors/SyntheticRuntime/ControllerOrigin";
import { SYNTHETIC_RUNTIME_FAULT_KIND } from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";
import {
  CapabilityDescriptor,
  PlaywrightRpcResponse,
  SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
  SandboxExecutionResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

/*
 * These cover the sandbox's own start-up, not the tenant's script, so they run
 * against fakes rather than a real browser: the point is what happens when the
 * controller page's navigation never comes back, which is not something a
 * healthy Chromium will do on demand.
 *
 * The failure being pinned here is the one a customer reported --
 *
 *   page.goto: Timeout 30000ms exceeded.
 *   Call log: - navigating to "https://synthetic-runtime.oneuptime.invalid/<id>",
 *             waiting until "domcontentloaded"
 *       at WorkerController.execute (.../WorkerController.ts)
 *
 * -- which reached them as their monitor's script error, on an internal URL
 * they had no way to recognise, after a single attempt.
 *
 * The navigation was not the only step that could stall. Playwright's newPage,
 * route and exposeBinding take no timeout at all, and neither do the evaluate
 * and close that tear the controller page down; any of them waiting forever
 * held the check until the supervisor killed the worker, and the fault already
 * on its way out was lost. The fakes below can make each of those steps
 * resolve, reject, dawdle or never settle, and can play the browser's side of
 * the navigation one step at a time, so every step can be held to a deadline
 * and every stall shows up in the probe's logs as the step it stopped at.
 *
 * A page the bootstrap gave up on is not gone when its attempt ends, either:
 * its close is bounded too, and can run out. The fake context lists pages the
 * way a real one does, and the tests call the broker through the RPC binding
 * the way the sandbox does, so they can see which pages the tenant is shown
 * and which calls reach the broker at all.
 */

type BindingHandler = (
  source: { page: Page; frame: unknown },
  request: unknown,
) => Promise<unknown>;

type RouteHandler = (route: Route) => Promise<void>;

type PageListener = (...args: Array<unknown>) => void;

/*
 * A hook runs when its step is called and decides how the step settles:
 * returning resolves it, throwing rejects it, waiting delays it, and never
 * settling is the stall. A step without a hook settles at once.
 */
type StepHook = (page: FakePage) => Promise<void>;

type GotoHook = (
  page: FakePage,
  url: string,
  timeoutInMs: number,
) => Promise<void>;

type PreNavigationStep = "newPage" | "route" | "exposeBinding";

interface FakePageBehaviour {
  newPage?: StepHook | undefined;
  route?: StepHook | undefined;
  exposeBinding?: StepHook | undefined;
  goto?: GotoHook | undefined;
  close?: StepHook | undefined;
  runtimeProbe?: StepHook | undefined;
  startWorker?: StepHook | undefined;
  stopWorker?: StepHook | undefined;
}

interface FakePageRecord {
  page: FakePage;
  gotoUrls: string[];
  gotoTimeouts: Array<number | undefined>;
  routePatterns: string[];
  bindingNames: string[];
}

interface FakeRoute {
  route: Route;
  fulfilled: string[];
  aborted: string[];
}

interface ExecuteOverrides {
  bootstrapAttempts?: number;
  bootstrapTimeoutInMs?: number;
  teardownTimeoutInMs?: number;
}

interface ExecutionFailure {
  error: Error;
  kind: string | undefined;
  internalDetail: string | undefined;
  elapsedInMs: number;
}

interface AttemptReport {
  attempt: number;
  attempts: number;
  failedAfterInMs: number;
  budgetInMs: number;
  reached: string[];
  reachedAtInMs: number[];
  error: string;
}

interface BootstrapDetail {
  reports: AttemptReport[];
  lastError: string;
}

/*
 * What WorkerController hands the evaluate that starts the sandbox. Only the
 * parts the tests read back are spelled out.
 */
interface ControllerStartInput {
  payload: {
    executionId: string;
    capabilities: {
      runtime: CapabilityDescriptor;
      page: CapabilityDescriptor;
      browserContext: CapabilityDescriptor;
    };
  };
}

interface StartedWorker {
  executionId: string;
  runtimeCapabilityId: string;
  monitoredPageCapabilityId: string;
  /*
   * The pages of the browser context the sandbox is handed at start-up: what
   * the tenant's context.pages() returns before any call has been made.
   */
  initialContextPageIds: string[];
}

/*
 * A binding either refuses a call itself, or passes it to the broker and
 * returns the broker's answer.
 */
interface BindingOutcome {
  rejection: string | undefined;
  response: PlaywrightRpcResponse | undefined;
}

interface Gate {
  opened: Promise<void>;
  open: () => void;
}

interface ArmedTimer {
  handle: NodeJS.Timeout;
  delayInMs: number;
  hasFired: boolean;
}

interface RecordedTimers {
  armed: ArmedTimer[];
  clearedHandles: Set<unknown>;
}

const WORKER_COMPLETION: Record<string, unknown> = {
  returnValue: { data: { ok: true } },
  logMessages: [],
  capturedMetrics: [],
  screenshotAssignments: {},
};

const REJECTED_RPC_SOURCE: string = "Rejected synthetic runtime RPC source.";

/*
 * Mirrors of WorkerController's private constants. The tests only use them to
 * bound how long a check may take, so if the real values drift the bounds
 * fail loudly rather than pass by accident.
 */
const RETRY_DELAY_IN_MS: number = 250;
/*
 * Read by exactly one test, which checks the length of the timers a teardown
 * arms when no teardown timeout is given, and waits on none of them. Every
 * test that holds a teardown step open passes TEST_TEARDOWN_TIMEOUT_IN_MS
 * rather than waiting this out.
 */
const DEFAULT_TEARDOWN_TIMEOUT_IN_MS: number = 5_000;
/*
 * How long a bootstrap attempt waits for a loaded controller document's
 * JavaScript to answer before it gives up on the page, when the attempt has
 * that much budget left.
 */
const RUNTIME_PROBE_TIMEOUT_IN_MS: number = 5_000;

/*
 * The teardown bound every stalling test passes in: long enough that nothing
 * settling "at once" runs into it, short enough to wait out many times over.
 * Not 250 ms, so a timer armed for it cannot be mistaken for the retry
 * delay's.
 */
const TEST_TEARDOWN_TIMEOUT_IN_MS: number = 275;

/*
 * Headroom for timers on a busy machine: CI and a developer's laptop both run
 * this suite next to others, and a bound that only holds on an idle machine
 * is a flaky test, not a guarantee.
 */
const SCHEDULING_SLACK_IN_MS: number = 2_000;

/*
 * How far apart two clock readings that describe the same moment may be.
 * WorkerController reads Date.now() to hand goto its timeout, and the fake
 * reads it again as goto is called; on an idle machine those differ by a
 * millisecond at most. The allowance is for a loaded CI runner. It keeps the
 * tests' power: the bug they exist for -- a per-step deadline that hands goto
 * its whole budget after a 400 ms step -- is 400 ms out, not 75.
 */
const CLOCK_TOLERANCE_IN_MS: number = 75;

/*
 * With every step before the navigation settling at once, what is spent
 * before goto is bookkeeping: microtasks, not timers, a millisecond or two on
 * an idle machine. The allowance is for a loaded runner. Against the 1234 ms
 * budget it is checked on, it still tells that budget apart from a smaller
 * share of it: an attempt charged the 250 ms retry delay, say, gets 984 ms.
 */
const INSTANT_STEPS_TOLERANCE_IN_MS: number = 200;

/*
 * For a single attempt that is meant to stall: short enough to keep the test
 * quick, long enough that a fake step settling "at once" never runs into it.
 */
const QUICK_BUDGET_IN_MS: number = 300;

/*
 * The total bootstrap budget is attempts x the per-attempt budget, and an
 * attempt that stalls spends all of its share plus a 250 ms retry delay. With
 * the quick budget, two stalls leave a third attempt no time at all; this one
 * leaves it half a second, even on a slow machine. Any test that needs an
 * attempt to run after a stalled one uses it.
 */
const STALL_BUDGET_IN_MS: number = 1_000;

/*
 * Every test that could hang without a deadline carries this, so code without
 * the deadline fails the test rather than wedging the run.
 */
const BOUNDED_TEST_TIMEOUT_IN_MS: number = 15_000;

const MARKS_BEFORE_NAVIGATION: string[] = [
  "page opened",
  "route installed",
  "binding installed",
  "navigation started",
];

const NAVIGATION_MARKS: string[] = [
  "sentinel request intercepted",
  "sentinel document served",
  "sentinel document committed",
  "DOMContentLoaded",
];

const ATTEMPT_REPORT_PATTERN: RegExp =
  /^Bootstrap attempt (\d+)\/(\d+) failed after (\d+) ms of its (\d+) ms budget\. Reached: (.+?)\. Error: (.*)$/;
const REACHED_MARK_PATTERN: RegExp = /^(.+) \(\+(\d+) ms\)$/;
const LAST_ERROR_SEPARATOR: string = "\nLast error: ";

class FakePage {
  public closeCount: number = 0;
  public runtimeProbeCount: number = 0;
  public startWorkerCount: number = 0;
  public stopWorkerCount: number = 0;
  public deliveredAtInMs: number | undefined = undefined;
  public startInput: unknown = undefined;
  public readonly gotoUrls: string[] = [];
  public readonly gotoTimeouts: Array<number | undefined> = [];
  public readonly routePatterns: string[] = [];
  public readonly routeHandlers: RouteHandler[] = [];
  public readonly bindingNames: string[] = [];
  public readonly bindingHandlers: BindingHandler[] = [];
  public readonly subscribedEvents: string[] = [];
  public readonly childFrame: Record<string, unknown> = { name: "child" };

  private isPageClosed: boolean = false;
  private readonly frame: Record<string, unknown> = { name: "main" };
  private readonly listeners: Map<string, PageListener[]> = new Map<
    string,
    PageListener[]
  >();
  private readonly firstCalledAtInMs: Map<string, number> = new Map<
    string,
    number
  >();

  public constructor(
    private readonly context: FakeBrowserContext,
    private readonly index: number,
    public readonly behaviour: FakePageBehaviour,
  ) {}

  public markCalled(step: string): void {
    if (!this.firstCalledAtInMs.has(step)) {
      this.firstCalledAtInMs.set(step, Date.now());
    }
  }

  public calledAtInMs(step: string): number {
    const calledAtInMs: number | undefined = this.firstCalledAtInMs.get(step);
    if (calledAtInMs === undefined) {
      throw new Error(`The controller page's ${step} was never called.`);
    }
    return calledAtInMs;
  }

  public async route(pattern: string, handler: RouteHandler): Promise<void> {
    this.markCalled("route");
    this.routePatterns.push(pattern);
    this.routeHandlers.push(handler);
    await this.behaviour.route?.(this);
  }

  public async exposeBinding(
    name: string,
    handler: BindingHandler,
  ): Promise<void> {
    this.markCalled("exposeBinding");
    this.bindingNames.push(name);
    this.bindingHandlers.push(handler);
    await this.behaviour.exposeBinding?.(this);
  }

  public async goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<null> {
    this.markCalled("goto");
    this.gotoUrls.push(url);
    this.gotoTimeouts.push(options?.timeout);

    const failure: Error | undefined = this.context.gotoFailureFor(this.index);
    if (failure) {
      throw failure;
    }

    await this.behaviour.goto?.(this, url, options?.timeout ?? 30_000);

    return null;
  }

  public on(event: string, listener: PageListener): this {
    this.subscribedEvents.push(event);
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
    return this;
  }

  public off(event: string, listener: PageListener): this {
    this.listeners.set(
      event,
      (this.listeners.get(event) || []).filter(
        (registered: PageListener): boolean => {
          return registered !== listener;
        },
      ),
    );
    return this;
  }

  public listenerCount(event: string): number {
    return (this.listeners.get(event) || []).length;
  }

  public emit(event: string, ...args: Array<unknown>): void {
    for (const listener of [...(this.listeners.get(event) || [])]) {
      listener(...args);
    }
  }

  public mainFrame(): unknown {
    return this.frame;
  }

  public async evaluate(
    _callback: unknown,
    argument?: unknown,
  ): Promise<unknown> {
    /*
     * WorkerController drives the page with exactly three evaluate calls: one
     * to check that the controller document's JavaScript answers (no
     * argument), one to start the sandbox (an object payload) and one to stop
     * it (the control key, a bare string).
     */
    if (argument === undefined) {
      this.markCalled("runtimeProbe");
      this.runtimeProbeCount++;
      await this.behaviour.runtimeProbe?.(this);
      return true;
    }

    if (typeof argument === "string") {
      this.stopWorkerCount++;
      await this.behaviour.stopWorker?.(this);
      return undefined;
    }

    this.startInput = argument;
    this.startWorkerCount++;
    await this.behaviour.startWorker?.(this);

    if (this.context.onStartWorker) {
      await this.context.onStartWorker(this);
    }

    return WORKER_COMPLETION;
  }

  public isClosed(): boolean {
    return this.isPageClosed;
  }

  public async close(): Promise<void> {
    this.closeCount++;
    await this.behaviour.close?.(this);
    this.isPageClosed = true;
  }
}

class FakeBrowserContext {
  /*
   * Every page asked for, in order -- including one that was never delivered,
   * or delivered too late.
   */
  public readonly requestedPages: FakePage[] = [];
  /*
   * The tenant's page, in the context from the start as it is in a real
   * check, with just enough of a page for the broker to describe it. A broker
   * that hid every page is caught as surely as one that showed an internal
   * one.
   */
  public readonly monitoredPage: Record<string, unknown> = {
    name: "monitored-page",
    keyboard: {},
    mouse: {},
    touchscreen: {},
    isClosed: (): boolean => {
      return false;
    },
    url: (): string => {
      return "https://example.com/";
    },
    viewportSize: (): null => {
      return null;
    },
  };
  public readonly listenerEvents: string[] = [];
  public onStartWorker?: ((page: FakePage) => Promise<void>) | undefined;
  public behaviourFor: (pageIndex: number) => FakePageBehaviour =
    (): FakePageBehaviour => {
      return {};
    };

  /*
   * How many of the first navigations fail, and with what. A zero here is a
   * probe that is behaving; anything else is a probe under the load it
   * predictably sees whenever monitor intervals line up on a wall clock.
   */
  public constructor(
    private readonly failingNavigations: number = 0,
    private readonly failure: Error = timeoutError(),
  ) {}

  public async newPage(): Promise<Page> {
    /*
     * The page is recorded as soon as it is asked for, so a test can still
     * see a page that was never delivered, or one delivered too late.
     */
    const page: FakePage = new FakePage(
      this,
      this.requestedPages.length,
      this.behaviourFor(this.requestedPages.length),
    );
    this.requestedPages.push(page);
    page.markCalled("newPage");

    await page.behaviour.newPage?.(page);

    page.deliveredAtInMs = Date.now();
    return page as unknown as Page;
  }

  /*
   * What a real context lists: a page from when it is delivered until its
   * close has finished. A page whose close never finishes stays listed, which
   * is how a page the bootstrap gave up on can outlive the bootstrap.
   */
  public pages(): Page[] {
    return [
      this.monitoredPage,
      ...this.requestedPages.filter((page: FakePage): boolean => {
        return page.deliveredAtInMs !== undefined && !page.isClosed();
      }),
    ] as unknown as Page[];
  }

  public on(event: string, _listener: unknown): void {
    this.listenerEvents.push(event);
  }

  public gotoFailureFor(pageIndex: number): Error | undefined {
    return pageIndex < this.failingNavigations ? this.failure : undefined;
  }
}

function playwrightError(data: {
  lines: string[];
  name?: string | undefined;
}): Error {
  const message: string = data.lines.join("\n");
  const error: Error = new Error(message);
  if (data.name) {
    error.name = data.name;
  }
  error.stack = `${message}\n    at WorkerController.execute (/usr/src/app/Utils/Monitors/SyntheticRuntime/WorkerController.ts:148:28)`;
  return error;
}

/*
 * Playwright's real shape for this: the message carries the call log, and the
 * stack repeats it. Both halves matter -- the supervisor concatenates them,
 * which is why the customer saw the same paragraph twice.
 */
function timeoutError(): Error {
  return navigationTimeoutError(30000);
}

function navigationTimeoutError(timeoutInMs: number): Error {
  return playwrightError({
    name: "TimeoutError",
    lines: [
      `page.goto: Timeout ${timeoutInMs}ms exceeded.`,
      "Call log:",
      `  - navigating to "${SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN}/6f0d1f6e-1f0a-4d0e-9d0e-6f0d1f6e1f0a", waiting until "domcontentloaded"`,
    ],
  });
}

function newPageClosedError(): Error {
  return playwrightError({
    lines: [
      "browserContext.newPage: Target page, context or browser has been closed",
    ],
  });
}

function never(): Promise<never> {
  return new Promise<never>((): void => {
    // Deliberately never settles: this is the stall.
  });
}

/*
 * What Firefox was seen to do after the controller document's process switch:
 * the navigation completes -- the request is served, the document commits and
 * reaches DOMContentLoaded -- but Playwright never learns the document's
 * main-world JavaScript context, so every evaluate on the page waits forever.
 */
function lostJavaScriptContext(): FakePageBehaviour {
  return {
    goto: async (page: FakePage, url: string): Promise<void> => {
      await interceptRequest({ page, url });
      commitMainFrame(page);
      fireDomContentLoaded(page);
    },
    runtimeProbe: never,
    startWorker: never,
    stopWorker: never,
  };
}

function sleep(delayInMs: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, delayInMs);
  });
}

/*
 * A step that settles only when the test says so -- for a page that has to
 * arrive at a moment the test chooses, rather than after a guessed delay.
 */
function createGate(): Gate {
  let open: () => void = (): void => {
    // Replaced by the promise's resolver before anyone can call it.
  };
  const opened: Promise<void> = new Promise<void>(
    (resolve: () => void): void => {
      open = resolve;
    },
  );
  return {
    opened,
    open: (): void => {
      open();
    },
  };
}

/*
 * page.goto is the one bootstrap step Playwright does bound, so the fake's
 * stalled navigation honours the timeout it was handed, exactly as a real one
 * would.
 */
async function stallUntilNavigationTimeout(
  timeoutInMs: number,
): Promise<never> {
  await sleep(timeoutInMs);
  throw navigationTimeoutError(timeoutInMs);
}

async function waitUntil(
  condition: () => boolean,
  timeoutInMs: number,
): Promise<void> {
  const deadlineAtInMs: number = Date.now() + timeoutInMs;
  while (!condition() && Date.now() < deadlineAtInMs) {
    await sleep(10);
  }
}

function behaviourWith(
  step: PreNavigationStep,
  hook: StepHook,
): FakePageBehaviour {
  const behaviour: FakePageBehaviour = {};
  behaviour[step] = hook;
  return behaviour;
}

function fakeRoute(data: {
  url: string;
  resourceType: string;
  fulfill?: (() => Promise<void>) | undefined;
}): FakeRoute {
  const fulfilled: string[] = [];
  const aborted: string[] = [];
  const route: Route = {
    request: (): { url: () => string; resourceType: () => string } => {
      return {
        url: (): string => {
          return data.url;
        },
        resourceType: (): string => {
          return data.resourceType;
        },
      };
    },
    fulfill: async (): Promise<void> => {
      if (data.fulfill) {
        await data.fulfill();
      }
      fulfilled.push(data.url);
    },
    abort: async (errorCode?: string): Promise<void> => {
      aborted.push(errorCode || "");
    },
  } as unknown as Route;

  return { route, fulfilled, aborted };
}

/*
 * The browser's half of the controller navigation, one step at a time, so a
 * test can stop it exactly where a real stall stops: the request handed to
 * page.route, the document committed to the main frame, DOMContentLoaded.
 */
function interceptRequest(data: {
  page: FakePage;
  url: string;
  resourceType?: string | undefined;
  fulfill?: (() => Promise<void>) | undefined;
}): Promise<void> {
  const handler: RouteHandler | undefined = data.page.routeHandlers[0];
  if (!handler) {
    throw new Error("The controller page has no route installed.");
  }
  return handler(
    fakeRoute({
      url: data.url,
      resourceType: data.resourceType ?? "document",
      fulfill: data.fulfill,
    }).route,
  );
}

function commitMainFrame(page: FakePage): void {
  page.emit("framenavigated", page.mainFrame());
}

function fireDomContentLoaded(page: FakePage): void {
  page.emit("domcontentloaded", page);
}

/*
 * What the sandbox was handed when it started on this page: enough to make
 * the calls the sandbox itself would make.
 */
function startedWorkerOn(page: FakePage): StartedWorker {
  if (page.startInput === undefined) {
    throw new Error("The sandbox was never started on this page.");
  }
  const input: ControllerStartInput = page.startInput as ControllerStartInput;
  const contextPages: unknown =
    input.payload.capabilities.browserContext.snapshot?.["pages"];
  if (!Array.isArray(contextPages)) {
    throw new Error("The sandbox was not handed the context's pages.");
  }

  return {
    executionId: input.payload.executionId,
    runtimeCapabilityId: input.payload.capabilities.runtime.id,
    monitoredPageCapabilityId: input.payload.capabilities.page.id,
    initialContextPageIds: contextPages.map(
      (descriptor: CapabilityDescriptor): string => {
        return descriptor.id;
      },
    ),
  };
}

/*
 * Calls a page's RPC binding as the sandbox would, from the given page's main
 * frame, with a request the broker accepts: a log line. An answer means the
 * call reached the broker; a rejection means the binding refused it first.
 */
async function callBinding(data: {
  bindingPage: FakePage;
  sourcePage: FakePage;
  worker: StartedWorker;
}): Promise<BindingOutcome> {
  const handler: BindingHandler | undefined =
    data.bindingPage.bindingHandlers[0];
  if (!handler) {
    throw new Error("The page has no RPC binding installed.");
  }

  return await handler(
    {
      page: data.sourcePage as unknown as Page,
      frame: data.sourcePage.mainFrame(),
    },
    {
      version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
      executionId: data.worker.executionId,
      requestId: "test-log",
      capabilityId: data.worker.runtimeCapabilityId,
      method: "log",
      args: ["called from the test"],
    },
  ).then(
    (response: unknown): BindingOutcome => {
      return {
        rejection: undefined,
        response: response as PlaywrightRpcResponse,
      };
    },
    (error: Error): BindingOutcome => {
      return { rejection: error.message, response: undefined };
    },
  );
}

/*
 * The pages the broker's answer tells the sandbox about -- the tenant's
 * context.pages() after the call.
 */
function tenantPageIdsIn(outcome: BindingOutcome | undefined): string[] {
  const response: PlaywrightRpcResponse | undefined = outcome?.response;
  if (!response || !response.state) {
    throw new Error(
      `The broker never answered the call: ${outcome?.rejection ?? "it was not made"}`,
    );
  }
  return response.state.pages.map(
    (descriptor: CapabilityDescriptor): string => {
      return descriptor.id;
    },
  );
}

/*
 * Runs a check with every timer it arms recorded: its length, whether it
 * fired, and whether anything cleared it. The timers themselves are real, so
 * the check runs exactly as it would unobserved.
 */
async function recordTimers(run: () => Promise<void>): Promise<RecordedTimers> {
  const realSetTimeout: typeof setTimeout = global.setTimeout;
  const armed: ArmedTimer[] = [];
  const clearedHandles: Set<unknown> = new Set<unknown>();
  const setTimeoutSpy: jest.SpyInstance = jest
    .spyOn(global, "setTimeout")
    .mockImplementation(((
      callback: (...callbackArgs: Array<unknown>) => void,
      delayInMs?: number,
      ...callbackArgs: Array<unknown>
    ): NodeJS.Timeout => {
      const timer: ArmedTimer = {
        handle: realSetTimeout((): void => {
          timer.hasFired = true;
          callback(...callbackArgs);
        }, delayInMs),
        delayInMs: delayInMs ?? 0,
        hasFired: false,
      };
      armed.push(timer);
      return timer.handle;
    }) as unknown as typeof setTimeout);
  const clearTimeoutSpy: jest.SpyInstance = jest.spyOn(global, "clearTimeout");

  try {
    await run();
  } finally {
    for (const call of clearTimeoutSpy.mock.calls as Array<Array<unknown>>) {
      clearedHandles.add(call[0]);
    }
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  }

  return { armed, clearedHandles };
}

function execute(
  context: FakeBrowserContext,
  overrides: ExecuteOverrides = {},
): Promise<SandboxExecutionResult> {
  return WorkerController.execute({
    browserContext: context as unknown as BrowserContext,
    page: context.monitoredPage as unknown as Page,
    code: "return { data: { ok: true } };",
    browserType: "Chromium",
    screenSizeType: "Desktop",
    args: {},
    timeoutInMs: 10_000,
    bootstrapAttempts: overrides.bootstrapAttempts ?? 3,
    /*
     * Small enough to keep the suite fast, large enough that the retry delays
     * do not themselves exhaust the total bootstrap budget -- which is derived
     * from this number, so a 50ms budget would leave no room to retry at all.
     */
    bootstrapTimeoutInMs: overrides.bootstrapTimeoutInMs ?? 500,
    /*
     * Left to the production default unless a test passes one: only the tests
     * that hold a teardown step open need it, and one test checks the
     * default.
     */
    teardownTimeoutInMs: overrides.teardownTimeoutInMs,
  });
}

async function executeExpectingFailure(
  context: FakeBrowserContext,
  overrides: ExecuteOverrides = {},
): Promise<ExecutionFailure> {
  const startedAtInMs: number = Date.now();
  const error: Error = await execute(context, overrides).then(
    (): Error => {
      throw new Error("Expected the execution to fail.");
    },
    (caught: Error): Error => {
      return caught;
    },
  );

  return {
    error,
    kind: (error as { kind?: string }).kind,
    internalDetail: (error as { internalDetail?: string }).internalDetail,
    elapsedInMs: Date.now() - startedAtInMs,
  };
}

function tenantBootstrapMessage(attempts: number, budgetInMs: number): string {
  return `Synthetic monitor could not start on this probe: the browser runtime did not finish starting up after ${attempts} attempt(s) of up to ${budgetInMs} ms. The monitored page was never opened, so this does not reflect the health of the monitored site.`;
}

/*
 * Parses the fault's internal detail strictly: anything other than one report
 * line per attempt followed by "Last error:" fails the test that asked.
 */
function parseBootstrapDetail(detail: string | undefined): BootstrapDetail {
  if (detail === undefined) {
    throw new Error("The fault carries no internal detail.");
  }

  const separatorIndex: number = detail.indexOf(LAST_ERROR_SEPARATOR);
  if (separatorIndex < 0) {
    throw new Error(
      `The internal detail has no "Last error:" line:\n${detail}`,
    );
  }

  const reports: AttemptReport[] = detail
    .slice(0, separatorIndex)
    .split("\n")
    .map((line: string): AttemptReport => {
      const match: RegExpExecArray | null = ATTEMPT_REPORT_PATTERN.exec(line);
      if (!match) {
        throw new Error(`Unexpected internal detail line: ${line}`);
      }

      const reachedText: string = match[5]!;
      const marks: Array<{ step: string; atInMs: number }> =
        reachedText === "nothing"
          ? []
          : reachedText
              .split(", ")
              .map((entry: string): { step: string; atInMs: number } => {
                const markMatch: RegExpExecArray | null =
                  REACHED_MARK_PATTERN.exec(entry);
                if (!markMatch) {
                  throw new Error(`Unexpected reached step: ${entry}`);
                }
                return { step: markMatch[1]!, atInMs: Number(markMatch[2]) };
              });

      return {
        attempt: Number(match[1]),
        attempts: Number(match[2]),
        failedAfterInMs: Number(match[3]),
        budgetInMs: Number(match[4]),
        reached: marks.map((mark: { step: string }): string => {
          return mark.step;
        }),
        reachedAtInMs: marks.map((mark: { atInMs: number }): number => {
          return mark.atInMs;
        }),
        error: match[6]!,
      };
    });

  return {
    reports,
    lastError: detail.slice(separatorIndex + LAST_ERROR_SEPARATOR.length),
  };
}

/*
 * Checks the marks a test is about, in the order it expects them, and the
 * marks whose absence is its point -- and nothing else. A mark added to the
 * trace later is not a regression; a mark that is missing, out of order, or
 * reached when the stall should have stopped short of it, is.
 */
function expectReached(data: {
  report: AttemptReport;
  inOrder: string[];
  notReached: string[];
}): void {
  expect(
    data.report.reached.filter((step: string): boolean => {
      return data.inOrder.includes(step);
    }),
  ).toEqual(data.inOrder);
  expect(
    data.report.reached.filter((step: string): boolean => {
      return data.notReached.includes(step);
    }),
  ).toEqual([]);
}

/*
 * The attempt that failed only once its navigation had started is the one
 * whose report says how far the browser got; every test of the navigation
 * trace runs exactly one.
 */
async function reachedBySingleStalledAttempt(
  goto: GotoHook,
): Promise<AttemptReport> {
  const context: FakeBrowserContext = new FakeBrowserContext(0);
  context.behaviourFor = (): FakePageBehaviour => {
    return { goto };
  };

  const failure: ExecutionFailure = await executeExpectingFailure(context, {
    bootstrapAttempts: 1,
    bootstrapTimeoutInMs: QUICK_BUDGET_IN_MS,
  });

  expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
  expect(failure.error.message).toBe(
    tenantBootstrapMessage(1, QUICK_BUDGET_IN_MS),
  );

  const detail: BootstrapDetail = parseBootstrapDetail(failure.internalDetail);
  expect(detail.reports).toHaveLength(1);
  return detail.reports[0]!;
}

function describeFakePages(context: FakeBrowserContext): FakePageRecord[] {
  return context.requestedPages.map((page: FakePage) => {
    return {
      page,
      gotoUrls: page.gotoUrls,
      gotoTimeouts: page.gotoTimeouts,
      routePatterns: page.routePatterns,
      bindingNames: page.bindingNames,
    };
  });
}

describe("SyntheticRuntime WorkerController bootstrap", () => {
  test("opens exactly one controller page when the first navigation lands", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(0);

    const result: SandboxExecutionResult = await execute(context);

    expect(result.returnValue).toEqual({ data: { ok: true } });
    expect(context.requestedPages).toHaveLength(1);
    expect(context.requestedPages[0]!.gotoUrls).toHaveLength(1);
    expect(context.requestedPages[0]!.gotoUrls[0]).toContain(
      SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN,
    );
  });

  test("recovers from a stalled bootstrap navigation by retrying on a fresh page", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(1);

    const result: SandboxExecutionResult = await execute(context);

    expect(result.returnValue).toEqual({ data: { ok: true } });
    expect(context.requestedPages).toHaveLength(2);
    // The stalled page is abandoned, not reused: its request is still paused.
    expect(context.requestedPages[0]!.gotoUrls).toHaveLength(1);
    expect(context.requestedPages[1]!.gotoUrls).toHaveLength(1);
  });

  test("closes the page from every abandoned attempt", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(2);

    await execute(context);

    expect(context.requestedPages).toHaveLength(3);
    expect(context.requestedPages[0]!.closeCount).toBe(1);
    expect(context.requestedPages[1]!.closeCount).toBe(1);
  });

  test("navigates every attempt to the same execution's sentinel URL", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(2);

    await execute(context);

    const urls: string[] = context.requestedPages.flatMap((page: FakePage) => {
      return page.gotoUrls;
    });
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(1);
  });

  test("re-installs the route and the RPC binding on each fresh attempt", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(1);

    await execute(context);

    for (const record of describeFakePages(context)) {
      expect(record.routePatterns).toEqual(["**/*"]);
      expect(record.bindingNames).toHaveLength(1);
      expect(record.bindingNames[0]).toMatch(/^__oneuptimeRpc_[0-9a-f]{32}$/);
    }
  });

  test("subscribes to the browser context once, however many attempts it takes", async () => {
    /*
     * A broker per attempt would be the obvious way to write the retry, and
     * would leak a "page" listener onto the shared context for every attempt
     * that failed.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(2);

    await execute(context);

    expect(context.listenerEvents).toEqual(["page"]);
  });

  test("gives each attempt the configured bootstrap budget", async () => {
    /*
     * The budget belongs to the whole attempt -- opening the page, installing
     * its route and binding, and the navigation -- so goto is handed whatever
     * of it is left once navigation starts, not the configured figure itself.
     * With every earlier step settling at once, that remainder is the budget
     * less a little bookkeeping: never more than the budget, and never
     * meaningfully less.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(1);

    await execute(context, { bootstrapTimeoutInMs: 1234 });

    expect(context.requestedPages).toHaveLength(2);
    for (const page of context.requestedPages) {
      expect(page.gotoTimeouts).toHaveLength(1);
      expect(page.gotoTimeouts[0]).toBeLessThanOrEqual(1234);
      expect(page.gotoTimeouts[0]).toBeGreaterThanOrEqual(
        1234 - INSTANT_STEPS_TOLERANCE_IN_MS,
      );
    }
  });

  test("reports a probe-side runtime fault once the attempts are spent", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    await expect(
      execute(context, { bootstrapAttempts: 2 }),
    ).rejects.toMatchObject({
      kind: SYNTHETIC_RUNTIME_FAULT_KIND,
      name: "SyntheticRuntimeFault",
    });
    expect(context.requestedPages).toHaveLength(2);
  });

  test("keeps the sentinel URL and the Playwright stack out of the tenant-facing message", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    const error: Error = await execute(context, {
      bootstrapAttempts: 1,
    }).then(
      (): Error => {
        throw new Error("Expected the bootstrap to fail.");
      },
      (caught: Error): Error => {
        return caught;
      },
    );

    // What the customer reads must not be OneUptime's internals.
    expect(error.message).not.toContain("synthetic-runtime.oneuptime.invalid");
    expect(error.message).not.toContain("WorkerController.ts");
    expect(error.message).not.toContain("page.goto");
    expect(error.message).toContain("could not start on this probe");
    expect(error.message).toContain(
      "does not reflect the health of the monitored site",
    );

    // ...while the probe's own logs keep every bit of it.
    const detail: string = (error as { internalDetail?: string })
      .internalDetail as string;
    expect(detail).toContain("page.goto: Timeout 30000ms exceeded.");
    expect(detail).toContain("WorkerController.ts:148:28");
  });

  test("reports the number of attempts and the budget it spent on each", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    await expect(
      execute(context, { bootstrapAttempts: 3, bootstrapTimeoutInMs: 250 }),
    ).rejects.toThrow(/3 attempt\(s\) of up to 250 ms/);
  });

  test("stops retrying once the whole bootstrap budget is spent", async () => {
    /*
     * Retrying has to fit inside the startup allowance the supervisor already
     * reserved. Past it, the supervisor's own deadline fires first and the
     * check dies as a bare execution timeout that explains nothing.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    /*
     * Ten attempts are allowed, but each one burns its full 40ms budget
     * against a total of 10 x 40ms, so the elapsed retry delays (250ms each)
     * exhaust it well before the tenth.
     */
    await expect(
      execute(context, { bootstrapAttempts: 10, bootstrapTimeoutInMs: 40 }),
    ).rejects.toThrow(/could not start on this probe/);

    expect(context.requestedPages.length).toBeGreaterThan(1);
    expect(context.requestedPages.length).toBeLessThan(10);
  });

  test("binds the RPC guard to the page of its own attempt", async () => {
    /*
     * The binding installed on a page that was later abandoned must not accept
     * calls made from another page, and the surviving page's binding must not
     * reject its own.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(1);
    const outcomes: BindingOutcome[] = [];

    context.onStartWorker = async (livePage: FakePage): Promise<void> => {
      const worker: StartedWorker = startedWorkerOn(livePage);
      outcomes.push(
        await callBinding({
          bindingPage: context.requestedPages[0]!,
          sourcePage: livePage,
          worker,
        }),
        await callBinding({
          bindingPage: livePage,
          sourcePage: livePage,
          worker,
        }),
      );
    };

    await execute(context);

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.rejection).toBe(REJECTED_RPC_SOURCE);
    expect(outcomes[0]!.response).toBeUndefined();
    // The live binding hands the call to the broker, which carries it out.
    expect(outcomes[1]!.rejection).toBeUndefined();
    expect(outcomes[1]!.response?.ok).toBe(true);
  });

  test("rejects a bootstrap attempt count that is not a usable number", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(0);

    await expect(execute(context, { bootstrapAttempts: 0 })).rejects.toThrow(
      "Synthetic runtime bootstrap attempt count is invalid.",
    );
    await expect(execute(context, { bootstrapAttempts: 99 })).rejects.toThrow(
      "Synthetic runtime bootstrap attempt count is invalid.",
    );
    expect(context.requestedPages).toHaveLength(0);
  });

  test("rejects a bootstrap timeout that is not a usable number", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(0);

    await expect(execute(context, { bootstrapTimeoutInMs: 0 })).rejects.toThrow(
      "Synthetic runtime bootstrap timeout is invalid.",
    );
    await expect(
      execute(context, { bootstrapTimeoutInMs: 1.5 }),
    ).rejects.toThrow("Synthetic runtime bootstrap timeout is invalid.");
  });

  test.each<number>([0, -1, 1.5, 120_001, 2_147_483_648])(
    "rejects a teardown timeout of %p before opening any page",
    async (teardownTimeoutInMs: number): Promise<void> => {
      /*
       * A bound of zero or less would give every teardown step up before it
       * started, and a fractional one is not a timer length anyone meant. An
       * enormous one is worse than useless: Node clamps a timer above 2^31-1
       * ms to 1 ms, so it too would give teardown up at once. Nothing may
       * wait longer than the worker's whole start-up allowance (120 s).
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);

      await expect(execute(context, { teardownTimeoutInMs })).rejects.toThrow(
        "Synthetic runtime teardown timeout is invalid.",
      );
      expect(context.requestedPages).toHaveLength(0);
    },
  );
});

describe("SyntheticRuntime WorkerController bootstrap steps before the navigation", () => {
  interface StalledStep {
    step: PreNavigationStep;
    waitingTo: string;
    reached: string[];
    notReached: string[];
    opensPage: boolean;
  }

  const STALLED_STEPS: StalledStep[] = [
    {
      step: "newPage",
      waitingTo: "open the controller page",
      reached: [],
      notReached: MARKS_BEFORE_NAVIGATION,
      opensPage: false,
    },
    {
      step: "route",
      waitingTo: "install the sentinel route",
      reached: ["page opened"],
      notReached: [
        "route installed",
        "binding installed",
        "navigation started",
      ],
      opensPage: true,
    },
    {
      step: "exposeBinding",
      waitingTo: "install the runtime binding",
      reached: ["page opened", "route installed"],
      notReached: ["binding installed", "navigation started"],
      opensPage: true,
    },
  ];

  test("reports a runtime fault after every attempt when the controller page cannot even be opened", async () => {
    /*
     * newPage used to sit outside the attempt's try, so the first rejection
     * escaped as it was: after a single attempt, as the tenant's script error,
     * carrying Playwright's text. A browser whose context is going away is
     * the probe's problem, and it deserves the same retry and the same
     * tenant-safe message as a navigation that stalled.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(0);
    context.behaviourFor = (): FakePageBehaviour => {
      return {
        newPage: async (): Promise<void> => {
          throw newPageClosedError();
        },
      };
    };

    const failure: ExecutionFailure = await executeExpectingFailure(context);

    expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
    expect(failure.error.name).toBe("SyntheticRuntimeFault");
    expect(failure.error.message).toBe(tenantBootstrapMessage(3, 500));
    expect(failure.error.message).not.toContain("browserContext.newPage");
    expect(failure.error.message).not.toContain("has been closed");
    expect(context.requestedPages).toHaveLength(3);

    expect(failure.internalDetail).toContain(
      "browserContext.newPage: Target page, context or browser has been closed",
    );
    const detail: BootstrapDetail = parseBootstrapDetail(
      failure.internalDetail,
    );
    expect(detail.reports).toHaveLength(3);
    for (const report of detail.reports) {
      // Nothing at all: this is the whole list, and it is empty.
      expect(report.reached).toEqual([]);
      expect(report.error).toBe(
        "browserContext.newPage: Target page, context or browser has been closed",
      );
    }
    expect(failure.internalDetail).toContain("Reached: nothing.");
  });

  test.each(STALLED_STEPS)(
    "gives up on an attempt whose $step call never settles, on every attempt, within the budget, and closes what it opened",
    async (stalled: StalledStep): Promise<void> => {
      /*
       * None of these calls takes a timeout in Playwright. Before they shared
       * the attempt's deadline, one that never settled held the check until
       * the supervisor killed the worker -- minutes later, as a bare execution
       * timeout -- with no retry and nothing in the logs to say which step it
       * had been waiting on.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return behaviourWith(stalled.step, never);
      };

      const failure: ExecutionFailure = await executeExpectingFailure(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
      });

      expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(failure.error.message).toBe(
        tenantBootstrapMessage(3, STALL_BUDGET_IN_MS),
      );
      expect(context.requestedPages).toHaveLength(3);
      expect(failure.elapsedInMs).toBeLessThan(
        3 * STALL_BUDGET_IN_MS + 2 * RETRY_DELAY_IN_MS + SCHEDULING_SLACK_IN_MS,
      );

      const detail: BootstrapDetail = parseBootstrapDetail(
        failure.internalDetail,
      );
      expect(detail.reports).toHaveLength(3);
      for (const report of detail.reports) {
        expectReached({
          report,
          inOrder: stalled.reached,
          notReached: stalled.notReached,
        });
        expect(report.error).toMatch(
          new RegExp(
            `^Timed out after \\d+ ms waiting to ${stalled.waitingTo}\\.$`,
          ),
        );
      }

      for (const page of context.requestedPages) {
        // No attempt got as far as navigating...
        expect(page.gotoUrls).toEqual([]);
        /*
         * ...and every page that did open was closed. Only its set-up hung;
         * left open, it would sit in the context next to the monitored page
         * for the rest of the check. A page that never arrived has nothing
         * to close.
         */
        expect(page.closeCount).toBe(stalled.opensPage ? 1 : 0);
      }
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "closes a controller page that only arrives after its attempt gave up on it",
    async () => {
      /*
       * newPage cannot be cancelled. A page that shows up once its attempt has
       * moved on belongs to nobody, and nothing else would ever close it.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        if (pageIndex > 0) {
          return {};
        }
        return {
          newPage: async (): Promise<void> => {
            await sleep(STALL_BUDGET_IN_MS + 200);
          },
        };
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);

      const latePage: FakePage = context.requestedPages[0]!;
      await waitUntil((): boolean => {
        return latePage.closeCount > 0;
      }, SCHEDULING_SLACK_IN_MS);

      expect(latePage.deliveredAtInMs).toBeDefined();
      expect(latePage.closeCount).toBe(1);
      // The attempt that asked for it had already given up: nothing was set up.
      expect(latePage.routePatterns).toEqual([]);
      expect(latePage.gotoUrls).toEqual([]);
      expect(context.requestedPages[1]!.closeCount).toBe(1);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test.each<PreNavigationStep>(["newPage", "route", "exposeBinding"])(
    "gives the navigation only what a slow %s call left of the attempt's budget",
    async (step: PreNavigationStep): Promise<void> => {
      /*
       * One deadline for the whole attempt, not one per step. A goto that
       * still got the full budget after a slow newPage would let an attempt
       * run well past its share, and the attempts after it -- and the sandbox
       * start after those -- would pay for it out of the supervisor's startup
       * allowance.
       */
      const budgetInMs: number = 1_000;
      const stepDelayInMs: number = 400;
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return behaviourWith(step, async (): Promise<void> => {
          await sleep(stepDelayInMs);
        });
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapAttempts: 1,
        bootstrapTimeoutInMs: budgetInMs,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      const page: FakePage = context.requestedPages[0]!;
      expect(page.gotoTimeouts).toHaveLength(1);
      const gotoTimeoutInMs: number = page.gotoTimeouts[0]!;
      const spentBeforeGotoInMs: number =
        page.calledAtInMs("goto") - page.calledAtInMs("newPage");

      expect(spentBeforeGotoInMs).toBeGreaterThanOrEqual(
        stepDelayInMs - CLOCK_TOLERANCE_IN_MS,
      );
      expect(gotoTimeoutInMs).toBeLessThanOrEqual(
        budgetInMs - stepDelayInMs + CLOCK_TOLERANCE_IN_MS,
      );
      expect(
        Math.abs(
          gotoTimeoutInMs - Math.max(1, budgetInMs - spentBeforeGotoInMs),
        ),
      ).toBeLessThanOrEqual(CLOCK_TOLERANCE_IN_MS);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "fails an attempt whose steps are each quick enough but together overrun its budget",
    async () => {
      /*
       * Three 400 ms steps against a 1 s budget: no single step is slow, but the
       * attempt as a whole is. It must fail where the budget ran out -- while
       * installing the binding -- rather than hand the navigation a fresh second.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        const slowStep: StepHook = async (): Promise<void> => {
          await sleep(400);
        };
        return { newPage: slowStep, route: slowStep, exposeBinding: slowStep };
      };

      const failure: ExecutionFailure = await executeExpectingFailure(context, {
        bootstrapAttempts: 1,
        bootstrapTimeoutInMs: 1_000,
      });

      expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(failure.elapsedInMs).toBeLessThan(1_000 + SCHEDULING_SLACK_IN_MS);
      expect(context.requestedPages[0]!.gotoUrls).toEqual([]);
      expect(context.requestedPages[0]!.closeCount).toBe(1);

      const detail: BootstrapDetail = parseBootstrapDetail(
        failure.internalDetail,
      );
      expect(detail.reports).toHaveLength(1);
      expectReached({
        report: detail.reports[0]!,
        inOrder: ["page opened", "route installed"],
        notReached: ["binding installed", "navigation started"],
      });
      expect(detail.reports[0]!.error).toMatch(
        /waiting to install the runtime binding\.$/,
      );
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "stops retrying once the whole bootstrap budget is spent, even when no step ever settles",
    async () => {
      /*
       * The total-budget cut-off used to be reachable only through attempts that
       * failed on their own. With a newPage that never settles, no attempt ever
       * failed, and the loop never got back round to check the budget.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return { newPage: never };
      };

      const failure: ExecutionFailure = await executeExpectingFailure(context, {
        bootstrapAttempts: 10,
        bootstrapTimeoutInMs: 100,
      });

      expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(context.requestedPages.length).toBeGreaterThan(1);
      expect(context.requestedPages.length).toBeLessThan(10);
      // The total budget is 10 x 100 ms; the last retry delay may start inside it.
      expect(failure.elapsedInMs).toBeLessThan(
        10 * 100 + RETRY_DELAY_IN_MS + SCHEDULING_SLACK_IN_MS,
      );
      expect(failure.error.message).toBe(
        tenantBootstrapMessage(context.requestedPages.length, 100),
      );

      const detail: BootstrapDetail = parseBootstrapDetail(
        failure.internalDetail,
      );
      expect(detail.reports).toHaveLength(context.requestedPages.length);
      for (const report of detail.reports) {
        expect(report.attempts).toBe(10);
        expect(report.budgetInMs).toBeLessThanOrEqual(100);
      }
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "moves on to the next attempt when an abandoned page never finishes closing",
    async () => {
      /*
       * page.close takes no timeout either. A page that lost its renderer can
       * leave it pending forever, and waiting on it would strand the retry that
       * was about to recover the check.
       *
       * The bounded close is spent inside the attempt that gave up, so it
       * comes out of the whole bootstrap budget (attempts x per-attempt
       * budget) like any other step: 3 x 500 ms here, of which the close and
       * the retry delay after it take about a third.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(1);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0 ? { close: never } : {};
      };
      const startedAtInMs: number = Date.now();

      const result: SandboxExecutionResult = await execute(context, {
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      });

      const elapsedInMs: number = Date.now() - startedAtInMs;
      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      expect(context.requestedPages[0]!.closeCount).toBe(1);
      // It waited out the configured bound on the close, and not much more.
      expect(elapsedInMs).toBeGreaterThanOrEqual(
        TEST_TEARDOWN_TIMEOUT_IN_MS + RETRY_DELAY_IN_MS - CLOCK_TOLERANCE_IN_MS,
      );
      expect(elapsedInMs).toBeLessThan(
        TEST_TEARDOWN_TIMEOUT_IN_MS +
          RETRY_DELAY_IN_MS +
          SCHEDULING_SLACK_IN_MS,
      );
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "charges an abandoned page's bounded close to the whole bootstrap budget",
    async () => {
      /*
       * The attempt after a close that ran out starts with that much less of
       * the total. Two 600 ms attempts share 1200 ms; the first spends a
       * 600 ms close bound and the 250 ms retry delay before the second
       * begins, so the second can have 350 ms at most -- not its own 600.
       */
      const closeBoundInMs: number = 600;
      const budgetInMs: number = 600;
      const context: FakeBrowserContext = new FakeBrowserContext(1);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0 ? { close: never } : {};
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapAttempts: 2,
        bootstrapTimeoutInMs: budgetInMs,
        teardownTimeoutInMs: closeBoundInMs,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      const secondGotoTimeoutInMs: number =
        context.requestedPages[1]!.gotoTimeouts[0]!;
      expect(secondGotoTimeoutInMs).toBeGreaterThan(0);
      expect(secondGotoTimeoutInMs).toBeLessThanOrEqual(
        2 * budgetInMs -
          closeBoundInMs -
          RETRY_DELAY_IN_MS +
          CLOCK_TOLERANCE_IN_MS,
      );
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "subscribes to the browser context once when attempts fail before they navigate",
    async () => {
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        if (pageIndex === 0) {
          return {
            newPage: async (): Promise<void> => {
              throw newPageClosedError();
            },
          };
        }
        return pageIndex === 1 ? { route: never } : {};
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(3);
      expect(context.listenerEvents).toEqual(["page"]);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "rejects RPC calls through a binding whose install outlived its attempt",
    async () => {
      /*
       * An exposeBinding that never came back still handed its callback to the
       * page that nothing uses any more. If that install ever lands, calls
       * through it must be refused exactly like calls through a page whose
       * navigation failed -- whether they claim to come from that page or from
       * the live one.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0 ? { exposeBinding: never } : {};
      };
      const outcomes: BindingOutcome[] = [];

      context.onStartWorker = async (livePage: FakePage): Promise<void> => {
        const abandonedPage: FakePage = context.requestedPages[0]!;
        const worker: StartedWorker = startedWorkerOn(livePage);
        outcomes.push(
          await callBinding({
            bindingPage: abandonedPage,
            sourcePage: abandonedPage,
            worker,
          }),
          await callBinding({
            bindingPage: abandonedPage,
            sourcePage: livePage,
            worker,
          }),
        );
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      expect(
        outcomes.map((outcome: BindingOutcome): string | undefined => {
          return outcome.rejection;
        }),
      ).toEqual([REJECTED_RPC_SOURCE, REJECTED_RPC_SOURCE]);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );
});

describe("SyntheticRuntime WorkerController pages the bootstrap gave up on", () => {
  /*
   * An abandoned attempt's page is closed, but only within a bound, and a close
   * that runs out leaves the page alive in the tenant's browser context: still
   * on the sentinel URL, still carrying its RPC binding. Against a real
   * Chromium, such a page was listed among the tenant's pages, and a call
   * through its binding reached the broker.
   *
   * Two of these tests give each attempt 3 s. That leaves the retry room even
   * if the abandoned page's close runs to the production five seconds, so a
   * teardown bound that is not honoured cannot hide what they check behind a
   * spent bootstrap budget.
   */
  const ROOMY_BUDGET_IN_MS: number = 3_000;

  test(
    "refuses RPC through an abandoned attempt's binding, even from that attempt's own page and main frame",
    async () => {
      /*
       * Checking where a call comes from does not cover this: the call comes
       * from the very page and frame the binding was installed for. Only the
       * attempt having been given up on tells it apart from the surviving
       * attempt's binding, which must still reach the broker.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(1);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0 ? { close: never } : {};
      };
      const outcomes: BindingOutcome[] = [];
      let wasAbandonedPageOpen: boolean | undefined = undefined;

      context.onStartWorker = async (livePage: FakePage): Promise<void> => {
        const abandonedPage: FakePage = context.requestedPages[0]!;
        const worker: StartedWorker = startedWorkerOn(livePage);
        wasAbandonedPageOpen = !abandonedPage.isClosed();
        outcomes.push(
          await callBinding({
            bindingPage: abandonedPage,
            sourcePage: abandonedPage,
            worker,
          }),
          await callBinding({
            bindingPage: livePage,
            sourcePage: livePage,
            worker,
          }),
        );
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: ROOMY_BUDGET_IN_MS,
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      // Its close was asked for and never finished: the page was still there.
      expect(context.requestedPages[0]!.closeCount).toBe(1);
      expect(wasAbandonedPageOpen).toBe(true);

      expect(outcomes).toHaveLength(2);
      expect(outcomes[0]!.rejection).toBe(REJECTED_RPC_SOURCE);
      expect(outcomes[0]!.response).toBeUndefined();
      expect(outcomes[1]!.rejection).toBeUndefined();
      expect(outcomes[1]!.response?.ok).toBe(true);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "keeps an abandoned attempt's page, still closing, out of the pages the tenant is shown",
    async () => {
      /*
       * The tenant sees the context's pages in the browser context it is
       * handed at start-up, and again in the page list that comes back with
       * every call. The page limit counts the same list, so a lingering
       * internal page would also have used up one of the tenant's pages.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(1);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0 ? { close: never } : {};
      };
      let worker: StartedWorker | undefined = undefined;
      let listedPages: Page[] = [];
      let answer: BindingOutcome | undefined = undefined;

      context.onStartWorker = async (livePage: FakePage): Promise<void> => {
        worker = startedWorkerOn(livePage);
        listedPages = context.pages();
        answer = await callBinding({
          bindingPage: livePage,
          sourcePage: livePage,
          worker,
        });
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: ROOMY_BUDGET_IN_MS,
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      // The abandoned page really was still in the context...
      expect(listedPages).toContain(
        context.requestedPages[0]! as unknown as Page,
      );
      // ...and the tenant was shown its own page and nothing else, both times.
      const startedWorker: StartedWorker = worker!;
      expect(startedWorker.initialContextPageIds).toEqual([
        startedWorker.monitoredPageCapabilityId,
      ]);
      expect(answer!.response?.ok).toBe(true);
      expect(tenantPageIdsIn(answer)).toEqual([
        startedWorker.monitoredPageCapabilityId,
      ]);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "keeps a controller page that only arrives once the sandbox is running out of the pages the tenant is shown",
    async () => {
      /*
       * newPage cannot be cancelled, so the page an attempt gave up waiting
       * for can still arrive -- here, only after the bootstrap has settled on
       * another page and the broker already exists. It is closed as soon as
       * it arrives, and until that close finishes it must be as invisible as
       * the rest.
       */
      const lateDelivery: Gate = createGate();
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        if (pageIndex > 0) {
          return {};
        }
        return {
          newPage: async (): Promise<void> => {
            await lateDelivery.opened;
          },
          close: never,
        };
      };
      let worker: StartedWorker | undefined = undefined;
      let listedPages: Page[] = [];
      let answer: BindingOutcome | undefined = undefined;

      context.onStartWorker = async (livePage: FakePage): Promise<void> => {
        const latePage: FakePage = context.requestedPages[0]!;
        worker = startedWorkerOn(livePage);
        lateDelivery.open();
        await waitUntil((): boolean => {
          return latePage.closeCount > 0;
        }, SCHEDULING_SLACK_IN_MS);
        listedPages = context.pages();
        answer = await callBinding({
          bindingPage: livePage,
          sourcePage: livePage,
          worker,
        });
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      const latePage: FakePage = context.requestedPages[0]!;
      // It arrived, was never set up, and its close was asked for...
      expect(latePage.deliveredAtInMs).toBeDefined();
      expect(latePage.routePatterns).toEqual([]);
      expect(latePage.closeCount).toBe(1);
      // ...and it was in the context when the call was made...
      expect(listedPages).toContain(latePage as unknown as Page);
      // ...but not in what the tenant was shown.
      expect(answer!.response?.ok).toBe(true);
      expect(tenantPageIdsIn(answer)).toEqual([
        worker!.monitoredPageCapabilityId,
      ]);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );
});

describe("SyntheticRuntime WorkerController bootstrap diagnostics", () => {
  test("writes one report per attempt, in order, followed by the last error's full stack", async () => {
    /*
     * Playwright's own timeout names the URL and nothing more, and the fault
     * used to carry only the last attempt's error -- so three attempts that
     * stalled at three different steps read exactly like one. The report per
     * attempt is what lets the probe's logs tell a browser-wide stall (every
     * attempt stops at the same step) from one confined to a page.
     */
    const errors: Error[] = [1, 2, 3].map((attempt: number): Error => {
      return playwrightError({
        lines: [
          `page.goto: net::ERR_ABORTED on attempt ${attempt}`,
          "Call log:",
          `  - navigating to "${SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN}/attempt-${attempt}", waiting until "domcontentloaded"`,
        ],
      });
    });
    const context: FakeBrowserContext = new FakeBrowserContext(0);
    context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
      return {
        goto: async (): Promise<void> => {
          throw errors[pageIndex]!;
        },
      };
    };

    const failure: ExecutionFailure = await executeExpectingFailure(context);

    expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
    expect(failure.error.message).toBe(tenantBootstrapMessage(3, 500));

    const detail: BootstrapDetail = parseBootstrapDetail(
      failure.internalDetail,
    );
    expect(
      detail.reports.map((report: AttemptReport): number => {
        return report.attempt;
      }),
    ).toEqual([1, 2, 3]);

    detail.reports.forEach((report: AttemptReport, index: number): void => {
      expect(report.attempts).toBe(3);
      expect(report.budgetInMs).toBeLessThanOrEqual(500);
      expectReached({
        report,
        inOrder: MARKS_BEFORE_NAVIGATION,
        notReached: NAVIGATION_MARKS,
      });
      expect(
        [...report.reachedAtInMs].sort((a: number, b: number): number => {
          return a - b;
        }),
      ).toEqual(report.reachedAtInMs);
      expect(report.failedAfterInMs).toBeGreaterThanOrEqual(
        report.reachedAtInMs[report.reachedAtInMs.length - 1]!,
      );
      // Only the first line: the call log belongs to the stack below.
      expect(report.error).toBe(
        `page.goto: net::ERR_ABORTED on attempt ${index + 1}`,
      );
    });

    expect(detail.lastError).toBe(errors[2]!.stack);
    expect(
      failure.internalDetail!.endsWith(`Last error: ${errors[2]!.stack}`),
    ).toBe(true);
  });

  test("reports only the attempts it actually made when the total budget cuts the retry short", async () => {
    const context: FakeBrowserContext = new FakeBrowserContext(99);

    const failure: ExecutionFailure = await executeExpectingFailure(context, {
      bootstrapAttempts: 10,
      bootstrapTimeoutInMs: 40,
    });

    expect(context.requestedPages.length).toBeLessThan(10);
    const detail: BootstrapDetail = parseBootstrapDetail(
      failure.internalDetail,
    );
    expect(detail.reports).toHaveLength(context.requestedPages.length);
    expect(
      detail.reports.map((report: AttemptReport): string => {
        return `${report.attempt}/${report.attempts}`;
      }),
    ).toEqual(
      context.requestedPages.map((_page: FakePage, index: number): string => {
        return `${index + 1}/10`;
      }),
    );
    expect(failure.error.message).toBe(
      tenantBootstrapMessage(context.requestedPages.length, 40),
    );
  });

  test(
    "traces a navigation that was intercepted, served, committed and loaded",
    async () => {
      /*
       * Every mark is recorded when its event happens, whatever the navigation
       * does afterwards -- even one that reached DOMContentLoaded and still
       * timed out waiting for Playwright to notice.
       *
       * The whole list, in full: the order in which a navigation passes these
       * points is what the trace exists to show.
       */
      const report: AttemptReport = await reachedBySingleStalledAttempt(
        async (
          page: FakePage,
          url: string,
          timeoutInMs: number,
        ): Promise<void> => {
          await interceptRequest({ page, url });
          commitMainFrame(page);
          fireDomContentLoaded(page);
          await stallUntilNavigationTimeout(timeoutInMs);
        },
      );

      expect(report.reached).toEqual([
        ...MARKS_BEFORE_NAVIGATION,
        ...NAVIGATION_MARKS,
      ]);
      expect(report.error).toMatch(/^page\.goto: Timeout \d+ms exceeded\.$/);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "tells a navigation the browser never handed to the route apart from one it did",
    async () => {
      /*
       * The stall customers hit: Chromium held the request back until a fresh
       * on-disk profile's cookie store was synced, so page.route never saw it.
       * Its report stops at "navigation started".
       */
      const report: AttemptReport = await reachedBySingleStalledAttempt(
        async (
          _page: FakePage,
          _url: string,
          timeoutInMs: number,
        ): Promise<void> => {
          await stallUntilNavigationTimeout(timeoutInMs);
        },
      );

      expectReached({
        report,
        inOrder: MARKS_BEFORE_NAVIGATION,
        notReached: NAVIGATION_MARKS,
      });
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "does not count other requests through the route as the sentinel request",
    async () => {
      const report: AttemptReport = await reachedBySingleStalledAttempt(
        async (
          page: FakePage,
          url: string,
          timeoutInMs: number,
        ): Promise<void> => {
          await interceptRequest({ page, url, resourceType: "fetch" });
          await interceptRequest({
            page,
            url: "https://example.com/",
            resourceType: "document",
          });
          await stallUntilNavigationTimeout(timeoutInMs);
        },
      );

      expectReached({
        report,
        inOrder: MARKS_BEFORE_NAVIGATION,
        notReached: [
          "sentinel request intercepted",
          "sentinel document served",
        ],
      });
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "tells a request whose fulfil never finished apart from a served document",
    async () => {
      const report: AttemptReport = await reachedBySingleStalledAttempt(
        async (
          page: FakePage,
          url: string,
          timeoutInMs: number,
        ): Promise<void> => {
          void interceptRequest({ page, url, fulfill: never });
          await stallUntilNavigationTimeout(timeoutInMs);
        },
      );

      expectReached({
        report,
        inOrder: [...MARKS_BEFORE_NAVIGATION, "sentinel request intercepted"],
        notReached: [
          "sentinel document served",
          "sentinel document committed",
          "DOMContentLoaded",
        ],
      });
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "tells a document that was served but never committed apart from one that committed",
    async () => {
      /*
       * Served-but-never-committed is a renderer that could not start;
       * committed-but-never-loaded is a renderer that is busy. Different causes,
       * and until now the same Playwright timeout.
       */
      const report: AttemptReport = await reachedBySingleStalledAttempt(
        async (
          page: FakePage,
          url: string,
          timeoutInMs: number,
        ): Promise<void> => {
          await interceptRequest({ page, url });
          await stallUntilNavigationTimeout(timeoutInMs);
        },
      );

      expectReached({
        report,
        inOrder: [
          ...MARKS_BEFORE_NAVIGATION,
          "sentinel request intercepted",
          "sentinel document served",
        ],
        notReached: ["sentinel document committed", "DOMContentLoaded"],
      });
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "does not count a subframe navigation as the sentinel document committing",
    async () => {
      const report: AttemptReport = await reachedBySingleStalledAttempt(
        async (
          page: FakePage,
          url: string,
          timeoutInMs: number,
        ): Promise<void> => {
          await interceptRequest({ page, url });
          page.emit("framenavigated", page.childFrame);
          await stallUntilNavigationTimeout(timeoutInMs);
        },
      );

      expectReached({
        report,
        inOrder: [
          ...MARKS_BEFORE_NAVIGATION,
          "sentinel request intercepted",
          "sentinel document served",
        ],
        notReached: ["sentinel document committed"],
      });
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test("removes its navigation listeners from the controller page once the bootstrap succeeds", async () => {
    /*
     * The controller page lives for the whole check. Listeners left on it
     * would keep the finished attempt's trace alive and fire on every
     * navigation the page ever makes.
     */
    const listenersDuringNavigation: number[] = [];
    const context: FakeBrowserContext = new FakeBrowserContext(0);
    context.behaviourFor = (): FakePageBehaviour => {
      return {
        goto: async (page: FakePage, url: string): Promise<void> => {
          listenersDuringNavigation.push(
            page.listenerCount("framenavigated"),
            page.listenerCount("domcontentloaded"),
          );
          await interceptRequest({ page, url });
          commitMainFrame(page);
          fireDomContentLoaded(page);
        },
      };
    };

    const result: SandboxExecutionResult = await execute(context);

    expect(result.returnValue).toEqual({ data: { ok: true } });
    expect(listenersDuringNavigation).toEqual([1, 1]);
    expect(context.requestedPages[0]!.listenerCount("framenavigated")).toBe(0);
    expect(context.requestedPages[0]!.listenerCount("domcontentloaded")).toBe(
      0,
    );
  });

  test(
    "removes its navigation listeners from every abandoned page",
    async () => {
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        if (pageIndex === 0) {
          return {
            goto: async (): Promise<void> => {
              throw timeoutError();
            },
          };
        }
        if (pageIndex === 1) {
          return {
            goto: async (
              page: FakePage,
              url: string,
              timeoutInMs: number,
            ): Promise<void> => {
              await interceptRequest({ page, url });
              await stallUntilNavigationTimeout(timeoutInMs);
            },
          };
        }
        return {};
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(3);
      for (const page of context.requestedPages) {
        // They were there while the page navigated...
        expect(page.subscribedEvents).toEqual(
          expect.arrayContaining(["framenavigated", "domcontentloaded"]),
        );
        // ...and are gone now, whichever way the attempt ended.
        expect(page.listenerCount("framenavigated")).toBe(0);
        expect(page.listenerCount("domcontentloaded")).toBe(0);
      }
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );
});

describe("SyntheticRuntime WorkerController controller page JavaScript context", () => {
  const PROBE_TIMEOUT_PATTERN: RegExp =
    /^Timed out after (\d+) ms waiting to reach the controller page's JavaScript context\.$/;

  test(
    "retries on a fresh page when the controller document loads but its JavaScript never answers",
    async () => {
      /*
       * Nothing used to notice a page in this state until the sandbox start
       * waited on it too, so the check spent the whole 30-second sandbox
       * start-up budget and then a second worker -- while a fresh page in the
       * same browser would have worked at once.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0 ? lostJavaScriptContext() : {};
      };
      const startedAtInMs: number = Date.now();

      const result: SandboxExecutionResult = await execute(context);

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(Date.now() - startedAtInMs).toBeLessThan(
        500 + RETRY_DELAY_IN_MS + SCHEDULING_SLACK_IN_MS,
      );
      expect(context.requestedPages).toHaveLength(2);

      const silentPage: FakePage = context.requestedPages[0]!;
      expect(silentPage.gotoUrls).toHaveLength(1);
      expect(silentPage.runtimeProbeCount).toBe(1);
      // The sandbox is never started on a page that cannot run it...
      expect(silentPage.startWorkerCount).toBe(0);
      expect(silentPage.closeCount).toBe(1);

      // ...and is started exactly once, on the page that answered.
      expect(context.requestedPages[1]!.runtimeProbeCount).toBe(1);
      expect(context.requestedPages[1]!.startWorkerCount).toBe(1);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "gives up on a silent controller page after a few seconds, however much of the attempt's budget is left",
    async () => {
      /*
       * A context that was never reported does not arrive late, so the check
       * does not wait out the attempt's budget -- 20 seconds in production --
       * before moving on to a page that works.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0 ? lostJavaScriptContext() : {};
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: 20_000,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      const waitedInMs: number =
        context.requestedPages[1]!.calledAtInMs("newPage") -
        context.requestedPages[0]!.calledAtInMs("runtimeProbe");
      expect(waitedInMs).toBeGreaterThanOrEqual(
        RUNTIME_PROBE_TIMEOUT_IN_MS - CLOCK_TOLERANCE_IN_MS,
      );
      expect(waitedInMs).toBeLessThan(
        RUNTIME_PROBE_TIMEOUT_IN_MS +
          RETRY_DELAY_IN_MS +
          SCHEDULING_SLACK_IN_MS,
      );
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "reports a runtime fault that names the JavaScript check when no controller page ever answers",
    async () => {
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return lostJavaScriptContext();
      };

      const failure: ExecutionFailure = await executeExpectingFailure(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
      });

      expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(failure.error.message).toBe(
        tenantBootstrapMessage(3, STALL_BUDGET_IN_MS),
      );
      // Inside the bootstrap's own budget, never the sandbox's start-up wait.
      expect(failure.elapsedInMs).toBeLessThan(
        3 * STALL_BUDGET_IN_MS + 2 * RETRY_DELAY_IN_MS + SCHEDULING_SLACK_IN_MS,
      );

      const detail: BootstrapDetail = parseBootstrapDetail(
        failure.internalDetail,
      );
      expect(detail.reports).toHaveLength(3);
      for (const report of detail.reports) {
        // The logs say the document loaded and then said nothing.
        expect(report.reached).toEqual([
          ...MARKS_BEFORE_NAVIGATION,
          ...NAVIGATION_MARKS,
        ]);
        expect(report.error).toMatch(PROBE_TIMEOUT_PATTERN);
      }
      for (const page of context.requestedPages) {
        expect(page.runtimeProbeCount).toBe(1);
        expect(page.startWorkerCount).toBe(0);
        expect(page.closeCount).toBe(1);
      }
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "gives the JavaScript check only what the navigation left of the attempt's budget",
    async () => {
      const budgetInMs: number = 1_000;
      const navigationDelayInMs: number = 400;
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return {
          ...lostJavaScriptContext(),
          goto: async (): Promise<void> => {
            await sleep(navigationDelayInMs);
          },
        };
      };

      const failure: ExecutionFailure = await executeExpectingFailure(context, {
        bootstrapAttempts: 1,
        bootstrapTimeoutInMs: budgetInMs,
      });

      expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      expect(failure.elapsedInMs).toBeLessThan(
        budgetInMs + SCHEDULING_SLACK_IN_MS,
      );
      const detail: BootstrapDetail = parseBootstrapDetail(
        failure.internalDetail,
      );
      expect(detail.reports).toHaveLength(1);
      const match: RegExpExecArray | null = PROBE_TIMEOUT_PATTERN.exec(
        detail.reports[0]!.error,
      );
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeLessThanOrEqual(
        budgetInMs - navigationDelayInMs + CLOCK_TOLERANCE_IN_MS,
      );
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  /*
   * The least the JavaScript check is given, mirrored from WorkerController:
   * a navigation that lands at the very end of its attempt still leaves the
   * page this long to answer.
   */
  const RUNTIME_PROBE_MINIMUM_IN_MS: number = 500;

  test(
    "still gives a page whose navigation used up the attempt a moment to answer",
    async () => {
      /*
       * Without a floor the check would get the one millisecond the
       * navigation left, and a working page -- here answering in 100 ms --
       * would fail the attempt, and with it the whole bootstrap.
       */
      const budgetInMs: number = 1_000;
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return {
          goto: async (): Promise<void> => {
            await sleep(budgetInMs + 50);
          },
          runtimeProbe: async (): Promise<void> => {
            await sleep(100);
          },
        };
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapAttempts: 1,
        bootstrapTimeoutInMs: budgetInMs,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(1);
      expect(context.requestedPages[0]!.runtimeProbeCount).toBe(1);
      expect(context.requestedPages[0]!.startWorkerCount).toBe(1);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "gives up on a silent page whose navigation used up the attempt after that moment",
    async () => {
      const budgetInMs: number = 1_000;
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return {
          ...lostJavaScriptContext(),
          goto: async (): Promise<void> => {
            await sleep(budgetInMs + 50);
          },
        };
      };

      const failure: ExecutionFailure = await executeExpectingFailure(context, {
        bootstrapAttempts: 1,
        bootstrapTimeoutInMs: budgetInMs,
      });

      expect(failure.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      const detail: BootstrapDetail = parseBootstrapDetail(
        failure.internalDetail,
      );
      expect(detail.reports).toHaveLength(1);
      const match: RegExpExecArray | null = PROBE_TIMEOUT_PATTERN.exec(
        detail.reports[0]!.error,
      );
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(RUNTIME_PROBE_MINIMUM_IN_MS);
      // The attempt overran its budget by that moment, and not by more.
      expect(failure.elapsedInMs).toBeLessThan(
        budgetInMs + 50 + RUNTIME_PROBE_MINIMUM_IN_MS + SCHEDULING_SLACK_IN_MS,
      );
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test("checks the controller document's JavaScript after the navigation and before starting the sandbox", async () => {
    const steps: string[] = [];
    const context: FakeBrowserContext = new FakeBrowserContext(0);
    context.behaviourFor = (): FakePageBehaviour => {
      return {
        goto: async (): Promise<void> => {
          steps.push("navigation started");
          await sleep(20);
          steps.push("navigation finished");
        },
        runtimeProbe: async (): Promise<void> => {
          steps.push("JavaScript checked");
        },
        startWorker: async (): Promise<void> => {
          steps.push("sandbox started");
        },
      };
    };

    const result: SandboxExecutionResult = await execute(context);

    expect(result.returnValue).toEqual({ data: { ok: true } });
    expect(steps).toEqual([
      "navigation started",
      "navigation finished",
      "JavaScript checked",
      "sandbox started",
    ]);
  });

  test("retries on a fresh page when checking the controller document's JavaScript fails outright", async () => {
    const contextDestroyed: Error = playwrightError({
      lines: [
        "page.evaluate: Execution context was destroyed, most likely because of a navigation",
      ],
    });
    const context: FakeBrowserContext = new FakeBrowserContext(0);
    context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
      return pageIndex === 0
        ? {
            runtimeProbe: async (): Promise<void> => {
              throw contextDestroyed;
            },
          }
        : {};
    };

    const result: SandboxExecutionResult = await execute(context);

    expect(result.returnValue).toEqual({ data: { ok: true } });
    expect(context.requestedPages).toHaveLength(2);
    expect(context.requestedPages[0]!.startWorkerCount).toBe(0);
    expect(context.requestedPages[0]!.closeCount).toBe(1);
    expect(context.requestedPages[1]!.startWorkerCount).toBe(1);
  });

  test(
    "refuses RPC through the binding of a controller page given up on because its JavaScript never answered",
    async () => {
      /*
       * The silent page is closed within a bound, and a close that runs out
       * leaves it alive on the sentinel URL with its binding. From then on
       * that binding must refuse calls -- from its own page and main frame
       * too -- while the live page's binding still reaches the broker.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (pageIndex: number): FakePageBehaviour => {
        return pageIndex === 0
          ? { ...lostJavaScriptContext(), close: never }
          : {};
      };
      const outcomes: BindingOutcome[] = [];

      context.onStartWorker = async (livePage: FakePage): Promise<void> => {
        const silentPage: FakePage = context.requestedPages[0]!;
        const worker: StartedWorker = startedWorkerOn(livePage);
        outcomes.push(
          await callBinding({
            bindingPage: silentPage,
            sourcePage: silentPage,
            worker,
          }),
          await callBinding({
            bindingPage: livePage,
            sourcePage: livePage,
            worker,
          }),
        );
      };

      const result: SandboxExecutionResult = await execute(context, {
        bootstrapTimeoutInMs: STALL_BUDGET_IN_MS,
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      });

      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(context.requestedPages).toHaveLength(2);
      expect(context.requestedPages[0]!.isClosed()).toBe(false);
      expect(outcomes).toHaveLength(2);
      expect(outcomes[0]!.rejection).toBe(REJECTED_RPC_SOURCE);
      expect(outcomes[0]!.response).toBeUndefined();
      expect(outcomes[1]!.rejection).toBeUndefined();
      expect(outcomes[1]!.response?.ok).toBe(true);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );
});

describe("SyntheticRuntime WorkerController teardown", () => {
  test(
    "still reports why the sandbox failed when stopping it never returns",
    async () => {
      /*
       * A controller page that has lost its JavaScript context -- Firefox has
       * been seen to drop it after the controller document's process switch --
       * never settles an evaluate. The stop in the teardown waited on it, and
       * the start-up fault that was already on its way out was swallowed while
       * the worker sat there until the supervisor killed it.
       */
      const crash: Error = new Error("Synthetic runtime worker crashed.");
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return {
          startWorker: async (): Promise<void> => {
            throw crash;
          },
          stopWorker: never,
        };
      };
      const startedAtInMs: number = Date.now();

      const outcome: unknown = await execute(context, {
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      }).then(
        (): string => {
          return "resolved";
        },
        (error: unknown): unknown => {
          return error;
        },
      );

      const elapsedInMs: number = Date.now() - startedAtInMs;
      expect(outcome).toBe(crash);
      // It gave the stop the configured bound, and no more than that.
      expect(elapsedInMs).toBeGreaterThanOrEqual(
        TEST_TEARDOWN_TIMEOUT_IN_MS - CLOCK_TOLERANCE_IN_MS,
      );
      expect(elapsedInMs).toBeLessThan(
        TEST_TEARDOWN_TIMEOUT_IN_MS + SCHEDULING_SLACK_IN_MS,
      );
      expect(context.requestedPages).toHaveLength(1);
      expect(context.requestedPages[0]!.stopWorkerCount).toBe(1);
      // The page is still closed after the stop gave up.
      expect(context.requestedPages[0]!.closeCount).toBe(1);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "returns a finished check's result when stopping the sandbox never returns",
    async () => {
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return { stopWorker: never };
      };
      const startedAtInMs: number = Date.now();

      const result: SandboxExecutionResult = await execute(context, {
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      });

      const elapsedInMs: number = Date.now() - startedAtInMs;
      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(elapsedInMs).toBeGreaterThanOrEqual(
        TEST_TEARDOWN_TIMEOUT_IN_MS - CLOCK_TOLERANCE_IN_MS,
      );
      expect(elapsedInMs).toBeLessThan(
        TEST_TEARDOWN_TIMEOUT_IN_MS + SCHEDULING_SLACK_IN_MS,
      );
      expect(context.requestedPages[0]!.stopWorkerCount).toBe(1);
      expect(context.requestedPages[0]!.closeCount).toBe(1);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test(
    "returns a finished check's result when closing the controller page never returns",
    async () => {
      /*
       * The tenant's script has already run and its result is in hand; a close
       * that never settles must not turn it into a supervisor timeout.
       */
      const context: FakeBrowserContext = new FakeBrowserContext(0);
      context.behaviourFor = (): FakePageBehaviour => {
        return { close: never };
      };
      const startedAtInMs: number = Date.now();

      const result: SandboxExecutionResult = await execute(context, {
        teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
      });

      const elapsedInMs: number = Date.now() - startedAtInMs;
      expect(result.returnValue).toEqual({ data: { ok: true } });
      expect(elapsedInMs).toBeGreaterThanOrEqual(
        TEST_TEARDOWN_TIMEOUT_IN_MS - CLOCK_TOLERANCE_IN_MS,
      );
      expect(elapsedInMs).toBeLessThan(
        TEST_TEARDOWN_TIMEOUT_IN_MS + SCHEDULING_SLACK_IN_MS,
      );
      expect(context.requestedPages).toHaveLength(1);
      expect(context.requestedPages[0]!.stopWorkerCount).toBe(1);
      expect(context.requestedPages[0]!.closeCount).toBe(1);
    },
    BOUNDED_TEST_TIMEOUT_IN_MS,
  );

  test("clears every deadline timer it arms, through a retried bootstrap and the teardown", async () => {
    /*
     * Every step Playwright would wait on forever is raced against a timer.
     * One left armed after its step settled would fire later into a race
     * nobody is waiting on any more: harmless once, but there is one per step
     * of every attempt and of every teardown, and nothing else would notice
     * they had stopped being cleared. Timers that did their job and fired --
     * the retry delay -- are not leaks.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(1);
    let result: SandboxExecutionResult | undefined = undefined;

    const timers: RecordedTimers = await recordTimers(
      async (): Promise<void> => {
        result = await execute(context, {
          teardownTimeoutInMs: TEST_TEARDOWN_TIMEOUT_IN_MS,
        });
      },
    );

    expect(result!.returnValue).toEqual({ data: { ok: true } });
    expect(context.requestedPages).toHaveLength(2);

    const leftArmed: ArmedTimer[] = timers.armed.filter(
      (timer: ArmedTimer): boolean => {
        return !timer.hasFired && !timers.clearedHandles.has(timer.handle);
      },
    );
    expect(
      leftArmed.map((timer: ArmedTimer): number => {
        return timer.delayInMs;
      }),
    ).toEqual([]);

    /*
     * The configured bound, and only it: the abandoned attempt's close, then
     * stopping the sandbox and closing the controller page.
     */
    const teardownTimers: ArmedTimer[] = timers.armed.filter(
      (timer: ArmedTimer): boolean => {
        return timer.delayInMs === TEST_TEARDOWN_TIMEOUT_IN_MS;
      },
    );
    expect(teardownTimers).toHaveLength(3);
    expect(
      timers.armed.filter((timer: ArmedTimer): boolean => {
        return timer.delayInMs === DEFAULT_TEARDOWN_TIMEOUT_IN_MS;
      }),
    ).toHaveLength(0);
    /*
     * Not a count of the implementation's timers, just proof they were
     * watched: at the least, three step deadlines per attempt and the three
     * teardown bounds were cleared.
     */
    expect(
      timers.armed.filter((timer: ArmedTimer): boolean => {
        return timers.clearedHandles.has(timer.handle);
      }).length,
    ).toBeGreaterThanOrEqual(2 * 3 + 3);
  });

  test("bounds each teardown step by the production five seconds when no teardown timeout is given", async () => {
    /*
     * Read off the timers the teardown arms rather than waited out: both steps
     * settle at once, so their timers are cleared long before they could fire.
     */
    const context: FakeBrowserContext = new FakeBrowserContext(0);

    const timers: RecordedTimers = await recordTimers(
      async (): Promise<void> => {
        await execute(context);
      },
    );

    const teardownTimers: ArmedTimer[] = timers.armed.filter(
      (timer: ArmedTimer): boolean => {
        return timer.delayInMs === DEFAULT_TEARDOWN_TIMEOUT_IN_MS;
      },
    );
    // Stopping the sandbox, then closing the controller page.
    expect(teardownTimers).toHaveLength(2);
    for (const timer of teardownTimers) {
      expect(timer.hasFired).toBe(false);
      expect(timers.clearedHandles.has(timer.handle)).toBe(true);
    }
  });
});

describe("SyntheticRuntime WorkerController sentinel route", () => {
  async function captureRouteHandler(): Promise<{
    handler: RouteHandler;
    url: string;
  }> {
    const context: FakeBrowserContext = new FakeBrowserContext(0);
    await execute(context);
    return {
      handler: context.requestedPages[0]!.routeHandlers[0]!,
      url: context.requestedPages[0]!.gotoUrls[0]!,
    };
  }

  test("serves the sentinel document from memory and blocks everything else", async () => {
    const { handler, url } = await captureRouteHandler();

    const sentinel: FakeRoute = fakeRoute({
      url,
      resourceType: "document",
    });
    await handler(sentinel.route);
    expect(sentinel.fulfilled).toEqual([url]);
    expect(sentinel.aborted).toEqual([]);

    const other: FakeRoute = fakeRoute({
      url: "https://example.com/tracker.js",
      resourceType: "script",
    });
    await handler(other.route);
    expect(other.fulfilled).toEqual([]);
    expect(other.aborted).toEqual(["blockedbyclient"]);
  });

  test("blocks a non-document request even on the sentinel URL", async () => {
    const { handler, url } = await captureRouteHandler();

    const disguised: FakeRoute = fakeRoute({
      url,
      resourceType: "fetch",
    });
    await handler(disguised.route);

    expect(disguised.fulfilled).toEqual([]);
    expect(disguised.aborted).toEqual(["blockedbyclient"]);
  });

  test("always settles the route, so a failed fulfil cannot strand the navigation", async () => {
    /*
     * A handler that returns without fulfilling, aborting, or continuing leaves
     * the request paused in the browser with nothing to end it but the
     * navigation timeout -- the 30-second stall this whole file is about.
     */
    const { handler, url } = await captureRouteHandler();

    const broken: FakeRoute = fakeRoute({
      url,
      resourceType: "document",
      fulfill: async (): Promise<void> => {
        throw new Error("Target page, context or browser has been closed");
      },
    });

    await expect(handler(broken.route)).resolves.toBeUndefined();
    expect(broken.fulfilled).toEqual([]);
    expect(broken.aborted).toEqual(["failed"]);
  });
});
