import { QueueJob, QueueName } from "../../../Server/Infrastructure/Queue";
import UnknownQueueJob from "../../../Server/Infrastructure/UnknownQueueJob";
import logger from "../../../Server/Utils/Logger";

/*
 * A job this process has nothing to run with goes back to its queue for a
 * worker that can run it (issue #5546), and fails, once and saying why, only
 * when nobody has run it for half an hour.
 *
 * BullMQ is the shared test stand-in (Tests/__mocks__/bullmq.js): its
 * DelayedError and UnrecoverableError are named as BullMQ names them, which
 * is how BullMQ and QueueWorker recognise them. That a hand-back really
 * leaves the job delayed and uses none of its attempts is shown against a
 * real Valkey in App's UnknownWorkerJobValkey suite.
 */

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    AppVersion: "14.0.97",
  };
});

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const QUEUED_AT: number = Date.UTC(2026, 10, 2, 9, 7, 26, 535);

type FakeJob = QueueJob & { moveToDelayed: jest.Mock };

function job(overrides: Partial<Record<string, unknown>> = {}): FakeJob {
  return {
    id: "job-1",
    name: "SecurityHunts:RunProjectHunts",
    data: { projectId: "p" },
    timestamp: QUEUED_AT,
    opts: {},
    token: undefined,
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FakeJob;
}

// `token` null: the worker hands handBack no lock.
async function handBack(
  queued: FakeJob,
  now: number,
  token: string | null = "lock-token",
): Promise<Error> {
  try {
    await UnknownQueueJob.handBack({
      job: queued,
      token: token ?? undefined,
      queueName: QueueName.Worker,
      what: `a job named "${queued.name}"`,
      now,
    });
  } catch (error) {
    return error as Error;
  }

  throw new Error("handBack returned instead of throwing");
}

type Internals = { lastWarnedAt: Map<string, number> };

beforeEach(() => {
  (UnknownQueueJob as unknown as Internals).lastWarnedAt.clear();
  jest.mocked(logger.warn).mockClear();
});

describe("UnknownQueueJob.handBack", () => {
  test("moves the job back to its queue with the worker's lock, and says so with DelayedError", async () => {
    const queued: FakeJob = job();

    const error: Error = await handBack(queued, QUEUED_AT);

    expect(error.name).toBe("DelayedError");
    expect(queued.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(queued.moveToDelayed).toHaveBeenCalledWith(
      QUEUED_AT + 5 * SECOND,
      "lock-token",
    );
  });

  test("uses the lock BullMQ left on the job when it is not handed one", async () => {
    const queued: FakeJob = job({ token: "token-on-the-job" });

    await handBack(queued, QUEUED_AT, null);

    expect(queued.moveToDelayed).toHaveBeenCalledWith(
      QUEUED_AT + 5 * SECOND,
      "token-on-the-job",
    );
  });

  test("waits longer each time the job comes back, up to a minute", async () => {
    const waits: Array<number> = [];

    for (const waited of [0, 3, 5, 12, 40, 59, 61, 600, 29 * 60]) {
      const queued: FakeJob = job();
      await handBack(queued, QUEUED_AT + waited * SECOND);
      waits.push(
        (queued.moveToDelayed.mock.calls[0]![0] as number) -
          (QUEUED_AT + waited * SECOND),
      );
    }

    expect(waits).toEqual([
      5 * SECOND,
      5 * SECOND,
      5 * SECOND,
      12 * SECOND,
      40 * SECOND,
      59 * SECOND,
      MINUTE,
      MINUTE,
      MINUTE,
    ]);
  });

  test("fails the job once nobody has run it for thirty minutes, saying why", async () => {
    const queued: FakeJob = job();

    const error: Error = await handBack(queued, QUEUED_AT + 30 * MINUTE);

    expect(error.name).toBe("UnrecoverableError");
    expect(error.message).toContain(
      'No worker ran a job named "SecurityHunts:RunProjectHunts" within 30 minutes',
    );
    expect(error.message).toContain("This worker runs OneUptime 14.0.97");
    expect(error.message).toContain(
      "a server running another release of OneUptime queued it",
    );
    expect(error.message).toContain(
      "Run the same release of OneUptime on every server (app and worker).",
    );
    expect(queued.moveToDelayed).not.toHaveBeenCalled();
  });

  test("still hands the job back a moment before the thirty minutes are up", async () => {
    const queued: FakeJob = job();

    const error: Error = await handBack(queued, QUEUED_AT + 30 * MINUTE - 1);

    expect(error.name).toBe("DelayedError");
  });

  test("counts from when a job queued with a delay fell due, not from when it was queued", async () => {
    // Queued at 09:07 to run two hours later; due at 11:07.
    const queued: FakeJob = job({ opts: { delay: 2 * 60 * MINUTE } });

    const error: Error = await handBack(
      queued,
      QUEUED_AT + 2 * 60 * MINUTE + 10 * SECOND,
    );

    expect(error.name).toBe("DelayedError");
    expect(queued.moveToDelayed).toHaveBeenCalledWith(
      QUEUED_AT + 2 * 60 * MINUTE + 20 * SECOND,
      "lock-token",
    );
  });

  test("fails the job when there is no lock to move it with", async () => {
    const queued: FakeJob = job();

    const error: Error = await handBack(queued, QUEUED_AT, null);

    expect(error.name).toBe("UnrecoverableError");
    expect(queued.moveToDelayed).not.toHaveBeenCalled();
  });

  test("warns once per name every fifteen minutes, naming the queue and the release", async () => {
    await handBack(job(), QUEUED_AT);
    await handBack(job(), QUEUED_AT + 14 * MINUTE);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Handed a job named "SecurityHunts:RunProjectHunts" back to the Worker queue for a worker that can run it.',
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("This worker runs OneUptime 14.0.97"),
    );

    await handBack(job(), QUEUED_AT + 15 * MINUTE);
    expect(logger.warn).toHaveBeenCalledTimes(2);

    await handBack(job({ name: "Another:Job" }), QUEUED_AT + 15 * MINUTE);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });
});

describe("UnknownQueueJob.getDueAt", () => {
  test("is when the job was queued, plus the delay it was queued with", () => {
    expect(UnknownQueueJob.getDueAt(job())).toBe(QUEUED_AT);
    expect(UnknownQueueJob.getDueAt(job({ opts: { delay: 33465 } }))).toBe(
      QUEUED_AT + 33465,
    );
  });

  test("ignores what a hand-back changes: the job's own delay", () => {
    expect(UnknownQueueJob.getDueAt(job({ delay: 60 * SECOND }))).toBe(
      QUEUED_AT,
    );
  });

  test("reads a job with no timestamp or options as due long ago", () => {
    expect(
      UnknownQueueJob.getDueAt(job({ timestamp: undefined, opts: undefined })),
    ).toBe(0);
    expect(
      UnknownQueueJob.getDueAt(job({ opts: { delay: -5 * SECOND } })),
    ).toBe(QUEUED_AT);
  });
});

describe("UnknownQueueJob.describeRelease", () => {
  test("names a release by its version", () => {
    expect(UnknownQueueJob.describeRelease("14.0.99")).toBe(
      "OneUptime 14.0.99",
    );
    expect(UnknownQueueJob.describeRelease(" 14.0.99 ")).toBe(
      "OneUptime 14.0.99",
    );
  });

  test("says so when a release does not say its version", () => {
    for (const release of [null, undefined, "", "   ", "unknown"]) {
      expect(UnknownQueueJob.describeRelease(release)).toBe(
        "a release of OneUptime that does not say its version",
      );
    }
  });

  test("describes this process's own release", () => {
    expect(UnknownQueueJob.describeThisRelease()).toBe("OneUptime 14.0.97");
  });
});
