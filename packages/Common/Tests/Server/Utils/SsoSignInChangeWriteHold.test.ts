import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import Query from "../../../Server/Types/Database/Query";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import ProjectSsoProviderChanges, {
  ABANDONED_WRITE_HOLD_IN_MS,
  ABANDONED_WRITE_MARGIN_IN_MS,
  LAST_SSO_PROVIDER_MESSAGE,
  LOCK_TIMEOUT_IN_MS,
  SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
  WRITE_KEEP_INTERVAL_IN_MS,
  WRITE_KEEP_LIMIT_IN_MS,
  getAbandonedWriteHoldInMs,
  getWriteKeepLimitInMs,
} from "../../../Server/Utils/ProjectSsoProviderChanges";
import {
  PostgresQueryTimeoutMs,
  PostgresStatementTimeoutMs,
} from "../../../Server/EnvironmentConfig";
import ProjectSso from "../../../Models/DatabaseModels/ProjectSso";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { StoredRow, rowMatchesWhere } from "../TestingUtils/InMemoryRepository";
import {
  cancelledByDatabase,
  clientTimeout,
  connectionLost,
} from "../TestingUtils/StatementFailures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import timers from "timers";

/*
 * A CHECKED SIGN-IN CHANGE HOLDS ITS LOCKS FOR ITS WRITE, AND WRITES ONLY THE
 * ROWS IT CHECKED (Server/Utils/ProjectSsoProviderChanges).
 *
 *   - holdForWrite keeps a change's locks once more, right before its write,
 *     and keeps them alive while the write runs - every
 *     WRITE_KEEP_INTERVAL_IN_MS, at most WRITE_KEEP_LIMIT_IN_MS - until
 *     releaseSignInChange gives them back. A lock found gone right before
 *     the write is taken again, with every other, and the change checked
 *     again under them (its recheck) - or, with nothing to check it again,
 *     refuses it; one found gone while it runs is said loudly;
 *   - giveBackAfterFailedWrite gives the locks of a failed write back at
 *     once, unless the database never answered its statement, which may
 *     still land: they are then kept until the database would have
 *     cancelled it (ABANDONED_WRITE_HOLD_IN_MS), and left to run out;
 *   - writeOnlyTheRowsRead holds a write that names its rows by a filter to
 *     the rows its check read: by their ids, or - for a delete that read
 *     none - to rows deleted before, which only a hard delete reaches.
 *
 * Valkey is a stub here; the Valkey suites (SsoProviderChangesValkey) keep
 * real locks, and the Postgres suite (SsoFilterWritesPostgres) runs the
 * narrowed writes as SQL.
 */

/*
 * Lets every keep a round started run to its end. Node's own setImmediate:
 * Common's jest environment is jsdom, which has none, and the fake timers
 * stand in for the global ones.
 */
const flush: () => Promise<void> = async (): Promise<void> => {
  for (let round: number = 0; round < 3; round++) {
    await new Promise<void>((resolve: () => void): void => {
      timers.setImmediate(resolve);
    });
  }
};

// One keep interval passes, and whatever it started runs to its end.
const nextRound: () => Promise<void> = async (): Promise<void> => {
  jest.advanceTimersByTime(WRITE_KEEP_INTERVAL_IN_MS);
  await flush();
};

let keeps: Array<string> = [];
let released: Array<string> = [];
let lost: Set<string> = new Set<string>();
let valkeyDown: boolean = false;
let errors: Array<string> = [];
let warnings: Array<string> = [];
// A keep that waits until the test lets it answer.
let pendingKeep: { key: string; answer: (isKept: boolean) => void } | null =
  null;
let holdNextKeep: boolean = false;

// Every lock a test made, given back after it so no timer outlives it.
let made: Array<SemaphoreMutex> = [];

const lock: (key: string) => SemaphoreMutex = (key: string): SemaphoreMutex => {
  const mutex: SemaphoreMutex = { key } as unknown as SemaphoreMutex;
  made.push(mutex);
  return mutex;
};

const isKept: (mutex: SemaphoreMutex) => boolean = (
  mutex: SemaphoreMutex,
): boolean => {
  return ProjectSsoProviderChanges.isKeptForWrite(mutex);
};

