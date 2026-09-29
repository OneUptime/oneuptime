import fs from "fs";
import os from "os";
import path from "path";
import { Browser, BrowserContext, Page } from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticBrowser, {
  SyntheticBrowserSession,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticBrowser";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import SyntheticRuntimeFault, {
  SYNTHETIC_RUNTIME_FAULT_KIND,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticRuntimeFault";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import {
  SyntheticMonitorWorkerConfig,
  SyntheticMonitorWorkerResult,
  isSyntheticMonitorWorkerConfig,
  isSyntheticMonitorWorkerResult,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";
import {
  SYNTHETIC_WORKER_PROTOCOL_VERSION,
  SYNTHETIC_WORKER_START_MESSAGE_TYPE,
  SyntheticWorkerFailureEnvelope,
  SyntheticWorkerResultEnvelope,
  SyntheticWorkerSuccessEnvelope,
  createWorkerNonce,
  createWorkerStartEnvelope,
  isWorkerResultEnvelope,
} from "../../../../Utils/Monitors/SyntheticRuntime/WorkerProtocol";

/*
 * SyntheticMonitorWorker is the entry module of the forked worker process.
 * Importing it registers the IPC "message" handler and the SIGTERM/SIGINT
 * handlers; it answers the supervisor with process.send and then lets go of
 * the channel with process.disconnect.
 *
 * Its ordering is part of the fix for "the browser runtime did not finish
 * starting up after 3 attempt(s)". The worker used to close the browser before
 * it replied, and on storage slow to acknowledge writes a finished check spent
 * its last half-minute waiting for Chromium to flush, sometimes past its
 * deadline with the answer already in hand. It now replies first and closes
 * second. The full-process integration test cannot see that order -- the
 * supervisor kills the tree the moment a reply lands -- so these tests load the
 * real module in this process, with its two browser-facing dependencies mocked
 * and every process hook it touches stubbed, and record the order directly.
 *
 * Why every hook is stubbed rather than merely observed: jest hands each test
 * file a deep copy of `process` whose methods still close over the real one. A
 * real process.disconnect would cut a jest worker off from its parent, a real
 * process.exit would end the run, and the copied exitCode accessor writes the
 * real process's exit code, so a passing run would still exit 1. Jest's own
 * copy of process.send is a no-op that never calls back, so without a stub the
 * worker would wait for an acknowledgement forever.
 *
 * os.tmpdir() reads the native environment, which the sandbox's copy of
 * process.env never reaches. The tests therefore set HOME and TMPDIR on
 * process.env, where the worker reads HOME, and stub os.tmpdir() to the same
 * directory, which is the arrangement ProcessRunner makes for a real worker.
 */

const RUNTIME_MODULE_DIRECTORY: string =
  "../../../../Utils/Monitors/SyntheticRuntime";
const WORKER_MODULE_PATH: string = `${RUNTIME_MODULE_DIRECTORY}/SyntheticMonitorWorker`;
const SYNTHETIC_BROWSER_MODULE_PATH: string = `${RUNTIME_MODULE_DIRECTORY}/SyntheticBrowser`;
const WORKER_CONTROLLER_MODULE_PATH: string = `${RUNTIME_MODULE_DIRECTORY}/WorkerController`;

/*
 * Nothing here waits on a real browser or a real timer, so every step settles
 * in microseconds. The bound only turns a regression that never replies into a
 * readable failure instead of a hung suite.
 */
const WAIT_TIMEOUT_IN_MS: number = 5_000;
const TEST_TIMEOUT_IN_MS: number = 20_000;

const RUN_DIRECTORY_UNAVAILABLE_MESSAGE: string =
  "Synthetic worker run directory is unavailable.";
const TEMPORARY_DIRECTORY_MISMATCH_MESSAGE: string =
  "Synthetic worker temporary directory is not its run directory.";
const BROWSER_START_FAULT_MESSAGE: string =
  "Synthetic monitor could not start on this probe: the Chromium browser did not start. The monitored page was never opened, so this does not reflect the health of the monitored site.";
const BOOTSTRAP_FAULT_MESSAGE: string =
  "Synthetic monitor could not start on this probe: the browser runtime did not finish starting up after 3 attempt(s) of up to 20000 ms. The monitored page was never opened, so this does not reflect the health of the monitored site.";
const BOOTSTRAP_DIAGNOSIS: string =
  "Bootstrap attempt 3/3 failed after 20002 ms of its 20000 ms budget. Reached: page opened, route installed, binding installed, navigation started. Error: page.goto: Timeout 20000ms exceeded.";
const SCREENSHOT_BYTES: Buffer = Buffer.from("fake screenshot bytes");

type SyntheticBrowserStartOptions = Parameters<
  typeof SyntheticBrowser.start
>[0];
type SyntheticBrowserCloseOptions = Parameters<
  typeof SyntheticBrowser.close
>[0];
type WorkerControllerExecuteOptions = Parameters<
  typeof WorkerController.execute
>[0];
type ProcessListener = (...args: Array<unknown>) => void;
type WorkerResultEnvelope =
  SyntheticWorkerResultEnvelope<SyntheticMonitorWorkerResult>;
type SendCallback = (error: Error | null) => void;

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface ControllerFailureCase {
  readonly name: string;
  readonly error: () => Error;
  readonly expectedMessage: string;
  readonly expectedKind: string | undefined;
  readonly expectedDetail: string | undefined;
}

interface MismatchedTemporaryDirectoryCase {
  readonly name: string;
  readonly temporaryDirectory: (data: {
    runDirectory: string;
    otherDirectory: string;
  }) => string;
}

interface UnavailableRunDirectoryCase {
  readonly name: string;
  readonly home: (runDirectory: string) => string | undefined;
}

interface InvalidStartMessageCase {
  readonly name: string;
  readonly createMessage: (startNonce: string) => unknown;
}

const fakeBrowser: Browser = { name: "launched-browser" } as unknown as Browser;
const fakeSession: SyntheticBrowserSession = {
  browser: fakeBrowser,
  browserContext: {
    name: "ephemeral-context",
  } as unknown as BrowserContext,
  page: { name: "tenant-page" } as unknown as Page,
};

function createDeferred<Value>(): Deferred<Value> {
  let resolve: ((value: Value) => void) | undefined;
  const promise: Promise<Value> = new Promise<Value>(
    (resolvePromise: (value: Value) => void): void => {
      resolve = resolvePromise;
    },
  );

  return {
    promise,
    resolve: (value: Value): void => {
      resolve?.(value);
    },
  };
}

/*
 * One turn of the event loop. Everything the worker does between getting its
 * result and calling process.send is promise continuations, which all run
 * before a setImmediate callback does -- so anything still missing after this
 * was waiting on something else.
 */
function nextMacrotask(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setImmediate(resolve);
  });
}

