import PositiveNumber from "../../../Types/PositiveNumber";
import Email from "../../../Types/Email";
import { getJestSpyOn } from "../../Spy";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * GHSA-3qqq-hprx-g2jw -- "First-signup race condition can grant Master Admin to
 * two users at once".
 *
 * On a self-hosted instance the first person to sign up becomes Master Admin.
 * The check was a plain read followed by a plain write:
 *
 *     const userCount = await UserService.countBy({ query: {} });
 *     partialUser.isMasterAdmin = userCount.isZero();
 *     ...
 *     await UserService.create({ data: partialUser });
 *
 * Two signups arriving together both finished the COUNT before either INSERT
 * committed, so both read zero and both were created as Master Admin. Nothing
 * downstream reconciles that, and there is no uniqueness constraint to catch it
 * -- multiple master admins are a supported product state (the Admin Dashboard
 * has a per-user toggle, and the instance-health jobs page through all of them),
 * so the reporter's suggested partial unique index is not available as a fix.
 *
 * The fix serializes the check and the insert together, instance-wide, with the
 * Redis mutex in Common/Server/Infrastructure/Semaphore.ts -- the same
 * primitive every other cross-process critical section in this codebase uses.
 * It was originally a Postgres advisory lock; the mutex holds no database
 * connection and no open transaction, so serializing signups can no longer pin
 * a pooled backend `idle in transaction`.
 *
 * WHAT THESE TESTS ACTUALLY EXERCISE: the real UserService.createUserOnSignup.
 * Only the two edges are faked -- the rows (countBy/create against an in-memory
 * array) and Redis (an in-process mutex standing in for the redis-semaphore
 * Mutex). The fake mutex has the semantics that matter: exclusive per key, and
 * handed to the next waiter on release.
 *
 * The suite is kept honest by `serializeLock = false`, which runs the same race
 * with the mutex neutered. That case asserts the vulnerable outcome -- two
 * master admins -- so a harness that could not observe the bug in the first
 * place fails loudly instead of passing vacuously.
 * ---------------------------------------------------------------------------
 */

/*
 * IsBillingEnabled is read from process.env at import time, and the test
 * environment sets BILLING_ENABLED=true. Both deployment shapes therefore have
 * to be loaded deliberately rather than inherited from whatever the runner
 * happens to export.
 */
interface LoadedModules {
  userService: any;
  projectService: any;
  semaphore: any;
  logger: any;
  User: any;
}

type LoadModulesFunction = (data: { billingEnabled: boolean }) => LoadedModules;

const loadModules: LoadModulesFunction = (data: {
  billingEnabled: boolean;
}): LoadedModules => {
  const previous: string | undefined = process.env["BILLING_ENABLED"];
  process.env["BILLING_ENABLED"] = data.billingEnabled ? "true" : "false";

  let loaded: LoadedModules | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    /* eslint-disable @typescript-eslint/no-require-imports */
    loaded = {
      userService: require("../../../Server/Services/UserService").default,
      projectService: require("../../../Server/Services/ProjectService")
        .default,
      semaphore: require("../../../Server/Infrastructure/Semaphore").default,
      logger: require("../../../Server/Utils/Logger").default,
      User: require("../../../Models/DatabaseModels/User").default,
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
    /* eslint-enable @typescript-eslint/no-var-requires */
  });

  if (previous === undefined) {
    delete process.env["BILLING_ENABLED"];
  } else {
    process.env["BILLING_ENABLED"] = previous;
  }

  return loaded as unknown as LoadedModules;
};

/*
 * Stands in for the redis-semaphore Mutex: exclusive per key, FIFO, and handed
 * straight to the next waiter on release so ownership is never ambiguous.
 */
class FakeRedisMutexes {
  private held: Set<string> = new Set();
  private waiters: Map<string, Array<() => void>> = new Map();

