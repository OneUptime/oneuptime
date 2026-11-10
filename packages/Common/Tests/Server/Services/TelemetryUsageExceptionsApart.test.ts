/*
 * IsBillingEnabled is a module-load `const` in the real EnvironmentConfig. A
 * getter laid over the otherwise real module lets each test say whether
 * billing is on - and turn it on part way, as an install that starts billing
 * does (as TelemetryUsageMetering.test.ts does).
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

import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import LogService from "../../../Server/Services/LogService";
import MetricService from "../../../Server/Services/MetricService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProfileSampleService from "../../../Server/Services/ProfileSampleService";
import ProfileService from "../../../Server/Services/ProfileService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import SpanService from "../../../Server/Services/SpanService";
import TelemetryUsageBillingService, {
  TelemetryResourceUsage,
} from "../../../Server/Services/TelemetryUsageBillingService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import { TracesDataIngestMetredPlan } from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import Project from "../../../Models/DatabaseModels/Project";
import OneUptimeDate from "../../../Types/Date";
import Decimal from "../../../Types/Decimal";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  TELEMETRY_USAGE_PRODUCT_TYPES,
} from "../../../Types/Telemetry/TelemetryUsage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #6356: exceptions are shown as a signal of their own, apart from the
 * traces they are billed with. Traces are one billed product that sums the
 * span rows and the exception rows, so the Traces usage row keeps that sum -
 * what it is billed for - and records, beside it, how much of it was
 * exceptions (exceptionDataIngestedInGB). That part is never priced, never
 * charged and never added to anything.
 *
 * Billing safety first: what a project is billed for traces on OneUptime
 * Cloud must not change, and the exception bytes must never be charged twice.
 * Every scenario runs the real staging, metering and reporting code against an
 * in-memory store that evaluates the queries the service sends: billing on
 * and paying, billing on and free, billing off, and billing turned on later.
 * The reads (TelemetryUsageReads.test.ts and
 * TelemetryUsageExceptionsPostgres.test.ts) hold the pages to the rows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "63560000-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "63560000-2222-4222-8222-222222222222";
const HOST_ID: string = "63560000-3333-4333-8333-333333333333";
const MONITOR_ID: string = "63560000-4444-4444-8444-444444444444";

// A daily run at 08:00 UTC: the window is Oct 16 - Oct 22.
const NOW: Date = new Date("2026-10-23T08:00:00.000Z");

const GB: number = 1024 * 1024 * 1024;

function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/*
 * ---------------------------------------------------------------------
 * The usage rows, in memory, and an evaluator for the conditions the
 * service writes: plain equality, and QueryHelper's Raw operators (IN, >,
 * <, <=), read from the SQL they generate and the parameters they carry.
 * ---------------------------------------------------------------------
 */

interface StoredRow {
  _id: string;
  projectId: ObjectID;
  productType: ProductType;
  day: string;
  primaryEntityId: ObjectID;
  primaryEntityType?: ServiceType | undefined;
  dataIngestedInGB: Decimal;
  exceptionDataIngestedInGB?: Decimal | null | undefined;
  totalCostInUSD: Decimal;
  retainTelemetryDataForDays: number;
  isReportedToBillingProvider: boolean;
  reportedToBillingProviderAt?: Date | undefined;
  createdAt: Date;
}

let store: Array<StoredRow> = [];
let nextId: number = 0;

