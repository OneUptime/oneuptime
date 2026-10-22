import ProductionReviewRepositoryProfile, {
  MAX_PROFILED_SERVICES,
  PARTIAL_REPOSITORY_PROFILE_CACHE_SECONDS,
  REPOSITORY_PROFILE_CACHE_SECONDS,
  RepositoryProductionProfile,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewRepositoryProfile";
import { CodeAgentScopedService } from "../../../../../Server/Utils/AI/CodeFix/CodeAgentTelemetryScope";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import ProfileAggregationService from "../../../../../Server/Services/ProfileAggregationService";
import TraceAggregationService from "../../../../../Server/Services/TraceAggregationService";
import ProfileEvidence from "../../../../../Server/Utils/Profile/ProfileEvidence";
import RecentChangesContext, {
  RecentChange,
} from "../../../../../Server/Utils/AI/SRE/RecentChangesContext";
import { ChangeImpactVerdict } from "../../../../../Server/Utils/AI/SRE/ChangeImpact";
import { ProductionReviewSection } from "../../../../../Types/CodeRepository/ProductionReview";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What production does with a repository's code, read once for all of its
 * pull requests and kept half an hour: how busy its services are, their
 * operations, which operations run which code, where their CPU time goes,
 * and their deploys OneUptime suspects. Every read stands on its own: a
 * failure leaves its part out and says so, and the whole is kept for less
 * time so it is read again soon.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7f809102-1111-4222-8333-444455556666",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "7f809102-2222-4222-8333-444455556666",
);
const BUSY: string = "7f809102-aaaa-4222-8333-444455556666";
const QUIET: string = "7f809102-bbbb-4222-8333-444455556666";

function service(id: string): CodeAgentScopedService {
  return {
    id,
    name: id,
    method: "name-match",
    evidence: "",
    pathInRepository: null,
  };
}

