import QueueWorker from "../../../Server/Infrastructure/QueueWorker";
import JobDeadline, {
  JOB_DEADLINE_GRACE_MS,
} from "../../../Server/Utils/JobDeadline";
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

/*
 * Moves fake time on in steps, letting the promises each step settles run
 * before the next (Jest 28 has no advanceTimersByTimeAsync).
 */
async function advanceTimers(ms: number, stepMs: number = 50): Promise<void> {
  for (let elapsed: number = 0; elapsed < ms; elapsed += stepMs) {
    jest.advanceTimersByTime(Math.min(stepMs, ms - elapsed));

    for (let tick: number = 0; tick < 10; tick++) {
      await Promise.resolve();
    }
  }
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

  it("rejects a job still going at the end of the grace with the existing timeout error", async () => {
    const job: DeferredJob = deferredJob();
    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return job.promise;
    });
    const rejection: Promise<void> = expect(result).rejects.toEqual(
      new TimeoutException("Job Timeout"),
    );
    jest.advanceTimersByTime(100 + JOB_DEADLINE_GRACE_MS);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
    // The timeout is a deadline, not cancellation of the underlying work.
    job.resolve();
    await job.promise;
  });

  it("observes a job rejection after its grace without an unhandled rejection", async () => {
    const job: DeferredJob = deferredJob();
    const result: Promise<void> = QueueWorker.runJobWithTimeout(10, () => {
      return job.promise;
    });
    const rejection: Promise<void> =
      expect(result).rejects.toBeInstanceOf(TimeoutException);
    jest.advanceTimersByTime(10 + JOB_DEADLINE_GRACE_MS);
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
    jest.advanceTimersByTime(200 + JOB_DEADLINE_GRACE_MS);
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

  it("records a job that finishes the moment its time limit runs out as finished", async () => {
    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100);
      });
    });
    jest.advanceTimersByTime(100);
    await expect(result).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("fails a job that finishes a moment after its grace ends", async () => {
    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100 + JOB_DEADLINE_GRACE_MS + 1);
      });
    });
    const rejection: Promise<void> =
      expect(result).rejects.toBeInstanceOf(TimeoutException);
    jest.advanceTimersByTime(100 + JOB_DEADLINE_GRACE_MS);
    await rejection;
    // Only the job's own timer is left: it runs on, only failed.
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1);
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

/*
 * The time limit used to only fail the job: its loops went on reading and
 * writing beside the job's next run. Now the job is handed its deadline,
 * which passes when the limit runs out, and a job that checks it stops.
 */
