/*
 * IsBillingEnabled is a module-load `const` in the real EnvironmentConfig. A
 * getter laid over the otherwise real module lets each test say whether
 * billing is on - and turn it on part way, as an install that starts billing
 * does (the same pattern as TelemetryUsageCatchUpStaging.test.ts).
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
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import LogService from "../../../Server/Services/LogService";
import MetricService from "../../../Server/Services/MetricService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProfileSampleService from "../../../Server/Services/ProfileSampleService";
import ProfileService from "../../../Server/Services/ProfileService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import SpanService from "../../../Server/Services/SpanService";
import TelemetryUsageBillingService, {
  TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES,
  TelemetryResourceUsage,
} from "../../../Server/Services/TelemetryUsageBillingService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  LogDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
} from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import logger from "../../../Server/Utils/Logger";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import Decimal from "../../../Types/Decimal";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5916: telemetry usage is metered where billing is off too, so a
 * self-hosted install (Community Edition included) sees what each project
 * and service sends. Metering reuses billing's per-resource byteSize(*) scan
 * and its rows, and skips everything that is about paying: the live
 * pay-as-you-go authorization, the billing cutoff, and the cost.
 *
 * Billing safety comes first. A row metered while billing was off must never
 * be charged - not by the billing run, not by the marketplace usage reports,
 * not when billing is turned on later - and billing's own behaviour for
 * paying and free projects must not change. The rows live in an in-memory
 * store below, which evaluates the queries the service really sends, so the
 * scenarios run the real staging, metering and reporting code end to end.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";
const SLO_ID: string = "55555555-5555-4555-8555-555555555555";
const RUM_APP_ID: string = "66666666-6666-4666-8666-666666666666";
const DATA_STORE_ID: string = "77777777-7777-4777-8777-777777777777";

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
 * The ClickHouse side: the days a table has rows on, and its usage scan,
 * per product. Days are YYYY-MM-DD; a scan answers for the day it is asked.
 */
interface ScanRow {
  primaryEntityId: string;
  primaryEntityType: string | null;
  rowCount: number;
  estimatedBytes: number;
}

let telemetryDays: Array<string> = [];
let scanRows: Array<ScanRow> = [];

