import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * An ingestion key's own budgets (issue #5917), as TelemetryIngestionKeyService
 * saves and serves them:
 *
 *   - what may be saved: valid numbers, never 0 (empty is "use the
 *     project's"), and never more than the key's project may send - a key's
 *     budget only subdivides its project's, so one above it is refused when
 *     it is saved, against the project's limits read fresh;
 *   - what ingest is handed: the policy carries the key's budgets, or null
 *     when it sets none, read in the same query as the rest of the policy
 *     (no extra read per request), and a cache hit cannot be poisoned by a
 *     caller that mutates what it was handed.
 */

// Payment eligibility is covered by the billing admission suites.
jest.mock("../../../Server/Services/PayAsYouGoBillingService", () => {
  return {
    __esModule: true,
    default: {
      requirePayAsYouGo: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
    },
  };
});

/*
 * Whether the key's project is blocked is BlockedProjectBackgroundWork.test.ts.
 * A sample project (issue #6808) is refused a key when one is made and when
 * one is served: SampleProjectReaders.test.ts and
 * TelemetryIngestionKeyPolicyResolution.test.ts. These keys' projects are
 * neither.
 */
jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      isProjectBlocked: jest
        .fn<() => Promise<boolean>>()
        .mockResolvedValue(false),
      isSampleProject: jest
        .fn<() => Promise<boolean>>()
        .mockResolvedValue(false),
    },
  };
});

jest.mock(
  "../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings",
  () => {
    return {
      __esModule: true,
      default: {
        getInstanceSettings: jest.fn(),
        getProjectOverrides: jest.fn(),
      },
    };
  },
);

import Model from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import { Service as TelemetryIngestionKeyServiceType } from "../../../Server/Services/TelemetryIngestionKeyService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TelemetryIngestionBudgetSettings from "../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";

type MockFn = jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const KEY_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

type ServiceInternals = {
  onBeforeCreate: (createBy: CreateBy<Model>) => Promise<OnCreate<Model>>;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
};

/*
 * Typed loosely on purpose, as TelemetryIngestionKeyValidation.test.ts does:
 * nothing below needs more than the answers and the recorded calls.
 */
type Spy = {
  mockResolvedValue: (value: never) => unknown;
  mock: { calls: Array<Array<unknown>> };
};

interface Harness {
  service: TelemetryIngestionKeyServiceType;
  internals: ServiceInternals;
  findOneBy: Spy;
  rowsOfUpdate: Spy;
}

const settingsWith: (
  logsDailyInGB: number | null,
  logsRateInMB: number | null,
) => TelemetryIngestionBudgetStoredSettings = (
  logsDailyInGB: number | null,
  logsRateInMB: number | null,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  settings[ProductType.Logs] = {
    dailyBudgetInGB: logsDailyInGB,
    rateLimitInMBPerSecond: logsRateInMB,
  };
  return settings;
};

const buildService: () => Harness = (): Harness => {
  const service: TelemetryIngestionKeyServiceType =
    new TelemetryIngestionKeyServiceType();

  const findOneBy: Spy = jest.spyOn(service, "findOneBy") as unknown as Spy;
  findOneBy.mockResolvedValue(null as never);

  // The rows an update writes, read and held by the hook that checks them.
  const rowsOfUpdate: Spy = jest.spyOn(
    service,
    "findRowsAndHoldUpdateToThem",
  ) as unknown as Spy;
  rowsOfUpdate.mockResolvedValue([] as never);

  return {
    service: service,
    internals: service as unknown as ServiceInternals,
    findOneBy: findOneBy,
    rowsOfUpdate: rowsOfUpdate,
  };
};

const createBy: (payload: Record<string, unknown>) => CreateBy<Model> = (
  payload: Record<string, unknown>,
): CreateBy<Model> => {
  return {
    data: Object.assign(new Model(), {
      name: "Collector",
      ...payload,
    }) as Model,
    props: { isRoot: true, tenantId: PROJECT_ID },
  };
};

const updateBy: (payload: Record<string, unknown>) => UpdateBy<Model> = (
  payload: Record<string, unknown>,
): UpdateBy<Model> => {
  return {
    query: { _id: KEY_ID.toString() },
    data: payload,
    props: { isRoot: true },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
  } as unknown as UpdateBy<Model>;
};