interface RawOperator {
  getSql?: ((alias: string) => string) | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

function scalarOf(value: unknown): unknown {
  if (value instanceof Decimal) {
    return value.value;
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return value;
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  const operator: RawOperator = condition as RawOperator;

  if (condition && typeof condition === "object" && operator.getSql) {
    const sql: string = operator.getSql("COLUMN");
    const parameter: unknown = Object.values(
      operator.objectLiteralParameters || {},
    )[0];

    if (sql.startsWith("(COLUMN IN (:...")) {
      return (parameter as Array<string>).includes(String(scalarOf(value)));
    }

    if (sql.startsWith("(COLUMN > :")) {
      return Number(scalarOf(value)) > Number(scalarOf(parameter));
    }

    if (sql.startsWith("(COLUMN < :")) {
      return Number(scalarOf(value)) < Number(scalarOf(parameter));
    }

    if (sql.startsWith("(COLUMN <= :")) {
      return Number(scalarOf(value)) <= Number(scalarOf(parameter));
    }

    throw new Error(`The store does not evaluate ${sql}`);
  }

  return scalarOf(value) === scalarOf(condition);
}

function matchesQuery(row: StoredRow, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(
    ([column, condition]: [string, unknown]): boolean => {
      return matchesCondition(
        (row as unknown as Record<string, unknown>)[column],
        condition,
      );
    },
  );
}

function toModel(row: StoredRow): TelemetryUsageBilling {
  return Object.assign(new TelemetryUsageBilling(), {
    ...row,
    id: new ObjectID(row._id),
    _id: row._id,
  });
}

function rowsOf(query: Record<string, unknown>): Array<StoredRow> {
  return store.filter((row: StoredRow): boolean => {
    return matchesQuery(row, query);
  });
}

/*
 * The ClickHouse side: the days the tables have rows on, and each table's
 * usage scan - spans and exceptions apart, as the two tables answer.
 */
interface ScanRow {
  primaryEntityId: string;
  primaryEntityType: string | null;
  rowCount: number;
  estimatedBytes: number;
}

let telemetryDays: Array<string> = [];
let spanRows: Array<ScanRow> = [];
let exceptionRows: Array<ScanRow> = [];
let otherRows: Array<ScanRow> = [];

interface Spies {
  spanScan: jest.SpyInstance;
  exceptionScan: jest.SpyInstance;
  canUsePayAsYouGo: jest.SpyInstance;
  create: jest.SpyInstance;
}

let spies: Spies;

function installStore(): void {
  jest
    .spyOn(TelemetryUsageBillingService, "findBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<TelemetryUsageBilling>> => {
      return rowsOf(args.query).map(toModel);
    }) as never);

  jest
    .spyOn(TelemetryUsageBillingService, "findOneBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<TelemetryUsageBilling | null> => {
      const rows: Array<StoredRow> = rowsOf(args.query).sort(
        (a: StoredRow, b: StoredRow): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        },
      );

      return rows[0] ? toModel(rows[0]) : null;
    }) as never);

  spies.create = jest
    .spyOn(TelemetryUsageBillingService, "create")
    .mockImplementation((async (args: {
      data: TelemetryUsageBilling;
    }): Promise<TelemetryUsageBilling> => {
      const data: TelemetryUsageBilling = args.data;
      const row: StoredRow = {
        _id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
        projectId: data.projectId!,
        productType: data.productType!,
        day: data.day!,
        primaryEntityId: data.primaryEntityId!,
        primaryEntityType: data.primaryEntityType,
        dataIngestedInGB: data.dataIngestedInGB!,
        exceptionDataIngestedInGB: data.exceptionDataIngestedInGB,
        totalCostInUSD: data.totalCostInUSD!,
        retainTelemetryDataForDays: data.retainTelemetryDataForDays!,
        isReportedToBillingProvider: Boolean(data.isReportedToBillingProvider),
        createdAt: data.createdAt!,
      };

      store.push(row);

      return toModel(row);
    }) as never);

  jest
    .spyOn(TelemetryUsageBillingService, "updateOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
      data: Partial<StoredRow>;
    }): Promise<void> => {
      const row: StoredRow | undefined = store.find((each: StoredRow) => {
        return each._id === args.id.toString();
      });

      if (row) {
        Object.assign(row, args.data);
      }
    }) as never);

  jest
    .spyOn(TelemetryUsageBillingService, "updateBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
      data: Partial<StoredRow>;
    }): Promise<number> => {
      const rows: Array<StoredRow> = rowsOf(args.query);

      for (const row of rows) {
        Object.assign(row, args.data);
      }

      return rows.length;
    }) as never);
}