interface Spies {
  logScan: jest.SpyInstance;
  metricScan: jest.SpyInstance;
  spanScan: jest.SpyInstance;
  exceptionScan: jest.SpyInstance;
  profileScan: jest.SpyInstance;
  profileSampleScan: jest.SpyInstance;
  securityScan: jest.SpyInstance;
  replayScan: jest.SpyInstance;
  canUsePayAsYouGo: jest.SpyInstance;
  isLiveAuthorizationFor: jest.SpyInstance;
  getTelemetryBillingStartDate: jest.SpyInstance;
  authorizeUsageNow: jest.SpyInstance;
  create: jest.SpyInstance;
  hardDeleteBy: jest.SpyInstance;
  globalConfig: jest.SpyInstance;
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
  const scan: () => Promise<Array<ScanRow>> = async (): Promise<
    Array<ScanRow>
  > => {
    return scanRows;
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

  spies.logScan = jest
    .spyOn(LogService, "groupTelemetryUsageByService")
    .mockImplementation(scan as never);
  spies.metricScan = jest
    .spyOn(MetricService, "groupTelemetryUsageByService")
    .mockImplementation(scan as never);
  spies.spanScan = jest
    .spyOn(SpanService, "groupTelemetryUsageByService")
    .mockImplementation(scan as never);
  spies.exceptionScan = jest
    .spyOn(ExceptionInstanceService, "groupTelemetryUsageByService")
    .mockResolvedValue([] as never);
  spies.profileScan = jest
    .spyOn(ProfileService, "groupTelemetryUsageByService")
    .mockImplementation(scan as never);
  spies.profileSampleScan = jest
    .spyOn(ProfileSampleService, "groupTelemetryUsageByService")
    .mockResolvedValue([] as never);
  spies.securityScan = jest
    .spyOn(SecurityEventService, "groupTelemetryUsageByService")
    .mockImplementation(scan as never);
  spies.replayScan = jest
    .spyOn(RumSessionService, "groupSessionReplayUsageByEntity")
    .mockImplementation(scan as never);
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
    .mockResolvedValue(new Map<string, number>([[RUM_APP_ID, 3]]));
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
  spies.isLiveAuthorizationFor = jest
    .spyOn(PayAsYouGoBillingService, "isLiveAuthorizationFor")
    .mockReturnValue(false);
  spies.getTelemetryBillingStartDate = jest
    .spyOn(PayAsYouGoBillingService, "getTelemetryBillingStartDate")
    .mockResolvedValue(undefined as never);
  spies.authorizeUsageNow = jest
    .spyOn(PayAsYouGoBillingService, "authorizeUsageNow")
    .mockResolvedValue(
      options.canPay
        ? ({
            projectId: PROJECT_ID.toString(),
            decidedAt: Date.now(),
          } as never)
        : (null as never),
    );
}

function costOf(row: StoredRow): number {
  return Number(row.totalCostInUSD.value);
}

function gbOf(row: StoredRow): number {
  return Number(row.dataIngestedInGB.value);
}

beforeEach(() => {
  mockIsBillingEnabled = false;
  store = [];
  nextId = 0;
  telemetryDays = [];
  scanRows = [];
  spies = {} as Spies;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  // A failing day is logged loudly; the tests read what it did instead.
  jest.spyOn(logger, "error").mockImplementation(() => {});

  installStore();
  installTelemetry();
  installRetention();
  installPayments({ canPay: true });

  spies.hardDeleteBy = jest
    .spyOn(TelemetryUsageBillingService, "hardDeleteBy")
    .mockResolvedValue(0 as never);
  spies.globalConfig = jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(null as never);
});

afterEach(() => {
  mockIsBillingEnabled = false;
  jest.restoreAllMocks();
});

describe("metering where billing is off", () => {
  test("counts every day of the week that has telemetry and no usage yet, oldest first", async () => {
    telemetryDays = ["2026-10-22", "2026-10-16", "2026-10-19"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 1000,
        estimatedBytes: 2 * GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(
      store.map((row: StoredRow): string => {
        return row.day;
      }),
    ).toEqual(["Oct 16, 2026", "Oct 19, 2026", "Oct 22, 2026"]);

    expect(
      store.map((row: StoredRow): string => {
        return row.createdAt.toISOString();
      }),
    ).toEqual([
      "2026-10-16T00:00:00.000Z",
      "2026-10-19T00:00:00.000Z",
      "2026-10-22T00:00:00.000Z",
    ]);
  });

  test("stages each row at no cost, unreported, with the GB and retention billing would stage", async () => {
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 1000,
        estimatedBytes: 2 * GB,
      },
      {
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        rowCount: 500,
        estimatedBytes: GB / 2,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(store).toHaveLength(2);

    const service: StoredRow = store.find((row: StoredRow) => {
      return row.primaryEntityId.toString() === SERVICE_ID;
    })!;
    const host: StoredRow = store.find((row: StoredRow) => {
      return row.primaryEntityId.toString() === HOST_ID;
    })!;

    expect(gbOf(service)).toBe(2);
    expect(gbOf(host)).toBe(0.5);
    expect(service.primaryEntityType).toBe(ServiceType.OpenTelemetry);
    expect(host.primaryEntityType).toBe(ServiceType.Host);

    // The project default, and the host's own retention override.
    expect(service.retainTelemetryDataForDays).toBe(15);
    expect(host.retainTelemetryDataForDays).toBe(30);

    for (const row of store) {
      expect(costOf(row)).toBe(0);
      expect(row.isReportedToBillingProvider).toBe(false);
      expect(row.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(row.productType).toBe(ProductType.Logs);
    }
  });

  test("never asks a payment provider anything", async () => {
    telemetryDays = ["2026-10-20", "2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(store).toHaveLength(2);
    expect(spies.canUsePayAsYouGo).not.toHaveBeenCalled();
    expect(spies.isLiveAuthorizationFor).not.toHaveBeenCalled();
    expect(spies.getTelemetryBillingStartDate).not.toHaveBeenCalled();
    expect(spies.authorizeUsageNow).not.toHaveBeenCalled();
  });

  test("counts a day once: the next run finds it counted and scans nothing", async () => {
    telemetryDays = ["2026-10-21", "2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(spies.logScan).toHaveBeenCalledTimes(2);
    expect(store).toHaveLength(2);

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(spies.logScan).toHaveBeenCalledTimes(2);
    expect(store).toHaveLength(2);
    expect(gbOf(store[0]!)).toBe(1);
  });

  test("never counts today, nor a day older than the week", async () => {
    telemetryDays = ["2026-10-23", "2026-10-15"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(spies.logScan).not.toHaveBeenCalled();
    expect(store).toHaveLength(0);
  });

  test("a project with no telemetry costs the day query and no scan", async () => {
    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(LogService.getDaysWithRows).toHaveBeenCalledTimes(1);
    expect(spies.logScan).not.toHaveBeenCalled();
    expect(store).toHaveLength(0);
  });

  test("a day that fails is left for the next run, and the others are counted", async () => {
    telemetryDays = ["2026-10-17", "2026-10-19", "2026-10-22"];
    const timeout: Error = new Error("Timeout exceeded: elapsed 120 seconds");

    spies.logScan.mockImplementation((async (data: {
      startDate: Date;
    }): Promise<Array<ScanRow>> => {
      if (data.startDate.toISOString().startsWith("2026-10-19")) {
        throw timeout;
      }

      return [
        {
          primaryEntityId: SERVICE_ID,
          primaryEntityType: ServiceType.OpenTelemetry,
          rowCount: 10,
          estimatedBytes: GB,
        },
      ];
    }) as never);

    await expect(
      TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
      }),
    ).rejects.toBe(timeout);

    expect(
      store.map((row: StoredRow): string => {
        return row.day;
      }),
    ).toEqual(["Oct 17, 2026", "Oct 22, 2026"]);

    // The next run, the scan healthy again, counts the day that failed.
    spies.logScan.mockImplementation((async (): Promise<Array<ScanRow>> => {
      return [
        {
          primaryEntityId: SERVICE_ID,
          primaryEntityType: ServiceType.OpenTelemetry,
          rowCount: 10,
          estimatedBytes: GB,
        },
      ];
    }) as never);

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(
      store
        .map((row: StoredRow): string => {
          return row.day;
        })
        .sort(),
    ).toEqual(["Oct 17, 2026", "Oct 19, 2026", "Oct 22, 2026"]);
  });

  test("a day with a row already is not counted again for any resource", async () => {
    telemetryDays = ["2026-10-22"];
    store.push({
      _id: "00000000-0000-4000-8000-999999999999",
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      day: "Oct 22, 2026",
      primaryEntityId: new ObjectID(SERVICE_ID),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataIngestedInGB: new Decimal(1),
      totalCostInUSD: new Decimal(0),
      retainTelemetryDataForDays: 15,
      isReportedToBillingProvider: false,
      createdAt: utcMidnight("2026-10-22"),
    });
    scanRows = [
      {
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(spies.logScan).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
  });

  test("metering one day skips the resources it has counted already", async () => {
    store.push({
      _id: "00000000-0000-4000-8000-999999999999",
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      day: "Oct 22, 2026",
      primaryEntityId: new ObjectID(SERVICE_ID),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataIngestedInGB: new Decimal(1),
      totalCostInUSD: new Decimal(0),
      retainTelemetryDataForDays: 15,
      isReportedToBillingProvider: false,
      createdAt: utcMidnight("2026-10-22"),
    });
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB,
      },
      {
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      usageDate: utcMidnight("2026-10-22"),
    });

    expect(store).toHaveLength(2);
    // The service's row is as it was: not counted twice.
    expect(gbOf(store[0]!)).toBe(1);
    expect(store[1]!.primaryEntityId.toString()).toBe(HOST_ID);
  });

  test("leaves out OneUptime's own telemetry: monitors, SLOs and Data Observability", async () => {
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB,
      },
      {
        primaryEntityId: MONITOR_ID,
        primaryEntityType: ServiceType.Monitor,
        rowCount: 10,
        estimatedBytes: GB,
      },
      {
        primaryEntityId: SLO_ID,
        primaryEntityType: ServiceType.ServiceLevelObjective,
        rowCount: 10,
        estimatedBytes: GB,
      },
      {
        primaryEntityId: DATA_STORE_ID,
        primaryEntityType: ServiceType.DataStore,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
    });

    expect(
      store.map((row: StoredRow): string => {
        return row.primaryEntityId.toString();
      }),
    ).toEqual([SERVICE_ID]);

    // And the session replay budget series, inside the metrics scan.
    expect([...spies.metricScan.mock.calls[0]![0].excludeNames].sort()).toEqual(
      [...TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES].sort(),
    );
  });

  test("counts session replays at their application's replay retention", async () => {
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: RUM_APP_ID,
        primaryEntityType: ServiceType.RealUserMonitor,
        rowCount: 4,
        estimatedBytes: GB / 4,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SessionReplay,
    });

    expect(spies.replayScan).toHaveBeenCalledTimes(1);
    expect(store).toHaveLength(1);
    expect(store[0]!.retainTelemetryDataForDays).toBe(3);
    expect(costOf(store[0]!)).toBe(0);
  });

  test("counts a trace day's spans and exceptions into one row per resource", async () => {
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];
    spies.exceptionScan.mockResolvedValue([
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB / 2,
      },
    ] as never);

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(store).toHaveLength(1);
    expect(gbOf(store[0]!)).toBe(1.5);
  });

  test("counts a legacy row of no type as a Service", async () => {
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: null,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(store[0]!.primaryEntityType).toBe(ServiceType.OpenTelemetry);
  });

  test("does nothing at all where billing is on: billing stages usage itself", async () => {
    mockIsBillingEnabled = true;
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });
    await TelemetryUsageBillingService.meterTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      usageDate: utcMidnight("2026-10-22"),
    });

    expect(LogService.getDaysWithRows).not.toHaveBeenCalled();
    expect(spies.logScan).not.toHaveBeenCalled();
    expect(store).toHaveLength(0);
  });
});