const refusalOf: (promise: Promise<unknown>) => Promise<string> = async (
  promise: Promise<unknown>,
): Promise<string> => {
  try {
    await promise;
    return "done";
  } catch (err) {
    if (err instanceof BadDataException) {
      return err.message;
    }

    throw err;
  }
};

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date("2026-10-08T10:00:00.000Z"),
    doNotFake: ["nextTick"],
  });

  keeps = [];
  released = [];
  lost = new Set<string>();
  valkeyDown = false;
  errors = [];
  warnings = [];
  pendingKeep = null;
  holdNextKeep = false;
  made = [];

  getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
    key: string;
  }): Promise<boolean> => {
    keeps.push(mutex.key);

    if (valkeyDown) {
      throw new Error("Redis client is not connected");
    }

    if (holdNextKeep) {
      holdNextKeep = false;

      return await new Promise<boolean>(
        (answer: (isKept: boolean) => void): void => {
          pendingKeep = { key: mutex.key, answer };
        },
      );
    }

    return !lost.has(mutex.key);
  }) as never);

  getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
    key: string;
  }): Promise<void> => {
    released.push(mutex.key);
  }) as never);

  getJestSpyOn(logger, "error").mockImplementation(((
    message: unknown,
  ): void => {
    errors.push(String(message));
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation(((message: unknown): void => {
    warnings.push(String(message));
  }) as never);
});

afterEach(async () => {
  pendingKeep?.answer(true);
  await ProjectSsoProviderChanges.releaseSignInChange(made);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a checked sign-in change holds its locks for its write", () => {
  test("its locks are kept at once, then every few seconds while the write runs, and no more once they are given back", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");

    await ProjectSsoProviderChanges.holdForWrite([project, server]);

    expect(keeps).toEqual(["project", "server"]);
    expect(isKept(project)).toBe(true);
    expect(isKept(server)).toBe(true);

    await nextRound();
    await nextRound();

    expect(keeps).toEqual([
      "project",
      "server",
      "project",
      "server",
      "project",
      "server",
    ]);

    await ProjectSsoProviderChanges.releaseSignInChange([project, server]);

    expect(released).toEqual(["project", "server"]);
    expect(isKept(project)).toBe(false);
    expect(isKept(server)).toBe(false);

    for (let round: number = 0; round < 8; round++) {
      await nextRound();
    }

    expect(keeps).toHaveLength(6);
    expect(errors).toEqual([]);
  });

  test("held again right before the write - an earlier step held them - they are kept once more, and kept alive only once", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);
    await ProjectSsoProviderChanges.holdForWrite([project]);

    expect(keeps).toEqual(["project", "project"]);

    await nextRound();

    // One keeper: one keep a round, not two.
    expect(keeps).toEqual(["project", "project", "project"]);
  });

  test("a lock taken after an earlier step held the others is kept alive with them, each once", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");

    await ProjectSsoProviderChanges.holdForWrite([project]);
    await ProjectSsoProviderChanges.holdForWrite([project, server]);

    keeps = [];
    await nextRound();

    expect([...keeps].sort()).toEqual(["project", "server"]);
    expect(isKept(server)).toBe(true);
  });

  test("a lock found gone when the write is held refuses it, and keeps none of the change's locks alive", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");
    lost.add("server");

    await expect(
      refusalOf(ProjectSsoProviderChanges.holdForWrite([project, server])),
    ).resolves.toBe(SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE);

    expect(isKept(project)).toBe(false);
    expect(isKept(server)).toBe(false);

    keeps = [];
    await nextRound();
    await nextRound();

    expect(keeps).toEqual([]);
  });

  test("a lock found gone right before the write stops keeping alive the locks an earlier step held", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);
    expect(isKept(project)).toBe(true);

    lost.add("project");

    await expect(
      refusalOf(ProjectSsoProviderChanges.holdForWrite([project])),
    ).resolves.toBe(SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE);

    expect(isKept(project)).toBe(false);

    keeps = [];
    await nextRound();

    expect(keeps).toEqual([]);
  });

  test("a lock found gone while the write runs is said loudly and kept no more; the others are still kept", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");

    await ProjectSsoProviderChanges.holdForWrite([project, server]);

    lost.add("server");
    keeps = [];
    await nextRound();

    expect(keeps).toEqual(["project", "server"]);
    expect(isKept(project)).toBe(true);
    expect(isKept(server)).toBe(false);
    expect(errors).toEqual([
      "SSO sign-in change: a lock was lost while its change was being written; another change to who can sign in may have been written at the same time.",
    ]);

    keeps = [];
    await nextRound();

    expect(keeps).toEqual(["project"]);
    expect(errors).toHaveLength(1);
  });

  test("once every lock is gone, nothing more is kept", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);

    lost.add("project");
    await nextRound();

    expect(isKept(project)).toBe(false);

    keeps = [];
    await nextRound();
    await nextRound();

    expect(keeps).toEqual([]);
  });

  test("Valkey that cannot be reached while the write runs: the keep is tried again next round, and nothing is lost", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);

    valkeyDown = true;
    await nextRound();

    expect(isKept(project)).toBe(true);
    expect(warnings).toContain(
      "SSO sign-in change: could not keep a lock while its change was written; trying again.",
    );
    expect(errors).toEqual([]);

    valkeyDown = false;
    keeps = [];
    await nextRound();

    expect(keeps).toEqual(["project"]);
    expect(isKept(project)).toBe(true);
  });

  test("Valkey that cannot be reached when the write is held: the write goes on, as a change that could not lock does", async () => {
    const project: SemaphoreMutex = lock("project");
    valkeyDown = true;

    await expect(
      refusalOf(ProjectSsoProviderChanges.holdForWrite([project])),
    ).resolves.toBe("done");

    expect(isKept(project)).toBe(true);
  });

  test("a round still waiting on Valkey is not started again; once it answers, the next round keeps", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);

    holdNextKeep = true;
    keeps = [];
    await nextRound();
    await nextRound();
    await nextRound();

    expect(keeps).toEqual(["project"]);

    pendingKeep!.answer(true);
    pendingKeep = null;
    await flush();

    await nextRound();

    expect(keeps).toEqual(["project", "project"]);
    expect(isKept(project)).toBe(true);
  });

  test("past the limit the locks are kept no more, and that is said once", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);

    const rounds: number = WRITE_KEEP_LIMIT_IN_MS / WRITE_KEEP_INTERVAL_IN_MS;

    for (let round: number = 1; round < rounds; round++) {
      await nextRound();
    }

    // Kept when held, and every round before the limit.
    expect(keeps).toHaveLength(rounds);
    expect(isKept(project)).toBe(true);

    await nextRound();

    expect(keeps).toHaveLength(rounds);
    expect(isKept(project)).toBe(false);
    expect(errors).toEqual([
      "SSO sign-in change: still being written 60 seconds after its check; its locks are no longer kept, and run out.",
    ]);

    await nextRound();
    await nextRound();

    expect(keeps).toHaveLength(rounds);
    expect(errors).toHaveLength(1);
  });

  test("a round that never comes back does not keep the locks past the limit either", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);

    holdNextKeep = true;
    await nextRound();

    const rounds: number = WRITE_KEEP_LIMIT_IN_MS / WRITE_KEEP_INTERVAL_IN_MS;

    for (let round: number = 2; round <= rounds; round++) {
      await nextRound();
    }

    expect(isKept(project)).toBe(false);
    expect(errors).toEqual([
      "SSO sign-in change: still being written 60 seconds after its check; its locks are no longer kept, and run out.",
    ]);

    // It comes back at last: nothing more is kept, and no lock counts as lost.
    pendingKeep!.answer(false);
    pendingKeep = null;
    await flush();

    keeps = [];
    await nextRound();

    expect(keeps).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  test("given back while a round runs: that round keeps nothing more, and no lock counts as lost", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");

    await ProjectSsoProviderChanges.holdForWrite([project, server]);

    holdNextKeep = true;
    keeps = [];
    await nextRound();

    expect(keeps).toEqual(["project"]);

    await ProjectSsoProviderChanges.releaseSignInChange([project, server]);

    // Gone by now - it was given back.
    pendingKeep!.answer(false);
    pendingKeep = null;
    await flush();

    expect(keeps).toEqual(["project"]);
    expect(errors).toEqual([]);
    expect(isKept(project)).toBe(false);
    expect(isKept(server)).toBe(false);
  });

  test("a change that holds no lock - Valkey could not be reached when it locked - keeps nothing", async () => {
    await expect(
      refusalOf(ProjectSsoProviderChanges.holdForWrite([])),
    ).resolves.toBe("done");

    await nextRound();

    expect(keeps).toEqual([]);
  });

  test("giving the locks back never throws: a lock that cannot be given back runs out", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");

    await ProjectSsoProviderChanges.holdForWrite([project, server]);

    getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
      key: string;
    }): Promise<void> => {
      released.push(mutex.key);

      if (mutex.key === "project") {
        throw new Error("Redis client is not connected");
      }
    }) as never);

    await expect(
      ProjectSsoProviderChanges.releaseSignInChange([project, server]),
    ).resolves.toBeUndefined();

    expect(released).toEqual(["project", "server"]);
    expect(isKept(project)).toBe(false);
    expect(warnings).toContain(
      "SSO sign-in change: could not give a lock back.",
    );
  });

  test("a lock is kept well before it would run out, and kept alive longer than any statement of the write may run", () => {
    // Two keeps may be missed - a busy server, a slow Valkey - before a lock runs out.
    expect(WRITE_KEEP_INTERVAL_IN_MS * 3).toBeLessThanOrEqual(
      LOCK_TIMEOUT_IN_MS,
    );
    // Longer than the client waits for any one statement; far shorter than holding everyone for good.
    expect(WRITE_KEEP_LIMIT_IN_MS).toBeGreaterThan(PostgresQueryTimeoutMs);
    expect(WRITE_KEEP_LIMIT_IN_MS).toBe(60_000);
  });

  test("the keeping outlasts the client's wait for a statement whatever it is set to, and lasts a minute at the least", () => {
    // The defaults: the database gives up after 30 seconds, the client 5 seconds later.
    expect(getWriteKeepLimitInMs(35_000)).toBe(60_000);
    expect(getWriteKeepLimitInMs(1_000)).toBe(60_000);

    // Set longer: the keeping follows, with the same time to spare before the write.
    expect(getWriteKeepLimitInMs(60_000)).toBe(85_000);
    expect(getWriteKeepLimitInMs(300_000)).toBe(325_000);

    for (const queryTimeoutMs of [0, 35_000, 59_999, 120_000, 600_000]) {
      expect(getWriteKeepLimitInMs(queryTimeoutMs)).toBeGreaterThan(
        queryTimeoutMs,
      );
    }

    // Set to something that is not a number: still a limit, never none.
    expect(getWriteKeepLimitInMs(Number.NaN)).toBe(60_000);
    expect(getWriteKeepLimitInMs(Number.POSITIVE_INFINITY)).toBe(60_000);
  });
});