function installTelemetry(): void {
  const days: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    return telemetryDays;
  };

  for (const service of [
    SpanService,
    ExceptionInstanceService,
    LogService,
    MetricService,
    SecurityEventService,
    RumSessionService,
    ProfileService,
    ProfileSampleService,
  ]) {
    jest.spyOn(service, "getDaysWithRows").mockImplementation(days as never);
  }

  spies.spanScan = jest
    .spyOn(SpanService, "groupTelemetryUsageByService")
    .mockImplementation((async (): Promise<Array<ScanRow>> => {
      return spanRows;
    }) as never);
  spies.exceptionScan = jest
    .spyOn(ExceptionInstanceService, "groupTelemetryUsageByService")
    .mockImplementation((async (): Promise<Array<ScanRow>> => {
      return exceptionRows;
    }) as never);

  const others: () => Promise<Array<ScanRow>> = async (): Promise<
    Array<ScanRow>
  > => {
    return otherRows;
  };

  for (const service of [
    LogService,
    MetricService,
    SecurityEventService,
    ProfileService,
  ]) {
    jest
      .spyOn(service, "groupTelemetryUsageByService")
      .mockImplementation(others as never);
  }

  jest
    .spyOn(ProfileSampleService, "groupTelemetryUsageByService")
    .mockResolvedValue([] as never);
  jest
    .spyOn(RumSessionService, "groupSessionReplayUsageByEntity")
    .mockImplementation(others as never);
}

function installRetention(): void {
  // Private helpers: the per-resource retention lookups that read Postgres.
  jest
    .spyOn(
      TelemetryUsageBillingService as unknown as {
        buildTelemetryRetentionMap: () => Promise<Map<string, number>>;
      },
      "buildTelemetryRetentionMap",
    )
    .mockResolvedValue(new Map<string, number>([[HOST_ID, 30]]));
  jest
    .spyOn(
      TelemetryUsageBillingService as unknown as {
        buildSessionReplayRetentionMap: () => Promise<Map<string, number>>;
      },
      "buildSessionReplayRetentionMap",
    )
    .mockResolvedValue(new Map<string, number>());
  jest
    .spyOn(
      TelemetryUsageBillingService as unknown as {
        getProjectDefaultRetentionInDays: () => Promise<number>;
      },
      "getProjectDefaultRetentionInDays",
    )
    .mockResolvedValue(15);
}

function installPayments(options: { canPay: boolean }): void {
  spies.canUsePayAsYouGo = jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(options.canPay);
  jest
    .spyOn(PayAsYouGoBillingService, "isLiveAuthorizationFor")
    .mockReturnValue(false);
  jest
    .spyOn(PayAsYouGoBillingService, "getTelemetryBillingStartDate")
    .mockResolvedValue(undefined as never);
  jest.spyOn(PayAsYouGoBillingService, "authorizeUsageNow").mockResolvedValue(
    options.canPay
      ? ({
          projectId: PROJECT_ID.toString(),
          decidedAt: Date.now(),
        } as never)
      : (null as never),
  );
}

function scan(entityId: string, bytes: number, type?: ServiceType): ScanRow {
  return {
    primaryEntityId: entityId,
    primaryEntityType: type || ServiceType.OpenTelemetry,
    rowCount: 100,
    estimatedBytes: bytes,
  };
}

function costOf(row: StoredRow): number {
  return Number(row.totalCostInUSD.value);
}

function gbOf(row: StoredRow): number {
  return Number(row.dataIngestedInGB.value);
}

// The row's exceptions, in GB; null when it records none at all.
function exceptionsOf(row: StoredRow): number | null {
  return row.exceptionDataIngestedInGB instanceof Decimal
    ? row.exceptionDataIngestedInGB.value
    : null;
}

function rowFor(entityId: string, productType: ProductType): StoredRow {
  const row: StoredRow | undefined = store.find((each: StoredRow) => {
    return (
      each.primaryEntityId.toString() === entityId &&
      each.productType === productType
    );
  });

  if (!row) {
    throw new Error(`No ${productType} row for ${entityId}`);
  }

  return row;
}