const keyRow: (projectId: ObjectID) => Model = (projectId: ObjectID): Model => {
  const row: Model = new Model(ObjectID.generate());
  row.projectId = projectId;
  return row;
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  (
    TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
  ).mockResolvedValue({
    budgets: settingsWith(50, 20),
    warningPercent: 80,
    resetTime: "00:00",
    timezone: "UTC",
  } as never);
  (
    TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
  ).mockResolvedValue(null as never);
});

describe("TelemetryIngestionKeyService.onBeforeCreate - a key's own budgets", () => {
  test("saves a budget within the project's, normalized", async () => {
    const { internals }: Harness = buildService();
    const request: CreateBy<Model> = createBy({
      logsDailyIngestionBudgetInGB: "12.5",
      logsIngestionRateLimitInMBPerSecond: 20,
    });

    const result: OnCreate<Model> = await internals.onBeforeCreate(request);
    const data: Record<string, unknown> = result.createBy
      .data as unknown as Record<string, unknown>;

    expect(data["logsDailyIngestionBudgetInGB"]).toBe(12.5);
    expect(data["logsIngestionRateLimitInMBPerSecond"]).toBe(20);
    expect(
      TelemetryIngestionBudgetSettings.getProjectOverrides,
    ).toHaveBeenCalledWith(PROJECT_ID, { fresh: true });
  });

  test("refuses a budget above the project's", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(createBy({ logsDailyIngestionBudgetInGB: 51 })),
    ).rejects.toThrow("is more than the project's (50 GB)");
  });

  test("refuses 0: a key with no budget of its own leaves the field empty", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(createBy({ logsDailyIngestionBudgetInGB: 0 })),
    ).rejects.toThrow(BadDataException);
  });

  test("reads no settings for a key created without budgets", async () => {
    const { internals }: Harness = buildService();

    await internals.onBeforeCreate(createBy({}));

    expect(
      TelemetryIngestionBudgetSettings.getInstanceSettings,
    ).not.toHaveBeenCalled();
    expect(
      TelemetryIngestionBudgetSettings.getProjectOverrides,
    ).not.toHaveBeenCalled();
  });
});

describe("TelemetryIngestionKeyService.onBeforeUpdate - a key's own budgets", () => {
  test("checks the budget against each updated key's project, once per project", async () => {
    const { internals, rowsOfUpdate }: Harness = buildService();
    rowsOfUpdate.mockResolvedValue([
      keyRow(PROJECT_ID),
      keyRow(PROJECT_ID),
      keyRow(OTHER_PROJECT_ID),
    ] as never);

    await internals.onBeforeUpdate(
      updateBy({ logsDailyIngestionBudgetInGB: 10 }),
    );

    expect(rowsOfUpdate.mock.calls).toHaveLength(1);
    expect(rowsOfUpdate.mock.calls[0]![1]).toEqual({ projectId: true });

    const projectsRead: Array<string> = (
      TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
    ).mock.calls.map((call: Array<unknown>) => {
      return String(call[0]);
    });
    expect(projectsRead.sort()).toEqual(
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
    );
  });

  test("refuses a key rate above the project's own override", async () => {
    const { internals, rowsOfUpdate }: Harness = buildService();
    rowsOfUpdate.mockResolvedValue([keyRow(PROJECT_ID)] as never);
    (
      TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
    ).mockResolvedValue(settingsWith(null, 2) as never);

    await expect(
      internals.onBeforeUpdate(
        updateBy({ logsIngestionRateLimitInMBPerSecond: 3 }),
      ),
    ).rejects.toThrow("is more than the project's (2 MB per second)");
  });

  test("clearing a key's budget is always allowed, and is saved as null", async () => {
    const { internals, rowsOfUpdate }: Harness = buildService();
    rowsOfUpdate.mockResolvedValue([keyRow(PROJECT_ID)] as never);

    const result: OnUpdate<Model> = await internals.onBeforeUpdate(
      updateBy({ logsDailyIngestionBudgetInGB: "" }),
    );

    expect(
      (result.updateBy.data as unknown as Record<string, unknown>)[
        "logsDailyIngestionBudgetInGB"
      ],
    ).toBe(null);
  });

  test("an update that touches no budget reads no rows for it", async () => {
    const { internals, rowsOfUpdate }: Harness = buildService();

    await internals.onBeforeUpdate(updateBy({ name: "Renamed" }));

    expect(rowsOfUpdate.mock.calls).toHaveLength(0);
    expect(
      TelemetryIngestionBudgetSettings.getInstanceSettings,
    ).not.toHaveBeenCalled();
  });

  test("refuses a value that is not a budget before reading anything", async () => {
    const { internals, rowsOfUpdate }: Harness = buildService();

    await expect(
      internals.onBeforeUpdate(
        updateBy({ tracesDailyIngestionBudgetInGB: "lots" }),
      ),
    ).rejects.toThrow("Traces daily budget");
    expect(rowsOfUpdate.mock.calls).toHaveLength(0);
  });
});