describe("billing, unchanged where billing is on", () => {
  beforeEach(() => {
    mockIsBillingEnabled = true;
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 1000,
        estimatedBytes: 2 * GB,
      },
    ];
  });

  test("a paying project's day is staged with what it costs", async () => {
    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(store).toHaveLength(1);
    expect(costOf(store[0]!)).toBeCloseTo(
      LogDataIngestMeteredPlan.getTotalCostInUSD({
        dataIngestedInGB: 2,
        retentionInDays: 15,
      }),
      10,
    );
    expect(costOf(store[0]!)).toBeGreaterThan(0);
    expect(spies.canUsePayAsYouGo).toHaveBeenCalledWith(PROJECT_ID, {
      useCache: false,
    });
    expect(spies.getTelemetryBillingStartDate).toHaveBeenCalled();
  });

  test("a free project that cannot pay as it goes is waived, and nothing is staged", async () => {
    installPayments({ canPay: false });
    store.push({
      _id: "00000000-0000-4000-8000-999999999999",
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      day: "Oct 10, 2026",
      primaryEntityId: new ObjectID(SERVICE_ID),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataIngestedInGB: new Decimal(1),
      totalCostInUSD: new Decimal(4),
      retainTelemetryDataForDays: 15,
      isReportedToBillingProvider: false,
      createdAt: utcMidnight("2026-10-10"),
    });

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    // The earlier row is waived, and the day is not staged.
    expect(store).toHaveLength(1);
    expect(costOf(store[0]!)).toBe(0);
  });

  test("a day before the project's billing cutoff is never staged", async () => {
    spies.getTelemetryBillingStartDate.mockResolvedValue(
      utcMidnight("2026-10-23") as never,
    );

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      usageDate: utcMidnight("2026-10-22"),
    });

    expect(store).toHaveLength(0);
  });

  test("billing's catch-up stages nothing where billing is off, as before", async () => {
    mockIsBillingEnabled = false;

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      usageDate: utcMidnight("2026-10-22"),
    });

    expect(store).toHaveLength(0);
  });
});

