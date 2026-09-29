import type { ClaimedJob } from "../../Services/RunnerClient";
import type { RunnerCapabilitySet } from "../../Utils/RunnerCapabilities";

/*
 * The Runner's claim loop.
 *
 * Three things about it are load-bearing and none of them is visible from
 * outside a running Runner:
 *
 *   - Capabilities are read on EVERY tick, not once at boot. Reading them once
 *     is the bug CapabilityRefresh.test.ts was written for: granting a
 *     capability queued runs that nothing claimed until somebody restarted the
 *     container, with no error anywhere. The loop half of that contract lives
 *     here.
 *   - The concurrency cap is what stops one Runner from claiming the whole
 *     queue. It counts jobs in flight, so a job that finishes must free its
 *     slot -- including one whose executor threw.
 *   - A failing claim endpoint must break the loop for this tick rather than
 *     spin on it. A `continue` there is a hot loop against a server that is
 *     already unwell.
 *
 * The module starts a setInterval and registers signal handlers at import, so
 * each test loads it fresh with fake timers and mocked collaborators.
 */

const ENV_VARS_UNDER_TEST: Array<string> = [
  "ONEUPTIME_RUNNER_CONCURRENCY",
  "ONEUPTIME_RUNNER_POLL_INTERVAL_MS",
];

const originalEnv: Record<string, string | undefined> = {};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

function defer(): Deferred {
  let resolve: () => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<void> = new Promise<void>(
    (resolveFn: () => void, rejectFn: (error: Error) => void): void => {
      resolve = resolveFn;
      reject = rejectFn;
    },
  );
  return { promise: promise, resolve: resolve, reject: reject };
}

function buildJob(jobId: string): ClaimedJob {
  return { jobId: jobId } as ClaimedJob;
}

function useFakeTimers(): void {
  /*
   * Jest 28 takes a config object; the installed @types/jest (27) only knows
   * the old "modern" | "legacy" argument, hence the cast. The promise
   * plumbing needs the real setImmediate to settle, and Node makes
   * globalThis.performance read-only, so neither is faked.
   */
  (
    jest.useFakeTimers as unknown as (config: {
      doNotFake: Array<string>;
    }) => void
  )({ doNotFake: ["nextTick", "setImmediate", "performance"] });
}

function nextImmediate(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setImmediate(resolve);
  });
}

/*
 * Lets the loop's own awaits settle. The loop awaits claimNextJob between
 * iterations, so a tick needs several turns to run to completion.
 */
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 20; turn++) {
    await nextImmediate();
  }
}

type LoadedLoop = {
  startPolling: () => void;
  claimNextJob: jest.Mock;
  executeAndReport: jest.Mock;
  resolveCapabilities: jest.Mock;
};

function loadLoop(options: {
  concurrency?: number;
  capabilities?: Partial<RunnerCapabilitySet>;
}): LoadedLoop {
  jest.resetModules();

  if (options.concurrency !== undefined) {
    process.env["ONEUPTIME_RUNNER_CONCURRENCY"] = String(options.concurrency);
  }

  const claimNextJob: jest.Mock = jest.fn().mockResolvedValue(null);
  const executeAndReport: jest.Mock = jest.fn().mockResolvedValue(undefined);
  const resolveCapabilities: jest.Mock = jest.fn().mockReturnValue({
    canRunRunbooks: true,
    canRunCodeFixes: false,
    canRunAiCommands: false,
    ...options.capabilities,
  });

  jest.doMock("../../Services/RunnerClient", () => {
    return { __esModule: true, default: { claimNextJob: claimNextJob } };
  });
  jest.doMock("../../Services/RunbookExecutor", () => {
    return {
      __esModule: true,
      default: { executeAndReport: executeAndReport },
    };
  });
  jest.doMock("../../Utils/RunnerCapabilities", () => {
    return { __esModule: true, default: { resolve: resolveCapabilities } };
  });

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const startPolling: () => void = (
    require("../../Jobs/PollRunbookWork") as { default: () => void }
  ).default;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  return {
    startPolling: startPolling,
    claimNextJob: claimNextJob,
    executeAndReport: executeAndReport,
    resolveCapabilities: resolveCapabilities,
  };
}