describe("QueueWorker.runJobWithTimeout deadline", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("hands the job a deadline that ends at the time limit", async () => {
    jest.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
    let seen: JobDeadline | null = null;

    await QueueWorker.runJobWithTimeout(
      300_000,
      async (deadline: JobDeadline) => {
        seen = deadline;
      },
    );

    expect(seen).not.toBeNull();
    expect(seen!.endsAt?.toISOString()).toBe("2026-11-14T10:05:00.000Z");
    // A job that finished in time never saw its deadline pass.
    expect(seen!.hasPassed()).toBe(false);
  });

  it("passes the deadline with the timeout error when the limit runs out, and fails the job with it after the grace", async () => {
    const job: DeferredJob = deferredJob();
    let seen: JobDeadline | null = null;
    let isSettled: boolean = false;

    const result: Promise<void> = QueueWorker.runJobWithTimeout(
      100,
      (deadline: JobDeadline) => {
        seen = deadline;
        return job.promise;
      },
    );
    result.catch(() => {
      isSettled = true;
    });
    const rejection: Promise<void> =
      expect(result).rejects.toBeInstanceOf(TimeoutException);

    expect(seen!.hasPassed()).toBe(false);
    await advanceTimers(100);

    // The deadline passes at the limit; the job is not failed for it yet.
    expect(seen!.hasPassed()).toBe(true);
    expect(seen!.signal.aborted).toBe(true);
    expect(seen!.getReason()).toBeInstanceOf(TimeoutException);
    expect(isSettled).toBe(false);

    await advanceTimers(JOB_DEADLINE_GRACE_MS, 1_000);
    await rejection;

    // The job is failed with the same error its deadline passed with.
    await expect(result).rejects.toBe(seen!.getReason());
    job.resolve();
  });

  it("stops a job that loops at its next check once the limit runs out, and records it as finished", async () => {
    let pagesRead: number = 0;
    let stoppedBecause: Error | null = null;

    const looping: Promise<void> = QueueWorker.runJobWithTimeout(
      1_000,
      async (deadline: JobDeadline): Promise<void> => {
        // One page every 300 ms, for ever, unless the deadline stops it.
        while (!deadline.hasPassed()) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 300);
          });
          pagesRead++;
        }

        stoppedBecause = deadline.getReason();
      },
    );

    await advanceTimers(1_000);

    // Pages at 300, 600 and 900 ms; the one in flight at 1,000 ms finishes.
    await advanceTimers(200);
    await expect(looping).resolves.toBeUndefined();
    expect(pagesRead).toBe(4);
    expect(stoppedBecause).toBeInstanceOf(TimeoutException);

    // And it reads nothing more after that, and holds no timer.
    await advanceTimers(5_000);
    expect(pagesRead).toBe(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("gives every job its own deadline", async () => {
    const first: DeferredJob = deferredJob();
    const deadlines: Array<JobDeadline> = [];

    const firstResult: Promise<void> = QueueWorker.runJobWithTimeout(
      100,
      (deadline: JobDeadline) => {
        deadlines.push(deadline);
        return first.promise;
      },
    );
    const firstRejection: Promise<void> =
      expect(firstResult).rejects.toBeInstanceOf(TimeoutException);

    await QueueWorker.runJobWithTimeout(500, async (deadline: JobDeadline) => {
      deadlines.push(deadline);
    });

    jest.advanceTimersByTime(100);

    expect(deadlines[0]!.hasPassed()).toBe(true);
    expect(deadlines[1]!.hasPassed()).toBe(false);

    jest.advanceTimersByTime(JOB_DEADLINE_GRACE_MS);
    await firstRejection;
    first.resolve();
  });
});

/*
 * A run that stops at its deadline used to be failed in the same instant
 * ("Job Timeout"), so a job working through a backlog over several runs -
 * the owner notification jobs, CheckStalePolls, ProcessAutoImportRules -
 * read as a failing job every run (OneUptime issue #11017). Now a job has
 * JOB_DEADLINE_GRACE_MS past its limit to finish what is in flight, and is
 * recorded as it settles; only a job still going after that is failed.
 */
