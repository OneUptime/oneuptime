import ActiveMonitorLimit from "../../../../Server/Utils/Billing/ActiveMonitorLimit";
import ProjectLimitLock from "../../../../Server/Utils/Database/ProjectLimitLock";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import ProjectService, {
  CurrentPlan,
} from "../../../../Server/Services/ProjectService";
import CreateLimit from "../../../../Server/Types/Database/CreateLimit";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import {
  ActiveMonitorLimitKind,
  NO_ACTIVE_MONITOR_LIMIT,
} from "../../../../Types/Monitor/ActiveMonitorLimit";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import { DataSource, EntityManager } from "typeorm";

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
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
 * THE ACTIVE MONITOR LIMIT OF A PROJECT'S PLAN (Utils/Billing/ActiveMonitorLimit).
 *
 * The support report: a project bought from a reseller with a plan of 500
 * active monitors had 2,881. Nothing ever compared the two - the limit was
 * written on the project and never read. These pin what the one class every
 * monitor create now asks decides: which limit a project is held to, how it
 * counts, the sentence that refuses, the limit a create's INSERT is decided
 * against, and the count it keeps on the project. Postgres itself - the
 * statement, the lock, two creates at the limit at once - is held by
 * ActiveMonitorLimitPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);

interface RecordedStatement {
  sql: string;
  parameters: Array<unknown>;
}

// A manager that answers the count with `count` and records every statement.
function fakeManager(
  count: number | string,
  statements: Array<RecordedStatement>,
): EntityManager {
  return {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<{ count: number | string }>> => {
      statements.push({ sql: sql, parameters: parameters });
      return sql.startsWith("SELECT COUNT") ? [{ count: count }] : [];
    },
  } as unknown as EntityManager;
}

let currentPlan: SpyInstance<typeof ProjectService.getCurrentPlan>;

function onPlan(plan: CurrentPlan): void {
  currentPlan.mockResolvedValue(plan);
}