describe("TelemetryIngestionKeyService.getPolicyFromSecretKey - budgets in the policy", () => {
  const resolve: (
    harness: Harness,
    row: Record<string, unknown>,
  ) => Promise<TelemetryIngestionKeyPolicy> = async (
    harness: Harness,
    row: Record<string, unknown>,
  ): Promise<TelemetryIngestionKeyPolicy> => {
    harness.findOneBy.mockResolvedValue({
      _id: ObjectID.generate(),
      projectId: PROJECT_ID,
      isEnabled: true,
      ...row,
    } as never);

    const policy: TelemetryIngestionKeyPolicy | null =
      await harness.service.getPolicyFromSecretKey(
        ObjectID.generate().toString(),
      );

    expect(policy).not.toBeNull();
    return policy as TelemetryIngestionKeyPolicy;
  };

  test("reads every budget column in the same query as the rest of the policy", async () => {
    const harness: Harness = buildService();
    await resolve(harness, {});

    expect(harness.findOneBy.mock.calls).toHaveLength(1);
    const select: Record<string, unknown> = (
      harness.findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    for (const column of TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES) {
      expect(select[column]).toBe(true);
    }
  });

  test("a key that sets none has no budgets of its own", async () => {
    const policy: TelemetryIngestionKeyPolicy = await resolve(buildService(), {
      logsDailyIngestionBudgetInGB: null,
    });

    expect(policy.ingestionBudgets).toBe(null);
  });

  test("a key's budgets are handed to ingest, and garbage reads as not set", async () => {
    const policy: TelemetryIngestionKeyPolicy = await resolve(buildService(), {
      logsDailyIngestionBudgetInGB: "5",
      tracesIngestionRateLimitInMBPerSecond: 2,
      metricsDailyIngestionBudgetInGB: -3,
    });

    expect(policy.ingestionBudgets?.[ProductType.Logs]).toEqual({
      dailyBudgetInGB: 5,
      rateLimitInMBPerSecond: null,
    });
    expect(policy.ingestionBudgets?.[ProductType.Traces]).toEqual({
      dailyBudgetInGB: null,
      rateLimitInMBPerSecond: 2,
    });
    expect(policy.ingestionBudgets?.[ProductType.Metrics]).toEqual({
      dailyBudgetInGB: null,
      rateLimitInMBPerSecond: null,
    });
  });

  test("a cache hit hands out a copy: a caller's change cannot reach the next request", async () => {
    const harness: Harness = buildService();
    const token: string = ObjectID.generate().toString();
    harness.findOneBy.mockResolvedValue({
      _id: ObjectID.generate(),
      projectId: PROJECT_ID,
      isEnabled: true,
      logsDailyIngestionBudgetInGB: 5,
    } as never);

    const first: TelemetryIngestionKeyPolicy | null =
      await harness.service.getPolicyFromSecretKey(token);
    first!.ingestionBudgets![ProductType.Logs].dailyBudgetInGB = 5000;

    const second: TelemetryIngestionKeyPolicy | null =
      await harness.service.getPolicyFromSecretKey(token);

    expect(harness.findOneBy.mock.calls).toHaveLength(1);
    expect(second!.ingestionBudgets![ProductType.Logs].dailyBudgetInGB).toBe(5);
  });

  test("saving a key's budget forgets the cached policies", async () => {
    const harness: Harness = buildService();
    const token: string = ObjectID.generate().toString();
    harness.findOneBy.mockResolvedValue({
      _id: ObjectID.generate(),
      projectId: PROJECT_ID,
      isEnabled: true,
    } as never);

    await harness.service.getPolicyFromSecretKey(token);
    harness.rowsOfUpdate.mockResolvedValue([keyRow(PROJECT_ID)] as never);
    await harness.internals.onBeforeUpdate(
      updateBy({ logsDailyIngestionBudgetInGB: 1 }),
    );
    await harness.service.getPolicyFromSecretKey(token);

    expect(harness.findOneBy.mock.calls).toHaveLength(2);
  });
});