describe("a lock found gone right before the write is taken again, and the change checked again", () => {
  const TAKEN_AGAIN: string =
    "SSO sign-in change: a lock was gone right before the change was written; it is taken again, and the change checked again.";

  type Recheck = () => Promise<Array<SemaphoreMutex>>;

  test("every lock the change holds is given back, the change checked again under the locks it takes then, and those kept alive for the write", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");
    const locks: Array<SemaphoreMutex> = [project, server];
    lost.add("server");

    let retaken: Array<SemaphoreMutex> = [];
    const recheck: jest.Mock<Recheck> = jest.fn<Recheck>(
      async (): Promise<Array<SemaphoreMutex>> => {
        // Taken again: Valkey holds them for this change once more.
        lost.delete("server");
        retaken = [lock("project"), lock("server")];
        return retaken;
      },
    );

    await expect(
      refusalOf(ProjectSsoProviderChanges.holdForWrite(locks, recheck)),
    ).resolves.toBe("done");

    expect(recheck).toHaveBeenCalledTimes(1);
    // Both given back - the one still held too - before the change was checked again.
    expect(released).toEqual(["project", "server"]);
    expect(keeps).toEqual(["project", "server", "project", "server"]);
    // `locks` holds the locks taken again now, for whoever gives them back.
    expect(locks).toHaveLength(2);
    expect(locks[0]).toBe(retaken[0]);
    expect(locks[1]).toBe(retaken[1]);
    expect(isKept(project)).toBe(false);
    expect(isKept(server)).toBe(false);
    expect(isKept(retaken[0]!)).toBe(true);
    expect(isKept(retaken[1]!)).toBe(true);
    expect(warnings).toEqual([TAKEN_AGAIN]);
    expect(errors).toEqual([]);

    keeps = [];
    await nextRound();

    expect(keeps).toEqual(["project", "server"]);

    await ProjectSsoProviderChanges.releaseSignInChange(locks);

    expect(isKept(retaken[0]!)).toBe(false);
  });

  test("the locks an earlier step held stop being kept alive: only those taken again are, once a round", async () => {
    const project: SemaphoreMutex = lock("project");

    // Held once the check was done.
    await ProjectSsoProviderChanges.holdForWrite([project]);
    lost.add("project");

    const locks: Array<SemaphoreMutex> = [project];

    await ProjectSsoProviderChanges.holdForWrite(
      locks,
      async (): Promise<Array<SemaphoreMutex>> => {
        lost.delete("project");
        return [lock("project")];
      },
    );

    expect(locks[0]).not.toBe(project);
    expect(isKept(project)).toBe(false);
    expect(isKept(locks[0]!)).toBe(true);

    keeps = [];
    await nextRound();

    expect(keeps).toEqual(["project"]);
  });

  test("checked again, the change is refused: the refusal stands, nothing is held, and `locks` holds none", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");
    const locks: Array<SemaphoreMutex> = [project, server];
    lost.add("project");

    await expect(
      refusalOf(
        ProjectSsoProviderChanges.holdForWrite(
          locks,
          async (): Promise<Array<SemaphoreMutex>> => {
            // Having given back what it took.
            throw new BadDataException(LAST_SSO_PROVIDER_MESSAGE);
          },
        ),
      ),
    ).resolves.toBe(LAST_SSO_PROVIDER_MESSAGE);

    expect(locks).toEqual([]);
    expect(released).toEqual(["project", "server"]);
    expect(isKept(project)).toBe(false);
    expect(isKept(server)).toBe(false);

    keeps = [];
    await nextRound();
    await nextRound();

    expect(keeps).toEqual([]);
  });

  test("a lock taken again and found gone again refuses the write: checked again once only, and the locks taken again are given back", async () => {
    const project: SemaphoreMutex = lock("project");
    const locks: Array<SemaphoreMutex> = [project];
    lost.add("project");

    const recheck: jest.Mock<Recheck> = jest.fn<Recheck>(
      async (): Promise<Array<SemaphoreMutex>> => {
        // Still lost: Valkey keeps losing it.
        return [lock("project")];
      },
    );

    await expect(
      refusalOf(ProjectSsoProviderChanges.holdForWrite(locks, recheck)),
    ).resolves.toBe(SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE);

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(locks).toEqual([]);
    // The one found gone, then the one taken again.
    expect(released).toEqual(["project", "project"]);
    expect(keeps).toEqual(["project", "project"]);

    keeps = [];
    await nextRound();

    expect(keeps).toEqual([]);
  });

  test("checked again, the change holds no lock - its rows are gone, or Valkey could not be reached - and the write goes on holding none", async () => {
    const project: SemaphoreMutex = lock("project");
    const locks: Array<SemaphoreMutex> = [project];
    lost.add("project");

    await expect(
      refusalOf(
        ProjectSsoProviderChanges.holdForWrite(
          locks,
          async (): Promise<Array<SemaphoreMutex>> => {
            return [];
          },
        ),
      ),
    ).resolves.toBe("done");

    expect(locks).toEqual([]);

    keeps = [];
    await nextRound();

    expect(keeps).toEqual([]);
  });

  test("Valkey that cannot be reached when the write is held: the change is not checked again, and the write goes on", async () => {
    const project: SemaphoreMutex = lock("project");
    valkeyDown = true;

    const recheck: jest.Mock<Recheck> = jest.fn<Recheck>(
      async (): Promise<Array<SemaphoreMutex>> => {
        return [];
      },
    );

    await expect(
      refusalOf(ProjectSsoProviderChanges.holdForWrite([project], recheck)),
    ).resolves.toBe("done");

    expect(recheck).not.toHaveBeenCalled();
    expect(isKept(project)).toBe(true);
  });
});