beforeEach(() => {
  mockIsBillingEnabled = false;
  store = [];
  nextId = 0;
  telemetryDays = [];
  spanRows = [];
  exceptionRows = [];
  otherRows = [];
  spies = {} as Spies;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest.spyOn(logger, "error").mockImplementation(() => {});

  installStore();
  installTelemetry();
  installRetention();
  installPayments({ canPay: true });
});

afterEach(() => {
  mockIsBillingEnabled = false;
  jest.restoreAllMocks();
});

describe("a trace day's usage row, where billing is off", () => {
  beforeEach(() => {
    telemetryDays = ["2026-10-22"];
  });

  test("keeps everything the traces sent, and says how much of it was exceptions", async () => {
    spanRows = [scan(SERVICE_ID, 2 * GB)];
    exceptionRows = [scan(SERVICE_ID, GB / 2)];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(store).toHaveLength(1);

    const row: StoredRow = store[0]!;

    expect(row.productType).toBe(ProductType.Traces);
    // What the row is billed for: spans and exceptions together, as before.
    expect(gbOf(row)).toBe(2.5);
    // Of that, the exceptions.
    expect(exceptionsOf(row)).toBe(0.5);
    expect(costOf(row)).toBe(0);
    expect(row.isReportedToBillingProvider).toBe(false);
  });

  test("records a day with no exceptions as none of them, not as an unknown part", async () => {
    spanRows = [scan(SERVICE_ID, GB)];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(gbOf(store[0]!)).toBe(1);
    expect(exceptionsOf(store[0]!)).toBe(0);
  });

  test("a resource that only recorded exceptions is all exceptions", async () => {
    exceptionRows = [scan(HOST_ID, GB, ServiceType.Host)];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    const row: StoredRow = rowFor(HOST_ID, ProductType.Traces);

    expect(gbOf(row)).toBe(1);
    expect(exceptionsOf(row)).toBe(1);
    expect(row.primaryEntityType).toBe(ServiceType.Host);
    // The host's own retention, as for any of its traces.
    expect(row.retainTelemetryDataForDays).toBe(30);
  });

  test("counts each resource's exceptions with its own spans, and no one else's", async () => {
    spanRows = [scan(SERVICE_ID, 3 * GB), scan(HOST_ID, GB, ServiceType.Host)];
    exceptionRows = [scan(SERVICE_ID, GB)];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(store).toHaveLength(2);
    expect(gbOf(rowFor(SERVICE_ID, ProductType.Traces))).toBe(4);
    expect(exceptionsOf(rowFor(SERVICE_ID, ProductType.Traces))).toBe(1);
    expect(gbOf(rowFor(HOST_ID, ProductType.Traces))).toBe(1);
    expect(exceptionsOf(rowFor(HOST_ID, ProductType.Traces))).toBe(0);
  });

  test("leaves out OneUptime's own resources' exceptions with the rest of their telemetry", async () => {
    spanRows = [scan(SERVICE_ID, GB)];
    exceptionRows = [scan(MONITOR_ID, 5 * GB, ServiceType.Monitor)];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(
      store.map((row: StoredRow): string => {
        return row.primaryEntityId.toString();
      }),
    ).toEqual([SERVICE_ID]);
    expect(exceptionsOf(store[0]!)).toBe(0);
  });

  test("counts exceptions the engine gives no size for at the configured row size, in both figures alike", async () => {
    spanRows = [scan(SERVICE_ID, GB)];
    exceptionRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 1000,
        estimatedBytes: 0,
      },
    ];

    const usage: Map<string, TelemetryResourceUsage> =
      await TelemetryUsageBillingService.getTelemetryUsageByResource({
        projectId: PROJECT_ID,
        productType: ProductType.Traces,
        startDate: utcMidnight("2026-10-22"),
        endDate: OneUptimeDate.getEndOfDay(utcMidnight("2026-10-22"), "UTC"),
      });

    const resource: TelemetryResourceUsage = usage.get(SERVICE_ID)!;

    expect(resource.exceptionBytes).toBeGreaterThan(0);
    // The part is inside the bytes, never on top of them.
    expect(resource.bytes).toBe(GB + resource.exceptionBytes!);
  });

  test("gives no other product's row a part", async () => {
    otherRows = [scan(SERVICE_ID, GB)];

    for (const productType of [
      ProductType.Logs,
      ProductType.Metrics,
      ProductType.Profiles,
      ProductType.SessionReplay,
      ProductType.SecurityEvents,
    ]) {
      await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: productType,
      });

      const usage: Map<string, TelemetryResourceUsage> =
        await TelemetryUsageBillingService.getTelemetryUsageByResource({
          projectId: PROJECT_ID,
          productType: productType,
          startDate: utcMidnight("2026-10-22"),
          endDate: OneUptimeDate.getEndOfDay(utcMidnight("2026-10-22"), "UTC"),
        });

      expect({
        productType,
        exceptionBytes: usage.get(SERVICE_ID)?.exceptionBytes,
      }).toEqual({ productType, exceptionBytes: undefined });
    }

    expect(store).toHaveLength(5);

    for (const row of store) {
      expect({ productType: row.productType, part: exceptionsOf(row) }).toEqual(
        { productType: row.productType, part: null },
      );
    }

    // The exception table is read for traces only.
    expect(spies.exceptionScan).not.toHaveBeenCalled();
  });

  test("never writes a row of its own for exceptions: one row per resource, product and day", async () => {
    spanRows = [scan(SERVICE_ID, GB)];
    exceptionRows = [scan(SERVICE_ID, GB)];
    otherRows = [scan(SERVICE_ID, GB)];

    for (const productType of TELEMETRY_USAGE_PRODUCT_TYPES) {
      await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: productType,
      });
    }

    expect(
      store
        .map((row: StoredRow): string => {
          return row.productType;
        })
        .sort(),
    ).toEqual([...TELEMETRY_USAGE_PRODUCT_TYPES].sort());
    expect(
      store.some((row: StoredRow): boolean => {
        return (row.productType as string) === TELEMETRY_USAGE_EXCEPTIONS_SIGNAL;
      }),
    ).toBe(false);
  });

  test("still counts a day once: the next run finds it counted and scans nothing", async () => {
    spanRows = [scan(SERVICE_ID, GB)];
    exceptionRows = [scan(SERVICE_ID, GB)];

    for (let run: number = 0; run < 2; run++) {
      await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: ProductType.Traces,
      });
    }

    expect(spies.spanScan).toHaveBeenCalledTimes(1);
    expect(spies.exceptionScan).toHaveBeenCalledTimes(1);
    expect(store).toHaveLength(1);
    expect(gbOf(store[0]!)).toBe(2);
    expect(exceptionsOf(store[0]!)).toBe(1);
  });
});

