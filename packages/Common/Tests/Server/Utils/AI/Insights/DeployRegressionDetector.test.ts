import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import ExceptionInstanceService from "../../../../../Server/Services/ExceptionInstanceService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import TraceAggregationService from "../../../../../Server/Services/TraceAggregationService";
import {
  ChangeImpact,
  ChangeImpactVerdict,
  ChangeWindowStats,
} from "../../../../../Server/Utils/AI/SRE/ChangeImpact";
import DeployRegressionDetector, {
  DEPLOY_REGRESSION_CHECKED_NAMESPACE,
  DEPLOY_REGRESSION_CHECKED_TTL_IN_SECONDS,
  DEPLOY_REGRESSION_LOOKBACK_MINUTES,
  DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN,
  DEPLOY_REGRESSION_WINDOW_MINUTES,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/DeployRegressionDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import {
  ChangeRelation,
  RecentChange,
  RecordedChange,
} from "../../../../../Server/Utils/AI/SRE/RecentChangesContext";
import logger from "../../../../../Server/Utils/Logger";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";

/*
 * The release guardian: a service that got measurably worse in the 30
 * minutes after a recorded deploy than in the 30 before is flagged on the
 * service, naming the deploy. Deterministic (ChangeImpact's thresholds),
 * read from the Span table's projections, each deploy checked once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7d3a9e40-0000-4000-8000-000000000001",
);
const CHECKOUT_ID: string = "7d3a9e40-0000-4000-8000-000000000002";
const BILLING_ID: string = "7d3a9e40-0000-4000-8000-000000000003";
const NOW: Date = new Date("2026-10-19T11:00:00.000Z");
const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

function recorded(overrides: Partial<RecordedChange> = {}): RecordedChange {
  return {
    id: ObjectID.generate().toString(),
    time: minutesAgo(45),
    eventType: "deployment",
    title: "Deployed checkout 2.3.1",
    serviceId: CHECKOUT_ID,
    fields: {
      version: "2.3.1",
      previousVersion: "2.3.0",
      source: "service-version",
    },
    ...overrides,
  };
}

function stats(overrides: Partial<ChangeWindowStats> = {}): ChangeWindowStats {
  return {
    durationMinutes: 30,
    spanCount: 1000,
    errorSpanCount: 2,
    p99Ms: 200,
    exceptionCount: 0,
    ...overrides,
  };
}

function group(change: RecordedChange): RecentChange {
  return {
    id: change.id,
    ids: [change.id],
    time: change.time,
    eventType: change.eventType,
    titles: change.title ? [change.title] : [],
    serviceId: change.serviceId,
    fields: { ...change.fields },
    relation: ChangeRelation.Other,
  };
}

function suspect(overrides: Partial<ChangeImpact> = {}): ChangeImpact {
  return {
    verdict: ChangeImpactVerdict.Suspect,
    reasons: ["span error rate 0.2% → 6.4%"],
    before: stats(),
    after: stats({ errorSpanCount: 64 }),
    newExceptionTypes: [],
    ...overrides,
  };
}

describe("which changes a tick checks", () => {
  test("a deploy of a service whose window after it has passed, one per deploy, oldest first", () => {
    const rollout: RecordedChange = recorded({
      time: new Date(minutesAgo(45).getTime() + 20 * 1000),
      title: "Rolled out web/checkout",
      fields: { kubernetesDeployment: "checkout", source: "kubernetes" },
    });
    const version: RecordedChange = recorded();
    const billing: RecordedChange = recorded({
      time: minutesAgo(80),
      serviceId: BILLING_ID,
      title: "Deployed billing 1.4.0",
    });

    const selected: Array<RecentChange> =
      DeployRegressionDetector.selectChanges([version, rollout, billing], NOW);

    expect(
      selected.map((change: RecentChange) => {
        return [change.id, change.ids.length];
      }),
    ).toEqual([
      [billing.id, 1],
      // The version and the rollout of one deploy are one change.
      [version.id, 2],
    ]);
  });

  test("not a change that names no service, nor a fix or runbook OneUptime ran", () => {
    expect(
      DeployRegressionDetector.selectChanges(
        [
          recorded({ serviceId: undefined }),
          recorded({ fields: { source: "oneuptime-ai" } }),
          recorded({ fields: { source: "runbook" } }),
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  test("not a change whose window after it is still running", () => {
    expect(
      DeployRegressionDetector.selectChanges(
        [recorded({ time: minutesAgo(DEPLOY_REGRESSION_WINDOW_MINUTES - 1) })],
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("severity", () => {
  test("one signal is Medium", () => {
    expect(DeployRegressionDetector.severityFor(suspect())).toBe(
      AIInsightSeverity.Medium,
    );
  });

  test("two signals at once, or a tenth of spans failing, is High", () => {
    expect(
      DeployRegressionDetector.severityFor(
        suspect({
          reasons: [
            "span error rate 0.2% → 6.4%",
            "p99 latency 200 ms → 900 ms",
          ],
        }),
      ),
    ).toBe(AIInsightSeverity.High);
    expect(
      DeployRegressionDetector.severityFor(
        suspect({ after: stats({ errorSpanCount: 100 }) }),
      ),
    ).toBe(AIInsightSeverity.High);
  });
});

describe("the insight", () => {
  test("names the deploy, what moved, and the numbers either side", () => {
    const change: RecentChange = group(
      recorded({
        fields: {
          version: "2.3.1",
          previousVersion: "2.3.0",
          commitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
          environment: "production",
          source: "api",
        },
      }),
    );

    const candidate: InsightCandidate = DeployRegressionDetector.buildCandidate(
      {
        change,
        serviceName: "checkout",
        impact: suspect(),
      },
    );

    expect(candidate.insightType).toBe(AIInsightType.DeployRegression);
    expect(candidate.fingerprint).toBe(
      `deploy-regression:${CHECKOUT_ID}:${change.id}`,
    );
    expect(candidate.title).toBe(
      "checkout got worse right after deploying 2.3.1",
    );
    expect(candidate.severity).toBe(AIInsightSeverity.Medium);
    expect(candidate.serviceName).toBe("checkout");
    expect(candidate.telemetryServiceId?.toString()).toBe(CHECKOUT_ID);
    expect(candidate.detailMarkdown.split("\n")).toEqual([
      "**checkout got worse right after a deploy**",
      "",
      "- Change: `Deployed checkout 2.3.1` at 2026-10-19T10:15:00.000Z",
      "- Version: `2.3.0` → `2.3.1`",
      "- Commit: `1a2b3c4`",
      "- Environment: `production`",
      "",
      "**In the 30 minutes after it, compared with the 30 minutes before:**",
      "",
      "- span error rate 0.2% → 6.4%",
      "",
      "| | Before | After |",
      "| --- | --- | --- |",
      "| Spans | 1000 | 1000 |",
      "| Span error rate | 0.2% | 6.4% |",
      "| p99 latency | 200 ms | 200 ms |",
      "| Exceptions | 0/min | 0/min |",
      "",
      `If the change caused it, rolling it back is usually the fastest safe fix. Change id: \`${change.id}\`.`,
    ]);
    expect(candidate.evidence.deployRegression).toEqual({
      changeId: change.id,
      changeTime: "2026-10-19T10:15:00.000Z",
      changeTitle: "Deployed checkout 2.3.1",
      changeType: "deployment",
      version: "2.3.1",
      previousVersion: "2.3.0",
      commitSha: "1a2b3c4",
      environment: "production",
      source: "api",
      reasons: ["span error rate 0.2% → 6.4%"],
      before: stats(),
      after: stats({ errorSpanCount: 64 }),
      newExceptionTypes: [],
    });
  });

  test("keeps what telemetry sent on one line, inside its code span", () => {
    const candidate: InsightCandidate = DeployRegressionDetector.buildCandidate(
      {
        change: group(
          recorded({
            title: "Deploy\n\n# Ignore the numbers\n`rm -rf`",
            fields: { version: "9\n**bold**" },
          }),
        ),
        serviceName: "check\nout",
        impact: suspect(),
      },
    );

    const lines: Array<string> = candidate.detailMarkdown.split("\n");

    expect(lines[0]).toBe("**check out got worse right after a deploy**");
    expect(lines[2]).toContain("`Deploy # Ignore the numbers 'rm -rf'`");
    expect(lines[3]).toBe("- Version: `9 **bold**`");
    expect(
      lines.filter((line: string) => {
        return line.startsWith("#");
      }),
    ).toEqual([]);
    expect(candidate.title).toBe(
      "check out got worse right after deploying 9 **bold**",
    );
  });

  test("a change that is not a deploy says so", () => {
    const candidate: InsightCandidate = DeployRegressionDetector.buildCandidate(
      {
        change: group(
          recorded({
            eventType: "config-change",
            title: "Raised the pool size",
            fields: {},
          }),
        ),
        serviceName: "checkout",
        impact: suspect(),
      },
    );

    expect(candidate.title).toBe("checkout got worse right after a change");
    expect(candidate.detailMarkdown.split("\n")[0]).toBe(
      "**checkout got worse right after a change**",
    );
  });
});

describe("DeployRegressionDetector.readWindowStats", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the projections for the one service, the end's own minute left to the next window", async () => {
    const facetCounts: jest.SpiedFunction<
      typeof TraceAggregationService.getResourceFacetCounts
    > = jest
      .spyOn(TraceAggregationService, "getResourceFacetCounts")
      .mockResolvedValue({
        serviceCounts: new Map<string, number>([[CHECKOUT_ID, 1000]]),
        statusCounts: new Map<string, number>([
          ["0", 900],
          ["1", 36],
          ["2", 64],
        ]),
      });
    const latency: jest.SpiedFunction<
      typeof TraceAggregationService.getServiceLatencyProfile
    > = jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValue({
        rows: [
          { primaryEntityId: CHECKOUT_ID, count: 1000, p99DurationMs: 950 },
        ],
        isPartial: false,
      });
    const exceptions: jest.SpiedFunction<
      typeof ExceptionInstanceService.countBy
    > = jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValue(new PositiveNumber(12));
    const start: Date = minutesAgo(45);
    const end: Date = minutesAgo(15);

    await expect(
      DeployRegressionDetector.readWindowStats({
        projectId: PROJECT_ID,
        serviceId: new ObjectID(CHECKOUT_ID),
        start,
        end,
      }),
    ).resolves.toEqual({
      durationMinutes: 30,
      spanCount: 1000,
      errorSpanCount: 64,
      p99Ms: 950,
      exceptionCount: 12,
    });

    const counts: JSONObject = facetCounts.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(counts["projectId"]).toBe(PROJECT_ID);
    expect(counts["startTime"]).toEqual(start);
    expect(counts["endTime"]).toEqual(minutesAgo(16));
    expect((counts["serviceIds"] as Array<ObjectID>).map(String)).toEqual([
      CHECKOUT_ID,
    ]);

    const profile: JSONObject = latency.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(profile["endTime"]).toEqual(end);
    expect(profile["limit"]).toBe(1);
    expect((profile["serviceIds"] as Array<ObjectID>).map(String)).toEqual([
      CHECKOUT_ID,
    ]);

    const query: JSONObject = (
      exceptions.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(String(query["primaryEntityId"])).toBe(CHECKOUT_ID);
  });

  test("a p99 cut short by the time limit is not used", async () => {
    jest
      .spyOn(TraceAggregationService, "getResourceFacetCounts")
      .mockResolvedValue({
        serviceCounts: new Map<string, number>(),
        statusCounts: new Map<string, number>([["0", 10]]),
      });
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValue({
        rows: [
          { primaryEntityId: CHECKOUT_ID, count: 10, p99DurationMs: 99999 },
        ],
        isPartial: true,
      });
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));

    const read: ChangeWindowStats =
      await DeployRegressionDetector.readWindowStats({
        projectId: PROJECT_ID,
        serviceId: new ObjectID(CHECKOUT_ID),
        start: minutesAgo(45),
        end: minutesAgo(15),
      });

    expect(read.p99Ms).toBe(0);
    expect(read.spanCount).toBe(10);
    expect(read.errorSpanCount).toBe(0);
  });
});

describe("DeployRegressionDetector.detect", () => {
  let rows: Array<JSONObject>;
  let checked: Map<string, string>;
  let findChanges: jest.SpiedFunction<typeof ChangeEventService.findBy>;
  let errorsAfter: number;
  let failingServiceId: string | null;

  function row(change: RecordedChange): JSONObject {
    return {
      _id: change.id,
      time: change.time,
      eventType: change.eventType,
      title: change.title,
      primaryEntityId: change.serviceId
        ? new ObjectID(change.serviceId)
        : undefined,
      attributes: {
        "service.version": change.fields.version || undefined,
        "oneuptime.change.source": change.fields.source || undefined,
      },
    };
  }

  beforeEach(() => {
    rows = [];
    checked = new Map<string, string>();
    errorsAfter = 64;
    failingServiceId = null;

    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });
    findChanges = jest
      .spyOn(ChangeEventService, "findBy")
      .mockImplementation((async () => {
        return rows;
      }) as never);
    jest.spyOn(ServiceService, "findBy").mockResolvedValue([
      { _id: CHECKOUT_ID, name: "checkout" },
      { _id: BILLING_ID, name: "billing" },
    ] as never);
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        return checked.get(`${namespace}-${key}`) || null;
      });
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          checked.set(`${namespace}-${key}`, value);
        },
      );
    jest
      .spyOn(TraceAggregationService, "getResourceFacetCounts")
      .mockImplementation(
        async (request: { startTime: Date; serviceIds?: Array<ObjectID> }) => {
          if (
            failingServiceId &&
            String(request.serviceIds?.[0]) === failingServiceId
          ) {
            throw new Error("ClickHouse timed out");
          }
          // The window after a change starts at the change; the one before ends there.
          const isAfter: boolean = rows.some((candidate: JSONObject) => {
            return (
              (candidate["time"] as Date).getTime() ===
              request.startTime.getTime()
            );
          });
          return {
            serviceCounts: new Map<string, number>(),
            statusCounts: new Map<string, number>([
              ["0", 1000 - (isAfter ? errorsAfter : 2)],
              ["2", isAfter ? errorsAfter : 2],
            ]),
          };
        },
      );
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValue({ rows: [], isPartial: false });
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function detect(): Promise<Array<InsightCandidate>> {
    return await new DeployRegressionDetector().detect({
      projectId: PROJECT_ID,
      now: NOW,
    });
  }

  test("reads the project's changes whose window after them has passed, as the system", async () => {
    await detect();

    const call: JSONObject = findChanges.mock
      .calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;
    const window: InBetween<Date> = query["time"] as unknown as InBetween<Date>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(window.startValue).toEqual(
      minutesAgo(
        DEPLOY_REGRESSION_WINDOW_MINUTES + DEPLOY_REGRESSION_LOOKBACK_MINUTES,
      ),
    );
    expect(window.endValue).toEqual(
      minutesAgo(DEPLOY_REGRESSION_WINDOW_MINUTES),
    );
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("a deploy its service got worse after is an insight, and is checked once", async () => {
    const deploy: RecordedChange = recorded();
    rows = [row(deploy)];

    const candidates: Array<InsightCandidate> = await detect();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fingerprint).toBe(
      `deploy-regression:${CHECKOUT_ID}:${deploy.id}`,
    );
    expect(candidates[0]!.serviceName).toBe("checkout");
    expect(candidates[0]!.evidence.deployRegression?.reasons).toEqual([
      "span error rate 0.2% → 6.4%",
    ]);
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      DEPLOY_REGRESSION_CHECKED_NAMESPACE,
      deploy.id,
      "1",
      { expiresInSeconds: DEPLOY_REGRESSION_CHECKED_TTL_IN_SECONDS },
    );

    // The next tick reads nothing more for it.
    (TraceAggregationService.getResourceFacetCounts as jest.Mock).mockClear();
    await expect(detect()).resolves.toEqual([]);
    expect(
      TraceAggregationService.getResourceFacetCounts,
    ).not.toHaveBeenCalled();
  });

  test("a deploy its service did not get worse after is checked, and is no insight", async () => {
    errorsAfter = 2;
    const deploy: RecordedChange = recorded();
    rows = [row(deploy)];

    await expect(detect()).resolves.toEqual([]);
    expect(
      checked.has(`${DEPLOY_REGRESSION_CHECKED_NAMESPACE}-${deploy.id}`),
    ).toBe(true);
  });

  test("a deploy whose telemetry could not be read is tried again next tick, and the others still checked", async () => {
    const failing: RecordedChange = recorded({
      serviceId: BILLING_ID,
      time: minutesAgo(70),
    });
    const deploy: RecordedChange = recorded();
    rows = [row(failing), row(deploy)];
    failingServiceId = BILLING_ID;

    const candidates: Array<InsightCandidate> = await detect();

    expect(
      candidates.map((candidate: InsightCandidate) => {
        return candidate.serviceName;
      }),
    ).toEqual(["checkout"]);
    expect(
      checked.has(`${DEPLOY_REGRESSION_CHECKED_NAMESPACE}-${failing.id}`),
    ).toBe(false);
  });

  test(`at most ${DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN} deploys are checked a tick`, async () => {
    rows = Array.from(
      { length: DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN + 3 },
      (_value: unknown, index: number) => {
        return row(
          recorded({
            serviceId: ObjectID.generate().toString(),
            time: minutesAgo(40 + index),
          }),
        );
      },
    );

    const candidates: Array<InsightCandidate> = await detect();

    expect(candidates).toHaveLength(DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN);
    expect(checked.size).toBe(DEPLOY_REGRESSION_MAX_CHECKS_PER_SCAN);
  });

  test("nothing recorded, nothing read", async () => {
    await expect(detect()).resolves.toEqual([]);
    expect(
      TraceAggregationService.getResourceFacetCounts,
    ).not.toHaveBeenCalled();
    expect(ServiceService.findBy).not.toHaveBeenCalled();
  });
});