  public async acquire(key: string): Promise<void> {
    if (!this.held.has(key)) {
      this.held.add(key);
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      const queue: Array<() => void> = this.waiters.get(key) || [];
      queue.push(resolve);
      this.waiters.set(key, queue);
    });
  }

  public release(key: string): void {
    const queue: Array<() => void> | undefined = this.waiters.get(key);

    if (queue && queue.length > 0) {
      // Ownership transfers directly to the next waiter; the key stays held.
      const next: () => void = queue.shift()!;
      next();
      return;
    }

    this.held.delete(key);
  }

  public isHeld(key: string): boolean {
    return this.held.has(key);
  }
}

type YieldToEventLoopFunction = () => Promise<void>;

/*
 * A real countBy/create is a network round trip. Yielding here is what lets two
 * in-flight signups interleave at all -- without it the whole election would run
 * to completion inside one synchronous microtask burst and no race could exist
 * in the harness, mutex or no mutex.
 */
const yieldToEventLoop: YieldToEventLoopFunction = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
};

/*
 * The coordination protocol between replicas. Pinned literally rather than
 * imported: a rename that silently changed the key would let two deploys of
 * different versions elect two master admins, which is precisely the bug.
 */
const LOCK_NAMESPACE: string = "UserService.firstMasterAdminElection";
const LOCK_KEY: string = "instance";
const LOCK_TIMEOUT_MS: number = 10_000;
const ACQUIRE_TIMEOUT_MS: number = 5_000;

