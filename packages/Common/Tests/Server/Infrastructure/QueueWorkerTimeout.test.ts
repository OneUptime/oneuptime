import QueueWorker from "../../../Server/Infrastructure/QueueWorker";
import TimeoutException from "../../../Types/Exception/TimeoutException";

jest.mock("../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Infrastructure/Redis", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Utils/GracefulShutdown", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Utils/Logger", () => {
  return { __esModule: true, default: {} };
});

interface DeferredJob {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function deferredJob(): DeferredJob {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise: Promise<void> = new Promise<void>(
    (res: () => void, rej: (reason: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

describe("QueueWorker.runJobWithTimeout timer lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each([0, 1, 300_000, 3_600_000])(
    "releases a %i ms deadline immediately when the job succeeds",
    async (deadline: number) => {
      const callback: jest.Mock = jest.fn().mockResolvedValue(undefined);
      await expect(
        QueueWorker.runJobWithTimeout(deadline, callback),
      ).resolves.toBeUndefined();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it.each([new Error("failed"), "non-error rejection", null])(
    "preserves rejection identity and clears the deadline (%p)",
    async (error: unknown) => {
      await expect(
        QueueWorker.runJobWithTimeout(300_000, () => {
          return Promise.reject(error);
        }),
      ).rejects.toBe(error);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("clears the timer when the callback throws before returning a promise", async () => {
    const error: Error = new Error("synchronous failure");
    await expect(
      QueueWorker.runJobWithTimeout(300_000, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("holds a deadline only while a job is pending", async () => {
    const job: DeferredJob = deferredJob();
    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return job.promise;
    });
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(99);
    job.resolve();
    await result;
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(1);
    await expect(result).resolves.toBeUndefined();
  });

  it("rejects at the deadline with the existing timeout error", async () => {
    const job: DeferredJob = deferredJob();
    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return job.promise;
    });
    const rejection: Promise<void> = expect(result).rejects.toEqual(
      new TimeoutException("Job Timeout"),
    );
    jest.advanceTimersByTime(100);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
    // The timeout is a deadline, not cancellation of the underlying work.
    job.resolve();
    await job.promise;
  });

  it("observes a job rejection after its deadline without an unhandled rejection", async () => {
    const job: DeferredJob = deferredJob();
    const result: Promise<void> = QueueWorker.runJobWithTimeout(10, () => {
      return job.promise;
    });
    const rejection: Promise<void> =
      expect(result).rejects.toBeInstanceOf(TimeoutException);
    jest.advanceTimersByTime(10);
    await rejection;
    job.reject(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("keeps another concurrent job's deadline active", async () => {
    const first: DeferredJob = deferredJob();
    const second: DeferredJob = deferredJob();
    const firstResult: Promise<void> = QueueWorker.runJobWithTimeout(
      100,
      () => {
        return first.promise;
      },
    );
    const secondResult: Promise<void> = QueueWorker.runJobWithTimeout(
      200,
      () => {
        return second.promise;
      },
    );
    const secondRejection: Promise<void> =
      expect(secondResult).rejects.toBeInstanceOf(TimeoutException);

    first.resolve();
    await firstResult;
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(200);
    await secondRejection;
    expect(jest.getTimerCount()).toBe(0);
    second.resolve();
  });

  it("does not clear timers created by the job itself", async () => {
    const jobTimer: jest.Mock = jest.fn();
    await QueueWorker.runJobWithTimeout(100, async () => {
      setTimeout(jobTimer, 200);
    });
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(200);
    expect(jobTimer).toHaveBeenCalledTimes(1);
  });

  it("keeps the original deadline-first ordering for equal-time completion", async () => {
    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100);
      });
    });
    const rejection: Promise<void> =
      expect(result).rejects.toBeInstanceOf(TimeoutException);
    jest.advanceTimersByTime(100);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not accumulate timeout handles across 10,000 completed jobs", async () => {
    for (let batch: number = 0; batch < 100; batch++) {
      const jobs: Array<Promise<void>> = Array.from(
        { length: 100 },
        (_value: unknown, index: number): Promise<void> => {
          return QueueWorker.runJobWithTimeout(300_000, async () => {
            if (index % 2 === 0) {
              throw new Error("expected job failure");
            }
          }).catch(() => {
            // Failed jobs must release their timers too.
          });
        },
      );
      await Promise.all(jobs);
      expect(jest.getTimerCount()).toBe(0);
    }
  });
});
