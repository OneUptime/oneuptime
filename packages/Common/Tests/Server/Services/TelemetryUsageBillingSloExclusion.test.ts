/*
 * IsBillingEnabled is a module-load `const` in the real EnvironmentConfig, and
 * the service's constructor schedules a cleanup job when it is true. A getter
 * laid over the otherwise real module keeps it false while the service module
 * loads and lets the staging tests flip it on afterwards - TypeScript's
 * CommonJS emit reads it as a property at every use site.
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
  isTelemetryBillingExcludedEntityType,
  TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES,
  TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES,
} from "../../../Server/Services/TelemetryUsageBillingService";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import SessionReplayBudgetMetricType from "../../../Types/Rum/SessionReplayBudgetMetricType";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import SessionReplayBudgetMetricTypeUtil from "../../../Utils/Rum/SessionReplayBudgetMetricType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The SLO evaluation worker writes oneuptime.slo.* rows into the project's
 * own MetricItemV3 table every few minutes, keyed to the SLO with
 * primaryEntityType = ServiceLevelObjective. Metrics billing groups that
 * table by primaryEntityType, so without an explicit exclusion every SLO a
 * customer creates would appear on their invoice as ingested telemetry they
 * never sent. These tests pin the exclusion list, the helper, and - through
 * the real staging method - that an SLO row is never staged while a real
 * service's row still is.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const SLO_ID: string = "33333333-3333-4333-8333-333333333333";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";
const ALERT_ID: string = "55555555-5555-4555-8555-555555555555";
const INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";
const HOST_ID: string = "77777777-7777-4777-8777-777777777777";

describe("TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES", () => {
  test("is exactly OneUptime's own operational data: monitors, alerts, incidents and SLOs", () => {
    expect([...TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES].sort()).toEqual(
      [
        ServiceType.Monitor,
        ServiceType.Alert,
        ServiceType.Incident,
        ServiceType.ServiceLevelObjective,
      ].sort(),
    );
  });
});

describe("isTelemetryBillingExcludedEntityType", () => {
  test("never bills an SLO's oneuptime.slo.* rows", () => {
    expect(
      isTelemetryBillingExcludedEntityType(ServiceType.ServiceLevelObjective),
    ).toBe(true);
    // The raw column value, as the ClickHouse aggregation returns it.
    expect(isTelemetryBillingExcludedEntityType("ServiceLevelObjective")).toBe(
      true,
    );
  });

  test.each([ServiceType.Monitor, ServiceType.Alert, ServiceType.Incident])(
    "keeps excluding %s, as before",
    (type: ServiceType) => {
      expect(isTelemetryBillingExcludedEntityType(type)).toBe(true);
    },
  );

  test.each(
    (Object.values(ServiceType) as Array<ServiceType>).filter(
      (type: ServiceType): boolean => {
        return !TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES.includes(type);
      },
    ),
  )("still bills customer telemetry from %s", (type: ServiceType) => {
    expect(isTelemetryBillingExcludedEntityType(type)).toBe(false);
  });

  test.each([
    ["null (a legacy row, historically a real Service)", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["an unknown discriminator", "SomethingNew"],
    ["the wrong case", "servicelevelobjective"],
  ])(
    "bills %s rather than silently dropping it",
    (_name: string, value: string | null | undefined) => {
      expect(isTelemetryBillingExcludedEntityType(value)).toBe(false);
    },
  );
});

describe("stageTelemetryUsageForProject skips excluded entity types", () => {
  interface StagedUsage {
    primaryEntityId: ObjectID;
    primaryEntityType?: ServiceType | undefined;
    dataIngestedInGB: number;
  }

  let staged: Array<StagedUsage>;

  beforeEach(() => {
    staged = [];
    mockIsBillingEnabled = true;

    jest
      .spyOn(PayAsYouGoBillingService, "isLiveAuthorizationFor")
      .mockReturnValue(true);
    jest
      .spyOn(PayAsYouGoBillingService, "getTelemetryBillingStartDate")
      .mockResolvedValue(undefined as never);

    const bytes: number = 5 * 1024 * 1024 * 1024;

    jest
      .spyOn(MetricService, "groupTelemetryUsageByService")
      .mockResolvedValue([
        {
          primaryEntityId: SERVICE_ID,
          primaryEntityType: ServiceType.OpenTelemetry,
          rowCount: 1000,
          estimatedBytes: bytes,
        },
        {
          primaryEntityId: SLO_ID,
          primaryEntityType: ServiceType.ServiceLevelObjective,
          rowCount: 1000,
          estimatedBytes: bytes,
        },
        {
          primaryEntityId: MONITOR_ID,
          primaryEntityType: ServiceType.Monitor,
          rowCount: 1000,
          estimatedBytes: bytes,
        },
        {
          primaryEntityId: ALERT_ID,
          primaryEntityType: ServiceType.Alert,
          rowCount: 1000,
          estimatedBytes: bytes,
        },
        {
          primaryEntityId: INCIDENT_ID,
          primaryEntityType: ServiceType.Incident,
          rowCount: 1000,
          estimatedBytes: bytes,
        },
        {
          primaryEntityId: HOST_ID,
          primaryEntityType: ServiceType.Host,
          rowCount: 1000,
          estimatedBytes: bytes,
        },
      ] as never);

    // Private helpers: retention lookups that would otherwise hit Postgres.
    jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          buildTelemetryRetentionMap: () => Promise<Map<string, number>>;
        },
        "buildTelemetryRetentionMap",
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

    jest
      .spyOn(TelemetryUsageBillingService, "findBy")
      .mockResolvedValue([] as Array<TelemetryUsageBilling> as never);
    jest
      .spyOn(TelemetryUsageBillingService, "updateUsageBilling")
      .mockImplementation(async (data: StagedUsage): Promise<void> => {
        staged.push(data);
      });
  });

  afterEach(() => {
    mockIsBillingEnabled = false;
    jest.restoreAllMocks();
  });

  test("stages the service and the host, and never the SLO, monitor, alert or incident rows", async () => {
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
    });

    const stagedIds: Array<string> = staged.map(
      (usage: StagedUsage): string => {
        return usage.primaryEntityId.toString();
      },
    );

    expect(stagedIds.sort()).toEqual([SERVICE_ID, HOST_ID].sort());
    expect(stagedIds).not.toContain(SLO_ID);

    for (const usage of staged) {
      expect(usage.primaryEntityType).not.toBe(
        ServiceType.ServiceLevelObjective,
      );
      expect(usage.dataIngestedInGB).toBeGreaterThan(0);
    }
  });

  test("a project whose only metric rows are SLO readings stages nothing at all", async () => {
    jest
      .spyOn(MetricService, "groupTelemetryUsageByService")
      .mockResolvedValue([
        {
          primaryEntityId: SLO_ID,
          primaryEntityType: ServiceType.ServiceLevelObjective,
          rowCount: 288,
          estimatedBytes: 1024 * 1024,
        },
      ] as never);

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
    });

    expect(staged).toHaveLength(0);
  });
});

describe("the staging loop uses the shared exclusion", () => {
  test("decides through isTelemetryBillingExcludedEntityType, before anything is staged", () => {
    const source: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Server",
          "Services",
          "TelemetryUsageBillingService.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    const exclusionCheck: string =
      "if (isTelemetryBillingExcludedEntityType(usage.primaryEntityType)) { continue; }";

    expect(source).toContain(exclusionCheck);
    expect(source.indexOf(exclusionCheck)).toBeLessThan(
      source.indexOf("await this.updateUsageBilling({"),
    );
    // No second, hand-maintained list that could drift from the constant.
    expect(source).not.toContain(
      "usage.primaryEntityType === ServiceType.Monitor",
    );
  });
});

/*
 * The session replay budget sweep posts oneuptime.rum.session.replay.budget.*
 * readings keyed to the RUM application with primaryEntityType
 * RealUserMonitor - the same id and type as the application's real web
 * vitals, which must stay billed. So those rows are left out by NAME, inside
 * the Metrics scan only, and never by type. That is safe only because OTLP
 * ingest refuses the names (App's OtelMetricsIngestReservedNames.test.ts):
 * the pins below fail if either side drifts from the other.
 */