describe("billing turned on after usage was metered without it", () => {
  async function meterTheWeekWithoutBilling(): Promise<void> {
    mockIsBillingEnabled = false;
    telemetryDays = ["2026-10-20", "2026-10-21", "2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 1000,
        estimatedBytes: 4 * GB,
      },
    ];

    for (const productType of [ProductType.Logs, ProductType.Traces]) {
      await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: productType,
      });
    }

    expect(store).toHaveLength(6);
  }

  test("never stages a metered day again, so nothing is charged retroactively", async () => {
    await meterTheWeekWithoutBilling();

    mockIsBillingEnabled = true;
    const stage: jest.SpyInstance = jest.spyOn(
      TelemetryUsageBillingService,
      "stageTelemetryUsageForProject",
    );

    for (const productType of [ProductType.Logs, ProductType.Traces]) {
      await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: productType,
      });
    }

    expect(stage).not.toHaveBeenCalled();
    expect(store).toHaveLength(6);

    for (const row of store) {
      expect(costOf(row)).toBe(0);
    }
  });

  test("even a day staged for billing directly adds no cost to a resource it metered", async () => {
    await meterTheWeekWithoutBilling();

    mockIsBillingEnabled = true;

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      usageDate: utcMidnight("2026-10-22"),
    });

    expect(store).toHaveLength(6);

    for (const row of store) {
      expect(costOf(row)).toBe(0);
    }
  });

  test("the billing run reports none of it to the payment provider", async () => {
    await meterTheWeekWithoutBilling();

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

    for (const plan of [LogDataIngestMeteredPlan, TracesDataIngestMetredPlan]) {
      await plan.reportQuantityToBillingProvider(PROJECT_ID, {});
    }

    expect(report).not.toHaveBeenCalled();

    for (const row of store) {
      expect(row.isReportedToBillingProvider).toBe(false);
      expect(costOf(row)).toBe(0);
    }

    // What the run would report, as it reads it: nothing.
    expect(
      await TelemetryUsageBillingService.getUnreportedUsageBilling({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
      }),
    ).toEqual([]);
  });

  test("a metered row that is added to still costs nothing", async () => {
    for (let run: number = 0; run < 2; run++) {
      await TelemetryUsageBillingService.updateUsageBilling({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        primaryEntityId: new ObjectID(SERVICE_ID),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataIngestedInGB: 3,
        retentionInDays: 90,
        usageDate: utcMidnight("2026-10-22"),
        isBillable: false,
      });
    }

    expect(store).toHaveLength(1);
    expect(gbOf(store[0]!)).toBe(6);
    expect(costOf(store[0]!)).toBe(0);
  });

  test("every path that charges for usage takes only rows that cost something", () => {
    const read: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(__dirname, relative), "utf8");
    };
    const service: string = read(
      "../../../Server/Services/TelemetryUsageBillingService.ts",
    ).replace(/\s+/g, " ");

    // The billing run's report (getUnreportedUsageBilling).
    expect(service).toContain(
      "isReportedToBillingProvider: false, totalCostInUSD: QueryHelper.greaterThan(0), }, skip: 0, limit: LIMIT_MAX, /// because a project can have MANY telemetry services.",
    );

    // The cloud marketplaces' hourly usage reports, where ee/ is checked out.
    const reporter: string = path.join(
      __dirname,
      "../../../../../ee/Server/CloudMarketplace/MarketplaceUsageReporter.ts",
    );

    if (fs.existsSync(reporter)) {
      expect(fs.readFileSync(reporter, "utf8").replace(/\s+/g, " ")).toContain(
        "isReportedToBillingProvider: false, totalCostInUSD: QueryHelper.greaterThan(0),",
      );
    }
  });
});

