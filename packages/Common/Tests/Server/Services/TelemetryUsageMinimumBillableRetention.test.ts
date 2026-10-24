/*
 * IsBillingEnabled is a module-load `const` in the real EnvironmentConfig, and
 * the service's constructor schedules a cleanup job when it is true. A getter
 * laid over the otherwise real module keeps it false while the service module
 * loads and lets these tests flip it on afterwards (the same pattern as
 * TelemetryUsageSessionReplayRetention.test.ts).
 */
let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import LogService from "../../../Server/Services/LogService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import TelemetryUsageBillingService from "../../../Server/Services/TelemetryUsageBillingService";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import {
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "../../../Types/Billing/PayAsYouGoPricing";
import Decimal from "../../../Types/Decimal";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Logs, metrics, traces, profiles and security events are billed for at
 * least 7 days of retention, and session replay for exactly the days it is
 * kept. A day's usage row keeps the days the telemetry is really kept - it
 * is what Usage History shows as "Data Retention (in Days)" - and only its
 * cost is floored. These tests run the real updateUsageBilling, and the
 * real staging around it, with the database calls stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ENTITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ONE_DAY_SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const TEN_DAY_SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const DEFAULT_SERVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const SEVEN_DAY_SERVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const ONE_DAY_APP_ID: string = "77777777-7777-4777-8777-777777777777";
const THIRTY_DAY_APP_ID: string = "88888888-8888-4888-8888-888888888888";

const ONE_GIB: number = 1024 * 1024 * 1024;

const TELEMETRY_UNIT_COST_IN_USD: number =
  TELEMETRY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS;
const SESSION_REPLAY_UNIT_COST_IN_USD: number =
  SESSION_REPLAY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS;

const FLOORED_PRODUCT_TYPES: Array<ProductType> = [
  ProductType.Logs,
  ProductType.Metrics,
  ProductType.Traces,
  ProductType.Profiles,
  ProductType.SecurityEvents,
];

interface UpdatedRow {
  id: ObjectID;
  data: {
    dataIngestedInGB: Decimal;
    totalCostInUSD: Decimal;
    retainTelemetryDataForDays: number;
  };
}

let created: Array<TelemetryUsageBilling>;
let updated: Array<UpdatedRow>;
let existingRow: TelemetryUsageBilling | null;

function stubDatabase(): void {
  created = [];
  updated = [];
  existingRow = null;

  jest
    .spyOn(TelemetryUsageBillingService, "findOneBy")
    .mockImplementation(async (): Promise<TelemetryUsageBilling | null> => {
      return existingRow;
    });
  jest
    .spyOn(TelemetryUsageBillingService, "create")
    .mockImplementation(
      async (args: {
        data: TelemetryUsageBilling;
      }): Promise<TelemetryUsageBilling> => {
        created.push(args.data);
        return args.data;
      },
    );
  jest
    .spyOn(TelemetryUsageBillingService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<number> => {
      updated.push(args as UpdatedRow);
      return 1;
    });
}

function createdRowFor(entityId: string): TelemetryUsageBilling | undefined {
  return created.find((row: TelemetryUsageBilling): boolean => {
    return row.primaryEntityId?.toString() === entityId;
  });
}

async function billOneGB(
  productType: ProductType,
  retentionInDays: number,
): Promise<void> {
  await TelemetryUsageBillingService.updateUsageBilling({
    projectId: PROJECT_ID,
    productType: productType,
    primaryEntityId: ENTITY_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataIngestedInGB: 1,
    retentionInDays: retentionInDays,
  });
}

