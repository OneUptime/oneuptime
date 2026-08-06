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
 * The fix serializes the check and the insert together, instance-wide, with a
 * Postgres advisory lock.
 *
 * WHAT THESE TESTS ACTUALLY EXERCISE: the real UserService.createUserOnSignup
 * and the real PostgresAdvisoryLock. Only the two edges are faked -- the rows
 * (countBy/create against an in-memory array) and the lock statement (an
 * in-process mutex standing in for pg_advisory_xact_lock). The fake lock has
 * the semantics that matter: exclusive, and released when the holder's
 * transaction ends.
 *
 * The suite is kept honest by `withoutSerialization`, which runs the same race
 * with the lock statement neutered. That case asserts the vulnerable outcome --
 * two master admins -- so a harness that could not observe the bug in the first
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
  postgresDatabase: any;
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
      postgresDatabase:
        require("../../../Server/Infrastructure/PostgresDatabase").default,
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
 * Stands in for Postgres advisory locks: exclusive per label, FIFO, and handed
 * straight to the next waiter on release so ownership is never ambiguous.
 */
class FakeAdvisoryLocks {
  private held: Set<string> = new Set();
  private waiters: Map<string, Array<() => void>> = new Map();

  public async acquire(label: string): Promise<void> {
    if (!this.held.has(label)) {
      this.held.add(label);
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      const queue: Array<() => void> = this.waiters.get(label) || [];
      queue.push(resolve);
      this.waiters.set(label, queue);
    });
  }

  public release(label: string): void {
    const queue: Array<() => void> | undefined = this.waiters.get(label);

    if (queue && queue.length > 0) {
      // Ownership transfers directly to the next waiter; the label stays held.
      const next: () => void = queue.shift()!;
      next();
      return;
    }

    this.held.delete(label);
  }
}

type YieldToEventLoopFunction = () => Promise<void>;

/*
 * A real countBy/create is a network round trip. Yielding here is what lets two
 * in-flight signups interleave at all -- without it the whole election would run
 * to completion inside one synchronous microtask burst and no race could exist
 * in the harness, lock or no lock.
 */
const yieldToEventLoop: YieldToEventLoopFunction = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
};

const FIRST_MASTER_ADMIN_LOCK_LABEL: string =
  "oneuptime:first-master-admin-election";

describe("UserService.createUserOnSignup -- first Master Admin election", () => {
  let selfHosted: LoadedModules;
  let hosted: LoadedModules;

  let locks: FakeAdvisoryLocks;
  let userRows: Array<any>;
  let projectCount: number;
  let events: Array<string>;
  let releasedRunners: number;
  let serializeLockStatement: boolean;

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
    getJestSpyOn(modules.postgresDatabase, "getDataSource").mockReturnValue({
      createQueryRunner: (): unknown => {
        let heldLabel: string | null = null;

        const runner: Record<string, unknown> = {
          isTransactionActive: false,
          connect: async (): Promise<void> => {
            return undefined;
          },
          startTransaction: async (): Promise<void> => {
            runner["isTransactionActive"] = true;
          },
          query: async (
            sql: string,
            params: Array<unknown>,
          ): Promise<Array<unknown>> => {
            if (
              serializeLockStatement &&
              sql.includes("pg_advisory_xact_lock")
            ) {
              heldLabel = String(params[0]);
              await locks.acquire(heldLabel);
              events.push("lock");
            }

            return [];
          },
          endTransaction: (): void => {
            runner["isTransactionActive"] = false;

            if (heldLabel) {
              locks.release(heldLabel);
              events.push("unlock");
              heldLabel = null;
            }
          },
          commitTransaction: async (): Promise<void> => {
            (runner["endTransaction"] as () => void)();
          },
          rollbackTransaction: async (): Promise<void> => {
            (runner["endTransaction"] as () => void)();
          },
          release: async (): Promise<void> => {
            releasedRunners++;
            // A dropped connection ends the transaction, and with it the lock.
            (runner["endTransaction"] as () => void)();
          },
        };

        return runner;
      },
    });

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

    locks = new FakeAdvisoryLocks();
    userRows = [];
    projectCount = 0;
    events = [];
    releasedRunners = 0;
    serializeLockStatement = true;

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
      expect(releasedRunners).toBe(1);
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
       * nothing to serialize -- every signup paying for a lock round trip would
       * be pure cost.
       */
      expect(events).toEqual(["create"]);
      expect(hosted.userService.countBy).not.toHaveBeenCalled();
      expect(hosted.projectService.countBy).not.toHaveBeenCalled();
      expect(hosted.postgresDatabase.getDataSource).not.toHaveBeenCalled();
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

    test("every racer takes the same lock label", async () => {
      const takenLabels: Array<unknown> = [];

      getJestSpyOn(
        selfHosted.postgresDatabase,
        "getDataSource",
      ).mockReturnValue({
        createQueryRunner: (): unknown => {
          return {
            isTransactionActive: true,
            connect: async (): Promise<void> => {
              return undefined;
            },
            startTransaction: async (): Promise<void> => {
              return undefined;
            },
            query: async (
              _sql: string,
              params: Array<unknown>,
            ): Promise<Array<unknown>> => {
              takenLabels.push(params[0]);
              return [];
            },
            commitTransaction: async (): Promise<void> => {
              return undefined;
            },
            rollbackTransaction: async (): Promise<void> => {
              return undefined;
            },
            release: async (): Promise<void> => {
              return undefined;
            },
          };
        },
      });

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
       * Two callers taking two DIFFERENT labels exclude nobody. Pin the exact
       * string: it is the entire coordination protocol between replicas.
       */
      expect(takenLabels).toEqual([
        FIRST_MASTER_ADMIN_LOCK_LABEL,
        FIRST_MASTER_ADMIN_LOCK_LABEL,
      ]);
    });

    test("without serialization the same harness reproduces the vulnerability", async () => {
      /*
       * Sensitivity check, not a description of desired behaviour. If this ever
       * starts producing one master admin, the harness has stopped being able
       * to observe the bug and every passing test above means nothing.
       */
      serializeLockStatement = false;

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