function stubReads(
  change: { failTraffic?: boolean; partialTraffic?: boolean } = {},
): {
  functionList: jest.SpyInstance;
  sample: jest.SpyInstance;
} {
  if (change.failTraffic) {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockRejectedValue(new Error("ClickHouse is down"));
  } else {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValue({
        rows: [
          { primaryEntityId: QUIET.toUpperCase(), count: 10, p99DurationMs: 5 },
          { primaryEntityId: BUSY, count: 12431, p99DurationMs: 840.123 },
        ],
        isPartial: Boolean(change.partialTraffic),
      });
  }

  jest.spyOn(TraceAggregationService, "getAnalyticsTable").mockResolvedValue([
    {
      groupValues: { primaryEntityId: BUSY.toUpperCase(), name: "GET /a" },
      count: 3200,
      errorCount: 13,
      avgDurationMs: 1,
      p50DurationMs: 1,
      p90DurationMs: 1,
      p95DurationMs: 840.456,
      p99DurationMs: 1,
      minDurationMs: 1,
      maxDurationMs: 1,
    },
    {
      groupValues: { primaryEntityId: "", name: "orphan" },
      count: 1,
      errorCount: 0,
      avgDurationMs: 1,
      p50DurationMs: 1,
      p90DurationMs: 1,
      p95DurationMs: 1,
      p99DurationMs: 1,
      minDurationMs: 1,
      maxDurationMs: 1,
    },
  ]);

  const sample: jest.SpyInstance = jest
    .spyOn(TraceAggregationService, "getCodeLocationSample")
    .mockResolvedValue([
      {
        serviceId: BUSY,
        name: "GET /a",
        filePath: "/app/src/a.ts",
        functionName: "handleA",
        count: 40,
      },
    ]);

  jest.spyOn(ProfileEvidence, "resolveKind").mockResolvedValue({
    selection: "cpu",
    category: null,
    queryTypes: ["cpu"],
    unit: "nanoseconds" as never,
  });

  jest.spyOn(ProfileEvidence, "describeKind").mockReturnValue("CPU time");

  const functionList: jest.SpyInstance = jest
    .spyOn(ProfileAggregationService, "getFunctionList")
    .mockResolvedValue({
      functions: [
        {
          functionName: "handleA",
          fileName: "/app/src/a.ts",
          lineNumber: 3,
          selfValue: 40,
          totalValue: 120,
          sampleCount: 9,
          frameType: "",
          ownValue: 100,
        },
        {
          functionName: "JSON.parse",
          fileName: "/app/node_modules/x/index.js",
          lineNumber: 1,
          selfValue: 500,
          totalValue: 500,
          sampleCount: 9,
          frameType: "",
          ownValue: 0,
        },
      ],
      windowTotal: 1000,
      windowSampleCount: 99,
      truncated: false,
    });

  jest.spyOn(ChangeEventService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(RecentChangesContext, "checkImpact")
    .mockImplementation(async (data: { changes: Array<RecentChange> }) => {
      for (const change of data.changes) {
        change.impact = {
          verdict: ChangeImpactVerdict.Suspect,
          reasons: ["error rate rose"],
          newExceptionTypes: [],
        };
      }
    });

  return { functionList, sample };
}

describe("ProductionReviewRepositoryProfile.read", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads every part, by service, the own code of the busiest's profiles only", async () => {
    const { functionList, sample } = stubReads();

    const profile: RepositoryProductionProfile =
      await ProductionReviewRepositoryProfile.read({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(QUIET), service(BUSY)],
      });

    expect(profile.traffic).toEqual([
      { serviceId: QUIET, count: 10, p99Ms: 5 },
      { serviceId: BUSY, count: 12431, p99Ms: 840.12 },
    ]);
    expect(profile.operations).toEqual([
      {
        serviceId: BUSY,
        name: "GET /a",
        count: 3200,
        errorCount: 13,
        p95Ms: 840.46,
      },
    ]);
    expect(profile.codeLocations).toEqual([
      {
        serviceId: BUSY,
        name: "GET /a",
        filePath: "/app/src/a.ts",
        functionName: "handleA",
        count: 40,
      },
    ]);
    expect(profile.functions).toEqual([
      {
        serviceId: BUSY,
        functionName: "handleA",
        fileName: "/app/src/a.ts",
        totalPercent: 12,
        selfPercent: 4,
        kind: "CPU time",
      },
      {
        serviceId: QUIET,
        functionName: "handleA",
        fileName: "/app/src/a.ts",
        totalPercent: 12,
        selfPercent: 4,
        kind: "CPU time",
      },
    ]);
    expect(profile.unread).toEqual([]);

    // The busiest service's profile is read first.
    expect(
      (
        functionList.mock.calls[0]![0] as { serviceIds: Array<ObjectID> }
      ).serviceIds[0]!.toString(),
    ).toBe(BUSY);

    // One bounded sample of the code locations, for every service.
    expect(sample).toHaveBeenCalledTimes(1);
  });

  test("a read that fails leaves its part out, and says which", async () => {
    stubReads({ failTraffic: true });

    const profile: RepositoryProductionProfile =
      await ProductionReviewRepositoryProfile.read({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(BUSY)],
      });

    expect(profile.traffic).toEqual([]);
    expect(profile.operations).toHaveLength(1);
    expect(profile.unread).toEqual([ProductionReviewSection.Services]);
  });

  test("traffic cut short is no traffic: a partial count is wrong data", async () => {
    stubReads({ partialTraffic: true });

    const profile: RepositoryProductionProfile =
      await ProductionReviewRepositoryProfile.read({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(BUSY)],
      });

    expect(profile.traffic).toEqual([]);
    expect(profile.unread).toContain(ProductionReviewSection.Services);
  });

  test("at most the five busiest services' profiles are read", async () => {
    const { functionList } = stubReads();

    await ProductionReviewRepositoryProfile.read({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      services: Array.from({ length: 8 }, (_value: unknown, index: number) => {
        return service(`7f809102-cc0${index}-4222-8333-444455556666`);
      }),
    });

    expect(functionList).toHaveBeenCalledTimes(MAX_PROFILED_SERVICES);
  });

  test("only the deploys OneUptime suspects are kept", async () => {
    stubReads();

    jest.spyOn(ChangeEventService, "findBy").mockResolvedValue([
      {
        _id: "8a9b0c1d-0000-4000-8000-000000000001",
        time: new Date("2026-10-22T08:00:00.000Z"),
        eventType: "Deployment",
        title: "Deploy v1.4.2",
        primaryEntityId: new ObjectID(BUSY),
        attributes: { "deployment.version": "v1.4.2" },
      },
    ] as never);

    const profile: RepositoryProductionProfile =
      await ProductionReviewRepositoryProfile.read({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(BUSY)],
      });

    expect(profile.suspectDeploys).toHaveLength(1);
    expect(profile.suspectDeploys[0]).toMatchObject({
      serviceId: BUSY,
      impact: "error rate rose",
    });
  });

  test("no services, nothing read", async () => {
    const traffic: jest.SpyInstance = jest.spyOn(
      TraceAggregationService,
      "getServiceLatencyProfile",
    );

    const profile: RepositoryProductionProfile =
      await ProductionReviewRepositoryProfile.read({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [],
      });

    expect(traffic).not.toHaveBeenCalled();
    expect(profile.unread).toEqual([]);
  });
});