describe("UserService.createUserOnSignup -- first Master Admin election", () => {
  let selfHosted: LoadedModules;
  let hosted: LoadedModules;

  let mutexes: FakeRedisMutexes;
  let userRows: Array<any>;
  let projectCount: number;
  let events: Array<string>;
  let releases: number;
  let serializeLock: boolean;

  beforeAll(() => {
    // Loading the module graph is expensive; do it once per deployment shape.
    selfHosted = loadModules({ billingEnabled: false });
    hosted = loadModules({ billingEnabled: true });
  });

  type BuildUserFunction = (data: {
    modules: LoadedModules;
    email: string;
    isMasterAdmin?: boolean | undefined;
  }) => any;

  const buildUser: BuildUserFunction = (data: {
    modules: LoadedModules;
    email: string;
    isMasterAdmin?: boolean | undefined;
  }): any => {
    const user: any = new data.modules.User();
    user.email = new Email(data.email);

    if (data.isMasterAdmin !== undefined) {
      user.isMasterAdmin = data.isMasterAdmin;
    }

    return user;
  };

  type WireUpFunction = (modules: LoadedModules) => void;

  const wireUp: WireUpFunction = (modules: LoadedModules): void => {
    getJestSpyOn(modules.semaphore, "lock").mockImplementation(
      async (data: any): Promise<any> => {
        const key: string = `${data.namespace}-${data.key}`;

        if (serializeLock) {
          await mutexes.acquire(key);
        }

        events.push("lock");

        // Stands in for the SemaphoreMutex handle the real lock() returns.
        return { key };
      },
    );

    getJestSpyOn(modules.semaphore, "release").mockImplementation(
      async (mutex: any): Promise<void> => {
        releases++;

        if (serializeLock) {
          mutexes.release(mutex.key);
        }

        events.push("unlock");
      },
    );

    getJestSpyOn(modules.userService, "countBy").mockImplementation(
      async (): Promise<PositiveNumber> => {
        await yieldToEventLoop();
        events.push("countUsers");
        return new PositiveNumber(userRows.length);
      },
    );

    getJestSpyOn(modules.projectService, "countBy").mockImplementation(
      async (): Promise<PositiveNumber> => {
        await yieldToEventLoop();
        events.push("countProjects");
        return new PositiveNumber(projectCount);
      },
    );

    getJestSpyOn(modules.userService, "create").mockImplementation(
      async (createBy: any): Promise<any> => {
        await yieldToEventLoop();
        userRows.push(createBy.data);
        events.push("create");
        return createBy.data;
      },
    );

    getJestSpyOn(modules.logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    getJestSpyOn(modules.logger, "error").mockImplementation((): void => {
      return undefined;
    });
  };

  beforeEach(() => {
    jest.restoreAllMocks();

    mutexes = new FakeRedisMutexes();
    userRows = [];
    projectCount = 0;
    events = [];
    releases = 0;
    serializeLock = true;

    wireUp(selfHosted);
    wireUp(hosted);
  });

  describe("self-hosted (billing disabled)", () => {
    test("elects the very first user of an empty instance as Master Admin", async () => {
      const created: any = await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      expect(created.isMasterAdmin).toBe(true);
    });

    test("does not elect anyone once the instance already has a user", async () => {
      userRows.push({ email: "existing@example.com" });

      const created: any = await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "second@example.com" }),
        props: { isRoot: true },
      });

      expect(created.isMasterAdmin).toBe(false);
    });

    test("overwrites an isMasterAdmin smuggled in by the caller", async () => {
      /*
       * Signup creates with isRoot, which bypasses the column's empty
       * `create: []` access control -- so a request body carrying
       * isMasterAdmin: true would be honoured if this method did not assign the
       * column on every path.
       */
      userRows.push({ email: "existing@example.com" });

      const created: any = await selfHosted.userService.createUserOnSignup({
        user: buildUser({
          modules: selfHosted,
          email: "attacker@example.com",
          isMasterAdmin: true,
        }),
        props: { isRoot: true },
      });

      expect(created.isMasterAdmin).toBe(false);
      expect(userRows[userRows.length - 1].isMasterAdmin).toBe(false);
    });

    test("refuses to elect when the User table is empty but projects exist", async () => {
      /*
       * The advisory calls this out: the race re-opens any time the User table
       * reaches zero rows -- a bad restore, a tenant-deletion script, a partial
       * backup. Projects with no users at all is not reachable through any
       * supported path (a user who belongs to a project cannot be deleted), so
       * it means the instance was emptied out from under itself. Handing Master
       * Admin to the next stranger who signs up is not an acceptable recovery.
       */
      projectCount = 3;

      const created: any = await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "stranger@example.com" }),
        props: { isRoot: true },
      });

      expect(created.isMasterAdmin).toBe(false);
      expect(selfHosted.logger.warn).toHaveBeenCalled();
    });

    test("still elects on a genuinely fresh instance -- no users and no projects", async () => {
      projectCount = 0;

      const created: any = await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      expect(created.isMasterAdmin).toBe(true);
    });

    test("does not bother counting projects when users already exist", async () => {
      userRows.push({ email: "existing@example.com" });

      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "second@example.com" }),
        props: { isRoot: true },
      });

      expect(selfHosted.projectService.countBy).not.toHaveBeenCalled();
    });

    test("counts and creates inside the same critical section", async () => {
      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      /*
       * The load-bearing shape: the INSERT is inside the lock, not just the
       * COUNT. Releasing after the count would let the next holder count a
       * table the winner had not written to yet -- the same race with extra
       * steps.
       */
      expect(events).toEqual([
        "lock",
        "countUsers",
        "countProjects",
        "create",
        "unlock",
      ]);
    });

    test("takes the lock before it reads anything", async () => {
      /*
       * A check-then-lock ordering would be the same vulnerability: both
       * racers would finish their COUNT before either took the mutex.
       */
      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      expect(events[0]).toBe("lock");
      expect(events.indexOf("lock")).toBeLessThan(events.indexOf("countUsers"));
    });

    test("passes the caller's props through to create", async () => {
      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      const call: any = (selfHosted.userService.create as any).mock.calls[0][0];
      expect(call.props).toEqual({ isRoot: true });
    });

    test("releases the lock when the create fails", async () => {
      getJestSpyOn(selfHosted.userService, "create").mockImplementation(
        async (): Promise<never> => {
          throw new Error("insert failed");
        },
      );

      await expect(
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "first@example.com" }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow("insert failed");

      // A leaked lock would block every subsequent signup on the instance.
      expect(events).toContain("unlock");
      expect(releases).toBe(1);
      expect(mutexes.isHeld(`${LOCK_NAMESPACE}-${LOCK_KEY}`)).toBe(false);
    });

    test("releases the lock when the eligibility read fails", async () => {
      getJestSpyOn(selfHosted.userService, "countBy").mockImplementation(
        async (): Promise<never> => {
          throw new Error("count failed");
        },
      );

      await expect(
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "first@example.com" }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow("count failed");

      expect(releases).toBe(1);
      expect(mutexes.isHeld(`${LOCK_NAMESPACE}-${LOCK_KEY}`)).toBe(false);
    });

    test("releases the lock exactly once on the happy path", async () => {
      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      // A double release would hand the lock to two waiters at once.
      expect(releases).toBe(1);
      expect(mutexes.isHeld(`${LOCK_NAMESPACE}-${LOCK_KEY}`)).toBe(false);
    });

    test("a signup that fails does not stop the next one from being elected", async () => {
      getJestSpyOn(selfHosted.userService, "create").mockImplementationOnce(
        async (): Promise<never> => {
          throw new Error("insert failed");
        },
      );

      await expect(
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "first@example.com" }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow("insert failed");

      const created: any = await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "second@example.com" }),
        props: { isRoot: true },
      });

      expect(created.isMasterAdmin).toBe(true);
    });
  });

  describe("how the mutex is taken", () => {
    test("uses the expected key, namespace and timeouts", async () => {
      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      expect(selfHosted.semaphore.lock).toHaveBeenCalledTimes(1);
      expect((selfHosted.semaphore.lock as any).mock.calls[0][0]).toEqual({
        key: LOCK_KEY,
        namespace: LOCK_NAMESPACE,
        lockTimeout: LOCK_TIMEOUT_MS,
        acquireTimeout: ACQUIRE_TIMEOUT_MS,
      });
    });

    test("bounds the wait rather than blocking the request indefinitely", async () => {
      /*
       * Signup is user-facing. redis-semaphore defaults acquireAttemptsLimit to
       * Infinity, so an acquireTimeout is the only thing standing between a
       * contended lock and a request that hangs until the client gives up.
       */
      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      const options: any = (selfHosted.semaphore.lock as any).mock.calls[0][0];

      expect(options.acquireTimeout).toBeGreaterThan(0);
      expect(options.acquireTimeout).toBeLessThanOrEqual(10_000);
    });

    test("gives the lock a crash bound longer than the wait it imposes", async () => {
      /*
       * lockTimeout is what frees the key when a holder is SIGKILLed mid
       * election. It has to outlive the acquire wait, or a waiter would time
       * out before a dead holder's key ever expired.
       */
      await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      const options: any = (selfHosted.semaphore.lock as any).mock.calls[0][0];

      expect(options.lockTimeout).toBeGreaterThan(options.acquireTimeout);
    });
  });

  describe("when Redis will not cooperate", () => {
    test("fails the signup instead of electing unserialized when the lock cannot be acquired", async () => {
      /*
       * The whole point. Falling back to an unlocked election on a Redis
       * outage would reinstate GHSA-3qqq-hprx-g2jw exactly, and it would do so
       * at the worst possible moment -- a fresh instance whose Redis is not up
       * yet is precisely when the User table is empty.
       */
      getJestSpyOn(selfHosted.semaphore, "lock").mockImplementation(
        async (): Promise<never> => {
          throw new Error("Redis client is not connected");
        },
      );

      await expect(
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "first@example.com" }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow("Redis client is not connected");

      expect(selfHosted.userService.create).not.toHaveBeenCalled();
      expect(userRows).toHaveLength(0);
    });

    test("does not try to release a lock it never acquired", async () => {
      getJestSpyOn(selfHosted.semaphore, "lock").mockImplementation(
        async (): Promise<never> => {
          throw new Error("acquire-timeout");
        },
      );

      await expect(
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "first@example.com" }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow("acquire-timeout");

      // Releasing a mutex nobody holds can free somebody else's critical section.
      expect(selfHosted.semaphore.release).not.toHaveBeenCalled();
    });

    test("logs why the signup was refused", async () => {
      getJestSpyOn(selfHosted.semaphore, "lock").mockImplementation(
        async (): Promise<never> => {
          throw new Error("Redis client is not connected");
        },
      );

      await expect(
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "first@example.com" }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow();

      /*
       * "Signups 500 and nothing says why" is an outage nobody can diagnose.
       */
      expect(selfHosted.logger.error).toHaveBeenCalled();
    });

    test("a failed release does not mask a successful signup", async () => {
      getJestSpyOn(selfHosted.semaphore, "release").mockImplementation(
        async (): Promise<never> => {
          throw new Error("redis closed");
        },
      );

      const created: any = await selfHosted.userService.createUserOnSignup({
        user: buildUser({ modules: selfHosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      /*
       * The row is already committed at this point. Throwing here would tell
       * the caller their signup failed when it did not, and the lock expires on
       * its own anyway.
       */
      expect(created.isMasterAdmin).toBe(true);
      expect(selfHosted.logger.error).toHaveBeenCalled();
    });

    test("a failed release does not mask the real failure underneath it", async () => {
      getJestSpyOn(selfHosted.userService, "create").mockImplementation(
        async (): Promise<never> => {
          throw new Error("insert failed");
        },
      );

      getJestSpyOn(selfHosted.semaphore, "release").mockImplementation(
        async (): Promise<never> => {
          throw new Error("redis closed");
        },
      );

      // The caller needs "insert failed", not a connection-management detail.
      await expect(
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "first@example.com" }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("hosted (billing enabled)", () => {
    test("never elects a Master Admin", async () => {
      const created: any = await hosted.userService.createUserOnSignup({
        user: buildUser({
          modules: hosted,
          email: "first@example.com",
          isMasterAdmin: true,
        }),
        props: { isRoot: true },
      });

      expect(created.isMasterAdmin).toBe(false);
    });

    test("takes no lock and runs no bootstrap queries", async () => {
      await hosted.userService.createUserOnSignup({
        user: buildUser({ modules: hosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      /*
       * There is no first-user bootstrap on the hosted service, so there is
       * nothing to serialize -- every signup paying for a Redis round trip
       * would be pure cost, and a Redis blip would take signup down with it.
       */
      expect(events).toEqual(["create"]);
      expect(hosted.userService.countBy).not.toHaveBeenCalled();
      expect(hosted.projectService.countBy).not.toHaveBeenCalled();
      expect(hosted.semaphore.lock).not.toHaveBeenCalled();
      expect(hosted.semaphore.release).not.toHaveBeenCalled();
    });

    test("signup survives a Redis outage", async () => {
      getJestSpyOn(hosted.semaphore, "lock").mockImplementation(
        async (): Promise<never> => {
          throw new Error("Redis client is not connected");
        },
      );

      const created: any = await hosted.userService.createUserOnSignup({
        user: buildUser({ modules: hosted, email: "first@example.com" }),
        props: { isRoot: true },
      });

      expect(created).toBeTruthy();
    });
  });

  describe("the race itself", () => {
    test("two simultaneous signups produce exactly one Master Admin", async () => {
      const [first, second]: Array<any> = await Promise.all([
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race1@example.com" }),
          props: { isRoot: true },
        }),
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race2@example.com" }),
          props: { isRoot: true },
        }),
      ]);

      const elected: Array<any> = [first, second].filter((user: any) => {
        return user.isMasterAdmin === true;
      });

      expect(elected).toHaveLength(1);
      expect(userRows).toHaveLength(2);
    });

    test("ten simultaneous signups produce exactly one Master Admin", async () => {
      const signups: Array<Promise<any>> = [];

      for (let index: number = 0; index < 10; index++) {
        signups.push(
          selfHosted.userService.createUserOnSignup({
            user: buildUser({
              modules: selfHosted,
              email: `race${index}@example.com`,
            }),
            props: { isRoot: true },
          }),
        );
      }

      const created: Array<any> = await Promise.all(signups);

      const elected: Array<any> = created.filter((user: any) => {
        return user.isMasterAdmin === true;
      });

      expect(elected).toHaveLength(1);
      expect(userRows).toHaveLength(10);
    });

    test("critical sections never interleave", async () => {
      const signups: Array<Promise<any>> = [];

      for (let index: number = 0; index < 5; index++) {
        signups.push(
          selfHosted.userService.createUserOnSignup({
            user: buildUser({
              modules: selfHosted,
              email: `race${index}@example.com`,
            }),
            props: { isRoot: true },
          }),
        );
      }

      await Promise.all(signups);

      /*
       * "Exactly one master admin" can pass by luck of scheduling. This asserts
       * the mechanism instead: the event stream has to be flat lock/unlock
       * pairs, never a second lock while one is still open.
       */
      let depth: number = 0;

      for (const event of events) {
        if (event === "lock") {
          depth++;
          expect(depth).toBe(1);
        }

        if (event === "unlock") {
          depth--;
          expect(depth).toBe(0);
        }
      }

      expect(depth).toBe(0);
    });

    test("the loser of the race is created as an ordinary user, not rejected", async () => {
      const created: Array<any> = await Promise.all([
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race1@example.com" }),
          props: { isRoot: true },
        }),
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race2@example.com" }),
          props: { isRoot: true },
        }),
      ]);

      // Serializing the election must not turn a valid signup into an error.
      for (const user of created) {
        expect(user).toBeTruthy();
        expect(typeof user.isMasterAdmin).toBe("boolean");
      }
    });

    test("every racer takes the same key", async () => {
      await Promise.all([
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race1@example.com" }),
          props: { isRoot: true },
        }),
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race2@example.com" }),
          props: { isRoot: true },
        }),
      ]);

      /*
       * Two callers taking two DIFFERENT keys exclude nobody. Pin the exact
       * strings: they are the entire coordination protocol between replicas.
       */
      const keys: Array<string> = (
        selfHosted.semaphore.lock as any
      ).mock.calls.map((call: Array<any>) => {
        return `${call[0].namespace}-${call[0].key}`;
      });

      expect(keys).toEqual([
        `${LOCK_NAMESPACE}-${LOCK_KEY}`,
        `${LOCK_NAMESPACE}-${LOCK_KEY}`,
      ]);
    });

    test("a racer that fails mid-election still frees the lock for the rest", async () => {
      getJestSpyOn(selfHosted.userService, "create").mockImplementationOnce(
        async (): Promise<never> => {
          throw new Error("insert failed");
        },
      );

      const outcomes: Array<any> = await Promise.allSettled([
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race1@example.com" }),
          props: { isRoot: true },
        }),
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race2@example.com" }),
          props: { isRoot: true },
        }),
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race3@example.com" }),
          props: { isRoot: true },
        }),
      ]);

      const fulfilled: Array<any> = outcomes.filter((outcome: any) => {
        return outcome.status === "fulfilled";
      });

      /*
       * A leaked lock would deadlock the two survivors, and Promise.allSettled
       * would never resolve -- the test would time out rather than fail.
       */
      expect(fulfilled).toHaveLength(2);
      expect(mutexes.isHeld(`${LOCK_NAMESPACE}-${LOCK_KEY}`)).toBe(false);

      const elected: Array<any> = fulfilled.filter((outcome: any) => {
        return outcome.value.isMasterAdmin === true;
      });

      expect(elected).toHaveLength(1);
    });

    test("without serialization the same harness reproduces the vulnerability", async () => {
      /*
       * Sensitivity check, not a description of desired behaviour. If this ever
       * starts producing one master admin, the harness has stopped being able
       * to observe the bug and every passing test above means nothing.
       */
      serializeLock = false;

      const created: Array<any> = await Promise.all([
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race1@example.com" }),
          props: { isRoot: true },
        }),
        selfHosted.userService.createUserOnSignup({
          user: buildUser({ modules: selfHosted, email: "race2@example.com" }),
          props: { isRoot: true },
        }),
      ]);

      const elected: Array<any> = created.filter((user: any) => {
        return user.isMasterAdmin === true;
      });

      expect(elected).toHaveLength(2);
    });
  });
});
