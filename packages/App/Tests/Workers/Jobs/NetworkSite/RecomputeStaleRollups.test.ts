import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * NetworkSite:RecomputeStaleRollups - the cron backstop for the network site
 * rollups no event recomputes: a device going stale changes a site's answer
 * with nothing but the passage of time.
 *
 * What is pinned here (issue #8103):
 *
 *   - ONE SWEEP AT A TIME. RunCron runs one copy of the job at a time
 *     (CronLock), and the job keeps its own Redis mutex beside that lease:
 *     the lease lapses half a minute past the time limit even while an await
 *     of the run has not returned, and two runs recomputing one site can
 *     leave two open timeline rows for one transition. Taken without
 *     queueing, released even when the sweep throws; a held lock skips the
 *     tick.
 *   - A SWEEP STOPS AT ITS DEADLINE, between sites: its time limit, or its
 *     lease lost. The sites it did not reach are still the oldest and lead
 *     the next sweep.
 *   - NEVER-ROLLED-UP SITES FIRST, and one broken site never starves the
 *     rest.
 */

type CronHandler = (deadline?: JobDeadline) => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCronOptions: Record<string, unknown> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCronOptions[jobName] = options;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      recomputeRollupForSite: jest.fn(),
    },
  };
});

// Imported for its side effect: the RunCron mock above records the handler.
import "../../../../FeatureSet/Workers/Jobs/NetworkSite/RecomputeStaleRollups";

const JOB_NAME: string = "NetworkSite:RecomputeStaleRollups";

const siteService: {
  findBy: jest.Mock;
  recomputeRollupForSite: jest.Mock;
} = NetworkSiteService as unknown as {
  findBy: jest.Mock;
  recomputeRollupForSite: jest.Mock;
};
const semaphore: { lock: jest.Mock; release: jest.Mock } =
  Semaphore as unknown as { lock: jest.Mock; release: jest.Mock };
const mockedLogger: { error: jest.Mock; debug: jest.Mock } =
  logger as unknown as { error: jest.Mock; debug: jest.Mock };

const SWEEP_MUTEX: SemaphoreMutex = {
  identifier: "network-site-rollup-sweep",
} as unknown as SemaphoreMutex;

const NEVER_ROLLED_UP_ID: string = "11111111-1111-4111-8111-111111111111";
const STALE_A_ID: string = "22222222-2222-4222-8222-222222222222";
const STALE_B_ID: string = "33333333-3333-4333-8333-333333333333";

function site(id: string): NetworkSite {
  return new NetworkSite(new ObjectID(id));
}

/*
 * The job asks two questions: the sites never rolled up first, then the
 * stalest. `answers` is [neverRolledUp, stale].
 */
function sitePages(answers: [Array<NetworkSite>, Array<NetworkSite>]): void {
  siteService.findBy
    .mockResolvedValueOnce(answers[0])
    .mockResolvedValueOnce(answers[1]);
}

function threeSites(): void {
  sitePages([[site(NEVER_ROLLED_UP_ID)], [site(STALE_A_ID), site(STALE_B_ID)]]);
}

function recomputedSiteIds(): Array<string> {
  return siteService.recomputeRollupForSite.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as ObjectID).toString();
    },
  );
}

async function runSweep(deadline?: JobDeadline): Promise<void> {
  await mockCapturedJobs[JOB_NAME]!(deadline);
}

beforeEach(() => {
  jest.clearAllMocks();
  semaphore.lock.mockResolvedValue(SWEEP_MUTEX);
  semaphore.release.mockResolvedValue(undefined);
  siteService.findBy.mockResolvedValue([]);
  siteService.recomputeRollupForSite.mockResolvedValue(undefined);
});