function createConfig(
  overrides: Partial<SyntheticMonitorWorkerConfig> = {},
): SyntheticMonitorWorkerConfig {
  return {
    code: "return { data: 'checked' };",
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    executablePath: "/opt/ms-playwright/chromium-1223/chrome-linux64/chrome",
    viewport: { width: 1_366, height: 768 },
    timeoutInMs: 30_000,
    chromiumSandboxEnabled: true,
    args: { region: "eu" },
    ...overrides,
  };
}

function createExecutionResult(): SandboxExecutionResult {
  return {
    returnValue: { data: "checked" },
    logMessages: ["page loaded"],
    capturedMetrics: [],
    screenshots: { "home-page": SCREENSHOT_BYTES },
  };
}

describe("SyntheticMonitorWorker lifecycle", () => {
  const systemTemporaryDirectory: string = os.tmpdir();
  const savedProcessProperties: Map<string, PropertyDescriptor | undefined> =
    new Map();
  const savedEnvironment: Map<string, string | undefined> = new Map();

  let runDirectory: string;
  let otherDirectory: string;
  let nonce: string;
  let events: Array<string>;
  let sentMessages: Array<unknown>;
  let listeners: Map<string, ProcessListener>;
  let disconnected: Deferred<void>;
  let originalExitCode: typeof process.exitCode;
  let startMock: jest.Mock<
    Promise<SyntheticBrowserSession>,
    [SyntheticBrowserStartOptions]
  >;
  let closeMock: jest.Mock<Promise<void>, [SyntheticBrowserCloseOptions]>;
  let executeMock: jest.Mock<
    Promise<SandboxExecutionResult>,
    [WorkerControllerExecuteOptions]
  >;
  let launcherMock: jest.Mock<Promise<never>, []>;
  let sendMock: jest.Mock<boolean, [unknown, unknown]>;
  let disconnectMock: jest.Mock<void, []>;
  let exitMock: jest.Mock<void, [unknown]>;

  function stubProcessProperty(key: string, value: unknown): void {
    if (!savedProcessProperties.has(key)) {
      savedProcessProperties.set(
        key,
        Object.getOwnPropertyDescriptor(process, key),
      );
    }
    Object.defineProperty(process, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  }

  function restoreProcessProperties(): void {
    for (const [key, descriptor] of savedProcessProperties) {
      if (descriptor) {
        Object.defineProperty(process, key, descriptor);
      } else {
        delete (process as unknown as Record<string, unknown>)[key];
      }
    }
    savedProcessProperties.clear();
  }

  function setEnvironment(key: string, value: string | undefined): void {
    if (!savedEnvironment.has(key)) {
      savedEnvironment.set(key, process.env[key]);
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  function restoreEnvironment(): void {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    savedEnvironment.clear();
  }

  function useTemporaryDirectory(directory: string): void {
    jest.spyOn(os, "tmpdir").mockReturnValue(directory);
  }

  function registerListener(
    event: string | symbol,
    listener: ProcessListener,
  ): NodeJS.Process {
    listeners.set(String(event), listener);
    return process;
  }

  /*
   * Loads a fresh copy of the worker module, so its once-only message latch
   * and its active-browser slot start empty. The mocks are bound at require
   * time, so a test sets its implementations before calling this.
   */
  function loadWorker(): void {
    jest.isolateModules((): void => {
      jest.doMock(SYNTHETIC_BROWSER_MODULE_PATH, () => {
        return {
          __esModule: true,
          default: { start: startMock, close: closeMock },
        };
      });
      jest.doMock(WORKER_CONTROLLER_MODULE_PATH, () => {
        return { __esModule: true, default: { execute: executeMock } };
      });
      /*
       * The worker must get its browser from SyntheticBrowser. A worker that
       * launched one itself again would reach these and fail loudly.
       */
      jest.doMock("playwright", () => {
        return {
          chromium: {
            launch: launcherMock,
            launchPersistentContext: launcherMock,
          },
          firefox: {
            launch: launcherMock,
            launchPersistentContext: launcherMock,
          },
        };
      });

      /*
       * A synchronous require inside isolateModules is the only way to pick up
       * the mocks above; a static import would be hoisted above them and bound
       * to the real modules, and would register the handlers only once.
       */
      /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      require(WORKER_MODULE_PATH);
    });

    if (!listeners.has("message")) {
      throw new Error(
        "The worker did not register a handler for its start message.",
      );
    }
  }

  function deliverStartMessage(message: unknown): void {
    const listener: ProcessListener | undefined = listeners.get("message");
    if (!listener) {
      throw new Error("The worker has not been loaded.");
    }
    listener(message);
  }

  function startEnvelope(): unknown {
    const config: SyntheticMonitorWorkerConfig = createConfig();
    /*
     * An invalid config makes the worker exit silently, which would read as
     * "no reply" rather than as a broken harness.
     */
    expect(isSyntheticMonitorWorkerConfig(config)).toBe(true);
    return createWorkerStartEnvelope({ nonce, config });
  }

  async function waitFor(
    promise: Promise<void>,
    description: string,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        promise,
        new Promise<never>(
          (
            _resolve: (value: never) => void,
            reject: (error: Error) => void,
          ): void => {
            timer = setTimeout((): void => {
              reject(
                new Error(
                  `Timed out after ${WAIT_TIMEOUT_IN_MS} ms waiting for ${description}. Events so far: ${events.join(", ")}`,
                ),
              );
            }, WAIT_TIMEOUT_IN_MS);
          },
        ),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  function onlyReply(): WorkerResultEnvelope {
    expect(sentMessages).toHaveLength(1);
    const validation: {
      value: unknown;
      expectedNonce: string;
      validateResult: typeof isSyntheticMonitorWorkerResult;
    } = {
      value: sentMessages[0],
      expectedNonce: nonce,
      validateResult: isSyntheticMonitorWorkerResult,
    };

    if (!isWorkerResultEnvelope<SyntheticMonitorWorkerResult>(validation)) {
      throw new Error(
        `The worker's reply is not a valid result envelope: ${JSON.stringify(sentMessages[0])}`,
      );
    }

    return validation.value;
  }

  function onlySuccess(): SyntheticWorkerSuccessEnvelope<SyntheticMonitorWorkerResult> {
    const reply: WorkerResultEnvelope = onlyReply();
    if (!reply.ok) {
      throw new Error(
        `Expected a success reply, got: ${JSON.stringify(reply.error)}`,
      );
    }
    return reply;
  }

  function onlyFailure(): SyntheticWorkerFailureEnvelope {
    const reply: WorkerResultEnvelope = onlyReply();
    if (reply.ok) {
      throw new Error("Expected a failure reply, got a success.");
    }
    return reply;
  }

  beforeEach(() => {
    runDirectory = fs.mkdtempSync(
      path.join(systemTemporaryDirectory, "synthetic-worker-lifecycle-"),
    );
    otherDirectory = fs.mkdtempSync(
      path.join(systemTemporaryDirectory, "synthetic-worker-elsewhere-"),
    );
    nonce = createWorkerNonce();
    events = [];
    sentMessages = [];
    listeners = new Map();
    disconnected = createDeferred<void>();
    originalExitCode = process.exitCode;

    setEnvironment("HOME", runDirectory);
    setEnvironment("TMPDIR", runDirectory);
    useTemporaryDirectory(runDirectory);

    startMock = jest.fn(
      async (
        options: SyntheticBrowserStartOptions,
      ): Promise<SyntheticBrowserSession> => {
        events.push("browser:start");
        options.onLaunched?.(fakeBrowser);
        return fakeSession;
      },
    );
    closeMock = jest.fn(
      async (_options: SyntheticBrowserCloseOptions): Promise<void> => {
        events.push("browser:close");
      },
    );
    executeMock = jest.fn(
      async (
        _options: WorkerControllerExecuteOptions,
      ): Promise<SandboxExecutionResult> => {
        events.push("controller:execute");
        return createExecutionResult();
      },
    );
    launcherMock = jest.fn(async (): Promise<never> => {
      throw new Error(
        "The worker must start its browser through SyntheticBrowser.",
      );
    });

    /*
     * The reply is serialized the way fork() IPC serializes it, and is
     * acknowledged on a later turn, as a real channel does. The acknowledgement
     * is recorded once the worker's callback has returned, which is the moment
     * the worker learns its reply was handed off.
     */
    sendMock = jest.fn((message: unknown, callback: unknown): boolean => {
      events.push("reply:sent");
      sentMessages.push(JSON.parse(JSON.stringify(message)));
      setImmediate((): void => {
        if (typeof callback === "function") {
          (callback as SendCallback)(null);
        }
        events.push("reply:acknowledged");
      });
      return true;
    });
    disconnectMock = jest.fn((): void => {
      events.push("process:disconnect");
      disconnected.resolve();
    });
    exitMock = jest.fn((code: unknown): void => {
      events.push(`process:exit:${String(code)}`);
    });

    stubProcessProperty("send", sendMock);
    stubProcessProperty("connected", true);
    stubProcessProperty("disconnect", disconnectMock);
    stubProcessProperty("exit", exitMock);
    stubProcessProperty("exitCode", undefined);
    stubProcessProperty("once", jest.fn(registerListener));
    stubProcessProperty("on", jest.fn(registerListener));
  });

  afterEach(() => {
    restoreProcessProperties();
    restoreEnvironment();
    jest.restoreAllMocks();
    jest.resetModules();
    fs.rmSync(runDirectory, { recursive: true, force: true });
    fs.rmSync(otherDirectory, { recursive: true, force: true });

    // The worker's exit code went to the stub, never to the jest process.
    expect(process.exitCode).toBe(originalExitCode);
  });

  describe("replying before closing the browser", () => {
    test(
      "sends the result, and has it acknowledged, before it starts closing the browser",
      async () => {
        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(disconnected.promise, "the worker to disconnect");

        expect(events).toEqual([
          "browser:start",
          "controller:execute",
          "reply:sent",
          "reply:acknowledged",
          "browser:close",
          "process:disconnect",
        ]);
        expect(closeMock).toHaveBeenCalledTimes(1);
        expect(closeMock).toHaveBeenCalledWith({ browser: fakeBrowser });
        expect(disconnectMock).toHaveBeenCalledTimes(1);

        const reply: SyntheticWorkerSuccessEnvelope<SyntheticMonitorWorkerResult> =
          onlySuccess();
        expect(reply.result).toEqual({
          returnValue: { data: "checked" },
          logMessages: ["page loaded"],
          capturedMetrics: [],
          screenshots: { "home-page": SCREENSHOT_BYTES.toString("base64") },
        });

        const config: SyntheticMonitorWorkerConfig = createConfig();
        expect(startMock).toHaveBeenCalledTimes(1);
        expect(startMock.mock.calls[0]?.[0].config).toEqual(config);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(executeMock).toHaveBeenCalledWith({
          browserContext: fakeSession.browserContext,
          page: fakeSession.page,
          code: config.code,
          browserType: config.browserType,
          screenSizeType: config.screenSizeType,
          args: config.args,
          timeoutInMs: config.timeoutInMs,
        });
        expect(launcherMock).not.toHaveBeenCalled();
        expect(exitMock).not.toHaveBeenCalled();
      },
      TEST_TIMEOUT_IN_MS,
    );

    test(
      "a browser close that never settles neither delays nor prevents the reply",
      async () => {
        /*
         * On slow storage Chromium can take half a minute to close. The
         * supervisor kills the process tree as soon as the reply lands, so
         * that wait must come after the reply, never in front of it.
         */
        const execution: Deferred<SandboxExecutionResult> =
          createDeferred<SandboxExecutionResult>();
        const executeCalled: Deferred<void> = createDeferred<void>();
        const closeCalled: Deferred<void> = createDeferred<void>();
        /*
         * Stays pending while the reply is checked. Resolving it at the end
         * stands in for SyntheticBrowser.close giving up at its own bound,
         * which SyntheticBrowser.test.ts pins.
         */
        const closeBoundElapsed: Deferred<void> = createDeferred<void>();

        executeMock.mockImplementation(
          (
            _options: WorkerControllerExecuteOptions,
          ): Promise<SandboxExecutionResult> => {
            events.push("controller:execute");
            executeCalled.resolve();
            return execution.promise;
          },
        );
        closeMock.mockImplementation(
          (_options: SyntheticBrowserCloseOptions): Promise<void> => {
            events.push("browser:close");
            closeCalled.resolve();
            return closeBoundElapsed.promise;
          },
        );

        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(executeCalled.promise, "the controller to run");
        expect(sentMessages).toEqual([]);

        execution.resolve(createExecutionResult());
        await nextMacrotask();

        /*
         * The reply left in the same turn the result arrived: nothing -- no
         * close, no timer -- was awaited between the result and process.send.
         */
        expect(sentMessages).toHaveLength(1);
        expect(events).toEqual([
          "browser:start",
          "controller:execute",
          "reply:sent",
        ]);

        await waitFor(closeCalled.promise, "the worker to close the browser");
        expect(events).toEqual([
          "browser:start",
          "controller:execute",
          "reply:sent",
          "reply:acknowledged",
          "browser:close",
        ]);
        expect(onlySuccess().result.returnValue).toEqual({ data: "checked" });
        expect(closeMock).toHaveBeenCalledWith({ browser: fakeBrowser });

        /*
         * The channel is released only once closing is over, which in
         * production is at most SyntheticBrowser.close's bound.
         */
        await nextMacrotask();
        expect(disconnectMock).not.toHaveBeenCalled();

        closeBoundElapsed.resolve();
        await waitFor(disconnected.promise, "the worker to disconnect");
        expect(disconnectMock).toHaveBeenCalledTimes(1);
        expect(closeMock).toHaveBeenCalledTimes(1);
        expect(events[events.length - 1]).toBe("process:disconnect");
        expect(sentMessages).toHaveLength(1);
      },
      TEST_TIMEOUT_IN_MS,
    );

    test(
      "a runtime fault after the browser launched is reported with its diagnosis, then the launched browser is closed",
      async () => {
        /*
         * SyntheticBrowser.start hands over the browser the moment it exists,
         * so a context or page that then fails to open still leaves a browser
         * process behind. The worker has to close it -- and still reply
         * first.
         */
        startMock.mockImplementation(
          async (
            options: SyntheticBrowserStartOptions,
          ): Promise<SyntheticBrowserSession> => {
            events.push("browser:start");
            options.onLaunched?.(fakeBrowser);
            throw new SyntheticRuntimeFault({
              message: BROWSER_START_FAULT_MESSAGE,
              internalDetail: new Error(
                "browser.newContext: Target page, context or browser has been closed",
              ),
            });
          },
        );

        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(disconnected.promise, "the worker to disconnect");

        expect(events).toEqual([
          "browser:start",
          "reply:sent",
          "reply:acknowledged",
          "browser:close",
          "process:disconnect",
        ]);
        expect(closeMock).toHaveBeenCalledTimes(1);
        expect(closeMock).toHaveBeenCalledWith({ browser: fakeBrowser });
        expect(executeMock).not.toHaveBeenCalled();

        const failure: SyntheticWorkerFailureEnvelope = onlyFailure();
        expect(failure.error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
        expect(failure.error.message).toBe(BROWSER_START_FAULT_MESSAGE);
        expect(failure.error.internalDetail).toContain(
          "browser.newContext: Target page, context or browser has been closed",
        );
        expect(failure.error.message).not.toContain("browser.newContext");
      },
      TEST_TIMEOUT_IN_MS,
    );

    test(
      "a browser that never launched is reported, and there is nothing to close",
      async () => {
        startMock.mockImplementation(
          async (
            _options: SyntheticBrowserStartOptions,
          ): Promise<SyntheticBrowserSession> => {
            events.push("browser:start");
            throw new SyntheticRuntimeFault({
              message: BROWSER_START_FAULT_MESSAGE,
              internalDetail: new Error(
                "browserType.launch: Executable doesn't exist at /opt/ms-playwright/chromium-1223/chrome-linux64/chrome",
              ),
            });
          },
        );

        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(disconnected.promise, "the worker to disconnect");

        expect(events).toEqual([
          "browser:start",
          "reply:sent",
          "reply:acknowledged",
          "process:disconnect",
        ]);
        expect(closeMock).not.toHaveBeenCalled();
        expect(onlyFailure().error.kind).toBe(SYNTHETIC_RUNTIME_FAULT_KIND);
      },
      TEST_TIMEOUT_IN_MS,
    );

    const controllerFailures: Array<ControllerFailureCase> = [
      {
        name: "an ordinary error",
        error: (): Error => {
          return new Error("Target page, context or browser has been closed");
        },
        expectedMessage: "Target page, context or browser has been closed",
        expectedKind: undefined,
        expectedDetail: undefined,
      },
      {
        name: "a bootstrap runtime fault",
        error: (): Error => {
          return new SyntheticRuntimeFault({
            message: BOOTSTRAP_FAULT_MESSAGE,
            internalDetail: BOOTSTRAP_DIAGNOSIS,
          });
        },
        expectedMessage: BOOTSTRAP_FAULT_MESSAGE,
        expectedKind: SYNTHETIC_RUNTIME_FAULT_KIND,
        expectedDetail: BOOTSTRAP_DIAGNOSIS,
      },
    ];

    test.each(controllerFailures)(
      "a controller that throws $name is reported, then the browser is closed",
      async ({
        error,
        expectedMessage,
        expectedKind,
        expectedDetail,
      }: ControllerFailureCase) => {
        executeMock.mockImplementation(
          async (
            _options: WorkerControllerExecuteOptions,
          ): Promise<SandboxExecutionResult> => {
            events.push("controller:execute");
            throw error();
          },
        );

        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(disconnected.promise, "the worker to disconnect");

        expect(events).toEqual([
          "browser:start",
          "controller:execute",
          "reply:sent",
          "reply:acknowledged",
          "browser:close",
          "process:disconnect",
        ]);
        expect(closeMock).toHaveBeenCalledTimes(1);
        expect(closeMock).toHaveBeenCalledWith({ browser: fakeBrowser });

        const failure: SyntheticWorkerFailureEnvelope = onlyFailure();
        expect(failure.error.message).toBe(expectedMessage);
        expect(failure.error.kind).toBe(expectedKind);
        expect(failure.error.internalDetail).toBe(expectedDetail);
      },
      TEST_TIMEOUT_IN_MS,
    );
  });

  describe("the run directory guards", () => {
    /*
     * Playwright puts the browser's temporary profile under os.tmpdir(), while
     * the disk watchdog and the cleanup watch only the run directory (HOME).
     * A worker whose two directories differ would write where nothing
     * measures or removes it, so it refuses before any browser exists.
     */
    const mismatchedTemporaryDirectories: Array<MismatchedTemporaryDirectoryCase> =
      [
        {
          name: "a sibling of the run directory",
          temporaryDirectory: (data: {
            runDirectory: string;
            otherDirectory: string;
          }): string => {
            return data.otherDirectory;
          },
        },
        {
          name: "a directory inside the run directory",
          temporaryDirectory: (data: {
            runDirectory: string;
            otherDirectory: string;
          }): string => {
            return path.join(data.runDirectory, "tmp");
          },
        },
        {
          name: "the run directory's parent",
          temporaryDirectory: (data: {
            runDirectory: string;
            otherDirectory: string;
          }): string => {
            return path.dirname(data.runDirectory);
          },
        },
      ];

    test.each(mismatchedTemporaryDirectories)(
      "refuses to start a browser when the temporary directory is $name",
      async ({ temporaryDirectory }: MismatchedTemporaryDirectoryCase) => {
        const temporary: string = temporaryDirectory({
          runDirectory,
          otherDirectory,
        });
        expect(path.isAbsolute(temporary)).toBe(true);
        expect(path.resolve(temporary)).not.toBe(path.resolve(runDirectory));
        useTemporaryDirectory(temporary);

        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(disconnected.promise, "the worker to disconnect");

        const failure: SyntheticWorkerFailureEnvelope = onlyFailure();
        expect(failure.error.message).toBe(
          TEMPORARY_DIRECTORY_MISMATCH_MESSAGE,
        );
        // A probe misconfiguration, not a runtime fault to retry elsewhere.
        expect(Object.keys(failure.error).sort()).toEqual(["message", "stack"]);
        expect(startMock).not.toHaveBeenCalled();
        expect(launcherMock).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
        expect(closeMock).not.toHaveBeenCalled();
        expect(events).toEqual([
          "reply:sent",
          "reply:acknowledged",
          "process:disconnect",
        ]);
        expect(disconnectMock).toHaveBeenCalledTimes(1);
      },
      TEST_TIMEOUT_IN_MS,
    );

    test(
      "accepts the run directory spelled another way",
      async () => {
        /*
         * The comparison is between resolved paths, so a trailing separator
         * or a `..` segment is the same directory, not a mismatch.
         */
        setEnvironment("HOME", `${runDirectory}${path.sep}`);
        useTemporaryDirectory(
          `${runDirectory}${path.sep}nested${path.sep}..${path.sep}`,
        );

        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(disconnected.promise, "the worker to disconnect");

        expect(onlySuccess().result.returnValue).toEqual({ data: "checked" });
        expect(startMock).toHaveBeenCalledTimes(1);
      },
      TEST_TIMEOUT_IN_MS,
    );

    const unavailableRunDirectories: Array<UnavailableRunDirectoryCase> = [
      {
        name: "HOME is not set",
        home: (): string | undefined => {
          return undefined;
        },
      },
      {
        name: "HOME is empty",
        home: (): string | undefined => {
          return "";
        },
      },
      {
        name: "HOME is relative, even though it resolves to the temporary directory",
        home: (directory: string): string | undefined => {
          return path.relative(process.cwd(), directory);
        },
      },
    ];

    test.each(unavailableRunDirectories)(
      "refuses to start a browser when $name",
      async ({ home }: UnavailableRunDirectoryCase) => {
        const value: string | undefined = home(runDirectory);
        if (value) {
          expect(path.isAbsolute(value)).toBe(false);
          expect(path.resolve(value)).toBe(runDirectory);
        }
        setEnvironment("HOME", value);

        loadWorker();
        deliverStartMessage(startEnvelope());
        await waitFor(disconnected.promise, "the worker to disconnect");

        const failure: SyntheticWorkerFailureEnvelope = onlyFailure();
        expect(failure.error.message).toBe(RUN_DIRECTORY_UNAVAILABLE_MESSAGE);
        expect(Object.keys(failure.error).sort()).toEqual(["message", "stack"]);
        expect(startMock).not.toHaveBeenCalled();
        expect(launcherMock).not.toHaveBeenCalled();
        expect(closeMock).not.toHaveBeenCalled();
        expect(events).toEqual([
          "reply:sent",
          "reply:acknowledged",
          "process:disconnect",
        ]);
      },
      TEST_TIMEOUT_IN_MS,
    );
  });

  describe("an invalid start message", () => {
    const invalidStartMessages: Array<InvalidStartMessageCase> = [
      {
        name: "a value that is not an envelope",
        createMessage: (): unknown => {
          return "start";
        },
      },
      {
        name: "an envelope with an unexpected field",
        createMessage: (startNonce: string): unknown => {
          return {
            ...createWorkerStartEnvelope({
              nonce: startNonce,
              config: createConfig(),
            }),
            unexpected: true,
          };
        },
      },
      {
        name: "an envelope with an invalid nonce",
        createMessage: (): unknown => {
          return {
            type: SYNTHETIC_WORKER_START_MESSAGE_TYPE,
            version: SYNTHETIC_WORKER_PROTOCOL_VERSION,
            nonce: "short",
            config: createConfig(),
          };
        },
      },
      {
        name: "an envelope whose config does not validate",
        createMessage: (startNonce: string): unknown => {
          return createWorkerStartEnvelope({
            nonce: startNonce,
            config: createConfig({ executablePath: "chrome" }),
          });
        },
      },
    ];

    test.each(invalidStartMessages)(
      "gets no reply, only exit code 1 and a disconnect, for $name",
      async ({ createMessage }: InvalidStartMessageCase) => {
        loadWorker();
        deliverStartMessage(createMessage(nonce));

        expect(process.exitCode).toBe(1);
        expect(disconnectMock).toHaveBeenCalledTimes(1);

        // Nothing is sent later either.
        await nextMacrotask();
        await nextMacrotask();
        expect(sendMock).not.toHaveBeenCalled();
        expect(sentMessages).toEqual([]);
        expect(startMock).not.toHaveBeenCalled();
        expect(exitMock).not.toHaveBeenCalled();
        expect(events).toEqual(["process:disconnect"]);
      },
      TEST_TIMEOUT_IN_MS,
    );
  });
});