describe("ProductionReviewRepositoryProfile.get", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a fresh copy in the cache is used as it is", async () => {
    const cached: RepositoryProductionProfile = {
      readAt: "2026-10-22T09:50:00.000Z",
      traffic: [],
      operations: [],
      codeLocations: [],
      functions: [],
      suspectDeploys: [],
      unread: [],
    };

    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockResolvedValue(cached as unknown as JSONObject);
    const read: jest.SpyInstance = jest.spyOn(
      ProductionReviewRepositoryProfile,
      "read",
    );

    expect(
      await ProductionReviewRepositoryProfile.get({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(BUSY)],
      }),
    ).toEqual(cached);
    expect(read).not.toHaveBeenCalled();
  });

  test("otherwise read and kept half an hour - five minutes when a part failed", async () => {
    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
    const setJSON: jest.SpyInstance = jest
      .spyOn(GlobalCache, "setJSON")
      .mockResolvedValue(undefined);

    stubReads();

    await ProductionReviewRepositoryProfile.get({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      services: [service(BUSY)],
    });

    expect(setJSON.mock.calls[0]![3]).toEqual({
      expiresInSeconds: REPOSITORY_PROFILE_CACHE_SECONDS,
    });

    jest.restoreAllMocks();
    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
    const setPartial: jest.SpyInstance = jest
      .spyOn(GlobalCache, "setJSON")
      .mockResolvedValue(undefined);
    stubReads({ failTraffic: true });

    await ProductionReviewRepositoryProfile.get({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      services: [service(BUSY)],
    });

    expect(setPartial.mock.calls[0]![3]).toEqual({
      expiresInSeconds: PARTIAL_REPOSITORY_PROFILE_CACHE_SECONDS,
    });
  });

  test("a cache that cannot be reached does not stop the review, and something that is not a profile is not one", async () => {
    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockResolvedValue({ readAt: 1 } as unknown as JSONObject);
    jest
      .spyOn(GlobalCache, "setJSON")
      .mockRejectedValue(new Error("Valkey is down"));
    stubReads();

    const profile: RepositoryProductionProfile =
      await ProductionReviewRepositoryProfile.get({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(BUSY)],
      });

    expect(profile.operations).toHaveLength(1);
  });

  test("the cache key follows the set of services, in any order", () => {
    const key: string = ProductionReviewRepositoryProfile.getCacheKey({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
      services: [service(BUSY), service(QUIET)],
    });

    expect(
      ProductionReviewRepositoryProfile.getCacheKey({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(QUIET), service(BUSY)],
      }),
    ).toBe(key);
    expect(
      ProductionReviewRepositoryProfile.getCacheKey({
        projectId: PROJECT_ID,
        codeRepositoryId: REPOSITORY_ID,
        services: [service(BUSY)],
      }),
    ).not.toBe(key);
  });
});