beforeEach(() => {
  setTestBillingEnabled(true);
  currentPlan = jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: PlanType.Growth, isSubscriptionUnpaid: false });
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("the limit a project's plan holds it to", () => {
  test("a plan bought from a reseller caps active monitors at its own number", () => {
    expect(
      ActiveMonitorLimit.getLimitOfPlan({
        plan: PlanType.Growth,
        isSubscriptionUnpaid: false,
        activeMonitorsLimit: 500,
      }),
    ).toEqual({ limit: 500, kind: ActiveMonitorLimitKind.Plan });
  });

  test("the Free plan caps them at the install's allowance", () => {
    expect(
      ActiveMonitorLimit.getLimitOfPlan({
        plan: PlanType.Free,
        isSubscriptionUnpaid: false,
      }),
    ).toEqual({ limit: 10, kind: ActiveMonitorLimitKind.FreePlan });
  });

  test("held to both, the lower one decides", () => {
    expect(
      ActiveMonitorLimit.getLimitOfPlan({
        plan: PlanType.Free,
        isSubscriptionUnpaid: false,
        activeMonitorsLimit: 500,
      }),
    ).toEqual({ limit: 10, kind: ActiveMonitorLimitKind.FreePlan });
    expect(
      ActiveMonitorLimit.getLimitOfPlan({
        plan: PlanType.Free,
        isSubscriptionUnpaid: false,
        activeMonitorsLimit: 3,
      }),
    ).toEqual({ limit: 3, kind: ActiveMonitorLimitKind.Plan });
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise, null])(
    "a %s project with no limit of its own has none",
    (plan: PlanType | null) => {
      expect(
        ActiveMonitorLimit.getLimitOfPlan({
          plan: plan,
          isSubscriptionUnpaid: false,
        }),
      ).toBeNull();
    },
  );

  test("is read with the project's plan, when billing is on", async () => {
    onPlan({
      plan: PlanType.Scale,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 500,
    });

    await expect(
      ActiveMonitorLimit.readLimit({ projectId: PROJECT_ID }),
    ).resolves.toEqual({ limit: 500, kind: ActiveMonitorLimitKind.Plan });
    expect(currentPlan).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("uses the plan a caller has just read, without reading it again", async () => {
    await expect(
      ActiveMonitorLimit.readLimit({
        projectId: PROJECT_ID,
        currentPlan: { plan: PlanType.Free, isSubscriptionUnpaid: false },
      }),
    ).resolves.toEqual({ limit: 10, kind: ActiveMonitorLimitKind.FreePlan });
    expect(currentPlan).not.toHaveBeenCalled();
  });

  // A self-hosted install has no plans, so nothing is read and nothing caps.
  test("is none on an install without billing", async () => {
    setTestBillingEnabled(false);
    onPlan({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 1,
    });

    await expect(
      ActiveMonitorLimit.readLimit({ projectId: PROJECT_ID }),
    ).resolves.toBeNull();
    expect(currentPlan).not.toHaveBeenCalled();
  });
});

describe("the count", () => {
  test("is one statement: every monitor of the project but a Manual one, deleted ones left out", async () => {
    const statements: Array<RecordedStatement> = [];

    await expect(
      ActiveMonitorLimit.countActiveMonitors({
        projectId: PROJECT_ID,
        manager: fakeManager(2881, statements),
      }),
    ).resolves.toBe(2881);

    expect(statements).toEqual([
      {
        sql: 'SELECT COUNT(*)::int AS "count" FROM "Monitor" WHERE "projectId" = $1 AND "monitorType" <> $2 AND "deletedAt" IS NULL',
        parameters: [PROJECT_ID.toString(), MonitorType.Manual],
      },
    ]);
  });

  test("reads a count the driver hands back as text as a number", async () => {
    await expect(
      ActiveMonitorLimit.countActiveMonitors({
        projectId: PROJECT_ID,
        manager: fakeManager("17", []),
      }),
    ).resolves.toBe(17);
  });

  test("with no manager, runs on the app's own connection", async () => {
    const statements: Array<RecordedStatement> = [];
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      manager: fakeManager(4, statements),
    } as unknown as DataSource);

    await expect(
      ActiveMonitorLimit.countActiveMonitors({ projectId: PROJECT_ID }),
    ).resolves.toBe(4);
    expect(statements).toHaveLength(1);
  });

  test("with no database, says so", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);

    await expect(
      ActiveMonitorLimit.countActiveMonitors({ projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(DatabaseNotConnectedException);
  });
});

describe("what the dashboard is told", () => {
  test("a project with no limit is told so, and nothing is counted", async () => {
    const count: SpyInstance<typeof ActiveMonitorLimit.countActiveMonitors> =
      jest.spyOn(ActiveMonitorLimit, "countActiveMonitors");

    await expect(ActiveMonitorLimit.getStatus(PROJECT_ID)).resolves.toEqual(
      NO_ACTIVE_MONITOR_LIMIT,
    );
    expect(count).not.toHaveBeenCalled();
  });

  test("a project with one is told the limit and how many it has", async () => {
    onPlan({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 500,
    });
    jest
      .spyOn(ActiveMonitorLimit, "countActiveMonitors")
      .mockResolvedValue(2881);

    await expect(ActiveMonitorLimit.getStatus(PROJECT_ID)).resolves.toEqual({
      limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
      activeMonitors: 2881,
    });
  });
});

describe("the refusal", () => {
  const PLAN_ROOM_TEXT: string =
    "Delete monitors you no longer need, or change the plan in Project Settings > Billing and Invoices > Billing. Manual monitors do not count towards the limit; monitors that are turned off or archived do.";
  const FREE_ROOM_TEXT: string =
    "Upgrade the plan in Project Settings > Billing and Invoices > Billing to add more. Manual monitors do not count towards the limit; monitors that are turned off or archived do.";

  test("at a plan's own limit: which limit, and what to do", () => {
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 500,
        adding: 1,
      }),
    ).toBe(
      `This project has reached its plan's limit of 500 active monitors, so no more can be added. ${PLAN_ROOM_TEXT}`,
    );
  });

  /*
   * The project in the support report. Its monitors keep running - nothing
   * is turned off - and it is told how many it has, how many its plan
   * includes, and when it can add again.
   */
  test("past a plan's own limit: how many it has, that they keep running, and when it can add again", () => {
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 2881,
        adding: 1,
      }),
    ).toBe(
      `This project has 2,881 active monitors and its plan includes 500, so no more can be added until it has fewer than 500. All of its monitors keep running. ${PLAN_ROOM_TEXT}`,
    );
  });

  test("with some room, but not for all a write adds", () => {
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 498,
        adding: 3,
      }),
    ).toBe(
      `This project has 498 active monitors and its plan includes 500, so it has room for 2 more, not 3. ${PLAN_ROOM_TEXT}`,
    );
  });

  test("at the Free plan's limit: upgrade", () => {
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 10, kind: ActiveMonitorLimitKind.FreePlan },
        activeMonitors: 10,
        adding: 1,
      }),
    ).toBe(
      `This project has reached the Free plan's limit of 10 active monitors, so no more can be added. ${FREE_ROOM_TEXT}`,
    );
  });

  /*
   * The Free plan includes no active monitor - each one on it is paid as
   * you go - so it allows its number; a plan bought from a reseller
   * includes its own.
   */
  test("past the Free plan's limit: it allows, rather than includes, its number", () => {
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 10, kind: ActiveMonitorLimitKind.FreePlan },
        activeMonitors: 12,
        adding: 1,
      }),
    ).toBe(
      `This project has 12 active monitors and the Free plan allows 10, so no more can be added until it has fewer than 10. All of its monitors keep running. ${FREE_ROOM_TEXT}`,
    );
  });

  test("with some room on the Free plan, it allows its number too", () => {
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 10, kind: ActiveMonitorLimitKind.FreePlan },
        activeMonitors: 8,
        adding: 3,
      }),
    ).toBe(
      `This project has 8 active monitors and the Free plan allows 10, so it has room for 2 more, not 3. ${FREE_ROOM_TEXT}`,
    );
  });

  test("says one monitor, and writes thousands as people read them", () => {
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 1, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 1,
        adding: 1,
      }),
    ).toContain("its plan's limit of 1 active monitor, so");
    expect(
      ActiveMonitorLimit.getRefusalMessage({
        limit: { limit: 1000, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 12345,
        adding: 1,
      }),
    ).toContain("12,345 active monitors and its plan includes 1,000");
  });

  test("names no price, no internal column, no setting a customer cannot find", () => {
    const message: string = ActiveMonitorLimit.getRefusalMessage({
      limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
      activeMonitors: 2881,
      adding: 1,
    });

    expect(message).not.toContain("activeMonitorsLimit");
    expect(message).not.toContain("currentActiveMonitorsCount");
    expect(message).not.toContain("$");
    expect(message).toContain("Project Settings > Billing and Invoices > Billing");
  });
});

