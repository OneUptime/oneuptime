import ObjectID from "Common/Types/ObjectID";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * MeteredPlan:ReportTelemetryMeteredPlan (ee/Server/Billing/Jobs: OneUptime
 * Cloud's billing lives in ee/) reports every metered plan of every
 * project once a day. The plans used to share one try/catch per project, so
 * the first plan to fail - a Stripe error, a usage scan over its time cap -
 * skipped every plan after it for that project. These tests pin that each
 * plan is reported on its own.
 */

let mockCronFunction: PromiseVoidFunction | null = null;

jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: (
      _name: string,
      _options: unknown,
      runFunction: PromiseVoidFunction,
    ): void => {
      mockCronFunction = runFunction;
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    IsBillingEnabled: true,
    IsDevelopment: false,
  };
});

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: { sleep: jest.fn(async (): Promise<void> => {}) },
  };
});

const mockFindAllBy: jest.Mock = jest.fn();
const mockGetCurrentPlan: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: (...args: Array<unknown>): unknown => {
        return mockFindAllBy(...args);
      },
      getCurrentPlan: (...args: Array<unknown>): unknown => {
        return mockGetCurrentPlan(...args);
      },
    },
  };
});

const mockReported: Array<string> = [];

interface MockPlan {
  productType: string;
  failsFor: Set<string>;
  getProductType: () => string;
  reportQuantityToBillingProvider: jest.Mock;
}

function mockPlan(productType: string): MockPlan {
  const plan: MockPlan = {
    productType: productType,
    failsFor: new Set<string>(),
    getProductType: (): string => {
      return productType;
    },
    reportQuantityToBillingProvider: jest.fn(
      async (projectId: ObjectID): Promise<void> => {
        if (plan.failsFor.has(projectId.toString())) {
          throw new Error(`${productType} report failed`);
        }

        mockReported.push(`${projectId.toString()}:${productType}`);
      },
    ),
  };

  return plan;
}

const mockPlans: Record<string, MockPlan> = {
  ActiveMonitoringMeteredPlan: mockPlan("Active Monitoring"),
  LogDataIngestMeteredPlan: mockPlan("Logs"),
  MetricsDataIngestMeteredPlan: mockPlan("Metrics"),
  TracesDataIngestMetredPlan: mockPlan("Traces"),
  ProfilesDataIngestMeteredPlan: mockPlan("Profiles"),
  SessionReplayDataIngestMeteredPlan: mockPlan("Session Replay"),
  SecurityEventsDataIngestMeteredPlan: mockPlan("Security Events"),
};

jest.mock("Common/Server/Types/Billing/MeteredPlan/AllMeteredPlans", () => {
  return { __esModule: true, ...mockPlans };
});

const mockLoggerError: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: Array<unknown>): void => {
        mockLoggerError(...args);
      },
    },
  };
});

// The job import comes last: registering the cron is its side effect.
import "../../../../Server/Billing/Jobs/ReportTelemetryMeteredPlan";

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const REPORT_ORDER: Array<string> = [
  "Logs",
  "Metrics",
  "Traces",
  "Active Monitoring",
  "Profiles",
  "Session Replay",
  "Security Events",
];

async function runJob(): Promise<void> {
  expect(mockCronFunction).not.toBeNull();
  await mockCronFunction!();
}

describe("MeteredPlan:ReportTelemetryMeteredPlan", () => {
  beforeEach(() => {
    mockReported.length = 0;
    mockLoggerError.mockClear();

    for (const plan of Object.values(mockPlans)) {
      plan.failsFor.clear();
      plan.reportQuantityToBillingProvider.mockClear();
    }

    mockFindAllBy.mockResolvedValue([{ id: PROJECT_A }, { id: PROJECT_B }]);
    mockGetCurrentPlan.mockResolvedValue({
      plan: "Growth",
      isSubscriptionUnpaid: false,
    });
  });

  test("reports every plan of every project, in order", async () => {
    await runJob();

    expect(mockReported).toEqual([
      ...REPORT_ORDER.map((productType: string): string => {
        return `${PROJECT_A.toString()}:${productType}`;
      }),
      ...REPORT_ORDER.map((productType: string): string => {
        return `${PROJECT_B.toString()}:${productType}`;
      }),
    ]);
  });

  test("a plan that fails does not stop the project's later plans", async () => {
    mockPlans["LogDataIngestMeteredPlan"]!.failsFor.add(PROJECT_A.toString());

    await runJob();

    expect(mockReported).toEqual([
      ...REPORT_ORDER.filter((productType: string): boolean => {
        return productType !== "Logs";
      }).map((productType: string): string => {
        return `${PROJECT_A.toString()}:${productType}`;
      }),
      ...REPORT_ORDER.map((productType: string): string => {
        return `${PROJECT_B.toString()}:${productType}`;
      }),
    ]);
  });

  test("names the plan and the project that failed", async () => {
    mockPlans["TracesDataIngestMetredPlan"]!.failsFor.add(PROJECT_B.toString());

    await runJob();

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const message: string = String(mockLoggerError.mock.calls[0]![0]);
    expect(message).toContain("Traces");
    expect(message).toContain(PROJECT_B.toString());
    expect(message).toContain("Traces report failed");
  });

  test("a project whose plan cannot be read does not stop the next project", async () => {
    mockGetCurrentPlan.mockImplementation(
      async (projectId: ObjectID): Promise<unknown> => {
        if (projectId.toString() === PROJECT_A.toString()) {
          throw new Error("Project does not have any plans");
        }

        return { plan: "Growth", isSubscriptionUnpaid: false };
      },
    );

    await runJob();

    expect(mockReported).toEqual(
      REPORT_ORDER.map((productType: string): string => {
        return `${PROJECT_B.toString()}:${productType}`;
      }),
    );
  });

  test("still skips a project whose subscription is unpaid", async () => {
    mockGetCurrentPlan.mockImplementation(
      async (projectId: ObjectID): Promise<unknown> => {
        return {
          plan: "Growth",
          isSubscriptionUnpaid: projectId.toString() === PROJECT_A.toString(),
        };
      },
    );

    await runJob();

    expect(mockReported).toEqual(
      REPORT_ORDER.map((productType: string): string => {
        return `${PROJECT_B.toString()}:${productType}`;
      }),
    );
  });
});
