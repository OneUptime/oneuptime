import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertFeedService from "../../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertStateService from "../../../../../Server/Services/AlertStateService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../../Server/Services/IncidentStateService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import FixProductionTelemetry, {
  FixTelemetryWindow,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionTelemetry";
import FixProductionVerifier, {
  VerifierRun,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerifier";
import PerformanceFixWatch from "../../../../../Server/Utils/AI/CodeFix/PerformanceFixWatch";
import { PerformanceMeasure } from "../../../../../Server/Utils/AI/CodeFix/PerformanceFixVerdict";
import RecurrenceFixWatch from "../../../../../Server/Utils/AI/CodeFix/RecurrenceFixWatch";
import TelemetryFixWatch from "../../../../../Server/Utils/AI/CodeFix/TelemetryFixWatch";
import {
  TelemetryArrival,
  TelemetryArrivalKind,
  TelemetrySignalCounts,
} from "../../../../../Server/Utils/AI/CodeFix/TelemetryFixVerdict";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubCommits from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommits";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import logger from "../../../../../Server/Utils/Logger";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import { PerformanceFindingType } from "../../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import FixProductionBaseline, {
  TelemetryFixSignal,
} from "../../../../../Types/AI/FixProductionBaseline";
import FixProductionCheck from "../../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import URL from "../../../../../Types/API/URL";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";

/*
 * Every kind of merged AI fix, watched in production (FixProductionVerifier
 * with PerformanceFixWatch, RecurrenceFixWatch and TelemetryFixWatch):
 *
 * - each is dispatched on the check its row records, and one this server
 *   does not know is left alone;
 * - what each measures before the merge is read once, on the first check,
 *   and kept: an operation's p99, a monitor's incidents, what a telemetry
 *   improvement's diff adds that was not sent before;
 * - the deploy that ships it is found like an exception fix's;
 * - telemetry is read once the fix has run a day, then about hourly, in
 *   the deploy's version only when the service's telemetry reports it;
 * - a decided fix updates what it was for: an insight resolved or
 *   reopened, a note on the incident's feed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9c1d0f50-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "9c1d0f50-0000-4000-8000-000000000002",
);
const RUN_ID: ObjectID = new ObjectID("9c1d0f50-0000-4000-8000-000000000003");
const FIX_ID: ObjectID = new ObjectID("9c1d0f50-0000-4000-8000-000000000004");
const INSIGHT_ID: ObjectID = new ObjectID(
  "9c1d0f50-0000-4000-8000-000000000005",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9c1d0f50-0000-4000-8000-000000000006",
);
const RECURRENCE_ID: ObjectID = new ObjectID(
  "9c1d0f50-0000-4000-8000-000000000007",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "9c1d0f50-0000-4000-8000-000000000008",
);
const ALERT_ID: ObjectID = new ObjectID("9c1d0f50-0000-4000-8000-000000000009");
const FIX_SHA: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const MERGED_AT: Date = new Date("2026-10-10T10:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const GRACE: number = 10 * 60 * 1000;

function hoursAfterMerge(hours: number): Date {
  return new Date(MERGED_AT.getTime() + hours * HOUR);
}

// The deploy every test ships the fix in, two hours after the merge.
const DEPLOYED_AT: Date = hoursAfterMerge(2);

// A check `hours` into the watch, after the rollout grace.
function runAt(hours: number): VerifierRun {
  return {
    now: new Date(DEPLOYED_AT.getTime() + GRACE + hours * HOUR),
    tokens: new Map<string, string | null>(),
    failedCompares: new Set<string>(),
  };
}

function fix(
  check: FixProductionCheck,
  overrides: JSONObject = {},
): AIAgentTaskPullRequest {
  return {
    id: FIX_ID,
    _id: FIX_ID.toString(),
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    createdAt: hoursAfterMerge(-5),
    pullRequestState: PullRequestState.Merged,
    pullRequestNumber: 123,
    pullRequestUrl: URL.fromString("https://github.com/acme/checkout/pull/123"),
    mergeCommitSha: FIX_SHA,
    mergedAt: MERGED_AT,
    productionCheck: check,
    productionStatus: FixProductionStatus.AwaitingDeploy,
    productionStatusAt: MERGED_AT,
    productionSummary:
      "Merged. Waiting for a recorded deploy of the service that contains the fix.",
    repoOrganizationName: "acme",
    repoName: "checkout",
    codeRepository: {
      _id: "9c1d0f50-0000-4000-8000-000000000010",
      projectId: PROJECT_ID,
      organizationName: "acme",
      repositoryName: "checkout",
      gitHubAppInstallationId: "4242",
    },
    ...overrides,
  } as unknown as AIAgentTaskPullRequest;
}

// A fix the deploy already shipped, with what its first check kept.
function watching(
  check: FixProductionCheck,
  baseline: FixProductionBaseline,
  overrides: JSONObject = {},
): AIAgentTaskPullRequest {
  return fix(check, {
    productionStatus: FixProductionStatus.Watching,
    productionSummary: "still watching",
    deployedAt: DEPLOYED_AT,
    deployedVersion: "2.3.2",
    deployedCommitSha: FIX_SHA,
    productionBaseline: baseline,
    ...overrides,
  });
}

let runRow: JSONObject | null;
let changes: Array<JSONObject>;
let updates: Array<JSONObject>;
let latency: (window: FixTelemetryWindow) => PerformanceMeasure;
let reportsVersion: boolean;
let measureLatency: SpyInstance<typeof FixProductionTelemetry.measureLatency>;
let findTexts: SpyInstance<typeof FixProductionTelemetry.findTexts>;
let countSignals: SpyInstance<typeof FixProductionTelemetry.countSignals>;
let texts: (window: FixTelemetryWindow) => Array<TelemetryArrival>;
let signalCounts: (window: FixTelemetryWindow) => TelemetrySignalCounts;

function updatesOf(): Array<JSONObject> {
  return updates.map((update: JSONObject): JSONObject => {
    return update["data"] as JSONObject;
  });
}

// The verdict a check wrote, leaving out a baseline it kept.
function lastVerdict(): JSONObject {
  const verdicts: Array<JSONObject> = updatesOf().filter(
    (data: JSONObject): boolean => {
      return data["productionStatus"] !== undefined;
    },
  );

  expect(verdicts.length).toBeGreaterThan(0);
  return verdicts[verdicts.length - 1]!;
}

function keptBaseline(): FixProductionBaseline {
  const kept: Array<JSONObject> = updatesOf().filter(
    (data: JSONObject): boolean => {
      return data["productionBaseline"] !== undefined;
    },
  );

  expect(kept.length).toBeGreaterThan(0);
  return kept[kept.length - 1]!["productionBaseline"] as FixProductionBaseline;
}

beforeEach(() => {
  runRow = null;
  changes = [
    {
      _id: ObjectID.generate().toString(),
      time: DEPLOYED_AT,
      primaryEntityId: SERVICE_ID,
      attributes: {
        "vcs.ref.head.revision": FIX_SHA,
        "service.version": "2.3.2",
        "oneuptime.change.source": "api",
      },
    },
  ];
  updates = [];
  reportsVersion = true;
  latency = (): PerformanceMeasure => {
    return { spanCount: 0, p99Ms: 0 };
  };
  texts = (): Array<TelemetryArrival> => {
    return [];
  };
  signalCounts = (): TelemetrySignalCounts => {
    return { spans: 0, logs: 0 };
  };

  FixProductionVerifier.forgetCompares();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(runAt(30).now);
  for (const level of ["debug", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }
  jest.spyOn(AIRunService, "findOneById").mockImplementation((async () => {
    return runRow;
  }) as never);
  jest
    .spyOn(AIAgentTaskPullRequestService, "updateOneById")
    .mockImplementation((async (data: JSONObject) => {
      updates.push(data);
    }) as never);
  jest.spyOn(ChangeEventService, "findBy").mockImplementation((async (data: {
    query: JSONObject;
  }) => {
    const scope: unknown = data.query["primaryEntityId"];

    return changes.filter((row: JSONObject): boolean => {
      return (
        scope === undefined ||
        String(row["primaryEntityId"] || "") === String(scope)
      );
    });
  }) as never);
  measureLatency = jest
    .spyOn(FixProductionTelemetry, "measureLatency")
    .mockImplementation((async (window: FixTelemetryWindow) => {
      return latency(window);
    }) as never);
  jest
    .spyOn(FixProductionTelemetry, "reportsVersion")
    .mockImplementation((async () => {
      return reportsVersion;
    }) as never);
  findTexts = jest
    .spyOn(FixProductionTelemetry, "findTexts")
    .mockImplementation((async (window: FixTelemetryWindow) => {
      return texts(window);
    }) as never);
  countSignals = jest
    .spyOn(FixProductionTelemetry, "countSignals")
    .mockImplementation((async (window: FixTelemetryWindow) => {
      return signalCounts(window);
    }) as never);
  jest
    .spyOn(GitHubUtil, "getInstallationAccessToken")
    .mockResolvedValue({ token: "tok", expiresAt: new Date() });
  jest
    .spyOn(GitHubInstallationBinding, "isRepositoryInstallationBound")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which check a merged fix is watched with", () => {
  // Each watch's verify, as the verifier calls it.
  type Watch = {
    verify: (fix: AIAgentTaskPullRequest, run: VerifierRun) => Promise<void>;
  };

  test.each([
    [FixProductionCheck.Performance, PerformanceFixWatch],
    [FixProductionCheck.Recurrence, RecurrenceFixWatch],
    [FixProductionCheck.Telemetry, TelemetryFixWatch],
  ] as Array<[FixProductionCheck, Watch]>)(
    "%s",
    async (check: FixProductionCheck, watch: Watch) => {
      const verify: SpyInstance<Watch["verify"]> = jest
        .spyOn(watch, "verify")
        .mockResolvedValue(undefined);
      const run: VerifierRun = runAt(1);
      const watched: AIAgentTaskPullRequest = fix(check);

      await FixProductionVerifier.verifyFix(watched, run);

      expect(verify).toHaveBeenCalledWith(watched, run);
    },
  );

  test("a check this server does not know is left for the server that wrote it", async () => {
    await FixProductionVerifier.verifyFix(
      fix("FasterQueries" as FixProductionCheck),
      runAt(1),
    );

    expect(updates).toEqual([]);
    expect(AIRunService.findOneById).not.toHaveBeenCalled();
  });

  test("the run that opened the fix is read in the fix's own project only", async () => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: new ObjectID("9c1d0f50-0000-4000-8000-0000000000ff"),
      codeFixTaskType: CodeFixTaskType.ImproveTracing,
      taskContext: { telemetryServiceId: SERVICE_ID.toString() },
    };

    await FixProductionVerifier.verifyFix(
      fix(FixProductionCheck.Telemetry),
      runAt(1),
    );

    expect(lastVerdict()).toEqual({
      productionStatus: FixProductionStatus.Unverifiable,
      productionSummary:
        "The task that opened this fix no longer exists, so what it adds cannot be looked for in production.",
      productionStatusAt: runAt(1).now,
    });
  });
});

describe("a performance fix", () => {
  function insightRun(): void {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.FixPerformance,
      triggeredByAiInsightId: INSIGHT_ID,
      taskContext: { traceId: "t1", serviceName: "checkout" },
    };
  }

  let insight: JSONObject;
  let insightUpdates: Array<JSONObject>;

  beforeEach(() => {
    insight = {
      _id: INSIGHT_ID.toString(),
      id: INSIGHT_ID,
      insightType: AIInsightType.TraceLatencyRegression,
      telemetryServiceId: SERVICE_ID,
      serviceName: "checkout",
      status: AIInsightStatus.FixOpened,
      evidence: {
        latency: {
          recentP99Ms: 4800,
          baselineP99Ms: 900,
          regressionMultiplier: 5.3,
          operationName: "GET /orders",
        },
      },
    };
    insightUpdates = [];
    jest.spyOn(AIInsightService, "findOneBy").mockImplementation((async () => {
      return insight;
    }) as never);
    jest.spyOn(AIInsightService, "updateOneById").mockImplementation((async (
      data: JSONObject,
    ) => {
      insightUpdates.push(data);
    }) as never);
    jest.spyOn(ServiceService, "findOneBy").mockImplementation((async (data: {
      query: JSONObject;
    }) => {
      return data.query["name"] === "checkout" ||
        String(data.query["_id"]) === SERVICE_ID.toString()
        ? { _id: SERVICE_ID.toString(), id: SERVICE_ID, name: "checkout" }
        : null;
    }) as never);
    latency = (window: FixTelemetryWindow): PerformanceMeasure => {
      return window.to.getTime() <= MERGED_AT.getTime()
        ? { spanCount: 4200, p99Ms: 2400 }
        : { spanCount: 1204, p99Ms: 310 };
    };
  });

  test("an insight's fix measures what the insight measured, in the week before the merge, once", async () => {
    insightRun();
    changes = [];

    await PerformanceFixWatch.verify(
      fix(FixProductionCheck.Performance),
      runAt(1),
    );

    expect(measureLatency).toHaveBeenCalledTimes(1);
    expect(measureLatency.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      spanName: "GET /orders",
      from: hoursAfterMerge(-7 * 24),
      to: MERGED_AT,
    });
    expect(keptBaseline()).toEqual({
      performance: {
        serviceId: SERVICE_ID.toString(),
        spanName: "GET /orders",
        insightId: INSIGHT_ID.toString(),
        spanCount: 4200,
        p99Ms: 2400,
        from: hoursAfterMerge(-7 * 24).toISOString(),
        to: MERGED_AT.toISOString(),
      },
    });
    // No deploy yet: waited for, quietly.
    expect(updatesOf()).toHaveLength(1);
  });

  test("an insight about a whole service measures every span of it", async () => {
    insightRun();
    insight["evidence"] = { latency: { recentP99Ms: 1, baselineP99Ms: 1 } };
    changes = [];

    await PerformanceFixWatch.verify(
      fix(FixProductionCheck.Performance),
      runAt(1),
    );

    expect(measureLatency.mock.calls[0]![0].spanName).toBeUndefined();
    expect(keptBaseline().performance).not.toHaveProperty("spanName");
  });

  test("a slow trace's fix measures the parent its N+1 runs under, in the trace's service", async () => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.FixPerformance,
      taskContext: {
        traceId: "t1",
        serviceName: "checkout",
        performanceFindings: [
          {
            findingType: PerformanceFindingType.NPlusOneQuery,
            headline: "N+1",
            evidence: "",
            spanCount: 27,
            combinedDurationMs: 1800,
            traceDurationMs: 2400,
            percentOfTrace: 75,
            normalizedSpanName: "SELECT users",
            parentSpanName: "GET /orders/:id",
            implicatedSpans: [],
          },
        ],
      },
    };
    changes = [];

    await PerformanceFixWatch.verify(
      fix(FixProductionCheck.Performance),
      runAt(1),
    );

    expect(measureLatency.mock.calls[0]![0]).toMatchObject({
      serviceId: SERVICE_ID,
      spanName: "GET /orders/:id",
    });
    expect(keptBaseline().performance).not.toHaveProperty("insightId");
  });

  test("a trace whose service OneUptime does not know cannot be measured", async () => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.FixPerformance,
      taskContext: {
        traceId: "t1",
        serviceName: "gone",
        performanceFindings: [
          {
            findingType: PerformanceFindingType.DominantSpan,
            headline: "Dominant",
            evidence: "",
            spanCount: 1,
            combinedDurationMs: 1800,
            traceDurationMs: 2400,
            percentOfTrace: 75,
            normalizedSpanName: "SELECT big",
            implicatedSpans: [
              { spanId: "s", name: "SELECT big", durationMs: 1800 },
            ],
          },
        ],
      },
    };

    await PerformanceFixWatch.verify(
      fix(FixProductionCheck.Performance),
      runAt(1),
    );

    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Unverifiable,
    );
    expect(lastVerdict()["productionSummary"]).toBe(
      "The trace this fix came from names no service OneUptime knows, so the operation it fixed cannot be measured.",
    );
    expect(measureLatency).not.toHaveBeenCalled();
  });

  test("too few spans before the merge is Unverifiable at once", async () => {
    insightRun();
    latency = (): PerformanceMeasure => {
      return { spanCount: 40, p99Ms: 2400 };
    };

    await PerformanceFixWatch.verify(
      fix(FixProductionCheck.Performance),
      runAt(1),
    );

    expect(lastVerdict()["productionSummary"]).toBe(
      '"GET /orders" ran 40 times in the 7 days before the fix merged: too few to measure its p99 against.',
    );
    expect(ChangeEventService.findBy).not.toHaveBeenCalled();
  });

  test("in its first day the deploy is recorded and nothing more is read", async () => {
    insightRun();

    await PerformanceFixWatch.verify(
      fix(FixProductionCheck.Performance),
      runAt(3),
    );

    expect(lastVerdict()).toEqual({
      productionStatus: FixProductionStatus.Watching,
      productionSummary:
        'Version 2.3.2 shipped the fix. The p99 of "GET /orders" was 2.4 s in the 7 days before it merged; it is compared again once the fix has run for a day.',
      productionStatusAt: runAt(3).now,
      deployedAt: DEPLOYED_AT,
      deployedVersion: "2.3.2",
      deployedCommitSha: FIX_SHA,
    });
    // Only the baseline.
    expect(measureLatency).toHaveBeenCalledTimes(1);
  });

  const BASELINE: FixProductionBaseline = {
    performance: {
      serviceId: SERVICE_ID.toString(),
      spanName: "GET /orders",
      insightId: INSIGHT_ID.toString(),
      spanCount: 4200,
      p99Ms: 2400,
      from: hoursAfterMerge(-7 * 24).toISOString(),
      to: MERGED_AT.toISOString(),
    },
  };

  test("after a day, the p99 in the deploy's version is compared, and a faster one resolves the insight", async () => {
    await PerformanceFixWatch.verify(
      watching(FixProductionCheck.Performance, BASELINE),
      runAt(24),
    );

    expect(measureLatency).toHaveBeenCalledTimes(1);
    expect(measureLatency.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      spanName: "GET /orders",
      from: DEPLOYED_AT,
      to: runAt(24).now,
      version: "2.3.2",
    });
    expect(lastVerdict()).toEqual({
      productionStatus: FixProductionStatus.Verified,
      productionSummary:
        'The p99 of "GET /orders" fell from 2.4 s to 310 ms in the 24 hours since version 2.3.2 shipped the fix (1,204 spans).',
      productionStatusAt: runAt(24).now,
    });
    expect(insightUpdates).toEqual([
      {
        id: INSIGHT_ID,
        data: { status: AIInsightStatus.Resolved },
        props: { isRoot: true },
      },
    ]);
  });

  test("a version the service's telemetry never reports is not read by: from the rollout grace on", async () => {
    reportsVersion = false;

    await PerformanceFixWatch.verify(
      watching(FixProductionCheck.Performance, BASELINE),
      runAt(24),
    );

    expect(measureLatency.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      spanName: "GET /orders",
      from: new Date(DEPLOYED_AT.getTime() + GRACE),
      to: runAt(24).now,
      version: undefined,
    });
  });

  test("a p99 no lower reopens the insight; a dismissed one stays dismissed", async () => {
    latency = (): PerformanceMeasure => {
      return { spanCount: 900, p99Ms: 2500 };
    };

    await PerformanceFixWatch.verify(
      watching(FixProductionCheck.Performance, BASELINE),
      runAt(24),
    );

    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Regressed,
    );
    expect(insightUpdates).toEqual([
      {
        id: INSIGHT_ID,
        data: { status: AIInsightStatus.ActionRequired },
        props: { isRoot: true },
      },
    ]);

    insight["status"] = AIInsightStatus.Dismissed;
    insightUpdates = [];

    await PerformanceFixWatch.verify(
      watching(FixProductionCheck.Performance, BASELINE),
      runAt(24),
    );

    expect(insightUpdates).toEqual([]);
  });

  test("a failed insight update leaves the verdict standing", async () => {
    (AIInsightService.updateOneById as jest.Mock).mockRejectedValue(
      new Error("Postgres is down") as never,
    );

    await PerformanceFixWatch.verify(
      watching(FixProductionCheck.Performance, BASELINE),
      runAt(24),
    );

    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Verified,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not update insight"),
    );
  });

  test("between the hourly measurements nothing is read or written", async () => {
    await PerformanceFixWatch.verify(
      watching(FixProductionCheck.Performance, BASELINE),
      runAt(24.5),
    );

    expect(measureLatency).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});

describe("a fix of an incident's root cause", () => {
  let incidentCounts: (query: JSONObject) => number;
  let incidentFeed: Array<JSONObject>;
  let alertFeed: Array<JSONObject>;

  beforeEach(() => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
      triggeredByIncidentId: INCIDENT_ID,
    };
    incidentCounts = (): number => {
      return 0;
    };
    incidentFeed = [];
    alertFeed = [];
    jest.spyOn(IncidentService, "findOneBy").mockImplementation((async () => {
      return {
        _id: INCIDENT_ID.toString(),
        id: INCIDENT_ID,
        incidentNumber: 42,
        incidentNumberWithPrefix: "INC-42",
        monitors: [
          { _id: MONITOR_ID.toString(), id: MONITOR_ID, name: "API health" },
        ],
      };
    }) as never);
    jest.spyOn(IncidentService, "countBy").mockImplementation((async (data: {
      query: JSONObject;
    }) => {
      return new PositiveNumber(incidentCounts(data.query));
    }) as never);
    jest.spyOn(IncidentService, "findBy").mockImplementation((async () => {
      return [
        {
          _id: RECURRENCE_ID.toString(),
          id: RECURRENCE_ID,
          incidentNumber: 57,
          incidentNumberWithPrefix: "INC-57",
        },
      ];
    }) as never);
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([
        new ObjectID("9c1d0f50-0000-4000-8000-0000000000aa"),
      ]);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: JSONObject) => {
        incidentFeed.push(data);
      }) as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation((async (data: JSONObject) => {
        alertFeed.push(data);
      }) as never);
  });

  // What a count asked for: a window, open ones, or neither.
  function isOpenQuery(query: JSONObject): boolean {
    return query["currentIncidentStateId"] !== undefined;
  }

  function windowOf(query: JSONObject): InBetween<Date> {
    return query["createdAt"] as unknown as InBetween<Date>;
  }

  test("the monitor's incidents in the month before the merge are counted once and kept", async () => {
    incidentCounts = (query: JSONObject): number => {
      return isOpenQuery(query) ? 0 : 9;
    };
    changes = [];

    await RecurrenceFixWatch.verify(
      fix(FixProductionCheck.Recurrence),
      runAt(1),
    );

    expect(keptBaseline()).toEqual({
      recurrence: {
        subjectKind: "incident",
        monitorIds: [MONITOR_ID.toString()],
        count: 9,
        from: hoursAfterMerge(-30 * 24).toISOString(),
        to: MERGED_AT.toISOString(),
      },
    });

    const query: JSONObject = (IncidentService.countBy as jest.Mock).mock
      .calls[0]![0] as JSONObject;
    expect((query["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
    expect((query["query"] as JSONObject)["monitors"]).toEqual([MONITOR_ID]);
  });

  test("the deploy is looked for among every change of the project", async () => {
    await RecurrenceFixWatch.verify(
      fix(FixProductionCheck.Recurrence),
      runAt(1),
    );

    const calls: Array<Array<unknown>> = (
      ChangeEventService.findBy as jest.Mock
    ).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0]![0] as JSONObject)["query"]).not.toHaveProperty(
      "primaryEntityId",
    );
    expect(lastVerdict()["deployedAt"]).toEqual(DEPLOYED_AT);
  });

  test("an incident declared by hand, with no monitor, cannot be watched", async () => {
    (IncidentService.findOneBy as jest.Mock).mockResolvedValue({
      _id: INCIDENT_ID.toString(),
      id: INCIDENT_ID,
      incidentNumber: 42,
      monitors: [],
    } as never);

    await RecurrenceFixWatch.verify(
      fix(FixProductionCheck.Recurrence),
      runAt(1),
    );

    expect(lastVerdict()["productionSummary"]).toBe(
      "No monitor raised the incident this fix was opened for, so there is no monitor to watch for it again.",
    );
  });

  const BASELINE: FixProductionBaseline = {
    recurrence: {
      subjectKind: "incident",
      monitorIds: [MONITOR_ID.toString()],
      count: 9,
      from: hoursAfterMerge(-30 * 24).toISOString(),
      to: MERGED_AT.toISOString(),
    },
  };

  test("a new incident after the rollout grace is Regressed, and both incidents' feeds say so", async () => {
    incidentCounts = (query: JSONObject): number => {
      return isOpenQuery(query) ? 0 : 1;
    };

    await RecurrenceFixWatch.verify(
      watching(FixProductionCheck.Recurrence, BASELINE),
      runAt(5),
    );

    const window: InBetween<Date> = windowOf(
      (IncidentService.countBy as jest.Mock).mock.calls
        .map((call: Array<unknown>) => {
          return (call[0] as JSONObject)["query"] as JSONObject;
        })
        .find((query: JSONObject) => {
          return !isOpenQuery(query);
        })!,
    );
    expect(window.startValue).toEqual(new Date(DEPLOYED_AT.getTime() + GRACE));
    expect(window.endValue).toEqual(runAt(5).now);

    expect(lastVerdict()["productionSummary"]).toBe(
      'Monitor "API health" raised incident INC-57 after version 2.3.2 shipped the fix, so the fix did not stop it.',
    );
    expect(incidentFeed).toHaveLength(2);
    expect(incidentFeed[0]!["incidentId"]).toBe(INCIDENT_ID);
    expect(incidentFeed[0]!["feedInfoInMarkdown"]).toContain(
      "**OneUptime AI's fix did not stop this:**",
    );
    expect(incidentFeed[0]!["feedInfoInMarkdown"]).toContain(
      "[Pull request #123](https://github.com/acme/checkout/pull/123)",
    );
    expect(incidentFeed[1]!["incidentId"]).toBe(RECURRENCE_ID);
    expect(incidentFeed[1]!["feedInfoInMarkdown"]).toContain(
      "**This happened again after an AI fix shipped:**",
    );
    expect(incidentFeed[1]!["feedInfoInMarkdown"]).toContain("INC-42");
    for (const note of incidentFeed) {
      expect(note["projectId"]).toBe(PROJECT_ID);
    }
  });

  test("quiet long enough is Verified, and the investigated incident's feed says so", async () => {
    await RecurrenceFixWatch.verify(
      watching(FixProductionCheck.Recurrence, BASELINE),
      runAt(240),
    );

    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Verified,
    );
    expect(incidentFeed).toHaveLength(1);
    expect(incidentFeed[0]!["incidentId"]).toBe(INCIDENT_ID);
    expect(incidentFeed[0]!["feedInfoInMarkdown"]).toContain(
      "**OneUptime AI's fix worked in production:**",
    );
  });

  test("an incident still open is remembered, and keeps the fix watched", async () => {
    incidentCounts = (query: JSONObject): number => {
      return isOpenQuery(query) ? 1 : 0;
    };

    await RecurrenceFixWatch.verify(
      watching(FixProductionCheck.Recurrence, BASELINE),
      runAt(240),
    );

    expect(keptBaseline().recurrence?.openSeenAt).toBe(
      runAt(240).now.toISOString(),
    );
    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Watching,
    );
    expect(incidentFeed).toEqual([]);
  });

  test("an alert's fix counts the alerts of its monitor", async () => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
      triggeredByAlertId: ALERT_ID,
    };
    jest.spyOn(AlertService, "findOneBy").mockImplementation((async () => {
      return {
        _id: ALERT_ID.toString(),
        id: ALERT_ID,
        alertNumber: 7,
        monitor: { _id: MONITOR_ID.toString(), id: MONITOR_ID, name: "Queue" },
      };
    }) as never);
    const alertCount: SpyInstance<typeof AlertService.countBy> = jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([]);
    changes = [];

    await RecurrenceFixWatch.verify(
      fix(FixProductionCheck.Recurrence),
      runAt(1),
    );

    expect(keptBaseline().recurrence).toMatchObject({
      subjectKind: "alert",
      monitorIds: [MONITOR_ID.toString()],
    });
    expect(
      JSON.stringify(
        ((alertCount.mock.calls[0]![0] as JSONObject)["query"] as JSONObject)[
          "monitorId"
        ],
      ),
    ).toContain(MONITOR_ID.toString());
    expect(IncidentService.countBy).not.toHaveBeenCalled();
  });
});

describe("a telemetry improvement", () => {
  let filePatches: SpyInstance<typeof GitHubCommits.listPullRequestFilePatches>;

  const PATCH: string = [
    "@@ -1,2 +1,4 @@",
    '+  tracer.startActiveSpan("checkout.pay", (span) => {',
    '+    span.setAttribute("order.id", id);',
    '+    span.setAttribute("http.route", route);',
  ].join("\n");

  beforeEach(() => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.ImproveTracing,
      taskContext: {
        telemetryServiceId: SERVICE_ID.toString(),
        serviceName: "checkout",
      },
    };
    filePatches = jest
      .spyOn(GitHubCommits, "listPullRequestFilePatches")
      .mockResolvedValue({
        files: [{ path: "src/pay.ts", patch: PATCH }, { path: "logo.png" }],
        isTruncated: false,
      });
    // "http.route" was already on the service's spans before the merge.
    texts = (window: FixTelemetryWindow): Array<TelemetryArrival> => {
      return window.to.getTime() <= MERGED_AT.getTime()
        ? [{ text: "http.route", kind: TelemetryArrivalKind.SpanAttribute }]
        : [];
    };
    signalCounts = (): TelemetrySignalCounts => {
      return { spans: 52000, logs: 0 };
    };
  });

  test("the first check reads the pull request's diff, and keeps what was not sent before", async () => {
    changes = [];

    await TelemetryFixWatch.verify(fix(FixProductionCheck.Telemetry), runAt(1));

    expect(filePatches).toHaveBeenCalledWith({
      token: "tok",
      owner: "acme",
      repository: "checkout",
      pullRequestNumber: 123,
    });
    expect(findTexts).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        from: hoursAfterMerge(-7 * 24),
        to: MERGED_AT,
      },
      [TelemetryArrivalKind.SpanName, TelemetryArrivalKind.SpanAttribute],
      ["checkout.pay", "order.id", "http.route"],
    );
    expect(keptBaseline()).toEqual({
      telemetry: {
        serviceId: SERVICE_ID.toString(),
        signals: [TelemetryFixSignal.Spans],
        candidates: ["checkout.pay", "order.id"],
        spanCount: 52000,
        logCount: 0,
        from: hoursAfterMerge(-7 * 24).toISOString(),
        to: MERGED_AT.toISOString(),
      },
    });
  });

  test("a logging improvement looks for log attributes and log text", async () => {
    runRow!["codeFixTaskType"] = CodeFixTaskType.ImproveLogging;
    changes = [];

    await TelemetryFixWatch.verify(fix(FixProductionCheck.Telemetry), runAt(1));

    expect(findTexts.mock.calls[0]![1]).toEqual([
      TelemetryArrivalKind.LogAttribute,
      TelemetryArrivalKind.LogBody,
    ]);
    expect(keptBaseline().telemetry?.signals).toEqual([
      TelemetryFixSignal.Logs,
    ]);
  });

  test("GitHub out of reach is asked again next time, until 14 days after the merge", async () => {
    filePatches.mockRejectedValue(
      new HTTPErrorResponse(502, { message: "Bad Gateway" }, {}) as never,
    );

    await TelemetryFixWatch.verify(fix(FixProductionCheck.Telemetry), runAt(1));

    expect(updates).toEqual([]);

    await TelemetryFixWatch.verify(fix(FixProductionCheck.Telemetry), {
      ...runAt(1),
      now: hoursAfterMerge(14 * 24),
    });

    expect(lastVerdict()["productionSummary"]).toBe(
      "The fix's changes could not be read from GitHub in the 14 days after it merged, so what it adds cannot be looked for in production.",
    );
  });

  test("an instrumentation fix of an incident with nothing new to look for cannot be verified", async () => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
      triggeredByIncidentId: INCIDENT_ID,
    };
    filePatches.mockRejectedValue(
      new HTTPErrorResponse(404, { message: "Not Found" }, {}) as never,
    );

    await TelemetryFixWatch.verify(fix(FixProductionCheck.Telemetry), runAt(1));

    expect(keptBaseline().telemetry).toEqual({
      signals: [TelemetryFixSignal.Spans, TelemetryFixSignal.Logs],
      candidates: [],
      spanCount: 0,
      logCount: 0,
      from: hoursAfterMerge(-7 * 24).toISOString(),
      to: MERGED_AT.toISOString(),
    });
    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Unverifiable,
    );
    expect(countSignals).not.toHaveBeenCalled();
  });

  const BASELINE: FixProductionBaseline = {
    telemetry: {
      serviceId: SERVICE_ID.toString(),
      signals: [TelemetryFixSignal.Spans],
      candidates: ["checkout.pay", "order.id"],
      spanCount: 52000,
      logCount: 0,
      from: hoursAfterMerge(-7 * 24).toISOString(),
      to: MERGED_AT.toISOString(),
    },
  };

  test("in its first day nothing is read", async () => {
    await TelemetryFixWatch.verify(
      watching(FixProductionCheck.Telemetry, BASELINE),
      runAt(5),
    );

    expect(findTexts).not.toHaveBeenCalled();
    expect(countSignals).not.toHaveBeenCalled();
  });

  test("after a day, what arrives from the deployed version verifies it", async () => {
    texts = (): Array<TelemetryArrival> => {
      return [{ text: "checkout.pay", kind: TelemetryArrivalKind.SpanName }];
    };

    await TelemetryFixWatch.verify(
      watching(FixProductionCheck.Telemetry, BASELINE),
      runAt(24),
    );

    expect(findTexts).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        from: DEPLOYED_AT,
        to: runAt(24).now,
        version: "2.3.2",
      },
      [TelemetryArrivalKind.SpanName, TelemetryArrivalKind.SpanAttribute],
      ["checkout.pay", "order.id"],
    );
    // Counted whatever version sent them, from the rollout grace on.
    expect(countSignals).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        from: new Date(DEPLOYED_AT.getTime() + GRACE),
        to: runAt(24).now,
      },
      [TelemetryFixSignal.Spans],
    );
    expect(lastVerdict()).toEqual({
      productionStatus: FixProductionStatus.Verified,
      productionSummary:
        'Version 2.3.2 sends what the fix adds: span "checkout.pay".',
      productionStatusAt: runAt(24).now,
    });
  });

  test("a service that stops sending spans is Regressed", async () => {
    signalCounts = (): TelemetrySignalCounts => {
      return { spans: 0, logs: 0 };
    };

    await TelemetryFixWatch.verify(
      watching(FixProductionCheck.Telemetry, BASELINE),
      runAt(24),
    );

    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Regressed,
    );
  });

  test("an instrumentation fix of an incident says on its feed how it went", async () => {
    runRow = {
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
      triggeredByIncidentId: INCIDENT_ID,
    };
    const feed: Array<JSONObject> = [];
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: JSONObject) => {
        feed.push(data);
      }) as never);
    texts = (): Array<TelemetryArrival> => {
      return [{ text: "orderId", kind: TelemetryArrivalKind.LogAttribute }];
    };

    await TelemetryFixWatch.verify(
      watching(FixProductionCheck.Telemetry, {
        telemetry: {
          signals: [TelemetryFixSignal.Spans, TelemetryFixSignal.Logs],
          candidates: ["orderId"],
          spanCount: 0,
          logCount: 0,
          from: hoursAfterMerge(-7 * 24).toISOString(),
          to: MERGED_AT.toISOString(),
        },
      }),
      runAt(24),
    );

    // The whole project, from the rollout grace on: no service to read a version in.
    expect(findTexts.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      serviceId: undefined,
      from: new Date(DEPLOYED_AT.getTime() + GRACE),
      to: runAt(24).now,
      version: undefined,
    });
    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Verified,
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!["incidentId"]).toBe(INCIDENT_ID);
    expect(feed[0]!["feedInfoInMarkdown"]).toContain(
      "**The telemetry OneUptime AI added is arriving:**",
    );
  });
});