describe("billing on, for a paying project: what traces cost is unchanged", () => {
  beforeEach(() => {
    mockIsBillingEnabled = true;
    telemetryDays = ["2026-10-22"];
    // 40 GB of spans and 10 GB of exceptions: 50 GB kept 15 days, 5 USD.
    spanRows = [scan(SERVICE_ID, 40 * GB)];
    exceptionRows = [scan(SERVICE_ID, 10 * GB)];
  });

  test("the Traces row costs the traces price of the spans and exceptions together, as before", async () => {
    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(store).toHaveLength(1);

    const row: StoredRow = store[0]!;

    expect(gbOf(row)).toBe(50);
    expect(exceptionsOf(row)).toBe(10);
    // The price of everything the row holds - exactly what it was before.
    expect(costOf(row)).toBeCloseTo(
      TracesDataIngestMetredPlan.getTotalCostInUSD({
        dataIngestedInGB: 50,
        retentionInDays: 15,
      }),
      10,
    );
    expect(costOf(row)).toBeCloseTo(5, 10);
  });

  test("never prices the exceptions on their own", async () => {
    const price: jest.SpyInstance = jest.spyOn(
      TracesDataIngestMetredPlan,
      "getTotalCostInUSD",
    );

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(price).toHaveBeenCalledTimes(1);
    expect(price).toHaveBeenCalledWith({
      dataIngestedInGB: 50,
      retentionInDays: 15,
    });
  });

  test("the billing run charges the day's traces once, at that cost", async () => {
    const report: jest.SpyInstance = jest
      .spyOn(BillingService, "addOrUpdateMeteredPricingOnSubscription")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      Object.assign(new Project(), {
        paymentProviderMeteredSubscriptionId: "sub_metered",
        paymentProviderPlanId: "plan_growth",
      }) as never,
    );

    await TracesDataIngestMetredPlan.reportQuantityToBillingProvider(
      PROJECT_ID,
      {},
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toBe("sub_metered");
    expect(report.mock.calls[0]![1]).toBe(TracesDataIngestMetredPlan);
    // 5 USD in cents: the 50 GB of spans and exceptions, charged once.
    expect(report.mock.calls[0]![2]).toBe(500);

    expect(store).toHaveLength(1);
    expect(store[0]!.isReportedToBillingProvider).toBe(true);

    // Reported: the next run charges nothing more for the day.
    await TracesDataIngestMetredPlan.reportQuantityToBillingProvider(
      PROJECT_ID,
      {},
    );

    expect(report).toHaveBeenCalledTimes(1);
  });

  test("what the billing run reads is the one Traces row, and nothing for exceptions", async () => {
    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    const unreported: Array<TelemetryUsageBilling> =
      await TelemetryUsageBillingService.getUnreportedUsageBilling({
        projectId: PROJECT_ID,
        productType: ProductType.Traces,
      });

    expect(unreported).toHaveLength(1);
    expect(Number(unreported[0]!.totalCostInUSD!.value)).toBeCloseTo(5, 10);

    expect(
      await TelemetryUsageBillingService.getUnreportedUsageBilling({
        projectId: PROJECT_ID,
        productType: TELEMETRY_USAGE_EXCEPTIONS_SIGNAL as ProductType,
      }),
    ).toEqual([]);
  });

  test("the marketplace usage reports' query, which takes every row that costs something, takes that one row", async () => {
    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    // As ee/Server/CloudMarketplace/MarketplaceUsageReporter asks for them.
    const owed: Array<TelemetryUsageBilling> =
      await TelemetryUsageBillingService.findBy({
        query: {
          projectId: PROJECT_ID,
          isReportedToBillingProvider: false,
          totalCostInUSD: QueryHelper.greaterThan(0),
        },
        select: { _id: true, totalCostInUSD: true, day: true },
        skip: 0,
        limit: 1000,
        props: { isRoot: true },
      });

    expect(owed).toHaveLength(1);
    expect(
      owed.reduce((sum: number, row: TelemetryUsageBilling): number => {
        return sum + Number(row.totalCostInUSD!.value);
      }, 0),
    ).toBeCloseTo(5, 10);
  });

  test("a row's exceptions part never changes what it costs", async () => {
    for (const [entityId, part] of [
      [SERVICE_ID, 0],
      [HOST_ID, 9],
    ] as Array<[string, number]>) {
      await TelemetryUsageBillingService.updateUsageBilling({
        projectId: PROJECT_ID,
        productType: ProductType.Traces,
        primaryEntityId: new ObjectID(entityId),
        dataIngestedInGB: 10,
        exceptionDataIngestedInGB: part,
        retentionInDays: 15,
        usageDate: utcMidnight("2026-10-22"),
      });
    }

    const service: StoredRow = rowFor(SERVICE_ID, ProductType.Traces);
    const host: StoredRow = rowFor(HOST_ID, ProductType.Traces);

    expect(exceptionsOf(service)).toBe(0);
    expect(exceptionsOf(host)).toBe(9);
    expect(costOf(service)).toBeCloseTo(1, 10);
    expect(costOf(host)).toBe(costOf(service));
  });
});