/*
 * The loop registers its own SIGINT/SIGTERM handlers at start, one set per
 * load. Only those are removed afterwards -- jest and ts-node have handlers of
 * their own on the same signals, and removing them would take the worker's
 * cleanup with them.
 */
const SIGNALS: Array<NodeJS.Signals> = ["SIGINT", "SIGTERM"];
let handlersBefore: Record<
  string,
  Array<(...args: Array<unknown>) => void>
> = {};

beforeEach(() => {
  for (const key of ENV_VARS_UNDER_TEST) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  handlersBefore = {};
  for (const signal of SIGNALS) {
    handlersBefore[signal] = [
      ...(process.listeners(signal) as Array<
        (...args: Array<unknown>) => void
      >),
    ];
  }
  useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  for (const key of ENV_VARS_UNDER_TEST) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key] as string;
    }
  }
  jest.resetModules();
  jest.restoreAllMocks();
  for (const signal of SIGNALS) {
    const before: Array<(...args: Array<unknown>) => void> =
      handlersBefore[signal] || [];
    for (const listener of process.listeners(signal) as Array<
      (...args: Array<unknown>) => void
    >) {
      if (!before.includes(listener)) {
        process.removeListener(signal, listener);
      }
    }
  }
});

describe("the claim loop's capability gate", () => {
  test("claims nothing while the Runner may run neither runbooks nor AI commands", async () => {
    const loop: LoadedLoop = loadLoop({
      capabilities: { canRunRunbooks: false, canRunAiCommands: false },
    });

    loop.startPolling();
    await settle();

    expect(loop.resolveCapabilities).toHaveBeenCalled();
    expect(loop.claimNextJob).not.toHaveBeenCalled();
  });

  test("either capability on its own keeps the loop claiming", async () => {
    for (const capabilities of [
      { canRunRunbooks: true, canRunAiCommands: false },
      { canRunRunbooks: false, canRunAiCommands: true },
      { canRunRunbooks: true, canRunAiCommands: true },
    ]) {
      const loop: LoadedLoop = loadLoop({ capabilities: capabilities });

      loop.startPolling();
      await settle();

      expect(loop.claimNextJob).toHaveBeenCalled();
    }
  });

  test("capabilities are read again on every tick, not once at boot", async () => {
    const loop: LoadedLoop = loadLoop({
      capabilities: { canRunRunbooks: false, canRunAiCommands: false },
    });

    loop.startPolling();
    await settle();
    expect(loop.claimNextJob).not.toHaveBeenCalled();

    // The dashboard grants the capability; no restart happens.
    loop.resolveCapabilities.mockReturnValue({
      canRunRunbooks: true,
      canRunCodeFixes: false,
      canRunAiCommands: false,
    });

    jest.advanceTimersByTime(5000);
    await settle();

    expect(loop.claimNextJob).toHaveBeenCalled();
  });

  test("a revoke stops the loop claiming within a tick", async () => {
    const loop: LoadedLoop = loadLoop({});

    loop.startPolling();
    await settle();
    const callsWhileGranted: number = loop.claimNextJob.mock.calls.length;
    expect(callsWhileGranted).toBeGreaterThan(0);

    loop.resolveCapabilities.mockReturnValue({
      canRunRunbooks: false,
      canRunCodeFixes: false,
      canRunAiCommands: false,
    });

    jest.advanceTimersByTime(5000);
    await settle();

    expect(loop.claimNextJob.mock.calls.length).toBe(callsWhileGranted);
  });
});

