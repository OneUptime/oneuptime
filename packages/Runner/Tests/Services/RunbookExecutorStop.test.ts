/*
 * ---------------------------------------------------------------------------
 * What the Runner does when a job's heartbeat says to stop.
 *
 * The server answers a job heartbeat { status: "ok", stop: true, reason }
 * once the project turned Enable AI off after this Runner claimed an AI
 * command (RunnerIngress.heartbeatJob). It never says so for a runbook's own
 * step or for Test access. The answer still renews the lease. So:
 *
 *  - a step the Runner was told to stop before it started - by the
 *    heartbeat it sends right before the step, or by one before it - never
 *    starts, and its result says why, with no exit code and no output (how
 *    the server reads "did not run");
 *  - a step that is already running is left to finish, and its result is
 *    reported as it would have been;
 *  - the lease is renewed all the same, so the result can still be
 *    delivered, retries included;
 *  - a job nothing asks to stop runs as before.
 *
 * Every case drives Executor.executeAndReport with AgentClient and the step
 * executors module-mocked; AgentClient.jobHeartbeat's onStop is called the
 * way the real client calls it, before it resolves.
 * ---------------------------------------------------------------------------
 */

import type { EventEmitter as NodeEventEmitter } from "events";

jest.mock("../../Services/RunnerClient", () => {
  // The real module for its error class; only the two calls are replaced.
  const actual: Record<string, unknown> = jest.requireActual(
    "../../Services/RunnerClient",
  );

  return {
    ...actual,
    __esModule: true,
    default: {
      submitJobResult: jest.fn(),
      jobHeartbeat: jest.fn(),
    },
  };
});

jest.mock("../../Services/KubectlExecutor", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

/*
 * bash is spawned for an AI-composed Bash command; the fake child prints a
 * line and exits 0 on the next turn of the event loop.
 */
jest.mock("child_process", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  class MockChildProcess extends EventEmitter {
    public stdout: NodeEventEmitter = new EventEmitter();
    public stderr: NodeEventEmitter = new EventEmitter();
  }

  return {
    __esModule: true,
    spawn: jest.fn((): MockChildProcess => {
      const child: MockChildProcess = new MockChildProcess();
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("restarted"));
        (child as unknown as NodeEventEmitter).emit("close", 0, null);
      });
      return child;
    }),
  };
});

import Executor, {
  JOB_LEASE_MS,
  NOT_RUN_STOPPED_MESSAGE,
} from "../../Services/RunbookExecutor";
import AgentClient, {
  ClaimedJob,
  RunnerIngestUnavailableError,
} from "../../Services/RunnerClient";
import KubectlExecutor from "../../Services/KubectlExecutor";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import { JOB_HEARTBEAT_INTERVAL_MS } from "../../Config";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import { spawn } from "child_process";

const submitJobResult: jest.Mock = AgentClient.submitJobResult as jest.Mock;
const jobHeartbeat: jest.Mock = AgentClient.jobHeartbeat as jest.Mock;
const kubectlExecute: jest.Mock = KubectlExecutor.execute as jest.Mock;
const spawnMock: jest.Mock = spawn as unknown as jest.Mock;
const loggerWarn: jest.Mock = logger.warn as jest.Mock;

const REASON: string =
  "OneUptime AI was turned off for this project (Enable AI) while its agent held this command.";

// What a kubectl that ran hands back.
const KUBECTL_RESULT: JSONObject = {
  success: true,
  output: "deployment.apps/web scaled",
  exitCode: 0,
};

const KUBECTL_SUBMISSION: JSONObject = { jobId: "job-1", ...KUBECTL_RESULT };

const NOT_RUN_SUBMISSION: JSONObject = {
  jobId: "job-1",
  success: false,
  output: "",
  errorMessage: `${NOT_RUN_STOPPED_MESSAGE}: ${REASON}`,
};

interface HeartbeatOptions {
  timeoutInMs?: number | undefined;
  onStop?: ((reason: string) => void) | undefined;
}

type HeartbeatAnswer = (
  jobId: string,
  options?: HeartbeatOptions,
) => Promise<boolean>;

// A renewal, as the real client reads { status: "ok" }.
const renews: HeartbeatAnswer = (): Promise<boolean> => {
  return Promise.resolve(true);
};

// A renewal that says to stop: onStop first, as the real client does.
const saysStop: HeartbeatAnswer = (
  _jobId: string,
  options?: HeartbeatOptions,
): Promise<boolean> => {
  options?.onStop?.(REASON);
  return Promise.resolve(true);
};

function kubectlJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-1",
    origin: "AiRemediation",
    stepId: "ai-remediation-kubectl-1",
    stepType: "Kubectl",
    script: "",
    timeoutInMs: 60_000,
    payload: {
      args: ["scale", "deployment/web", "--replicas=3", "-n", "web"],
      displayCommand: "kubectl scale deployment/web --replicas=3 -n web",
      tier: "Write",
    },
    ...overrides,
  };
}

// An AI fix's Bash command on a project's own Runner.
function bashCommandJob(): ClaimedJob {
  return {
    jobId: "job-1",
    origin: "AiRemediation",
    stepId: "ai-remediation-bash-1",
    stepType: "Bash",
    script: "systemctl restart nginx",
    timeoutInMs: 60_000,
  };
}

function submissions(): Array<JSONObject> {
  return submitJobResult.mock.calls.map((call: Array<unknown>) => {
    return call[0] as JSONObject;
  });
}

function warnings(): Array<string> {
  return loggerWarn.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

function nextImmediate(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await nextImmediate();
  }
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await flush();
}

/*
 * Fake time in small steps until the run is done (or `limitMs` passes), so
 * the lease's interval stops when the run does, as it would in real time.
 */
async function advanceUntilDone(
  run: Promise<void>,
  limitMs: number,
): Promise<void> {
  let isDone: boolean = false;
  void run.then((): void => {
    isDone = true;
  });

  await flush();
  for (let elapsed: number = 0; !isDone && elapsed < limitMs; ) {
    await advance(250);
    elapsed += 250;
  }

  await run;
}