describe("updateUsageBilling keeps the days telemetry is kept, and bills at least 7", () => {
  beforeEach(() => {
    stubDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(FLOORED_PRODUCT_TYPES)("%s", (productType: ProductType) => {
    test.each([1, 2, 3, 6])(
      "kept %p days: the row says so, and costs 7 days",
      async (retentionInDays: number) => {
        await billOneGB(productType, retentionInDays);

        expect(created).toHaveLength(1);
        expect(created[0]!.retainTelemetryDataForDays).toBe(retentionInDays);
        expect(created[0]!.dataIngestedInGB?.value).toBe(1);
        expect(created[0]!.totalCostInUSD?.value).toBeCloseTo(
          TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS *
            TELEMETRY_UNIT_COST_IN_USD,
          12,
        );
      },
    );

    test.each([7, 8, 15, 30, 90])(
      "kept %p days: costs exactly those days",
      async (retentionInDays: number) => {
        await billOneGB(productType, retentionInDays);

        expect(created[0]!.retainTelemetryDataForDays).toBe(retentionInDays);
        expect(created[0]!.totalCostInUSD?.value).toBeCloseTo(
          retentionInDays * TELEMETRY_UNIT_COST_IN_USD,
          12,
        );
      },
    );
  });

  test.each([1, 3, 7, 14])(
    "session replay kept %p days costs exactly those days",
    async (retentionInDays: number) => {
      await billOneGB(ProductType.SessionReplay, retentionInDays);

      expect(created[0]!.retainTelemetryDataForDays).toBe(retentionInDays);
      expect(created[0]!.totalCostInUSD?.value).toBeCloseTo(
        retentionInDays * SESSION_REPLAY_UNIT_COST_IN_USD,
        12,
      );
    },
  );

  test("adds a floored cost to the day's existing row, keeping its real retention", async () => {
    const rowId: ObjectID = ObjectID.generate();

    existingRow = Object.assign(new TelemetryUsageBilling(), {
      _id: rowId.toString(),
      dataIngestedInGB: new Decimal(2),
      totalCostInUSD: new Decimal(0.05),
    });

    await TelemetryUsageBillingService.updateUsageBilling({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      primaryEntityId: ENTITY_ID,
      dataIngestedInGB: 1,
      retentionInDays: 2,
    });

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.id.toString()).toBe(rowId.toString());
    expect(updated[0]!.data.retainTelemetryDataForDays).toBe(2);
    expect(updated[0]!.data.dataIngestedInGB.value).toBe(3);
    expect(updated[0]!.data.totalCostInUSD.value).toBeCloseTo(
      0.05 +
        TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS *
          TELEMETRY_UNIT_COST_IN_USD,
      12,
    );
  });

  test("a day staged in two parts costs what it would in one", async () => {
    await TelemetryUsageBillingService.updateUsageBilling({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
      primaryEntityId: ENTITY_ID,
      dataIngestedInGB: 0.4,
      retentionInDays: 3,
    });

    existingRow = created[0]!;
    existingRow.id = ObjectID.generate();

    await TelemetryUsageBillingService.updateUsageBilling({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
      primaryEntityId: ENTITY_ID,
      dataIngestedInGB: 0.6,
      retentionInDays: 3,
    });

    expect(updated[0]!.data.dataIngestedInGB.value).toBeCloseTo(1, 12);
    expect(updated[0]!.data.totalCostInUSD.value).toBeCloseTo(
      TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS * TELEMETRY_UNIT_COST_IN_USD,
      12,
    );
  });
});

describe("staging bills telemetry kept under 7 days as 7 days", () => {
  beforeEach(() => {
    stubDatabase();
    mockIsBillingEnabled = true;

    jest
      .spyOn(PayAsYouGoBillingService, "isLiveAuthorizationFor")
      .mockReturnValue(true);
    jest
      .spyOn(PayAsYouGoBillingService, "getTelemetryBillingStartDate")
      .mockResolvedValue(undefined as never);

    // Nothing staged yet for the day.
    jest
      .spyOn(TelemetryUsageBillingService, "findBy")
      .mockResolvedValue([] as Array<TelemetryUsageBilling> as never);

    // A 1-day and a 10-day service override, a 7-day one, and a 3-day default.
    jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          buildTelemetryRetentionMap: () => Promise<Map<string, number>>;
        },
        "buildTelemetryRetentionMap",
      )
      .mockResolvedValue(
        new Map<string, number>([
          [ONE_DAY_SERVICE_ID, 1],
          [TEN_DAY_SERVICE_ID, 10],
          [SEVEN_DAY_SERVICE_ID, 7],
        ]),
      );
    jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          getProjectDefaultRetentionInDays: () => Promise<number>;
        },
        "getProjectDefaultRetentionInDays",
      )
      .mockResolvedValue(3);
  });

  afterEach(() => {
    mockIsBillingEnabled = false;
    jest.restoreAllMocks();
  });

  function oneGibFrom(serviceId: string): {
    primaryEntityId: string;
    primaryEntityType: string;
    rowCount: number;
    estimatedBytes: number;
  } {
    return {
      primaryEntityId: serviceId,
      primaryEntityType: ServiceType.OpenTelemetry,
      rowCount: 1000,
      estimatedBytes: ONE_GIB,
    };
  }

  test("logs: each service's row keeps its own retention, and costs at least 7 days", async () => {
    jest
      .spyOn(LogService, "groupTelemetryUsageByService")
      .mockResolvedValue([
        oneGibFrom(ONE_DAY_SERVICE_ID),
        oneGibFrom(TEN_DAY_SERVICE_ID),
        oneGibFrom(DEFAULT_SERVICE_ID),
        oneGibFrom(SEVEN_DAY_SERVICE_ID),
      ] as never);

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(created).toHaveLength(4);

    const expected: Array<[string, number, number]> = [
      [ONE_DAY_SERVICE_ID, 1, 7],
      [TEN_DAY_SERVICE_ID, 10, 10],
      [DEFAULT_SERVICE_ID, 3, 7],
      [SEVEN_DAY_SERVICE_ID, 7, 7],
    ];

    for (const [serviceId, keptDays, billedDays] of expected) {
      const row: TelemetryUsageBilling | undefined = createdRowFor(serviceId);

      expect({
        serviceId,
        kept: row?.retainTelemetryDataForDays,
        cost: row?.totalCostInUSD?.value.toFixed(12),
      }).toEqual({
        serviceId,
        kept: keptDays,
        cost: (billedDays * TELEMETRY_UNIT_COST_IN_USD).toFixed(12),
      });
    }
  });

  test("security events are floored like logs", async () => {
    jest
      .spyOn(SecurityEventService, "groupTelemetryUsageByService")
      .mockResolvedValue([oneGibFrom(ONE_DAY_SERVICE_ID)] as never);

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SecurityEvents,
    });

    expect(createdRowFor(ONE_DAY_SERVICE_ID)?.retainTelemetryDataForDays).toBe(
      1,
    );
    expect(
      createdRowFor(ONE_DAY_SERVICE_ID)?.totalCostInUSD?.value,
    ).toBeCloseTo(
      TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS * TELEMETRY_UNIT_COST_IN_USD,
      12,
    );
  });

  test("session replay kept for 1 day is billed for 1 day", async () => {
    jest
      .spyOn(RumSessionService, "groupSessionReplayUsageByEntity")
      .mockResolvedValue([
        {
          primaryEntityId: ONE_DAY_APP_ID,
          primaryEntityType: ServiceType.RealUserMonitor,
          rowCount: 10,
          estimatedBytes: ONE_GIB,
        },
        {
          primaryEntityId: THIRTY_DAY_APP_ID,
          primaryEntityType: ServiceType.RealUserMonitor,
          rowCount: 10,
          estimatedBytes: ONE_GIB,
        },
      ]);
    jest.spyOn(RumApplicationService, "findBy").mockResolvedValue([
      Object.assign(new RumApplication(), {
        _id: ONE_DAY_APP_ID,
        sessionReplayRetentionInDays: 1,
      }),
      Object.assign(new RumApplication(), {
        _id: THIRTY_DAY_APP_ID,
        sessionReplayRetentionInDays: 30,
      }),
    ] as never);

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SessionReplay,
    });

    expect(createdRowFor(ONE_DAY_APP_ID)?.retainTelemetryDataForDays).toBe(1);
    expect(createdRowFor(ONE_DAY_APP_ID)?.totalCostInUSD?.value).toBeCloseTo(
      SESSION_REPLAY_UNIT_COST_IN_USD,
      12,
    );
    expect(createdRowFor(THIRTY_DAY_APP_ID)?.totalCostInUSD?.value).toBeCloseTo(
      30 * SESSION_REPLAY_UNIT_COST_IN_USD,
      12,
    );
  });
});
