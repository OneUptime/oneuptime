import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import PostgresDatabase from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: jest.fn(),
      deleteKeyIfValue: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Infrastructure/PostgresDatabase", () => {
  return {
    __esModule: true,
    default: {
      getDataSource: jest.fn(),
    },
  };
});

import {
  runWithInstanceHealthLease,
  INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES,
  INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
} from "../../../../FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthLock";

const JOB_NAME: string = "InstanceHealth:TestJob";
const LOCK_LABEL: string = "oneuptime:instance-health:test";

type SetIfNotExistsMock = jest.Mock;
type DeleteIfValueMock = jest.Mock;

const setStringIfNotExists: SetIfNotExistsMock =
  GlobalCache.setStringIfNotExists as unknown as SetIfNotExistsMock;
const deleteKeyIfValue: DeleteIfValueMock =
  GlobalCache.deleteKeyIfValue as unknown as DeleteIfValueMock;

/*
 * These tests exist because every promise this module makes is a property of
 * WHICH cache calls it issues and in WHAT order — none of which is observable
 * from the three call sites. The regression they guard is specific and was
 * live in production: the previous implementation held an open Postgres
 * transaction (pg_try_advisory_xact_lock) across the entire job, so a
 * 60-second idle_in_transaction_session_timeout could release the lock while
 * the job was still running and let a second replica start the same work.
 */
