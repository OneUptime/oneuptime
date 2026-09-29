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

import MetricService from "../../../Server/Services/MetricService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import TelemetryUsageBillingService, {
  isTelemetryBillingExcludedEntityType,
  TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES,
} from "../../../Server/Services/TelemetryUsageBillingService";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
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