describe("the claim loop's concurrency cap", () => {
  test("claims until the cap is full, then stops asking", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 3 });
    const running: Array<Deferred> = [defer(), defer(), defer()];
    let launched: number = 0;
    loop.claimNextJob.mockImplementation((): Promise<ClaimedJob> => {
      return Promise.resolve(buildJob(`job-${launched}`));
    });
    loop.executeAndReport.mockImplementation((): Promise<void> => {
      const deferred: Deferred = running[launched] as Deferred;
      launched++;
      return deferred.promise;
    });

    loop.startPolling();
    await settle();

    expect(loop.executeAndReport).toHaveBeenCalledTimes(3);
    // Three in flight, cap of three: the loop stops claiming.
    expect(loop.claimNextJob).toHaveBeenCalledTimes(3);
  });

  test("a finished job frees its slot for the next tick", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 1 });
    const first: Deferred = defer();
    loop.claimNextJob.mockResolvedValue(buildJob("job-1"));
    loop.executeAndReport.mockReturnValueOnce(first.promise);

    loop.startPolling();
    await settle();
    expect(loop.executeAndReport).toHaveBeenCalledTimes(1);

    // Still busy: the next tick claims nothing.
    jest.advanceTimersByTime(5000);
    await settle();
    expect(loop.executeAndReport).toHaveBeenCalledTimes(1);

    first.resolve();
    await settle();

    jest.advanceTimersByTime(5000);
    await settle();
    expect(loop.executeAndReport).toHaveBeenCalledTimes(2);
  });

  test("a job whose executor threw still frees its slot", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 1 });
    const first: Deferred = defer();
    loop.claimNextJob.mockResolvedValue(buildJob("job-1"));
    loop.executeAndReport.mockReturnValueOnce(first.promise);

    loop.startPolling();
    await settle();

    first.reject(new Error("executor crashed"));
    await settle();

    jest.advanceTimersByTime(5000);
    await settle();

    /*
     * The slot is freed in a finally, so a crash cannot leak it. Leaking one
     * would wedge a concurrency-1 Runner permanently.
     */
    expect(loop.executeAndReport).toHaveBeenCalledTimes(2);
  });

  test("an empty queue ends the tick rather than spinning", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 5 });
    loop.claimNextJob.mockResolvedValue(null);

    loop.startPolling();
    await settle();

    expect(loop.claimNextJob).toHaveBeenCalledTimes(1);
    expect(loop.executeAndReport).not.toHaveBeenCalled();
  });
});

describe("the claim loop when the server is unwell", () => {
  test("a failing claim breaks the tick instead of spinning on it", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 5 });
    loop.claimNextJob.mockRejectedValue(new Error("claim-next-job 503"));

    loop.startPolling();
    await settle();

    // One attempt, not five and not an unbounded retry.
    expect(loop.claimNextJob).toHaveBeenCalledTimes(1);
    expect(loop.executeAndReport).not.toHaveBeenCalled();
  });

  test("the next tick tries again once the server recovers", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 1 });
    loop.claimNextJob.mockRejectedValueOnce(new Error("claim-next-job 503"));

    loop.startPolling();
    await settle();
    expect(loop.executeAndReport).not.toHaveBeenCalled();

    loop.claimNextJob.mockResolvedValue(buildJob("job-1"));
    jest.advanceTimersByTime(5000);
    await settle();

    expect(loop.executeAndReport).toHaveBeenCalledTimes(1);
  });
});

describe("the claim loop's shutdown", () => {
  test("SIGTERM stops the loop claiming anything more", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 1 });
    loop.claimNextJob.mockResolvedValue(null);

    loop.startPolling();
    await settle();
    const callsBeforeShutdown: number = loop.claimNextJob.mock.calls.length;

    process.emit("SIGTERM");

    jest.advanceTimersByTime(60000);
    await settle();

    expect(loop.claimNextJob.mock.calls.length).toBe(callsBeforeShutdown);
  });

  test("SIGINT stops it too", async () => {
    const loop: LoadedLoop = loadLoop({ concurrency: 1 });
    loop.claimNextJob.mockResolvedValue(null);

    loop.startPolling();
    await settle();
    const callsBeforeShutdown: number = loop.claimNextJob.mock.calls.length;

    process.emit("SIGINT");

    jest.advanceTimersByTime(60000);
    await settle();

    expect(loop.claimNextJob.mock.calls.length).toBe(callsBeforeShutdown);
  });
});