describe("a write the database may still apply keeps its locks until the database would have cancelled it", () => {
  const KEPT_FOR_ABANDONED_WRITE: string =
    "SSO sign-in change: its write failed without an answer from the database, which may still apply it; its locks are kept 40 seconds, until the database would have cancelled it, and then run out.";
  const CAN_NO_LONGER_LAND: string =
    "SSO sign-in change: the write that failed without an answer from the database can no longer land; its locks are no longer kept, and run out.";

  // The rounds of keeping in this long.
  const roundsIn: (ms: number) => number = (ms: number): number => {
    return ms / WRITE_KEEP_INTERVAL_IN_MS;
  };

  test("the client stopped waiting for its statement: the locks are not given back, and are kept alive the statement timeout and a margin from then - past the write's own limit - and then left to run out", async () => {
    const project: SemaphoreMutex = lock("project");
    const server: SemaphoreMutex = lock("server");

    await ProjectSsoProviderChanges.holdForWrite([project, server]);

    // The statement runs until the client stops waiting for it: 35 seconds, by default.
    for (let round: number = 0; round < roundsIn(35_000); round++) {
      await nextRound();
    }

    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(
      [project, server],
      clientTimeout(),
    );

    expect(released).toEqual([]);
    expect(warnings).toEqual([KEPT_FOR_ABANDONED_WRITE]);
    expect(isKept(project)).toBe(true);

    // Kept past a minute from the check, until 40 seconds from the failure.
    for (
      let round: number = 1;
      round < roundsIn(ABANDONED_WRITE_HOLD_IN_MS);
      round++
    ) {
      await nextRound();
    }

    expect(isKept(project)).toBe(true);
    expect(isKept(server)).toBe(true);

    keeps = [];
    await nextRound();

    expect(keeps).toEqual([]);
    expect(isKept(project)).toBe(false);
    expect(isKept(server)).toBe(false);
    // Never given back, and never said as a write still under way.
    expect(released).toEqual([]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([KEPT_FOR_ABANDONED_WRITE, CAN_NO_LONGER_LAND]);

    await nextRound();
    await nextRound();

    expect(keeps).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  test("failed soon after its check, it is kept until the later of the two: the write's own limit stands", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);
    await nextRound();
    await nextRound();

    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(
      [project],
      connectionLost(),
    );

    // Five seconds in: 45 seconds from now is sooner than a minute from the check.
    for (
      let round: number = 3;
      round < roundsIn(WRITE_KEEP_LIMIT_IN_MS);
      round++
    ) {
      await nextRound();
    }

    expect(isKept(project)).toBe(true);

    await nextRound();

    expect(isKept(project)).toBe(false);
    expect(released).toEqual([]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([KEPT_FOR_ABANDONED_WRITE, CAN_NO_LONGER_LAND]);
  });

  test("a lock no longer kept alive when its write failed is kept alive from then, as long", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(
      [project],
      clientTimeout(),
    );

    expect(isKept(project)).toBe(true);
    expect(released).toEqual([]);

    for (
      let round: number = 1;
      round < roundsIn(ABANDONED_WRITE_HOLD_IN_MS);
      round++
    ) {
      await nextRound();
    }

    expect(keeps).toHaveLength(roundsIn(ABANDONED_WRITE_HOLD_IN_MS) - 1);
    expect(isKept(project)).toBe(true);

    await nextRound();

    expect(isKept(project)).toBe(false);
    expect(keeps).toHaveLength(roundsIn(ABANDONED_WRITE_HOLD_IN_MS) - 1);
  });

  test("a lock found gone while it is kept for such a write is said, and kept no more", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);
    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(
      [project],
      clientTimeout(),
    );

    lost.add("project");
    await nextRound();

    expect(isKept(project)).toBe(false);
    expect(errors).toEqual([
      "SSO sign-in change: a lock was lost while its change was being written; another change to who can sign in may have been written at the same time.",
    ]);
  });

  test("the database answered - it cancelled the statement at its own timeout: nothing was written, and the locks are given back at once", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);
    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(
      [project],
      cancelledByDatabase(),
    );

    expect(released).toEqual(["project"]);
    expect(isKept(project)).toBe(false);
    expect(warnings).toEqual([]);
  });

  test("refused before any statement was sent: the locks are given back at once", async () => {
    const project: SemaphoreMutex = lock("project");

    await ProjectSsoProviderChanges.holdForWrite([project]);
    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(
      [project],
      new BadDataException("Refused."),
    );

    expect(released).toEqual(["project"]);
    expect(isKept(project)).toBe(false);
  });

  test("a change that holds no lock keeps nothing, and says nothing", async () => {
    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(
      [],
      clientTimeout(),
    );

    await nextRound();

    expect(keeps).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("kept the database's statement timeout and a margin; with none set, as long as a write is kept", () => {
    // The defaults: the database cancels a statement after 30 seconds.
    expect(PostgresStatementTimeoutMs).toBe(30_000);
    expect(ABANDONED_WRITE_MARGIN_IN_MS).toBe(10_000);
    expect(ABANDONED_WRITE_HOLD_IN_MS).toBe(40_000);

    expect(getAbandonedWriteHoldInMs(30_000, 35_000)).toBe(40_000);
    expect(getAbandonedWriteHoldInMs(120_000, 125_000)).toBe(130_000);

    // Longer than the statement may run, whatever it is set to.
    for (const statementTimeoutMs of [1, 30_000, 300_000]) {
      expect(
        getAbandonedWriteHoldInMs(statementTimeoutMs, statementTimeoutMs + 5_000),
      ).toBeGreaterThan(statementTimeoutMs);
    }

    // None set - 0 is Postgres' "no timeout" - or not a number: as long as a write is kept.
    expect(getAbandonedWriteHoldInMs(0, 35_000)).toBe(60_000);
    expect(getAbandonedWriteHoldInMs(-1, 35_000)).toBe(60_000);
    expect(getAbandonedWriteHoldInMs(Number.NaN, 35_000)).toBe(60_000);
    expect(getAbandonedWriteHoldInMs(0, 300_000)).toBe(325_000);
  });
});