describe("billing on, for a free project", () => {
  test("stages no trace day, and so no exceptions part either", async () => {
    mockIsBillingEnabled = true;
    installPayments({ canPay: false });
    telemetryDays = ["2026-10-22"];
    spanRows = [scan(SERVICE_ID, 40 * GB)];
    exceptionRows = [scan(SERVICE_ID, 10 * GB)];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(store).toHaveLength(0);
    expect(spies.spanScan).not.toHaveBeenCalled();
    expect(spies.exceptionScan).not.toHaveBeenCalled();
    expect(spies.canUsePayAsYouGo).toHaveBeenCalled();
  });

  test("and its billing run reports nothing", async () => {
    mockIsBillingEnabled = true;
    installPayments({ canPay: false });
    telemetryDays = ["2026-10-22"];
    spanRows = [scan(SERVICE_ID, 40 * GB)];
    exceptionRows = [scan(SERVICE_ID, 10 * GB)];

    const report: jest.SpyInstance = jest
      .spyOn(BillingService, "addOrUpdateMeteredPricingOnSubscription")
      .mockResolvedValue(undefined as never);

    await TracesDataIngestMetredPlan.reportQuantityToBillingProvider(
      PROJECT_ID,
      {},
    );

    expect(report).not.toHaveBeenCalled();
    expect(store).toHaveLength(0);
  });
});

