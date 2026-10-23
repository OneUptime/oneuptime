/*
 * IsBillingEnabled is a module-load `const` in the real EnvironmentConfig, and
 * the service's constructor schedules a cleanup job when it is true. A getter
 * laid over the otherwise real module keeps it false while the service module
 * loads and lets these tests flip it on afterwards (the same pattern as
 * TelemetryUsageBillingSloExclusion.test.ts).
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
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import TelemetryUsageBillingService from "../../../Server/Services/TelemetryUsageBillingService";
import { SessionReplayDataIngestMeteredPlan } from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import {
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "../../../Types/Billing/PayAsYouGoPricing";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Session replay recordings are kept for the RUM application's replay
 * retention (7 days unless changed), which the session replay gate resolves
 * per application and never from the telemetry retention settings. Billing
 * used to price replay at the project's telemetry default instead - 15 days
 * unless changed - so a default customer paid for 15 days of recordings that
 * were kept for 7, about 2.1x the advertised $2 per GB per 15 days. These
 * tests pin that replay is billed for the days it is kept, and that the
 * application's other telemetry still bills at its telemetry retention.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEFAULT_APP_ID: string = "22222222-2222-4222-8222-222222222222";
const THIRTY_DAY_APP_ID: string = "33333333-3333-4333-8333-333333333333";
const TEN_DAY_APP_ID: string = "44444444-4444-4444-8444-444444444444";
const LONG_APP_ID: string = "55555555-5555-4555-8555-555555555555";
const DELETED_APP_ID: string = "66666666-6666-4666-8666-666666666666";

const ONE_GIB: number = 1024 * 1024 * 1024;

interface StagedUsage {
  primaryEntityId: ObjectID;
  primaryEntityType?: ServiceType | undefined;
  dataIngestedInGB: number;
  retentionInDays: number;
}

function replayUsage(applicationId: string): {
  primaryEntityId: string;
  primaryEntityType: string;
  rowCount: number;
  estimatedBytes: number;
} {
  return {
    primaryEntityId: applicationId,
    primaryEntityType: ServiceType.RealUserMonitor,
    rowCount: 100,
    estimatedBytes: ONE_GIB,
  };
}

function application(
  id: string,
  sessionReplayRetentionInDays: number | undefined,
): RumApplication {
  return Object.assign(new RumApplication(), {
    _id: id,
    sessionReplayRetentionInDays: sessionReplayRetentionInDays,
  });
}

describe("stageTelemetryUsageForProject bills session replay at the replay retention", () => {
  let staged: Array<StagedUsage>;
  let telemetryRetentionMap: jest.SpyInstance;
  let projectDefaultRetention: jest.SpyInstance;

  beforeEach(() => {
    staged = [];
    mockIsBillingEnabled = true;

    jest
      .spyOn(PayAsYouGoBillingService, "isLiveAuthorizationFor")
      .mockReturnValue(true);
    jest
      .spyOn(PayAsYouGoBillingService, "getTelemetryBillingStartDate")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(RumSessionService, "groupSessionReplayUsageByEntity")
      .mockResolvedValue([
        replayUsage(DEFAULT_APP_ID),
        replayUsage(THIRTY_DAY_APP_ID),
        replayUsage(TEN_DAY_APP_ID),
        replayUsage(LONG_APP_ID),
        replayUsage(DELETED_APP_ID),
      ]);

    jest
      .spyOn(RumApplicationService, "findBy")
      .mockResolvedValue([
        application(DEFAULT_APP_ID, undefined),
        application(THIRTY_DAY_APP_ID, 30),
        application(TEN_DAY_APP_ID, 10),
        application(LONG_APP_ID, 365),
      ] as never);

    /*
     * The telemetry retention a replay must NOT be billed at: a 30-day
     * project default, and a 90-day telemetry override on one application.
     */
    telemetryRetentionMap = jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          buildTelemetryRetentionMap: () => Promise<Map<string, number>>;
        },
        "buildTelemetryRetentionMap",
      )
      .mockResolvedValue(new Map<string, number>([[THIRTY_DAY_APP_ID, 90]]));
    projectDefaultRetention = jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          getProjectDefaultRetentionInDays: () => Promise<number>;
        },
        "getProjectDefaultRetentionInDays",
      )
      .mockResolvedValue(30);

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

  function stagedRetention(applicationId: string): number | undefined {
    return staged.find((usage: StagedUsage): boolean => {
      return usage.primaryEntityId.toString() === applicationId;
    })?.retentionInDays;
  }

  test("an application that sets nothing is billed for 7 days, not the project's 30-day telemetry default", async () => {
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SessionReplay,
    });

    expect(stagedRetention(DEFAULT_APP_ID)).toBe(7);
  });

  test("an application's own replay retention wins over its telemetry override", async () => {
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SessionReplay,
    });

    expect(stagedRetention(THIRTY_DAY_APP_ID)).toBe(30);
  });

  test("a setting is clamped exactly as ingest clamps it", async () => {
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SessionReplay,
    });

    expect(stagedRetention(TEN_DAY_APP_ID)).toBe(14);
    expect(stagedRetention(LONG_APP_ID)).toBe(90);
  });

  test("an application deleted since it recorded is billed at the replay default", async () => {
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SessionReplay,
    });

    expect(stagedRetention(DELETED_APP_ID)).toBe(7);
  });

  test("replay staging never reads the telemetry retention settings", async () => {
    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.SessionReplay,
    });

    expect(staged).toHaveLength(5);
    expect(telemetryRetentionMap).not.toHaveBeenCalled();
    expect(projectDefaultRetention).not.toHaveBeenCalled();
  });

  test("the application's web vitals still bill at its telemetry retention", async () => {
    jest
      .spyOn(MetricService, "groupTelemetryUsageByService")
      .mockResolvedValue([
        {
          primaryEntityId: THIRTY_DAY_APP_ID,
          primaryEntityType: ServiceType.RealUserMonitor,
          rowCount: 1000,
          estimatedBytes: ONE_GIB,
        },
        {
          primaryEntityId: DEFAULT_APP_ID,
          primaryEntityType: ServiceType.RealUserMonitor,
          rowCount: 1000,
          estimatedBytes: ONE_GIB,
        },
      ] as never);

    await TelemetryUsageBillingService.stageTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
    });

    expect(stagedRetention(THIRTY_DAY_APP_ID)).toBe(90);
    expect(stagedRetention(DEFAULT_APP_ID)).toBe(30);
  });
});

describe("the session replay charge", () => {
  test("is the advertised $2 per GB per 15 days, for the 7 days a default application keeps", () => {
    const sevenDayCharge: number =
      SessionReplayDataIngestMeteredPlan.getTotalCostInUSD({
        dataIngestedInGB: 1,
        retentionInDays: 7,
      });

    expect(sevenDayCharge).toBeCloseTo(
      (SESSION_REPLAY_PRICE_IN_USD_PER_GB * 7) /
        TELEMETRY_PRICE_RETENTION_IN_DAYS,
      10,
    );
    // What the same GB cost when replay was billed at a 15-day project default.
    expect(
      SessionReplayDataIngestMeteredPlan.getTotalCostInUSD({
        dataIngestedInGB: 1,
        retentionInDays: 15,
      }) / sevenDayCharge,
    ).toBeCloseTo(15 / 7, 10);
  });
});