describe("billing turned off after it staged usage", () => {
  test("metering leaves a billed day as billing staged it", async () => {
    mockIsBillingEnabled = true;
    telemetryDays = ["2026-10-22"];
    scanRows = [
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        rowCount: 1000,
        estimatedBytes: 2 * GB,
      },
    ];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    const billedCost: number = costOf(store[0]!);
    expect(billedCost).toBeGreaterThan(0);

    mockIsBillingEnabled = false;

    await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(store).toHaveLength(1);
    expect(costOf(store[0]!)).toBe(billedCost);
  });
});

describe("the usage each resource sent", () => {
  test("falls back to the configured row size when the engine reports no bytes", async () => {
    scanRows = [
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
        productType: ProductType.Logs,
        startDate: utcMidnight("2026-10-22"),
        endDate: OneUptimeDate.getEndOfDay(utcMidnight("2026-10-22"), "UTC"),
      });

    expect(usage.get(SERVICE_ID)?.bytes).toBeGreaterThan(0);
    expect(usage.get(SERVICE_ID)?.primaryEntityType).toBe(
      ServiceType.OpenTelemetry,
    );
  });

  test("reads one UTC day, the project's own, from the product's tables", async () => {
    await TelemetryUsageBillingService.getTelemetryUsageByResource({
      projectId: PROJECT_ID,
      productType: ProductType.Profiles,
      startDate: utcMidnight("2026-10-22"),
      endDate: OneUptimeDate.getEndOfDay(utcMidnight("2026-10-22"), "UTC"),
    });

    expect(spies.profileScan).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      timestampColumnName: "startTime",
      startDate: utcMidnight("2026-10-22"),
      endDate: new Date("2026-10-22T23:59:59.999Z"),
    });
    expect(spies.profileSampleScan).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      timestampColumnName: "time",
      startDate: utcMidnight("2026-10-22"),
      endDate: new Date("2026-10-22T23:59:59.999Z"),
    });
    expect(spies.logScan).not.toHaveBeenCalled();
  });

  test("leaves out what is never counted, by type", async () => {
    scanRows = [
      {
        primaryEntityId: MONITOR_ID,
        primaryEntityType: ServiceType.Monitor,
        rowCount: 10,
        estimatedBytes: GB,
      },
      {
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        rowCount: 10,
        estimatedBytes: GB,
      },
    ];

    const usage: Map<string, TelemetryResourceUsage> =
      await TelemetryUsageBillingService.getTelemetryUsageByResource({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        startDate: utcMidnight("2026-10-22"),
        endDate: OneUptimeDate.getEndOfDay(utcMidnight("2026-10-22"), "UTC"),
      });

    expect(Array.from(usage.keys())).toEqual([HOST_ID]);
  });

  test("fails loudly, rather than counting part of a day, when a scan fails", async () => {
    spies.logScan.mockRejectedValue(new Error("Timeout exceeded") as never);

    await expect(
      TelemetryUsageBillingService.getTelemetryUsageByResource({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        startDate: utcMidnight("2026-10-22"),
        endDate: OneUptimeDate.getEndOfDay(utcMidnight("2026-10-22"), "UTC"),
      }),
    ).rejects.toThrow("Timeout exceeded");
  });
});