describe("QueueWorker.runJobWithTimeout grace after the deadline", () => {
  const FIVE_MINUTES: number = 5 * 60 * 1000;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("is thirty seconds", () => {
    expect(JOB_DEADLINE_GRACE_MS).toBe(30 * 1000);
  });

  it("records a backlog run that stops at its deadline as finished, not as a timeout", async () => {
    // A page of owners told every 10 s; far more pages than one run reaches.
    const backlogPages: number = 1_000;
    let pagesTold: number = 0;
    let stoppedAtDeadline: boolean = false;

    const run: Promise<void> = QueueWorker.runJobWithTimeout(
      FIVE_MINUTES,
      async (deadline: JobDeadline): Promise<void> => {
        while (pagesTold < backlogPages) {
          if (deadline.hasPassed()) {
            stoppedAtDeadline = true;
            return;
          }

          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 10_000);
          });
          pagesTold++;
        }
      },
    );

    await advanceTimers(FIVE_MINUTES, 1_000);
    await advanceTimers(10_000, 1_000);

    await expect(run).resolves.toBeUndefined();
    expect(stoppedAtDeadline).toBe(true);
    // 30 pages in five minutes; the next run carries on with the rest.
    expect(pagesTold).toBe(30);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("records a job that returns a moment before its grace ends as finished", async () => {
    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100 + JOB_DEADLINE_GRACE_MS - 1);
      });
    });

    jest.advanceTimersByTime(100 + JOB_DEADLINE_GRACE_MS - 1);
    await expect(result).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("fails a job whose page in flight outlasts the grace, with the deadline's reason", async () => {
    let seen: JobDeadline | null = null;

    // One page takes two minutes: the one in flight at the limit overruns.
    const run: Promise<void> = QueueWorker.runJobWithTimeout(
      FIVE_MINUTES,
      async (deadline: JobDeadline): Promise<void> => {
        seen = deadline;

        while (!deadline.hasPassed()) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 2 * 60 * 1000);
          });
        }
      },
    );
    const rejection: Promise<void> = expect(run).rejects.toEqual(
      new TimeoutException("Job Timeout"),
    );

    await advanceTimers(FIVE_MINUTES + JOB_DEADLINE_GRACE_MS, 1_000);
    await rejection;
    await expect(run).rejects.toBe(seen!.getReason());

    // The page in flight still finishes, and the loop stops there.
    await advanceTimers(60_000, 1_000);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("fails a job that throws during the grace with its own error", async () => {
    const failure: Error = new Error("the page could not be written");

    const run: Promise<void> = QueueWorker.runJobWithTimeout(
      100,
      async (deadline: JobDeadline): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          deadline.onPassed(() => {
            setTimeout(resolve, 1_000);
          });
        });

        throw failure;
      },
    );

    await advanceTimers(100 + 1_000);
    await expect(run).rejects.toBe(failure);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("holds one timer at a time: the deadline's, then the grace's", async () => {
    const job: DeferredJob = deferredJob();

    const result: Promise<void> = QueueWorker.runJobWithTimeout(100, () => {
      return job.promise;
    });

    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(100);
    // The deadline's timer fired; the grace's waits in its place.
    expect(jest.getTimerCount()).toBe(1);

    job.resolve();
    await expect(result).resolves.toBeUndefined();
    // A job that settles in its grace leaves no timer behind.
    expect(jest.getTimerCount()).toBe(0);
  });

  it("still fails a job that hangs after its deadline was ended early, at the limit and the grace", async () => {
    const job: DeferredJob = deferredJob();
    let seen: JobDeadline | null = null;
    let isSettled: boolean = false;

    const result: Promise<void> = QueueWorker.runJobWithTimeout(
      1_000,
      (deadline: JobDeadline) => {
        seen = deadline;
        return job.promise;
      },
    );
    result.catch(() => {
      isSettled = true;
    });
    const rejection: Promise<void> = expect(result).rejects.toEqual(
      new TimeoutException("Job Timeout"),
    );

    // Whoever runs the job ends it early: a cron run whose lock lapsed.
    const lockLapsed: Error = new Error("its lock lapsed");
    seen!.end(lockLapsed);

    await advanceTimers(1_000 + JOB_DEADLINE_GRACE_MS - 1_000, 1_000);
    expect(isSettled).toBe(false);

    await advanceTimers(1_000);
    await rejection;
    // The first reason the deadline passed with stands.
    expect(seen!.getReason()).toBe(lockLapsed);
    job.resolve();
  });

  it("records a job that returns after its deadline was ended early as finished", async () => {
    const result: Promise<void> = QueueWorker.runJobWithTimeout(
      FIVE_MINUTES,
      async (deadline: JobDeadline): Promise<void> => {
        deadline.end(new Error("its lock lapsed"));

        while (!deadline.hasPassed()) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 1_000);
          });
        }
      },
    );

    await expect(result).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([0, 1, 60_000])(
    "gives a %i ms time limit the same grace",
    async (limit: number) => {
      const job: DeferredJob = deferredJob();
      let isSettled: boolean = false;

      const result: Promise<void> = QueueWorker.runJobWithTimeout(limit, () => {
        return job.promise;
      });
      result.catch(() => {
        isSettled = true;
      });
      const rejection: Promise<void> =
        expect(result).rejects.toBeInstanceOf(TimeoutException);

      await advanceTimers(limit + JOB_DEADLINE_GRACE_MS - 1, 1_000);
      expect(isSettled).toBe(false);

      await advanceTimers(1);
      await rejection;
      job.resolve();
    },
  );
});