describe("billing turned on after a trace day was metered without it", () => {
  test("never stages the day again, its exceptions part included, and charges nothing for it", async () => {
    telemetryDays = ["2026-10-22"];
    spanRows = [scan(SERVICE_ID, 40 * GB)];
    exceptionRows = [scan(SERVICE_ID, 10 * GB)];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(store).toHaveLength(1);
    expect(costOf(store[0]!)).toBe(0);
    expect(exceptionsOf(store[0]!)).toBe(10);

    mockIsBillingEnabled = true;

    const report: jest.SpyInstance = jest
      .spyOn(BillingService, "addOrUpdateMeteredPricingOnSubscription")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      Object.assign(new Project(), {
        paymentProviderMeteredSubscriptionId: "sub_metered",
        paymentProviderPlanId: "plan_growth",
      }) as never,
    );

    await TracesDataIngestMetredPlan.reportQuantityToBillingProvider(
      PROJECT_ID,
      {},
    );

    expect(report).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
    expect(costOf(store[0]!)).toBe(0);
    expect(gbOf(store[0]!)).toBe(50);
    expect(exceptionsOf(store[0]!)).toBe(10);
    expect(store[0]!.isReportedToBillingProvider).toBe(false);
  });
});

describe("a usage row that more is added to", () => {
  async function add(data: {
    productType?: ProductType;
    gigabytes: number;
    exceptions?: number | undefined;
    isBillable?: boolean;
  }): Promise<void> {
    await TelemetryUsageBillingService.updateUsageBilling({
      projectId: PROJECT_ID,
      productType: data.productType || ProductType.Traces,
      primaryEntityId: new ObjectID(SERVICE_ID),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataIngestedInGB: data.gigabytes,
      exceptionDataIngestedInGB: data.exceptions,
      retentionInDays: 15,
      usageDate: utcMidnight("2026-10-22"),
      isBillable: data.isBillable ?? false,
    });
  }

  test("sums both parts when each is known", async () => {
    await add({ gigabytes: 4, exceptions: 1 });
    await add({ gigabytes: 5, exceptions: 2 });

    expect(store).toHaveLength(1);
    expect(gbOf(store[0]!)).toBe(9);
    expect(exceptionsOf(store[0]!)).toBe(3);
  });

  test("records no part once some of its bytes have none: a row counted before exceptions were counted apart", async () => {
    store.push({
      _id: "00000000-0000-4000-8000-999999999999",
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
      day: "Oct 22, 2026",
      primaryEntityId: new ObjectID(SERVICE_ID),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataIngestedInGB: new Decimal(3),
      // As every Traces row counted before #6356 is: no part.
      exceptionDataIngestedInGB: null,
      totalCostInUSD: new Decimal(0),
      retainTelemetryDataForDays: 15,
      isReportedToBillingProvider: false,
      createdAt: utcMidnight("2026-10-22"),
    });

    await add({ gigabytes: 2, exceptions: 1 });

    expect(store).toHaveLength(1);
    expect(gbOf(store[0]!)).toBe(5);
    // A part of 1 GB would show 2 GB of the old exceptions as spans.
    expect(exceptionsOf(store[0]!)).toBeNull();
  });

  test("and when what is added has none", async () => {
    await add({ gigabytes: 4, exceptions: 1 });
    await add({ gigabytes: 1 });

    expect(gbOf(store[0]!)).toBe(5);
    expect(exceptionsOf(store[0]!)).toBeNull();
  });

  test("holds a part to the row: never more than it is billed for, never below none", async () => {
    await add({ gigabytes: 5, exceptions: 7 });

    expect(exceptionsOf(store[0]!)).toBe(5);

    store = [];
    await add({ gigabytes: 5, exceptions: -1 });

    expect(exceptionsOf(store[0]!)).toBe(0);

    store = [];
    await add({ gigabytes: 5, exceptions: Number.NaN });

    expect(exceptionsOf(store[0]!)).toBeNull();
  });

  test("keeps a part on Traces rows only", async () => {
    await add({
      productType: ProductType.Logs,
      gigabytes: 5,
      exceptions: 2,
    });

    expect(store[0]!.productType).toBe(ProductType.Logs);
    expect(exceptionsOf(store[0]!)).toBeNull();

    await add({
      productType: ProductType.Logs,
      gigabytes: 1,
      exceptions: 1,
    });

    expect(gbOf(store[0]!)).toBe(6);
    expect(exceptionsOf(store[0]!)).toBeNull();
  });

  test("costs, where billing stages it, what its whole GB costs, whatever its part", async () => {
    mockIsBillingEnabled = true;

    await add({ gigabytes: 30, exceptions: 30, isBillable: true });
    await add({ gigabytes: 20, exceptions: 0, isBillable: true });

    expect(gbOf(store[0]!)).toBe(50);
    expect(exceptionsOf(store[0]!)).toBe(30);
    expect(costOf(store[0]!)).toBeCloseTo(
      TracesDataIngestMetredPlan.getTotalCostInUSD({
        dataIngestedInGB: 50,
        retentionInDays: 15,
      }),
      10,
    );
  });
});