function useFakeTimers(): void {
  // As in RunbookExecutorResultDelivery: the real setImmediate flushes.
  (
    jest.useFakeTimers as unknown as (config: {
      doNotFake: Array<string>;
    }) => void
  )({ doNotFake: ["nextTick", "setImmediate", "performance"] });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolveFn: (value: T) => void = (): void => {
    return undefined;
  };
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

// A kubectl step that takes `ms` of (fake) time and then hands back `result`.
function kubectlTakes(ms: number, result: JSONObject): void {
  kubectlExecute.mockImplementation((): Promise<JSONObject> => {
    return new Promise<JSONObject>((resolve: (v: JSONObject) => void) => {
      setTimeout(() => {
        resolve(result);
      }, ms);
    });
  });
}

beforeEach(() => {
  submitJobResult.mockReset();
  submitJobResult.mockResolvedValue(true);
  jobHeartbeat.mockReset();
  jobHeartbeat.mockImplementation(renews);
  kubectlExecute.mockReset();
  kubectlExecute.mockResolvedValue(KUBECTL_RESULT);
  spawnMock.mockClear();
  loggerWarn.mockClear();
  jest.spyOn(RunnerCapabilities, "resolve").mockReturnValue({
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("told to stop before the step started", () => {
  test("by the heartbeat right before it: kubectl never runs, and the result says why", async () => {
    jobHeartbeat.mockImplementationOnce(saysStop);

    await Executor.executeAndReport(kubectlJob());

    expect(jobHeartbeat).toHaveBeenCalledTimes(1);
    expect(kubectlExecute).not.toHaveBeenCalled();
    // No exit code and no output: how the server reads "did not run".
    expect(submissions()).toEqual([NOT_RUN_SUBMISSION]);
    expect(submissions()[0]).not.toHaveProperty("exitCode");
    expect(NOT_RUN_STOPPED_MESSAGE).toBe(
      "The Runner did not run this step: when it was about to start it, OneUptime said to stop",
    );
    expect(
      warnings().some((warning: string): boolean => {
        return warning.includes("before its step started");
      }),
    ).toBe(true);
  });

  test("an AI fix's Bash command is held the same way: bash never starts", async () => {
    jobHeartbeat.mockImplementationOnce(saysStop);

    await Executor.executeAndReport(bashCommandJob());

    expect(spawnMock).not.toHaveBeenCalled();
    expect(submissions()).toEqual([NOT_RUN_SUBMISSION]);
  });

  test("by a background heartbeat while the one before the step was still out", async () => {
    useFakeTimers();
    const preSpawn: Deferred<boolean> = deferred<boolean>();
    jobHeartbeat
      .mockImplementationOnce((): Promise<boolean> => {
        return preSpawn.promise;
      })
      .mockImplementation(saysStop);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();

    // The lease's own heartbeat goes out, and says to stop ...
    await advance(JOB_HEARTBEAT_INTERVAL_MS);
    expect(jobHeartbeat).toHaveBeenCalledTimes(2);

    // ... then the slow one answers, saying nothing of a stop.
    preSpawn.resolve(true);
    await flush();
    await run;

    expect(kubectlExecute).not.toHaveBeenCalled();
    expect(submissions()).toEqual([NOT_RUN_SUBMISSION]);
  });
});

describe("told to stop while the step runs", () => {
  test("it is left to finish, its lease is still renewed, and its result is reported", async () => {
    useFakeTimers();
    jobHeartbeat.mockImplementationOnce(renews).mockImplementation(saysStop);
    kubectlTakes(JOB_HEARTBEAT_INTERVAL_MS * 3 + 1_000, KUBECTL_RESULT);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await advanceUntilDone(run, JOB_HEARTBEAT_INTERVAL_MS * 4);

    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(submissions()).toEqual([KUBECTL_SUBMISSION]);
    // The pre-spawn heartbeat, then the lease's own three while it ran.
    expect(jobHeartbeat).toHaveBeenCalledTimes(4);
    // Said once, however many heartbeats repeat it.
    expect(
      warnings().filter((warning: string): boolean => {
        return warning.includes("left to finish");
      }),
    ).toHaveLength(1);
  });

  test("a stop still renews the lease: a step that ran past the lease it started with still gets its result retried", async () => {
    /*
     * kubectl runs past the lease the pre-spawn heartbeat confirmed. Only
     * the lease's own heartbeats - every one of which says to stop - can
     * keep it, so if a stop did not renew it, the first failed delivery
     * would not be retried.
     */
    useFakeTimers();
    jobHeartbeat.mockImplementationOnce(renews).mockImplementation(saysStop);
    kubectlTakes(JOB_LEASE_MS + 5_000, KUBECTL_RESULT);
    submitJobResult
      .mockRejectedValueOnce(
        new RunnerIngestUnavailableError({
          request: "Result for job job-1",
          statusCode: 502,
          body: { message: "Bad Gateway" },
        }),
      )
      .mockResolvedValue(true);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await advanceUntilDone(run, JOB_LEASE_MS + 10_000);

    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(submissions()).toEqual([KUBECTL_SUBMISSION, KUBECTL_SUBMISSION]);
  });

  test("a stop answered after the result is delivered changes nothing", async () => {
    useFakeTimers();
    const late: Deferred<boolean> = deferred<boolean>();
    let lateOnStop: ((reason: string) => void) | undefined;
    jobHeartbeat
      .mockImplementationOnce(renews)
      .mockImplementationOnce(
        (_jobId: string, options?: HeartbeatOptions): Promise<boolean> => {
          lateOnStop = options?.onStop;
          return late.promise;
        },
      );
    kubectlTakes(JOB_HEARTBEAT_INTERVAL_MS + 1_000, KUBECTL_RESULT);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    await advance(JOB_HEARTBEAT_INTERVAL_MS + 1_000);
    await run;

    lateOnStop?.(REASON);
    late.resolve(true);
    await flush();

    expect(submissions()).toEqual([KUBECTL_SUBMISSION]);
    expect(
      warnings().some((warning: string): boolean => {
        return warning.includes("said to stop");
      }),
    ).toBe(false);
  });
});

describe("nothing asks it to stop", () => {
  test("the step runs and reports as before", async () => {
    useFakeTimers();
    kubectlTakes(JOB_HEARTBEAT_INTERVAL_MS * 2 + 1_000, KUBECTL_RESULT);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await advanceUntilDone(run, JOB_HEARTBEAT_INTERVAL_MS * 3);

    // The pre-spawn heartbeat, then the lease's own two while it ran.
    expect(jobHeartbeat).toHaveBeenCalledTimes(3);
    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(submissions()).toEqual([KUBECTL_SUBMISSION]);
    expect(
      warnings().some((warning: string): boolean => {
        return warning.includes("said to stop");
      }),
    ).toBe(false);
  });

  test("every heartbeat offers the executor's stop hook", async () => {
    useFakeTimers();
    kubectlTakes(JOB_HEARTBEAT_INTERVAL_MS + 1_000, KUBECTL_RESULT);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    await advance(JOB_HEARTBEAT_INTERVAL_MS + 1_000);
    await run;

    expect(jobHeartbeat).toHaveBeenCalledTimes(2);
    for (const call of jobHeartbeat.mock.calls as Array<
      [string, HeartbeatOptions | undefined]
    >) {
      expect(call[0]).toBe("job-1");
      expect(typeof call[1]?.onStop).toBe("function");
    }
  });
});