describe("asking for room", () => {
  beforeEach(() => {
    onPlan({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 500,
    });
  });

  test.each([
    [0, true],
    [499, true],
    [500, false],
    [2881, false],
  ])(
    "with %i active monitors on a plan of 500, one more fits: %s",
    async (activeMonitors: number, fits: boolean) => {
      jest
        .spyOn(ActiveMonitorLimit, "countActiveMonitors")
        .mockResolvedValue(activeMonitors);

      const refusal: string | null = await ActiveMonitorLimit.getRefusal({
        projectId: PROJECT_ID,
      });

      expect(refusal === null).toBe(fits);

      if (fits) {
        await expect(
          ActiveMonitorLimit.assertRoomFor({ projectId: PROJECT_ID }),
        ).resolves.toBeUndefined();
      } else {
        await expect(
          ActiveMonitorLimit.assertRoomFor({ projectId: PROJECT_ID }),
        ).rejects.toThrow(new BadDataException(refusal!));
      }
    },
  );

  test("counts every monitor a write adds at once", async () => {
    jest
      .spyOn(ActiveMonitorLimit, "countActiveMonitors")
      .mockResolvedValue(498);

    await expect(
      ActiveMonitorLimit.getRefusal({ projectId: PROJECT_ID, adding: 2 }),
    ).resolves.toBeNull();
    await expect(
      ActiveMonitorLimit.getRefusal({ projectId: PROJECT_ID, adding: 3 }),
    ).resolves.toContain("room for 2 more, not 3");
  });

  test("adding nothing is never refused, and counts nothing", async () => {
    const count: SpyInstance<typeof ActiveMonitorLimit.countActiveMonitors> =
      jest.spyOn(ActiveMonitorLimit, "countActiveMonitors");

    await expect(
      ActiveMonitorLimit.getRefusal({ projectId: PROJECT_ID, adding: 0 }),
    ).resolves.toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  test("a project with no limit is never refused, and nothing is counted", async () => {
    onPlan({ plan: PlanType.Scale, isSubscriptionUnpaid: false });
    const count: SpyInstance<typeof ActiveMonitorLimit.countActiveMonitors> =
      jest.spyOn(ActiveMonitorLimit, "countActiveMonitors");

    await expect(
      ActiveMonitorLimit.assertRoomFor({ projectId: PROJECT_ID }),
    ).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });
});

describe("the limit a create's INSERT is decided against", () => {
  beforeEach(() => {
    onPlan({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 500,
    });
  });

  test("a Manual monitor is never limited, and nothing is read for it", async () => {
    await expect(
      ActiveMonitorLimit.getCreateLimit({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Manual,
      }),
    ).resolves.toBeNull();
    expect(currentPlan).not.toHaveBeenCalled();
  });

  test("a create with no project or no type has none", async () => {
    await expect(
      ActiveMonitorLimit.getCreateLimit({
        projectId: undefined,
        monitorType: MonitorType.Website,
      }),
    ).resolves.toBeNull();
    await expect(
      ActiveMonitorLimit.getCreateLimit({
        projectId: PROJECT_ID,
        monitorType: undefined,
      }),
    ).resolves.toBeNull();
  });

  test("a project whose plan sets no limit has none", async () => {
    onPlan({ plan: PlanType.Scale, isSubscriptionUnpaid: false });

    await expect(
      ActiveMonitorLimit.getCreateLimit({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Website,
      }),
    ).resolves.toBeNull();
  });

  test("an active monitor is decided under the limit's lock in its project, counting with the INSERT's own transaction", async () => {
    const limit: CreateLimit | null = await ActiveMonitorLimit.getCreateLimit({
      projectId: PROJECT_ID,
      monitorType: MonitorType.Website,
    });

    expect(limit?.limitName).toBe(ActiveMonitorLimit.LIMIT_NAME);
    expect(limit?.projectId.toString()).toBe(PROJECT_ID.toString());

    const underLimit: Array<RecordedStatement> = [];
    await expect(
      limit!.check(fakeManager(499, underLimit)),
    ).resolves.toBeUndefined();
    expect(underLimit).toHaveLength(1);

    await expect(limit!.check(fakeManager(500, []))).rejects.toThrow(
      "This project has reached its plan's limit of 500 active monitors, so no more can be added.",
    );
    await expect(limit!.check(fakeManager(2881, []))).rejects.toBeInstanceOf(
      BadDataException,
    );
  });

  test.each(
    Object.values(MonitorType).filter((type: MonitorType) => {
      return type !== MonitorType.Manual;
    }),
  )("a %s monitor is held to it", async (monitorType: MonitorType) => {
    await expect(
      ActiveMonitorLimit.getCreateLimit({
        projectId: PROJECT_ID,
        monitorType: monitorType,
      }),
    ).resolves.not.toBeNull();
  });
});

describe("the count kept on the project", () => {
  test("is counted and written in one transaction holding the limit's lock, and handed back", async () => {
    const statements: Array<RecordedStatement> = [];
    const run: SpyInstance<typeof ProjectLimitLock.run> = jest
      .spyOn(ProjectLimitLock, "run")
      .mockImplementation(
        async (data: {
          limitName: string;
          projectId: ObjectID;
          run: (manager: EntityManager) => Promise<unknown>;
        }): Promise<unknown> => {
          return await data.run(fakeManager(2881, statements));
        },
      ) as unknown as SpyInstance<typeof ProjectLimitLock.run>;

    await expect(ActiveMonitorLimit.refreshCount(PROJECT_ID)).resolves.toBe(
      2881,
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        limitName: ActiveMonitorLimit.LIMIT_NAME,
        projectId: PROJECT_ID,
      }),
    );
    expect(
      statements.map((statement: RecordedStatement) => {
        return statement.sql;
      }),
    ).toEqual([
      ActiveMonitorLimit.COUNT_STATEMENT,
      ActiveMonitorLimit.WRITE_COUNT_STATEMENT,
    ]);
    expect(statements[1]!.parameters).toEqual([2881, PROJECT_ID.toString()]);
  });

  test("writes the project row only when the count changed", () => {
    expect(ActiveMonitorLimit.WRITE_COUNT_STATEMENT).toBe(
      'UPDATE "Project" SET "currentActiveMonitorsCount" = $1 WHERE "_id" = $2 AND "currentActiveMonitorsCount" IS DISTINCT FROM $1',
    );
  });
});
