/*
 * ---------------------------------------------------------------------------
 * How the Runner tells the server a step is starting, and how it delivers
 * the step's result.
 *
 * The server reads a Failed kubectl row with no exit code and no output as
 * "kubectl never ran", and reads startedAt (written by a job's first
 * heartbeat) as "the Runner started it". So:
 *
 *  - one awaited heartbeat goes out right before a step runs (and never for
 *    a step the Runner refuses), best effort, unless the server answers that
 *    the job is no longer this Runner's, which stops the step;
 *  - a result whose POST gets no answer or a 5xx is sent again, the SAME
 *    result (exit code, output), with bounded exponential backoff while the
 *    lease is confirmed, and is never replaced by the transport error.
 *
 * Every case drives Executor.executeAndReport with AgentClient and the step
 * executors module-mocked. Timing cases use fake timers (Date included), so
 * "when" is asserted in exact milliseconds.
 * ---------------------------------------------------------------------------
 */

import type { EventEmitter as NodeEventEmitter } from "events";

jest.mock("../../Services/RunnerClient", () => {
  /*
   * The real module for its error class; only the two calls the executor
   * makes are replaced.
   */
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

jest.mock("../../Services/SSHExecutor", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock("../../Services/KubernetesExecutor", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock("../../Services/KubectlExecutor", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/VM/VMAPI", () => {
  return {
    __esModule: true,
    default: { runCodeInSandbox: jest.fn() },
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
 * bash is spawned for real steps of type Bash; the fake child prints a line
 * and exits 0 on the next turn of the event loop. spawn itself is a jest.fn
 * so its call order can be compared with the heartbeat's.
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
  NOT_RUN_LEASE_LOST_MESSAGE,
  PRE_SPAWN_HEARTBEAT_TIMEOUT_MS,
  RESULT_RETRY_BASE_DELAY_MS,
  RESULT_RETRY_MAX_DELAY_MS,
  RESULT_SUBMIT_MAX_ATTEMPTS,
  getResultRetryDelayMs,
} from "../../Services/RunbookExecutor";
import AgentClient, {
  ClaimedJob,
  RunnerIngestUnavailableError,
} from "../../Services/RunnerClient";
import SSHExecutor from "../../Services/SSHExecutor";
import KubernetesExecutor from "../../Services/KubernetesExecutor";
import KubectlExecutor from "../../Services/KubectlExecutor";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import { JOB_HEARTBEAT_INTERVAL_MS } from "../../Config";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import { spawn } from "child_process";

const submitJobResult: jest.Mock = AgentClient.submitJobResult as jest.Mock;
const jobHeartbeat: jest.Mock = AgentClient.jobHeartbeat as jest.Mock;
const kubectlExecute: jest.Mock = KubectlExecutor.execute as jest.Mock;
const sshExecute: jest.Mock = SSHExecutor.execute as jest.Mock;
const kubernetesExecute: jest.Mock = KubernetesExecutor.execute as jest.Mock;
const runCodeInSandbox: jest.Mock = VMUtil.runCodeInSandbox as jest.Mock;
const spawnMock: jest.Mock = spawn as unknown as jest.Mock;
const loggerWarn: jest.Mock = logger.warn as jest.Mock;
const loggerError: jest.Mock = logger.error as jest.Mock;

// What a kubectl that ran and was refused by the API server hands back.
const KUBECTL_RAN_RESULT: JSONObject = {
  success: false,
  output:
    'Error from server (Forbidden): deployments.apps "web" is forbidden: User "system:serviceaccount:oneuptime:agent" cannot patch resource "deployments"',
  exitCode: 1,
  errorMessage: "Exit code 1",
};

// The payload the server must receive for KUBECTL_RAN_RESULT, every time.
const KUBECTL_RAN_SUBMISSION: JSONObject = {
  jobId: "job-1",
  ...KUBECTL_RAN_RESULT,
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

function networkError(): Error {
  return Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
}

function unavailable(statusCode: number): RunnerIngestUnavailableError {
  return new RunnerIngestUnavailableError({
    request: "Result for job job-1",
    statusCode,
    body: { message: "Bad Gateway" },
  });
}

function submissions(): Array<JSONObject> {
  return submitJobResult.mock.calls.map((call: Array<unknown>) => {
    return call[0] as JSONObject;
  });
}

function loggedText(mock: jest.Mock): string {
  return mock.mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
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

function useFakeTimers(): void {
  /*
   * Jest 28 takes a config object; the installed @types/jest (27) only
   * knows the old "modern" | "legacy" argument, hence the cast. The promise
   * plumbing needs the real setImmediate to flush, and Node makes
   * globalThis.performance read-only, so neither is faked. Date is.
   */
  (
    jest.useFakeTimers as unknown as (config: {
      doNotFake: Array<string>;
    }) => void
  )({ doNotFake: ["nextTick", "setImmediate", "performance"] });
}

// A promise the test settles by hand.
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

// Record when (fake Date.now) each result POST went out.
function recordSubmitTimes(
  times: Array<number>,
  outcome: () => Promise<boolean>,
): void {
  submitJobResult.mockImplementation((): Promise<boolean> => {
    times.push(Date.now());
    return outcome();
  });
}

beforeEach(() => {
  submitJobResult.mockReset();
  submitJobResult.mockResolvedValue(true);
  jobHeartbeat.mockReset();
  jobHeartbeat.mockResolvedValue(true);
  kubectlExecute.mockReset();
  kubectlExecute.mockResolvedValue(KUBECTL_RAN_RESULT);
  sshExecute.mockReset();
  kubernetesExecute.mockReset();
  runCodeInSandbox.mockReset();
  spawnMock.mockClear();
  loggerWarn.mockClear();
  loggerError.mockClear();
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

describe("the heartbeat right before a step runs", () => {
  test("goes out once, before the executor, with a short timeout; the result follows the step", async () => {
    await Executor.executeAndReport(kubectlJob());

    expect(jobHeartbeat).toHaveBeenCalledTimes(1);
    expect(jobHeartbeat).toHaveBeenCalledWith("job-1", {
      timeoutInMs: PRE_SPAWN_HEARTBEAT_TIMEOUT_MS,
    });
    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(submitJobResult).toHaveBeenCalledTimes(1);

    expect(jobHeartbeat.mock.invocationCallOrder[0]!).toBeLessThan(
      kubectlExecute.mock.invocationCallOrder[0]!,
    );
    expect(kubectlExecute.mock.invocationCallOrder[0]!).toBeLessThan(
      submitJobResult.mock.invocationCallOrder[0]!,
    );
    expect(PRE_SPAWN_HEARTBEAT_TIMEOUT_MS).toBeLessThan(
      JOB_HEARTBEAT_INTERVAL_MS,
    );
  });

  test("is awaited: the step does not start until the server has answered", async () => {
    const answer: Deferred<boolean> = deferred<boolean>();
    jobHeartbeat.mockReturnValueOnce(answer.promise);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();

    expect(jobHeartbeat).toHaveBeenCalledTimes(1);
    expect(kubectlExecute).not.toHaveBeenCalled();

    answer.resolve(true);
    await run;

    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(submissions()).toEqual([KUBECTL_RAN_SUBMISSION]);
  });

  const STEP_CASES: Array<[string, ClaimedJob, () => jest.Mock]> = [
    [
      "Kubectl",
      kubectlJob(),
      (): jest.Mock => {
        return kubectlExecute;
      },
    ],
    [
      "SSH",
      kubectlJob({
        origin: "Runbook",
        stepType: "SSH",
        payload: { command: "systemctl restart nginx" },
        credential: { credentialType: "SSH" },
      }),
      (): jest.Mock => {
        return sshExecute;
      },
    ],
    [
      "Kubernetes",
      kubectlJob({
        origin: "Runbook",
        stepType: "Kubernetes",
        payload: { action: "restart" },
        credential: { credentialType: "Kubernetes" },
      }),
      (): jest.Mock => {
        return kubernetesExecute;
      },
    ],
    [
      "JavaScript",
      kubectlJob({
        origin: "Runbook",
        stepType: "JavaScript",
        script: "return 1;",
        payload: undefined,
      }),
      (): jest.Mock => {
        return runCodeInSandbox;
      },
    ],
    [
      "Bash",
      kubectlJob({
        origin: "Runbook",
        stepType: "Bash",
        script: "systemctl restart nginx",
        payload: undefined,
      }),
      (): jest.Mock => {
        return spawnMock;
      },
    ],
  ];

  test.each(STEP_CASES)(
    "comes before a %s step starts",
    async (_stepType: string, job: ClaimedJob, executor: () => jest.Mock) => {
      sshExecute.mockResolvedValue({ success: true, output: "ok" });
      kubernetesExecute.mockResolvedValue({ success: true, output: "ok" });
      runCodeInSandbox.mockResolvedValue({ logMessages: [], returnValue: 1 });

      await Executor.executeAndReport(job);

      expect(jobHeartbeat).toHaveBeenCalledTimes(1);
      expect(executor()).toHaveBeenCalledTimes(1);
      expect(jobHeartbeat.mock.invocationCallOrder[0]!).toBeLessThan(
        executor().mock.invocationCallOrder[0]!,
      );
      expect(submitJobResult).toHaveBeenCalledTimes(1);
    },
  );

  const HEARTBEAT_FAILURES: Array<[string, Error]> = [
    ["no answer at all", networkError()],
    ["a 503", unavailable(503)],
  ];

  test.each(HEARTBEAT_FAILURES)(
    "is best effort: %s from the heartbeat does not stop the step",
    async (_label: string, error: Error) => {
      jobHeartbeat.mockRejectedValueOnce(error);

      await Executor.executeAndReport(kubectlJob());

      expect(kubectlExecute).toHaveBeenCalledTimes(1);
      expect(submissions()).toEqual([KUBECTL_RAN_SUBMISSION]);
      expect(loggedText(loggerWarn)).toContain("running it anyway");
    },
  );

  test("the server's answer that the job is no longer this Runner's stops the step, and that is reported as not run", async () => {
    jobHeartbeat.mockResolvedValueOnce(false);

    await Executor.executeAndReport(kubectlJob());

    expect(kubectlExecute).not.toHaveBeenCalled();
    expect(submissions()).toEqual([
      {
        jobId: "job-1",
        success: false,
        output: "",
        errorMessage: NOT_RUN_LEASE_LOST_MESSAGE,
      },
    ]);
    // No exit code: the server reads the row as "kubectl did not run".
    expect(submissions()[0]!["exitCode"]).toBeUndefined();
  });

  test("a job the server has let go is not retried either", async () => {
    useFakeTimers();
    jobHeartbeat.mockResolvedValueOnce(false);
    submitJobResult.mockRejectedValue(networkError());

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    await advance(RESULT_RETRY_MAX_DELAY_MS * RESULT_SUBMIT_MAX_ATTEMPTS);
    await run;

    expect(kubectlExecute).not.toHaveBeenCalled();
    expect(submitJobResult).toHaveBeenCalledTimes(1);
    expect(loggedText(loggerError)).toContain("the lease on it is gone");
  });

  const REFUSED_STEPS: Array<[string, ClaimedJob]> = [
    [
      "a kubectl step without its instructions",
      kubectlJob({ payload: undefined }),
    ],
    [
      "an investigation that is not kubectl",
      kubectlJob({
        origin: "AiInvestigation",
        stepType: "Bash",
        script: "kubectl get pods",
        payload: undefined,
      }),
    ],
    [
      "an AI command on the command denylist",
      kubectlJob({
        stepType: "Bash",
        script: "rm -rf /",
        payload: undefined,
      }),
    ],
    [
      "an SSH step without its credential",
      kubectlJob({
        origin: "Runbook",
        stepType: "SSH",
        payload: { command: "uptime" },
      }),
    ],
  ];

  test.each(REFUSED_STEPS)(
    "is never sent for a step the Runner refuses: %s",
    async (_label: string, job: ClaimedJob) => {
      await Executor.executeAndReport(job);

      expect(jobHeartbeat).not.toHaveBeenCalled();
      expect(kubectlExecute).not.toHaveBeenCalled();
      expect(sshExecute).not.toHaveBeenCalled();
      expect(spawnMock).not.toHaveBeenCalled();
      expect(submitJobResult).toHaveBeenCalledTimes(1);
      expect(submissions()[0]).toMatchObject({
        jobId: "job-1",
        success: false,
        output: "",
      });
      expect(submissions()[0]!["exitCode"]).toBeUndefined();
    },
  );

  test("is not sent when the host has switched AI commands off", async () => {
    (RunnerCapabilities.resolve as jest.Mock).mockReturnValue({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });

    await Executor.executeAndReport(kubectlJob());

    expect(jobHeartbeat).not.toHaveBeenCalled();
    expect(String(submissions()[0]!["errorMessage"])).toContain(
      "does not accept AI-composed commands",
    );
  });

  test("a step that throws is reported as a failure carrying the error (no exit code: nothing says it ran)", async () => {
    kubectlExecute.mockRejectedValue(new Error("kubectl binary vanished"));

    await Executor.executeAndReport(kubectlJob());

    expect(jobHeartbeat).toHaveBeenCalledTimes(1);
    expect(submissions()).toEqual([
      {
        jobId: "job-1",
        success: false,
        output: "",
        errorMessage: "kubectl binary vanished",
      },
    ]);
  });
});

describe("delivering the result", () => {
  test("backoff doubles from the base delay and is capped", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 20].map((n: number) => {
        return getResultRetryDelayMs(n);
      }),
    ).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    expect(RESULT_RETRY_BASE_DELAY_MS).toBe(500);
    expect(RESULT_RETRY_MAX_DELAY_MS).toBe(8000);
  });

  test("a 502 is retried after the first backoff, with the same result", async () => {
    useFakeTimers();
    submitJobResult
      .mockRejectedValueOnce(unavailable(502))
      .mockResolvedValueOnce(true);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    expect(submitJobResult).toHaveBeenCalledTimes(1);

    await advance(getResultRetryDelayMs(1) - 1);
    expect(submitJobResult).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(submitJobResult).toHaveBeenCalledTimes(2);

    await run;

    expect(submissions()).toEqual([
      KUBECTL_RAN_SUBMISSION,
      KUBECTL_RAN_SUBMISSION,
    ]);
    expect(loggedText(loggerWarn)).toContain("HTTP 502");
    expect(loggedText(loggerError)).not.toContain("Could not deliver");
  });

  /*
   * The review's scenario: kubectl ran (exit code 1, a Forbidden line) and
   * the first result POST lost its connection. The old catch path posted
   * { success: false, errorMessage: "socket hang up" } instead, a row the
   * server reads as "kubectl never ran".
   */
  test("a lost connection resends the step's exit code and output, never the network error", async () => {
    useFakeTimers();
    submitJobResult
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(true);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    await advance(getResultRetryDelayMs(1));
    await advance(getResultRetryDelayMs(2));
    await run;

    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(submissions()).toEqual([
      KUBECTL_RAN_SUBMISSION,
      KUBECTL_RAN_SUBMISSION,
      KUBECTL_RAN_SUBMISSION,
    ]);

    for (const submission of submissions()) {
      expect(submission["exitCode"]).toBe(1);
      expect(String(submission["errorMessage"])).not.toContain(
        "socket hang up",
      );
    }
  });

  test("a result that lands on the first try is sent once", async () => {
    await Executor.executeAndReport(kubectlJob());

    expect(submissions()).toEqual([KUBECTL_RAN_SUBMISSION]);
    expect(loggerWarn).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  test("the server's refusal (accepted: false or a 4xx) is final and not retried", async () => {
    useFakeTimers();
    submitJobResult.mockResolvedValue(false);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    await advance(RESULT_RETRY_MAX_DELAY_MS * RESULT_SUBMIT_MAX_ATTEMPTS);
    await run;

    expect(submitJobResult).toHaveBeenCalledTimes(1);
    expect(loggedText(loggerError)).toContain(
      "The server did not store the result of job job-1",
    );
  });

  test("a refusal after a lost attempt says the lost attempt may have landed", async () => {
    useFakeTimers();
    submitJobResult
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(false);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    await advance(getResultRetryDelayMs(1));
    await run;

    expect(submitJobResult).toHaveBeenCalledTimes(2);
    expect(loggedText(loggerError)).toContain(
      "an earlier attempt that got no answer already stored it",
    );
  });

  test("retries back off exponentially and stop at the attempt cap while the lease is kept", async () => {
    useFakeTimers();
    const times: Array<number> = [];
    recordSubmitTimes(times, (): Promise<boolean> => {
      return Promise.reject(unavailable(503));
    });

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();

    // Far longer than every backoff together; the lease heartbeats succeed.
    for (let elapsed: number = 0; elapsed < 60_000; elapsed += 250) {
      await advance(250);
    }
    await run;

    expect(times).toHaveLength(RESULT_SUBMIT_MAX_ATTEMPTS);

    const offsets: Array<number> = times.map((t: number) => {
      return t - times[0]!;
    });
    expect(offsets).toEqual([0, 500, 1500, 3500, 7500, 15500]);
    expect(loggedText(loggerError)).toContain(
      `after ${RESULT_SUBMIT_MAX_ATTEMPTS} attempts`,
    );

    // The heartbeat is stopped once delivery is over.
    const heartbeatsAtEnd: number = jobHeartbeat.mock.calls.length;
    await advance(JOB_HEARTBEAT_INTERVAL_MS * 5);
    expect(jobHeartbeat.mock.calls.length).toBe(heartbeatsAtEnd);
  });

  /*
   * The step takes 25 s. The pre-spawn heartbeat is answered at t=0, so the
   * lease is confirmed until t=30 s; the result first goes out at t=25 s.
   * Retries at 25.5 s, 26.5 s and 28.5 s fit; the next (32.5 s) would not.
   * With the background heartbeats answered, the lease keeps moving and
   * every attempt is made (the negative control of the same scenario).
   */
  const LEASE_CASES: Array<[string, boolean, number]> = [
    ["unanswered, so the lease ends at 30 s", false, 4],
    ["answered, so the lease keeps moving", true, RESULT_SUBMIT_MAX_ATTEMPTS],
  ];

  test.each(LEASE_CASES)(
    "retries stop before the confirmed lease ends (background heartbeats %s)",
    async (_label: string, heartbeatsAnswered: boolean, attempts: number) => {
      useFakeTimers();
      const startedAt: number = Date.now();
      jobHeartbeat.mockResolvedValueOnce(true);
      if (heartbeatsAnswered) {
        jobHeartbeat.mockResolvedValue(true);
      } else {
        jobHeartbeat.mockRejectedValue(networkError());
      }
      kubectlTakes(25_000, KUBECTL_RAN_RESULT);
      const times: Array<number> = [];
      recordSubmitTimes(times, (): Promise<boolean> => {
        return Promise.reject(unavailable(502));
      });

      const run: Promise<void> = Executor.executeAndReport(kubectlJob());
      await flush();
      for (let elapsed: number = 0; elapsed < 90_000; elapsed += 250) {
        await advance(250);
      }
      await run;

      expect(times).toHaveLength(attempts);
      expect(times[0]! - startedAt).toBe(25_000);

      if (heartbeatsAnswered) {
        expect(loggedText(loggerError)).toContain(
          `after ${RESULT_SUBMIT_MAX_ATTEMPTS} attempts`,
        );
      } else {
        // Every attempt started inside the lease confirmed at t=0.
        expect(times[times.length - 1]! - startedAt).toBeLessThan(JOB_LEASE_MS);
        expect(loggedText(loggerError)).toContain(
          "ends before another attempt",
        );
      }
    },
  );

  test("without any confirmed heartbeat the lease is counted from when the job arrived", async () => {
    useFakeTimers();
    const startedAt: number = Date.now();
    jobHeartbeat.mockRejectedValue(networkError());
    kubectlTakes(25_000, KUBECTL_RAN_RESULT);
    const times: Array<number> = [];
    recordSubmitTimes(times, (): Promise<boolean> => {
      return Promise.reject(networkError());
    });

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    for (let elapsed: number = 0; elapsed < 60_000; elapsed += 250) {
      await advance(250);
    }
    await run;

    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(
      times.map((t: number) => {
        return t - startedAt;
      }),
    ).toEqual([25_000, 25_500, 26_500, 28_500]);
  });

  test("a background heartbeat answering that the job is gone stops the retries", async () => {
    useFakeTimers();
    jobHeartbeat.mockResolvedValueOnce(true).mockResolvedValue(false);
    kubectlTakes(JOB_HEARTBEAT_INTERVAL_MS + 5_000, KUBECTL_RAN_RESULT);
    submitJobResult.mockRejectedValue(unavailable(502));

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    for (let elapsed: number = 0; elapsed < 60_000; elapsed += 250) {
      await advance(250);
    }
    await run;

    expect(jobHeartbeat).toHaveBeenCalledTimes(2);
    expect(submitJobResult).toHaveBeenCalledTimes(1);
    expect(loggedText(loggerWarn)).toContain("is no longer this Runner's");
    expect(loggedText(loggerError)).toContain("the lease on it is gone");
  });

  test("the lease heartbeat keeps going while a result is being retried, and stops after", async () => {
    useFakeTimers();
    const startedAt: number = Date.now();
    kubectlTakes(JOB_HEARTBEAT_INTERVAL_MS - 1_000, KUBECTL_RAN_RESULT);
    const times: Array<number> = [];
    let failuresLeft: number = 3;
    recordSubmitTimes(times, (): Promise<boolean> => {
      if (failuresLeft > 0) {
        failuresLeft--;
        return Promise.reject(networkError());
      }
      return Promise.resolve(true);
    });

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    for (let elapsed: number = 0; elapsed < 30_000; elapsed += 250) {
      await advance(250);
    }
    await run;

    // Delivered on the fourth attempt, after the interval heartbeat fired.
    expect(times).toHaveLength(4);
    expect(times[3]! - startedAt).toBeGreaterThan(JOB_HEARTBEAT_INTERVAL_MS);
    expect(jobHeartbeat).toHaveBeenCalledTimes(2);
    expect(jobHeartbeat.mock.calls[1]).toEqual(["job-1"]);

    await advance(JOB_HEARTBEAT_INTERVAL_MS * 5);
    expect(jobHeartbeat).toHaveBeenCalledTimes(2);
  });

  test("a heartbeat answered after the result is delivered changes nothing", async () => {
    useFakeTimers();
    const late: Deferred<boolean> = deferred<boolean>();
    jobHeartbeat.mockResolvedValueOnce(true).mockReturnValueOnce(late.promise);
    kubectlTakes(JOB_HEARTBEAT_INTERVAL_MS + 1_000, KUBECTL_RAN_RESULT);

    const run: Promise<void> = Executor.executeAndReport(kubectlJob());
    await flush();
    await advance(JOB_HEARTBEAT_INTERVAL_MS + 1_000);
    await run;

    expect(submissions()).toEqual([KUBECTL_RAN_SUBMISSION]);

    late.resolve(false);
    await flush();

    expect(loggedText(loggerWarn)).not.toContain("is no longer this Runner's");
  });
});
