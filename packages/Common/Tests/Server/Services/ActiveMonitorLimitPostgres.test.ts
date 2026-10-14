import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import ActiveMonitorLimit from "../../../Server/Utils/Billing/ActiveMonitorLimit";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  // The Free plan's allowance, pinned: an install can change it.
  Object.defineProperty(mocked, "AllowedActiveMonitorCountInFreePlan", {
    enumerable: true,
    value: 10,
  });

  return mocked;
});

/*
 * A PROJECT'S ACTIVE MONITOR LIMIT, HELD BY A REAL, MIGRATED POSTGRES.
 *
 * The support report: a project bought from a reseller with a plan of 500
 * active monitors had 2,881 (Project.activeMonitorsLimit 500,
 * currentActiveMonitorsCount 2881). The limit was written on the project
 * and never read; and the Free plan's cap, the one limit that was read, was
 * a count and an INSERT nothing held together, so creates at the limit
 * that raced all passed. Only Postgres can show what holds them now:
 *
 *  - creates that all passed the first, early check - held at a barrier
 *    until every one of them has - still add exactly as many monitors as
 *    the limit has room for: the INSERT is counted again in its own
 *    transaction under the limit's per-project advisory lock
 *    (DatabaseService.insertWithinCreateLimit, ProjectLimitLock);
 *  - a project already past its limit keeps every monitor it has, turned
 *    on as they were, and is refused new active ones - never Manual ones -
 *    until it has fewer than its limit;
 *  - the count the project shows (Project.currentActiveMonitorsCount) is
 *    what the Monitor table holds after creates, deletes - one made as
 *    OneUptime with no project on it too - and refreshes racing creates;
 *    turning monitors off, on and into the archive does not change it;
 *  - the limit counts exactly the rows the bill counts.
 *
 * Every create goes through the real MonitorService, as OneUptime's own
 * engines make them (root, with the project as tenant); the project's plan
 * and its limit are read from its row by the real
 * ProjectService.getCurrentPlan. Billing is on for every test (the plans
 * are set below); the payment provider, Redis (locks), live updates and
 * workflows are stood in for.
 *
 * Opt in with RUN_POSTGRES_ACTIVE_MONITOR_LIMIT_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. Every table's
 * STRUCTURE is cloned into a unique schema (first on the search_path),
 * dropped afterwards, so nothing lands in the database's own tables.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * ACTIVE_MONITOR_LIMIT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * ACTIVE_MONITOR_LIMIT_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ACTIVE_MONITOR_LIMIT_TESTS"] === "true"
    ? describe
    : describe.skip;

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const SCHEMA_NAME_DASHES: RegExp = /-/g;

// More creates at once than the connection pool has connections.
const RACING_CREATES: number = 12;
const POOL_SIZE: number = 10;

interface MonitorRow {
  name: string;
  monitorType: string;
  disableActiveMonitoring: boolean;
  isArchived: boolean;
  deletedAt: Date | null;
}

describePostgres(
  "a project's active monitor limit, on a migrated Postgres",
  () => {
    const schema: string = `active_monitor_limit_${ObjectID.generate()
      .toString()
      .replace(SCHEMA_NAME_DASHES, "")}`;

    const savedPlanEnvironment: Record<string, string | undefined> = {};

    let database: DataSource;
    let projectId: ObjectID;
    let operationalStatusId: ObjectID;

    beforeAll(async () => {
      for (const [key, value] of Object.entries(PLAN_ENVIRONMENT)) {
        savedPlanEnvironment[key] = process.env[key];
        process.env[key] = value;
      }

      database = new DataSource({
        type: "postgres",
        host:
          process.env["ACTIVE_MONITOR_LIMIT_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["ACTIVE_MONITOR_LIMIT_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["ACTIVE_MONITOR_LIMIT_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema},public`,
          max: POOL_SIZE,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      /*
       * Every table, so whatever a monitor's create, update and delete hooks
       * touch lands here and never in the database's own tables. Defaults,
       * NOT NULL and CHECK constraints and every index come with them;
       * foreign keys do not.
       */
      const tables: Array<string> = (
        await database.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'`,
        )
      ).map((row: { table_name: string }): string => {
        return row.table_name;
      });

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    }, 300000);

    afterAll(async () => {
      for (const [key, value] of Object.entries(savedPlanEnvironment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      setTestBillingEnabled(true);

      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      // Redis' locks: the status timeline's, not the limit's (Postgres').
      jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
        return {} as SemaphoreMutex;
      }) as never);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

      /*
       * A project with a payment method, whose usage is never reported to
       * the payment provider: the bill's report stops once it has counted.
       */
      jest
        .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(PayAsYouGoBillingService, "authorizeUsageNow")
        .mockResolvedValue(null);
      jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);

      // A project of its own per test: the plan is cached per project.
      projectId = ObjectID.generate();
    });

    afterEach(async () => {
      // What a create leaves running after it returns (onCreateSuccess) ends first.
      await settleDetachedWork();
      jest.restoreAllMocks();
      setTestBillingEnabled(false);
    });

    async function settleDetachedWork(): Promise<void> {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 1500);
      });
    }

    async function insertProject(data: {
      plan: "free" | "growth";
      activeMonitorsLimit: number | null;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug", "paymentProviderPlanId", "activeMonitorsLimit") VALUES ($1, 1, 'Reseller customer', $2, $3, $4)`,
        [
          projectId.toString(),
          `reseller-customer-${projectId.toString()}`,
          `price_${data.plan}_month`,
          data.activeMonitorsLimit,
        ],
      );

      operationalStatusId = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."MonitorStatus" ("_id", "version", "projectId", "name", "slug", "color", "isOperationalState", "isOfflineState", "priority") VALUES ($1, 1, $2, 'Operational', $3, '#22c55e', true, false, 0)`,
        [
          operationalStatusId.toString(),
          projectId.toString(),
          `operational-${operationalStatusId.toString()}`,
        ],
      );
    }

    // Monitors the project already has, written as rows.
    async function insertMonitors(
      count: number,
      data: {
        monitorType: MonitorType;
        disableActiveMonitoring?: boolean;
        isArchived?: boolean;
        isDeleted?: boolean;
      },
    ): Promise<void> {
      for (let index: number = 0; index < count; index++) {
        const id: string = ObjectID.generate().toString();

        await database.query(
          `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "disableActiveMonitoring", "isArchived", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            projectId.toString(),
            `Existing ${data.monitorType} ${index}`,
            `existing-${id}`,
            data.monitorType,
            operationalStatusId.toString(),
            Boolean(data.disableActiveMonitoring),
            Boolean(data.isArchived),
            data.isDeleted ? new Date() : null,
          ],
        );
      }
    }

    // A monitor made as OneUptime's engines make one: root, in the project.
    async function createMonitor(
      monitorType: MonitorType,
      name: string,
    ): Promise<Monitor> {
      const monitor: Monitor = new Monitor();
      monitor.name = name;
      monitor.monitorType = monitorType;

      return await MonitorService.create({
        data: monitor,
        props: { isRoot: true, tenantId: projectId },
      });
    }

    async function monitorRows(): Promise<Array<MonitorRow>> {
      return await database.query(
        `SELECT "name", "monitorType", "disableActiveMonitoring", "isArchived", "deletedAt" FROM "${schema}"."Monitor" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
    }

    /*
     * The project's active monitors, worked out here from the rows - not with
     * the statement under test.
     */
    async function activeMonitorsInTable(): Promise<number> {
      return (await monitorRows()).filter((row: MonitorRow): boolean => {
        return row.monitorType !== MonitorType.Manual && row.deletedAt === null;
      }).length;
    }

    async function storedCount(): Promise<number | null> {
      const rows: Array<{ currentActiveMonitorsCount: number | null }> =
        await database.query(
          `SELECT "currentActiveMonitorsCount" FROM "${schema}"."Project" WHERE "_id" = $1`,
          [projectId.toString()],
        );

      return rows[0]?.currentActiveMonitorsCount ?? null;
    }

    // Waits for the count the project shows to be `expected`, or fails.
    async function expectStoredCount(expected: number): Promise<void> {
      const deadline: number = Date.now() + 15000;
      let stored: number | null = await storedCount();

      while (stored !== expected && Date.now() < deadline) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 100);
        });
        stored = await storedCount();
      }

      expect(stored).toBe(expected);
    }

    /*
     * Holds every create once its own checks and hooks have passed - the
     * early check of the limit among them - until `count` of them have got
     * there, then lets them all go at once. Past it, only the INSERT's own
     * check under the lock stands between them and the table.
     */
    function holdCreatesUntilAllPassedTheirChecks(count: number): void {
      let arrived: number = 0;
      let release: () => void = (): void => {
        return;
      };
      const allArrived: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          release = resolve;
        },
      );

      jest
        .spyOn(
          MonitorService as unknown as {
            onCreatePermitted: () => Promise<void>;
          },
          "onCreatePermitted",
        )
        .mockImplementation(async (): Promise<void> => {
          arrived++;

          if (arrived === count) {
            release();
          }

          await allArrived;
        });
    }

    async function createAtOnce(
      monitorType: MonitorType,
      count: number,
    ): Promise<{ created: number; refusals: Array<string> }> {
      holdCreatesUntilAllPassedTheirChecks(count);

      const results: Array<PromiseSettledResult<Monitor>> =
        await Promise.allSettled(
          Array.from({ length: count }, (_value: unknown, index: number) => {
            return createMonitor(monitorType, `Racing monitor ${index}`);
          }),
        );

      return {
        created: results.filter(
          (result: PromiseSettledResult<Monitor>): boolean => {
            return result.status === "fulfilled";
          },
        ).length,
        refusals: results
          .filter((result: PromiseSettledResult<Monitor>): boolean => {
            return result.status === "rejected";
          })
          .map((result: PromiseSettledResult<Monitor>): string => {
            const reason: unknown = (result as { reason: unknown }).reason;
            expect(reason).toBeInstanceOf(BadDataException);
            return (reason as Error).message;
          }),
      };
    }

    describe("creates that race at the limit", () => {
      test("a plan of its own with room for one more: of twelve creates that all passed the early check, exactly one is added", async () => {
        await insertProject({ plan: "growth", activeMonitorsLimit: 5 });
        await insertMonitors(4, { monitorType: MonitorType.IncomingRequest });

        const outcome: { created: number; refusals: Array<string> } =
          await createAtOnce(MonitorType.IncomingRequest, RACING_CREATES);

        expect(outcome.created).toBe(1);
        expect(outcome.refusals).toHaveLength(RACING_CREATES - 1);

        for (const refusal of outcome.refusals) {
          expect(refusal).toBe(
            "This project has reached its plan's limit of 5 active monitors, so no more can be added. Delete monitors you no longer need, or change the plan in Project Settings > Billing. Manual monitors do not count towards the limit; monitors that are turned off or archived do.",
          );
        }

        expect(await activeMonitorsInTable()).toBe(5);
      }, 120000);

      test("the Free plan with room for three: exactly three are added", async () => {
        await insertProject({ plan: "free", activeMonitorsLimit: null });
        await insertMonitors(7, { monitorType: MonitorType.IncomingRequest });

        const outcome: { created: number; refusals: Array<string> } =
          await createAtOnce(MonitorType.IncomingRequest, RACING_CREATES);

        expect(outcome.created).toBe(3);
        expect(outcome.refusals).toHaveLength(RACING_CREATES - 3);
        expect(outcome.refusals[0]).toContain(
          "This project has reached the Free plan's limit of 10 active monitors",
        );
        expect(await activeMonitorsInTable()).toBe(10);
      }, 120000);

      test("a project with no limit is held to nothing: every create is added", async () => {
        await insertProject({ plan: "growth", activeMonitorsLimit: null });
        await insertMonitors(4, { monitorType: MonitorType.IncomingRequest });

        const outcome: { created: number; refusals: Array<string> } =
          await createAtOnce(MonitorType.IncomingRequest, RACING_CREATES);

        expect(outcome).toEqual({ created: RACING_CREATES, refusals: [] });
        expect(await activeMonitorsInTable()).toBe(4 + RACING_CREATES);
      }, 120000);
    });

    describe("a project already past its limit", () => {
      test("keeps every monitor, turned on as it was; is refused an active monitor and never a Manual one", async () => {
        // The support report's project, smaller: 7 active monitors on a plan of 5.
        await insertProject({ plan: "growth", activeMonitorsLimit: 5 });
        await insertMonitors(5, { monitorType: MonitorType.IncomingRequest });
        await insertMonitors(1, {
          monitorType: MonitorType.Website,
          disableActiveMonitoring: true,
        });
        await insertMonitors(1, {
          monitorType: MonitorType.Ping,
          isArchived: true,
        });
        const before: Array<MonitorRow> = await monitorRows();

        await expect(
          createMonitor(MonitorType.IncomingRequest, "One too many"),
        ).rejects.toThrow(
          "This project has 7 active monitors and its plan includes 5, so no more can be added until it has fewer than 5. Every monitor it has keeps running. Delete monitors you no longer need, or change the plan in Project Settings > Billing. Manual monitors do not count towards the limit; monitors that are turned off or archived do.",
        );

        const manual: Monitor = await createMonitor(
          MonitorType.Manual,
          "Status only",
        );
        expect(manual.id).toBeTruthy();

        const after: Array<MonitorRow> = await monitorRows();

        // Nothing turned off, nothing archived, nothing deleted: one Manual monitor more.
        expect(
          after.filter((row: MonitorRow): boolean => {
            return row.name !== "Status only";
          }),
        ).toEqual(before);
        expect(await activeMonitorsInTable()).toBe(7);
      }, 120000);

      test("adds again once it has fewer than its limit, and up to it only", async () => {
        await insertProject({ plan: "growth", activeMonitorsLimit: 5 });
        await insertMonitors(6, { monitorType: MonitorType.IncomingRequest });

        await expect(
          createMonitor(MonitorType.IncomingRequest, "Refused"),
        ).rejects.toBeInstanceOf(BadDataException);

        // Two deleted, as OneUptime: no project on the delete.
        const deletable: Array<Monitor> = await MonitorService.findBy({
          query: {
            projectId: projectId,
            monitorType: MonitorType.IncomingRequest,
          },
          select: { _id: true },
          limit: 2,
          skip: 0,
          props: { isRoot: true },
        });
        await MonitorService.deleteBy({
          query: {
            _id: QueryHelper.any(
              deletable.map((monitor: Monitor): ObjectID => {
                return monitor.id!;
              }),
            ),
          },
          limit: 2,
          skip: 0,
          props: { isRoot: true },
        });
        expect(await activeMonitorsInTable()).toBe(4);

        await createMonitor(MonitorType.IncomingRequest, "Fits again");
        expect(await activeMonitorsInTable()).toBe(5);

        await expect(
          createMonitor(MonitorType.IncomingRequest, "At the limit"),
        ).rejects.toThrow("its plan's limit of 5 active monitors");
      }, 120000);

      test("a Manual monitor made an active one is refused at the limit, and allowed under it", async () => {
        await insertProject({ plan: "growth", activeMonitorsLimit: 5 });
        await insertMonitors(5, { monitorType: MonitorType.IncomingRequest });
        const manual: Monitor = await createMonitor(
          MonitorType.Manual,
          "Becomes active",
        );

        await expect(
          MonitorService.updateOneById({
            id: manual.id!,
            data: { monitorType: MonitorType.IncomingRequest },
            props: { isRoot: true },
          }),
        ).rejects.toThrow("its plan's limit of 5 active monitors");

        await database.query(
          `UPDATE "${schema}"."Project" SET "activeMonitorsLimit" = 6 WHERE "_id" = $1`,
          [projectId.toString()],
        );
        ProjectService.forgetCurrentPlan(projectId);

        await MonitorService.updateOneById({
          id: manual.id!,
          data: { monitorType: MonitorType.IncomingRequest },
          props: { isRoot: true },
        });
        expect(await activeMonitorsInTable()).toBe(6);
      }, 120000);

      test("a raised limit holds at once on the server that wrote it", async () => {
        await insertProject({ plan: "growth", activeMonitorsLimit: 2 });
        await insertMonitors(2, { monitorType: MonitorType.IncomingRequest });

        await expect(
          createMonitor(MonitorType.IncomingRequest, "Refused"),
        ).rejects.toBeInstanceOf(BadDataException);

        // A reseller's change of tier writes the limit this way (ResellerPlanAPI).
        await ProjectService.updateOneById({
          id: projectId,
          data: { activeMonitorsLimit: 3 },
          props: { isRoot: true },
        });

        await createMonitor(MonitorType.IncomingRequest, "Fits the new tier");
        expect(await activeMonitorsInTable()).toBe(3);
      }, 120000);
    });

    describe("the count the project shows", () => {
      test("is what the table holds after creates, turning monitors off and on, archiving and deletes", async () => {
        await insertProject({ plan: "growth", activeMonitorsLimit: 50 });
        await insertMonitors(3, { monitorType: MonitorType.IncomingRequest });

        const first: Monitor = await createMonitor(
          MonitorType.IncomingRequest,
          "First",
        );
        const second: Monitor = await createMonitor(
          MonitorType.IncomingEmail,
          "Second",
        );
        await createMonitor(MonitorType.Manual, "Manual");
        await expectStoredCount(5);

        // Off, on and into the archive: still active monitors, still counted.
        for (const data of [
          { disableActiveMonitoring: true },
          { disableActiveMonitoring: false },
          { isArchived: true },
        ]) {
          await MonitorService.updateOneById({
            id: first.id!,
            data: data,
            props: { isRoot: true },
          });
        }
        expect(await ActiveMonitorLimit.refreshCount(projectId)).toBe(5);
        await expectStoredCount(5);

        // Deleted as OneUptime, with no project on the delete.
        await MonitorService.deleteOneById({
          id: second.id!,
          props: { isRoot: true },
        });
        await expectStoredCount(4);
        expect(await activeMonitorsInTable()).toBe(4);
      }, 120000);

      test("refreshes racing creates end on what the table holds", async () => {
        await insertProject({ plan: "growth", activeMonitorsLimit: 100 });

        await Promise.all([
          ...Array.from({ length: 6 }, (_value: unknown, index: number) => {
            return createMonitor(MonitorType.IncomingRequest, `Racer ${index}`);
          }),
          ...Array.from({ length: 6 }, () => {
            return ActiveMonitorLimit.refreshCount(projectId);
          }),
        ]);
        await ActiveMonitorLimit.refreshCount(projectId);

        expect(await storedCount()).toBe(6);
        expect(await activeMonitorsInTable()).toBe(6);
      }, 120000);
    });

    test("the limit counts exactly the rows the bill counts: every type, on, off, archived; deleted ones and Manual ones left out", async () => {
      await insertProject({ plan: "growth", activeMonitorsLimit: null });

      for (const monitorType of Object.values(MonitorType)) {
        await insertMonitors(1, { monitorType: monitorType });
      }
      await insertMonitors(2, {
        monitorType: MonitorType.Website,
        disableActiveMonitoring: true,
      });
      await insertMonitors(2, {
        monitorType: MonitorType.API,
        isArchived: true,
      });
      await insertMonitors(3, {
        monitorType: MonitorType.Ping,
        isDeleted: true,
      });
      await insertMonitors(2, { monitorType: MonitorType.Manual });

      const counted: number = await ActiveMonitorLimit.countActiveMonitors({
        projectId: projectId,
      });
      const billed: PositiveNumber = await MonitorService.countBy({
        query: {
          projectId: projectId,
          monitorType: QueryHelper.notEquals(MonitorType.Manual),
        },
        props: { isRoot: true },
      });

      expect(counted).toBe(Object.values(MonitorType).length - 1 + 4);
      expect(counted).toBe(billed.toNumber());
      expect(counted).toBe(await activeMonitorsInTable());
    }, 120000);
  },
);