describe("runWithInstanceHealthLease", () => {
  let events: Array<string>;

  beforeEach(() => {
    events = [];
    setStringIfNotExists.mockReset();
    deleteKeyIfValue.mockReset();
    (PostgresDatabase.getDataSource as jest.Mock).mockReset();

    setStringIfNotExists.mockImplementation(async (): Promise<boolean> => {
      events.push("acquire");
      return true;
    });
    deleteKeyIfValue.mockImplementation(async (): Promise<boolean> => {
      events.push("release");
      return true;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("runs the work when the lease is acquired", async () => {
    let ran: boolean = false;

    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        ran = true;
      },
    });

    expect(ran).toBe(true);
  });

  test("acquires BEFORE the work and releases AFTER it", async () => {
    /*
     * A lease released early is not a lease. The whole point for the caller is
     * that its read and its write are covered by one critical section.
     */
    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        events.push("work");
      },
    });

    expect(events).toEqual(["acquire", "work", "release"]);
  });

  test("skips the work when another replica holds the lease", async () => {
    setStringIfNotExists.mockResolvedValue(false);
    let ran: boolean = false;

    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        ran = true;
      },
    });

    expect(ran).toBe(false);
  });

  test("does NOT release a lease it never acquired", async () => {
    /*
     * The losing replica must not touch the winner's lease. Releasing here
     * would hand the lease straight to a third replica while the winner is
     * mid-run — the exact double-run this module prevents.
     */
    setStringIfNotExists.mockResolvedValue(false);

    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        // no-op
      },
    });

    expect(deleteKeyIfValue).not.toHaveBeenCalled();
  });

  test("acquires with SET NX under the caller's label and TTL", async () => {
    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: 900,
      run: async (): Promise<void> => {
        // no-op
      },
    });

    expect(setStringIfNotExists).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = setStringIfNotExists.mock
      .calls[0] as Array<unknown>;
    expect(call[1]).toBe(LOCK_LABEL);
    expect(call[3]).toEqual({ expiresInSeconds: 900 });
  });

  test("releases using the SAME namespace, label and token it acquired with", async () => {
    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        // no-op
      },
    });

    const acquireCall: Array<unknown> = setStringIfNotExists.mock
      .calls[0] as Array<unknown>;
    const releaseCall: Array<unknown> = deleteKeyIfValue.mock
      .calls[0] as Array<unknown>;

    // namespace, label, token must all match or the lease is unreleasable.
    expect(releaseCall[0]).toBe(acquireCall[0]);
    expect(releaseCall[1]).toBe(acquireCall[1]);
    expect(releaseCall[2]).toBe(acquireCall[2]);
  });

  test("uses a distinct holder token per attempt", async () => {
    /*
     * The token is what makes the release a compare-and-delete. If two
     * attempts shared a token, a late release from attempt #1 could delete
     * attempt #2's live lease.
     */
    const run: () => Promise<void> = async (): Promise<void> => {
      // no-op
    };

    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run,
    });
    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run,
    });

    const first: unknown = (
      setStringIfNotExists.mock.calls[0] as Array<unknown>
    )[2];
    const second: unknown = (
      setStringIfNotExists.mock.calls[1] as Array<unknown>
    )[2];

    expect(typeof first).toBe("string");
    expect(first).not.toBe(second);
  });

  test("releases the lease when the work THROWS, and rethrows", async () => {
    const failure: Error = new Error("evaluation blew up");

    await expect(
      runWithInstanceHealthLease({
        jobName: JOB_NAME,
        lockLabel: LOCK_LABEL,
        leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
        run: async (): Promise<void> => {
          throw failure;
        },
      }),
    ).rejects.toThrow(failure);

    // A leaked lease would block every later tick for a full TTL.
    expect(deleteKeyIfValue).toHaveBeenCalledTimes(1);
  });

  test("a failing release does not mask the work's error", async () => {
    const failure: Error = new Error("evaluation blew up");
    deleteKeyIfValue.mockRejectedValue(new Error("redis went away"));

    await expect(
      runWithInstanceHealthLease({
        jobName: JOB_NAME,
        lockLabel: LOCK_LABEL,
        leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
        run: async (): Promise<void> => {
          throw failure;
        },
      }),
    ).rejects.toThrow(failure);
  });

  test("a failing release does not turn a successful run into a failure", async () => {
    deleteKeyIfValue.mockRejectedValue(new Error("redis went away"));

    await expect(
      runWithInstanceHealthLease({
        jobName: JOB_NAME,
        lockLabel: LOCK_LABEL,
        leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
        run: async (): Promise<void> => {
          // no-op
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("skips the tick — rather than running unserialized — when the cache is down", async () => {
    /*
     * These jobs email every master admin and drop ClickHouse partitions.
     * Running twice is materially worse than not running until the next tick,
     * so an unavailable cache must fail closed.
     */
    setStringIfNotExists.mockRejectedValue(
      new DatabaseNotConnectedException("Cache is not connected"),
    );
    let ran: boolean = false;

    await expect(
      runWithInstanceHealthLease({
        jobName: JOB_NAME,
        lockLabel: LOCK_LABEL,
        leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
        run: async (): Promise<void> => {
          ran = true;
        },
      }),
    ).resolves.toBeUndefined();

    expect(ran).toBe(false);
    expect(deleteKeyIfValue).not.toHaveBeenCalled();
  });

  /*
   * The regression that caused the incident. The old implementation opened a
   * Postgres transaction and held it for the whole job. Nothing about the
   * call sites would reveal a reintroduction, so assert it structurally.
   */
  test("never touches Postgres — no connection, no transaction", async () => {
    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        // no-op
      },
    });

    expect(PostgresDatabase.getDataSource).not.toHaveBeenCalled();
  });

  test("holds the lease for the whole of a slow job", async () => {
    /*
     * Guards the ordering under real async interleaving: the release must not
     * be scheduled until the work's last await has settled.
     */
    let released: boolean = false;
    deleteKeyIfValue.mockImplementation(async (): Promise<boolean> => {
      released = true;
      return true;
    });

    await runWithInstanceHealthLease({
      jobName: JOB_NAME,
      lockLabel: LOCK_LABEL,
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        for (let i: number = 0; i < 5; i++) {
          await Promise.resolve();
          expect(released).toBe(false);
        }
      },
    });

    expect(released).toBe(true);
  });
});

/*
 * The lease TTL is a crash-recovery bound, not a job budget. If it were ever
 * shorter than the cron's own timeout, a still-running holder would lose its
 * lease and a second replica would start the same evaluation — which is the
 * precise failure the Postgres advisory lock had.
 */
describe("instance-health lease TTL invariant", () => {
  test("the lease outlives the job timeout", () => {
    expect(INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS).toBeGreaterThan(
      INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES * 60,
    );
  });

  test("the margin is meaningful, not a rounding error", () => {
    expect(
      INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS -
        INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES * 60,
    ).toBeGreaterThanOrEqual(60);
  });
});