describe("how long usage rows are kept", () => {
  function cutoffOf(call: Array<unknown>): Date {
    const query: Record<string, unknown> = (
      call[0] as { query: Record<string, unknown> }
    ).query;
    const operator: RawOperator = query["createdAt"] as RawOperator;

    expect(operator.getSql!("COLUMN").startsWith("(COLUMN < :")).toBe(true);

    return Object.values(operator.objectLiteralParameters!)[0] as Date;
  }

  test("deletes the days past the saved retention, with billing off", async () => {
    spies.globalConfig.mockResolvedValue(
      Object.assign(new GlobalConfig(), {
        telemetryUsageRetentionInDays: 60,
      }) as never,
    );

    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    expect(result.retentionInDays).toBe(60);
    expect(cutoffOf(spies.hardDeleteBy.mock.calls[0]!)).toEqual(
      new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000),
    );
    expect(spies.hardDeleteBy.mock.calls[0]![0].props).toEqual({
      isRoot: true,
    });
  });

  test("and with billing on, the same way", async () => {
    mockIsBillingEnabled = true;

    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    // Empty: the 120 days the rows were always kept for where billing was on.
    expect(result.retentionInDays).toBe(120);
    expect(cutoffOf(spies.hardDeleteBy.mock.calls[0]!)).toEqual(
      new Date(NOW.getTime() - 120 * 24 * 60 * 60 * 1000),
    );
  });

  test("never deletes inside metering's week, whatever is saved", async () => {
    spies.globalConfig.mockResolvedValue(
      Object.assign(new GlobalConfig(), {
        telemetryUsageRetentionInDays: 3,
      }) as never,
    );

    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    expect(result.retentionInDays).toBe(30);
    expect(cutoffOf(spies.hardDeleteBy.mock.calls[0]!).getTime()).toBeLessThan(
      utcMidnight("2026-10-16").getTime(),
    );
  });

  test("deletes in batches until none is left, and says how many", async () => {
    spies.hardDeleteBy
      .mockResolvedValueOnce(LIMIT_MAX as never)
      .mockResolvedValueOnce(12 as never)
      .mockResolvedValueOnce(0 as never);

    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    expect(spies.hardDeleteBy).toHaveBeenCalledTimes(3);
    expect(result.deleted).toBe(LIMIT_MAX + 12);
  });

  // The cleanup deletes from the store, a batch at a time, as Postgres would.
  function deleteFromStore(): void {
    spies.hardDeleteBy.mockImplementation((async (args: {
      query: Record<string, unknown>;
      limit: number;
    }): Promise<number> => {
      const matched: Array<StoredRow> = rowsOf(args.query).slice(0, args.limit);

      store = store.filter((row: StoredRow): boolean => {
        return !matched.includes(row);
      });

      return matched.length;
    }) as never);
  }

  function rowOfAge(data: {
    daysOld: number;
    costInUSD: number;
    isReported: boolean;
  }): StoredRow {
    const row: StoredRow = {
      _id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      day: `${data.daysOld} days ago`,
      primaryEntityId: new ObjectID(HOST_ID),
      primaryEntityType: ServiceType.Host,
      dataIngestedInGB: new Decimal(1),
      totalCostInUSD: new Decimal(data.costInUSD),
      retainTelemetryDataForDays: 15,
      isReportedToBillingProvider: data.isReported,
      createdAt: new Date(NOW.getTime() - data.daysOld * 24 * 60 * 60 * 1000),
    };

    store.push(row);

    return row;
  }

  function keptIds(): Array<string> {
    return store
      .map((row: StoredRow): string => {
        return row._id;
      })
      .sort();
  }

  test("a shorter retention keeps what billing has yet to charge, for the 120 days usage was always kept", async () => {
    mockIsBillingEnabled = true;
    spies.globalConfig.mockResolvedValue(
      Object.assign(new GlobalConfig(), {
        telemetryUsageRetentionInDays: 30,
      }) as never,
    );
    deleteFromStore();

    // Past the 30 days: metered at no cost, billed and reported, still owed.
    rowOfAge({ daysOld: 40, costInUSD: 0, isReported: false });
    rowOfAge({ daysOld: 40, costInUSD: 2, isReported: true });
    const owed: StoredRow = rowOfAge({
      daysOld: 40,
      costInUSD: 2,
      isReported: false,
    });
    // Owed, but past the 120 days every row was kept for: deleted as before.
    rowOfAge({ daysOld: 130, costInUSD: 2, isReported: false });
    const recent: StoredRow = rowOfAge({
      daysOld: 20,
      costInUSD: 0,
      isReported: false,
    });

    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    expect(keptIds()).toEqual([owed._id, recent._id].sort());
    expect(result.deleted).toBe(3);
    expect(result.retentionInDays).toBe(30);

    // What is still owed is reported, then goes with the next cleanup.
    expect(
      (
        await TelemetryUsageBillingService.getUnreportedUsageBilling({
          projectId: PROJECT_ID,
          productType: ProductType.Logs,
        })
      ).map((row: TelemetryUsageBilling): string => {
        return row._id!.toString();
      }),
    ).toEqual([owed._id]);
  });

  test("where billing is off, a shorter retention deletes every row past it: none is owed", async () => {
    spies.globalConfig.mockResolvedValue(
      Object.assign(new GlobalConfig(), {
        telemetryUsageRetentionInDays: 30,
      }) as never,
    );
    deleteFromStore();

    rowOfAge({ daysOld: 31, costInUSD: 0, isReported: false });
    rowOfAge({ daysOld: 90, costInUSD: 0, isReported: false });
    const recent: StoredRow = rowOfAge({
      daysOld: 29,
      costInUSD: 0,
      isReported: false,
    });

    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    expect(keptIds()).toEqual([recent._id]);
    expect(result.deleted).toBe(2);
  });

  test("a retention of 120 days or more deletes every row past it in one sweep, owed or not", async () => {
    mockIsBillingEnabled = true;
    spies.globalConfig.mockResolvedValue(
      Object.assign(new GlobalConfig(), {
        telemetryUsageRetentionInDays: 200,
      }) as never,
    );
    deleteFromStore();

    rowOfAge({ daysOld: 210, costInUSD: 2, isReported: false });
    const kept: Array<StoredRow> = [
      rowOfAge({ daysOld: 150, costInUSD: 2, isReported: false }),
      rowOfAge({ daysOld: 150, costInUSD: 0, isReported: false }),
    ];

    const result: { deleted: number; cutoff: Date; retentionInDays: number } =
      await TelemetryUsageBillingService.deleteUsageOlderThanRetention();

    expect(keptIds()).toEqual(
      kept
        .map((row: StoredRow): string => {
          return row._id;
        })
        .sort(),
    );
    expect(result.deleted).toBe(1);
    // One batch, and the empty one that ends it.
    expect(spies.hardDeleteBy).toHaveBeenCalledTimes(2);
  });

  test("reads the setting from the instance's one GlobalConfig, as root", async () => {
    await TelemetryUsageBillingService.getUsageRetentionInDays();

    expect(spies.globalConfig).toHaveBeenCalledWith({
      id: ObjectID.getZeroObjectID(),
      select: { telemetryUsageRetentionInDays: true },
      props: { isRoot: true },
    });
  });

  test("no longer schedules a fixed 120-day delete of its own, which ran only with billing on", () => {
    expect(TelemetryUsageBillingService.hardDeleteItemByColumnName).toBe("");
    expect(TelemetryUsageBillingService.hardDeleteItemsOlderThanDays).toBe(0);
  });
});