const RUM_APPLICATION_ID: string = "88888888-8888-4888-8888-888888888888";

const EVERY_BUDGET_METRIC_NAME: Array<string> = (
  Object.values(SessionReplayBudgetMetricType) as Array<string>
).sort();

describe("TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES", () => {
  test("is exactly the session replay budget series, every one of them", () => {
    expect([...TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES].sort()).toEqual(
      EVERY_BUDGET_METRIC_NAME,
    );
  });

  test("names only series OTLP ingest refuses, so no customer row can be stored under one for free", () => {
    for (const name of TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES) {
      expect(SessionReplayBudgetMetricTypeUtil.isReservedMetricName(name)).toBe(
        true,
      );
    }
  });

  test("leaves RUM applications billable by type: the exclusion is by name alone", () => {
    expect(TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES).not.toContain(
      ServiceType.RealUserMonitor,
    );
    expect(
      isTelemetryBillingExcludedEntityType(ServiceType.RealUserMonitor),
    ).toBe(false);
  });
});

describe("stageTelemetryUsageForProject excludes the budget series from the Metrics scan only", () => {
  interface StagedRumUsage {
    primaryEntityId: ObjectID;
    primaryEntityType?: ServiceType | undefined;
    dataIngestedInGB: number;
  }

  interface UsageScanSpies {
    spans: jest.SpyInstance;
    exceptions: jest.SpyInstance;
    logs: jest.SpyInstance;
    metrics: jest.SpyInstance;
    securityEvents: jest.SpyInstance;
    profiles: jest.SpyInstance;
    profileSamples: jest.SpyInstance;
    sessionReplay: jest.SpyInstance;
  }

  let staged: Array<StagedRumUsage>;
  let scans: UsageScanSpies;

  beforeEach(() => {
    staged = [];
    mockIsBillingEnabled = true;

    jest
      .spyOn(PayAsYouGoBillingService, "isLiveAuthorizationFor")
      .mockReturnValue(true);
    jest
      .spyOn(PayAsYouGoBillingService, "getTelemetryBillingStartDate")
      .mockResolvedValue(undefined as never);

    // Every usage scan any product can run, each finding nothing by default.
    scans = {
      spans: jest
        .spyOn(SpanService, "groupTelemetryUsageByService")
        .mockResolvedValue([]),
      exceptions: jest
        .spyOn(ExceptionInstanceService, "groupTelemetryUsageByService")
        .mockResolvedValue([]),
      logs: jest
        .spyOn(LogService, "groupTelemetryUsageByService")
        .mockResolvedValue([]),
      metrics: jest
        .spyOn(MetricService, "groupTelemetryUsageByService")
        .mockResolvedValue([]),
      securityEvents: jest
        .spyOn(SecurityEventService, "groupTelemetryUsageByService")
        .mockResolvedValue([]),
      profiles: jest
        .spyOn(ProfileService, "groupTelemetryUsageByService")
        .mockResolvedValue([]),
      profileSamples: jest
        .spyOn(ProfileSampleService, "groupTelemetryUsageByService")
        .mockResolvedValue([]),
      sessionReplay: jest
        .spyOn(RumSessionService, "groupSessionReplayUsageByEntity")
        .mockResolvedValue([]),
    };

    // Private helpers: retention lookups that would otherwise hit Postgres.
    jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          buildTelemetryRetentionMap: () => Promise<Map<string, number>>;
        },
        "buildTelemetryRetentionMap",
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

    jest
      .spyOn(TelemetryUsageBillingService, "findBy")
      .mockResolvedValue([] as Array<TelemetryUsageBilling> as never);
    jest
      .spyOn(TelemetryUsageBillingService, "updateUsageBilling")
      .mockImplementation(async (data: StagedRumUsage): Promise<void> => {
        staged.push(data);
      });
  });

  afterEach(() => {
    mockIsBillingEnabled = false;
    jest.restoreAllMocks();
  });

  test("the Metrics scan is told to leave out every budget metric name", async () => {
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
    });

    expect(scans.metrics).toHaveBeenCalledTimes(1);

    const scanArguments: {
      projectId: ObjectID;
      timestampColumnName: string;
      excludeNames?: Array<string> | undefined;
    } = scans.metrics.mock.calls[0]![0];

    expect([...(scanArguments.excludeNames || [])].sort()).toEqual(
      EVERY_BUDGET_METRIC_NAME,
    );
    // Nothing else about the scan changed.
    expect(scanArguments.projectId).toBe(PROJECT_ID);
    expect(scanArguments.timestampColumnName).toBe("time");
  });

  test("still stages a RUM application's own web vitals, which share the budget rows' id and type", async () => {
    scans.metrics.mockResolvedValue([
      {
        primaryEntityId: RUM_APPLICATION_ID,
        primaryEntityType: ServiceType.RealUserMonitor,
        rowCount: 1000,
        estimatedBytes: 5 * 1024 * 1024 * 1024,
      },
    ]);

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
    });

    expect(staged).toHaveLength(1);
    expect(staged[0]!.primaryEntityId.toString()).toBe(RUM_APPLICATION_ID);
    expect(staged[0]!.primaryEntityType).toBe(ServiceType.RealUserMonitor);
    expect(staged[0]!.dataIngestedInGB).toBeGreaterThan(0);
  });

  test.each([
    [ProductType.Traces, ["spans", "exceptions"]],
    [ProductType.Logs, ["logs"]],
    [ProductType.SecurityEvents, ["securityEvents"]],
    [ProductType.Profiles, ["profiles", "profileSamples"]],
    [ProductType.SessionReplay, ["sessionReplay"]],
  ])(
    "the %s scans exclude no names",
    async (productType: ProductType, expectedScans: Array<string>) => {
      await TelemetryUsageBillingService.stageTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: productType,
      });

      for (const [scanName, spy] of Object.entries(scans) as Array<
        [string, jest.SpyInstance]
      >) {
        if (!expectedScans.includes(scanName)) {
          expect(spy).not.toHaveBeenCalled();
          continue;
        }

        expect(spy).toHaveBeenCalledTimes(1);
        expect(
          Object.keys(spy.mock.calls[0]![0] as Record<string, unknown>),
        ).not.toContain("excludeNames");
      }
    },
  );
});