describe("what charges for usage", () => {
  const read: (relative: string) => string = (relative: string): string => {
    return fs
      .readFileSync(path.join(__dirname, relative), "utf8")
      .replace(/\s+/g, " ");
  };

  test("never reads the exceptions part: only what each row costs", () => {
    const plan: string = read(
      "../../../Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan.ts",
    );
    const service: string = read(
      "../../../Server/Services/TelemetryUsageBillingService.ts",
    );

    expect(plan).not.toContain("exceptionDataIngestedInGB");

    // The billing run's read of what it reports: the id and the cost.
    const unreported: string = service.slice(
      service.indexOf("public async getUnreportedUsageBilling"),
      service.indexOf("public async waiveUnreportedUsageBilling"),
    );

    expect(unreported).toContain(
      "select: { _id: true, totalCostInUSD: true, },",
    );
    expect(unreported).not.toContain("exceptionDataIngestedInGB");

    // The cloud marketplaces' hourly usage reports, where ee/ is checked out.
    const reporter: string = path.join(
      __dirname,
      "../../../../../ee/Server/CloudMarketplace/MarketplaceUsageReporter.ts",
    );

    if (fs.existsSync(reporter)) {
      const source: string = fs
        .readFileSync(reporter, "utf8")
        .replace(/\s+/g, " ");

      expect(source).toContain(
        "select: { _id: true, totalCostInUSD: true, day: true },",
      );
      expect(source).not.toContain("exceptionDataIngestedInGB");
    }
  });

  test("prices a row from all it is billed for, before its part is even read", () => {
    const service: string = read(
      "../../../Server/Services/TelemetryUsageBillingService.ts",
    );
    const update: string = service.slice(
      service.indexOf("public async updateUsageBilling"),
      service.indexOf("private getExceptionPartInGB"),
    );

    expect(update).toContain(
      "serverMeteredPlan.getTotalCostInUSD({ dataIngestedInGB: data.dataIngestedInGB, retentionInDays: data.retentionInDays, })",
    );
    expect(update.indexOf("getTotalCostInUSD")).toBeLessThan(
      update.indexOf("getExceptionPartInGB"),
    );
  });
});