/*
 * writeOnlyTheRowsRead, as the database is asked: the narrowed query is run
 * through the same matcher the in-memory tables use (InMemoryRepository).
 */
describe("a write that names its rows by a filter writes only the rows its check read", () => {
  const id: (n: number) => string = (n: number): string => {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  };

  const PROJECT: string = id(1);
  const OTHER_PROJECT: string = id(2);
  const READ_ONE: string = id(11);
  const READ_TWO: string = id(12);
  const CREATED_LATER: string = id(13);
  const DELETED_LONG_AGO: string = id(14);
  const DELETED_LAST_WEEK: string = id(15);
  const OTHER_PROJECTS_DELETED: string = id(16);

  const rows: () => Array<StoredRow> = (): Array<StoredRow> => {
    return [
      { _id: READ_ONE, projectId: PROJECT, isEnabled: true },
      { _id: READ_TWO, projectId: PROJECT, isEnabled: true },
      { _id: CREATED_LATER, projectId: PROJECT, isEnabled: true },
      {
        _id: DELETED_LONG_AGO,
        projectId: PROJECT,
        isEnabled: true,
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      },
      {
        _id: DELETED_LAST_WEEK,
        projectId: PROJECT,
        isEnabled: true,
        deletedAt: OneUptimeDate.getSomeDaysAgo(7),
      },
      {
        _id: OTHER_PROJECTS_DELETED,
        projectId: OTHER_PROJECT,
        isEnabled: true,
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      },
    ];
  };

  const service: DatabaseService<ProjectSso> =
    ProjectSsoService as unknown as DatabaseService<ProjectSso>;

  // The rows the narrowed write reaches - deleted ones included, as a hard delete reads them.
  const reached: (query: Query<ProjectSso>) => Array<string> = (
    query: Query<ProjectSso>,
  ): Array<string> => {
    return rows()
      .filter((row: StoredRow): boolean => {
        return rowMatchesWhere(row, query);
      })
      .map((row: StoredRow): string => {
        return String(row["_id"]);
      });
  };

  const update: (query: unknown) => UpdateBy<ProjectSso> = (
    query: unknown,
  ): UpdateBy<ProjectSso> => {
    return {
      query: query as Query<ProjectSso>,
      data: { isEnabled: false } as never,
      limit: LIMIT_MAX,
      skip: 5,
      props: { isRoot: true },
    };
  };

  const deletion: (query: unknown) => DeleteBy<ProjectSso> = (
    query: unknown,
  ): DeleteBy<ProjectSso> => {
    return {
      query: query as Query<ProjectSso>,
      limit: new PositiveNumber(LIMIT_MAX),
      skip: new PositiveNumber(5),
      props: { isRoot: true },
    };
  };

  test("an update goes to exactly the rows read: not one that comes to match its filter afterwards", () => {
    const write: UpdateBy<ProjectSso> = update({
      projectId: new ObjectID(PROJECT),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [READ_ONE, READ_TWO],
      isDelete: false,
    });

    expect(reached(write.query)).toEqual([READ_ONE, READ_TWO]);
    // Its window is those rows.
    expect(write.skip).toBe(0);
    expect(write.limit).toBe(2);
  });

  test("the ids of the rows read are what a write is held to", () => {
    expect(
      ProjectSsoProviderChanges.idsOf([{ id: READ_ONE }, { id: READ_TWO }]),
    ).toEqual([READ_ONE, READ_TWO]);
  });

  test("an update that read no row writes none", () => {
    const write: UpdateBy<ProjectSso> = update({
      projectId: new ObjectID(PROJECT),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [],
      isDelete: false,
    });

    expect(reached(write.query)).toEqual([]);
  });

  test("the write's own filter still holds: a row read that no longer matches it is left alone", () => {
    const write: UpdateBy<ProjectSso> = update({
      projectId: new ObjectID(OTHER_PROJECT),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [READ_ONE],
      isDelete: false,
    });

    expect(reached(write.query)).toEqual([]);
  });

  test("a write that named its row by id stays on it", () => {
    const write: UpdateBy<ProjectSso> = update({
      _id: READ_ONE,
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [READ_ONE],
      isDelete: false,
    });

    expect(reached(write.query)).toEqual([READ_ONE]);
  });

  test("a query per project is held branch by branch", () => {
    const write: UpdateBy<ProjectSso> = update([
      { projectId: new ObjectID(PROJECT) },
      { projectId: new ObjectID(OTHER_PROJECT) },
    ]);

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [READ_TWO],
      isDelete: false,
    });

    expect(Array.isArray(write.query)).toBe(true);
    expect(reached(write.query)).toEqual([READ_TWO]);
  });

  test("a delete that read rows deletes exactly those: not one created afterwards, and no row deleted before", () => {
    const write: DeleteBy<ProjectSso> = deletion({
      projectId: new ObjectID(PROJECT),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [READ_ONE],
      isDelete: true,
    });

    expect(reached(write.query)).toEqual([READ_ONE]);
    expect(write.skip).toBe(0);
    expect(write.limit).toBe(1);
  });

  test("a delete that read no row reaches only rows deleted before - which a hard delete purges - within its own filter", () => {
    const write: DeleteBy<ProjectSso> = deletion({
      projectId: new ObjectID(PROJECT),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [],
      isDelete: true,
    });

    expect(reached(write.query)).toEqual([DELETED_LONG_AGO, DELETED_LAST_WEEK]);
    // Its window is left as it asked.
    expect((write.skip as PositiveNumber).toNumber()).toBe(5);
  });

  test("the retention job's purge keeps what it asks of deletedAt: rows deleted more than a month ago, and no other", () => {
    const write: DeleteBy<ProjectSso> = deletion({
      deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [],
      isDelete: true,
    });

    expect(reached(write.query)).toEqual([
      DELETED_LONG_AGO,
      OTHER_PROJECTS_DELETED,
    ]);
  });

  test("a delete that read none and asks for one time of deletion reaches only rows deleted then", () => {
    // The clock stands still here, so this is the time the row was deleted at.
    const write: DeleteBy<ProjectSso> = deletion({
      deletedAt: OneUptimeDate.getSomeDaysAgo(7),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [],
      isDelete: true,
    });

    expect(reached(write.query)).toEqual([DELETED_LAST_WEEK]);
  });

  test("a delete that read none and asks for rows that are there reaches none", () => {
    const write: DeleteBy<ProjectSso> = deletion({
      projectId: new ObjectID(PROJECT),
      deletedAt: QueryHelper.isNull(),
    });

    ProjectSsoProviderChanges.writeOnlyTheRowsRead({
      service,
      write,
      rowIds: [],
      isDelete: true,
    });

    expect(reached(write.query)).toEqual([]);
  });
});