describe("the job is registered", () => {
  it("runs every five minutes, never on startup", () => {
    expect(typeof mockCapturedJobs[JOB_NAME]).toBe("function");
    expect(mockCronOptions[JOB_NAME]).toMatchObject({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });
});

describe("one sweep at a time", () => {
  it("takes its own sweep lock without queueing behind another, and releases it", async () => {
    threeSites();

    await runSweep(new JobDeadline());

    expect(semaphore.lock).toHaveBeenCalledTimes(1);
    expect(semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: JOB_NAME,
        namespace: "Workers.Cron",
        acquireAttemptsLimit: 1,
      }),
    );
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
    expect(siteService.recomputeRollupForSite).toHaveBeenCalledTimes(3);
  });

  /*
   * The lock outlives the job's four-minute time limit: redis-semaphore
   * refreshes it for as long as the run lasts, so a run whose await outlived
   * the limit keeps a second sweep out, which the run's lease alone does not.
   */
  it("holds its lock for longer than the job's time limit", async () => {
    await runSweep();

    const lockTimeout: number = (
      semaphore.lock.mock.calls[0]![0] as { lockTimeout: number }
    ).lockTimeout;

    expect(lockTimeout).toBeGreaterThan(4 * 60 * 1000);
  });

  it("does nothing at all when another sweep holds the lock", async () => {
    semaphore.lock.mockRejectedValue(new Error("already held"));

    await runSweep(new JobDeadline());

    expect(siteService.findBy).not.toHaveBeenCalled();
    expect(siteService.recomputeRollupForSite).not.toHaveBeenCalled();
    expect(semaphore.release).not.toHaveBeenCalled();
  });

  it("releases the lock even when the sweep throws", async () => {
    siteService.findBy.mockRejectedValue(new Error("database is on fire"));

    await expect(runSweep()).rejects.toThrow("database is on fire");

    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
  });
});

describe("which sites a sweep recomputes", () => {
  it("asks for the sites never rolled up first, then the stalest", async () => {
    threeSites();

    await runSweep();

    const [neverRolledUp, stale] = siteService.findBy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as {
          query: Record<string, unknown>;
          sort: Record<string, unknown>;
        };
      },
    );

    expect(neverRolledUp!.query["lastRollupAt"]).toBeDefined();
    expect(neverRolledUp!.sort).toEqual({ createdAt: SortOrder.Ascending });
    expect(stale!.sort).toEqual({ lastRollupAt: SortOrder.Ascending });
    expect(recomputedSiteIds()).toEqual([
      NEVER_ROLLED_UP_ID,
      STALE_A_ID,
      STALE_B_ID,
    ]);
  });

  it("keeps sweeping after one site fails", async () => {
    threeSites();
    siteService.recomputeRollupForSite
      .mockRejectedValueOnce(new Error("this site is broken"))
      .mockResolvedValue(undefined);

    await expect(runSweep()).resolves.toBeUndefined();

    expect(siteService.recomputeRollupForSite).toHaveBeenCalledTimes(3);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
  });

  it("recomputes nothing when no site is stale", async () => {
    await runSweep();

    expect(siteService.recomputeRollupForSite).not.toHaveBeenCalled();
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
  });
});

describe("a sweep stops at its deadline", () => {
  /*
   * The time limit ran out after the first site: the sweep stops before the
   * next one and releases its lock; the sites it did not reach are still the
   * oldest, so they lead the next sweep.
   */
  it("stops before the next site once the deadline has passed, and leaves the rest", async () => {
    threeSites();

    const deadline: JobDeadline = new JobDeadline();

    siteService.recomputeRollupForSite.mockImplementationOnce(
      async (): Promise<void> => {
        deadline.end();
      },
    );

    await runSweep(deadline);

    expect(recomputedSiteIds()).toEqual([NEVER_ROLLED_UP_ID]);
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
    expect(
      mockedLogger.debug.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes("the run's deadline has passed");
      }),
    ).toBe(true);
  });

  // A run whose lease was lost has its deadline ended (CronLock).
  it("stops the same way when the run's lease was lost", async () => {
    threeSites();

    const deadline: JobDeadline = new JobDeadline();

    siteService.recomputeRollupForSite.mockImplementationOnce(
      async (): Promise<void> => {
        deadline.end(new Error(`${JOB_NAME} stopped: its lock lapsed.`));
      },
    );

    await runSweep(deadline);

    expect(siteService.recomputeRollupForSite).toHaveBeenCalledTimes(1);
  });

  it("recomputes nothing when its deadline passed before it started", async () => {
    threeSites();

    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    await runSweep(deadline);

    expect(siteService.recomputeRollupForSite).not.toHaveBeenCalled();
    expect(semaphore.release).toHaveBeenCalledWith(SWEEP_MUTEX);
  });

  it("stops once it has spent most of its time limit, even before the deadline", async () => {
    threeSites();

    const start: number = Date.now();
    const now: jest.SpyInstance = jest.spyOn(Date, "now");
    now.mockReturnValue(start);

    siteService.recomputeRollupForSite.mockImplementationOnce(
      async (): Promise<void> => {
        // Past four fifths of the four-minute time limit.
        now.mockReturnValue(start + 3.5 * 60 * 1000);
      },
    );

    try {
      await runSweep(new JobDeadline());
    } finally {
      now.mockRestore();
    }

    expect(siteService.recomputeRollupForSite).toHaveBeenCalledTimes(1);
  });
});
