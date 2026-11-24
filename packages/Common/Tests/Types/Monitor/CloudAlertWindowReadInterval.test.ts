import { describe, expect, test } from "@jest/globals";
import MetricWindowCoverage, {
  MetricWindowCoverageResult,
} from "../../../Server/Utils/Monitor/Criteria/MetricWindowCoverage";
import { WindowCoverageShortfall } from "../../../Server/Utils/Monitor/Criteria/WindowCoverage";
import {
  AWS_METRIC_DELAY_MS,
  AZURE_METRIC_DELAY_MS,
  GCP_METRIC_DELAY_MS,
  MetricWindowPolicy,
  getMetricWindow,
  getMetricWindowPolicy,
} from "../../../Server/Utils/CloudConnection/CloudMetricWindows";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AWS_STREAM_TEMPLATE_VERSION,
  AZURE_FIVE_MINUTE_READ_MINUTES,
  GCP_ALIGNMENT_PERIOD_SECONDS,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE } from "../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_CONNECTION_READ_INTERVALS,
  getCloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  CLOUD_SLOW_METRIC_WINDOW,
  CloudAlertTemplate,
  CloudAlertTemplateArgs,
  getAllCloudAlertTemplates,
  getCloudAlertStreamedMetrics,
  getCloudAlertTemplate,
  getCloudAlertTemplateEquivalentSteps,
  getCloudAlertTemplateReadEveryMinutes,
  getCloudAlertTemplateWindows,
  getCloudAlertWindow,
  isCloudAlertTemplateStreamed,
} from "../../../Types/Monitor/CloudAlertTemplates";
import MetricSeriesArrival from "../../../Types/Monitor/MetricMonitor/MetricSeriesArrival";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import MetricSeriesArrivalUtil from "../../../Utils/Metrics/MetricSeriesArrivalUtil";

/*
 * #10028: A RECOMMENDED CLOUD MONITOR'S WINDOW FOLLOWS ITS CONNECTION'S
 * READS.
 *
 * Each template's window is sized for its cloud's default interval. A
 * connection read every 30 or 60 minutes brings that much of a metric at
 * once, and a 15-minute window held none of it most of the time, never
 * judged a read's oldest points, and held one read's points alone - which
 * "All Values" takes for a series that stopped a minute or two after the
 * read. A monitor is made with its template's window plus how much longer
 * its metric waits for a read than at the default interval, rounded up to a
 * window a monitor offers; one made at another interval keeps its window,
 * and still counts as made.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const NOW: Date = new Date(Date.UTC(2026, 10, 19, 12, 0, 0));

const EC2_CPU: string = "cloud-aws-ec2-high-cpu";
const EC2_STATUS: string = "cloud-aws-ec2-status-check-failed";
const AZURE_VM_CPU: string = "cloud-azure-vm-high-cpu";
const GCE_CPU: string = "cloud-gcp-compute-high-cpu";
const APP_HEALTH_CHECK: string = "cloud-azure-appservice-health-check-failing";
const ACM_EXPIRY: string = "cloud-aws-acm-certificate-expiring";

const EC2_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/EC2",
  "Dimensions.InstanceId": "i-0abc123def",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

function template(id: string): CloudAlertTemplate {
  const found: CloudAlertTemplate | undefined = getCloudAlertTemplate(id);

  expect(found).toBeDefined();

  return found!;
}

function windowsAt(id: string): Array<RollingTime> {
  return CLOUD_CONNECTION_READ_INTERVALS.map(
    (readIntervalInMinutes: number): RollingTime => {
      return getCloudAlertWindow({
        template: template(id),
        readIntervalInMinutes,
      });
    },
  );
}

function argsFor(
  overrides: Partial<CloudAlertTemplateArgs> = {},
): CloudAlertTemplateArgs {
  return {
    cloudResourceId: "00000000-0000-4000-8000-0000000000e1",
    telemetryAttributes: { ...EC2_ATTRIBUTES },
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-1",
    ...overrides,
  };
}

function windowOf(step: MonitorStep): RollingTime | undefined {
  return step.data?.metricMonitor?.rollingTime;
}

describe("the window each interval reads", () => {
  test("CLOUD_CONNECTION_READ_INTERVALS are the five a connection offers, each cloud's default among them", () => {
    expect(CLOUD_CONNECTION_READ_INTERVALS).toEqual([5, 10, 15, 30, 60]);
    expect(
      getCloudConnectionDefinition(CloudProvider.AWS)
        ?.defaultReadIntervalInMinutes,
    ).toBe(10);
    expect(
      getCloudConnectionDefinition(CloudProvider.Azure)
        ?.defaultReadIntervalInMinutes,
    ).toBe(5);
    expect(
      getCloudConnectionDefinition(CloudProvider.GCP)
        ?.defaultReadIntervalInMinutes,
    ).toBe(5);
  });

  /*
   * Read every 5, 10, 15, 30 and 60 minutes. Its template's window at its
   * cloud's default and faster; then its window plus the extra wait,
   * rounded up: Azure and Google Cloud's 15 minutes plus 5, 10, 25 or 55;
   * AWS's 30 plus 5, 20 or 50.
   */
  test.each([
    [
      EC2_CPU,
      [
        RollingTime.Past30Minutes,
        RollingTime.Past30Minutes,
        RollingTime.Past1Hour,
        RollingTime.Past1Hour,
        RollingTime.Past2Hours,
      ],
    ],
    [
      EC2_STATUS,
      [
        RollingTime.Past30Minutes,
        RollingTime.Past30Minutes,
        RollingTime.Past1Hour,
        RollingTime.Past1Hour,
        RollingTime.Past2Hours,
      ],
    ],
    [
      AZURE_VM_CPU,
      [
        RollingTime.Past15Minutes,
        RollingTime.Past30Minutes,
        RollingTime.Past30Minutes,
        RollingTime.Past1Hour,
        RollingTime.Past2Hours,
      ],
    ],
    [
      GCE_CPU,
      [
        RollingTime.Past15Minutes,
        RollingTime.Past30Minutes,
        RollingTime.Past30Minutes,
        RollingTime.Past1Hour,
        RollingTime.Past2Hours,
      ],
    ],
    /*
     * Its five-minute call comes every 15 minutes read every 5 or 15, every
     * 20 read every 10, and with the read past that.
     */
    [
      APP_HEALTH_CHECK,
      [
        RollingTime.Past30Minutes,
        RollingTime.Past1Hour,
        RollingTime.Past30Minutes,
        RollingTime.Past1Hour,
        RollingTime.Past2Hours,
      ],
    ],
    // Read once an hour whatever the interval: its 2 days stay.
    [
      ACM_EXPIRY,
      [
        CLOUD_SLOW_METRIC_WINDOW,
        CLOUD_SLOW_METRIC_WINDOW,
        CLOUD_SLOW_METRIC_WINDOW,
        CLOUD_SLOW_METRIC_WINDOW,
        CLOUD_SLOW_METRIC_WINDOW,
      ],
    ],
  ])("%s", (id: string, expected: Array<RollingTime>) => {
    expect(windowsAt(id)).toEqual(expected);
  });

  test("how often each template's metric is read", () => {
    expect(
      CLOUD_CONNECTION_READ_INTERVALS.map((minutes: number): number => {
        return getCloudAlertTemplateReadEveryMinutes(
          template(AZURE_VM_CPU),
          minutes,
        );
      }),
    ).toEqual([5, 10, 15, 30, 60]);
    expect(
      CLOUD_CONNECTION_READ_INTERVALS.map((minutes: number): number => {
        return getCloudAlertTemplateReadEveryMinutes(
          template(APP_HEALTH_CHECK),
          minutes,
        );
      }),
    ).toEqual([15, 20, 15, 30, 60]);
    expect(AZURE_FIVE_MINUTE_READ_MINUTES).toBe(15);
    expect(
      CLOUD_CONNECTION_READ_INTERVALS.map((minutes: number): number => {
        return getCloudAlertTemplateReadEveryMinutes(
          template(ACM_EXPIRY),
          minutes,
        );
      }),
    ).toEqual([60, 60, 60, 60, 60]);
  });

  test("no interval known - an unread connection, a row from before - reads its template's window", () => {
    for (const value of [undefined, null, 0, -5, Number.NaN]) {
      expect(
        getCloudAlertWindow({
          template: template(AZURE_VM_CPU),
          readIntervalInMinutes: value,
        }),
      ).toBe(RollingTime.Past15Minutes);
    }
  });

  test("every template's window at every interval: never shorter than its own, one a monitor offers, and long enough to hold what its reads add", () => {
    for (const cloudTemplate of getAllCloudAlertTemplates()) {
      const own: number = RollingTimeUtil.getWindowInMs(
        cloudTemplate.rollingTime,
      );
      const defaultInterval: number = getCloudConnectionDefinition(
        cloudTemplate.provider,
      )!.defaultReadIntervalInMinutes;

      for (const readIntervalInMinutes of CLOUD_CONNECTION_READ_INTERVALS) {
        const window: RollingTime = getCloudAlertWindow({
          template: cloudTemplate,
          readIntervalInMinutes,
        });
        const extraMs: number =
          (getCloudAlertTemplateReadEveryMinutes(
            cloudTemplate,
            readIntervalInMinutes,
          ) -
            getCloudAlertTemplateReadEveryMinutes(
              cloudTemplate,
              defaultInterval,
            )) *
          MINUTE_MS;

        expect(Object.values(RollingTime)).toContain(window);
        expect(RollingTimeUtil.getWindowInMs(window)).toBeGreaterThanOrEqual(
          own + Math.max(0, extraMs),
        );
        // Rounded up to the next a monitor offers, no further.
        expect(RollingTimeUtil.getWindowInMs(window)).toBeLessThanOrEqual(
          Math.max(own, 2 * (own + Math.max(0, extraMs))),
        );
      }
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * What the windows do, read after read
 * ---------------------------------------------------------------------------
 */

interface Read {
  atMs: number;
  points: Array<number>;
}

// The reads of one metric, as its connector's window policy has them.
function simulateReads(data: {
  policy: MetricWindowPolicy;
  intervalMinutes: number;
  firstReadMs: number;
  untilMs: number;
}): Array<Read> {
  const reads: Array<Read> = [];
  let cursor: string | undefined = undefined;

  for (
    let atMs: number = data.firstReadMs;
    atMs < data.untilMs;
    atMs += data.intervalMinutes * MINUTE_MS
  ) {
    const window: ReturnType<typeof getMetricWindow> = getMetricWindow({
      policy: data.policy,
      cursor,
      now: new Date(atMs),
    });

    if (!window) {
      continue;
    }

    const points: Array<number> = [];

    for (
      let point: number = window.start.getTime();
      point < window.end.getTime();
      point += data.policy.periodSeconds * 1000
    ) {
      points.push(point);
    }

    reads.push({ atMs, points });
    cursor = window.end.toISOString();
  }

  return reads;
}

interface Evaluation {
  atMs: number;
  // The points in its window, and the reads that brought them.
  points: Array<number>;
  readTimes: Array<number>;
}

interface Run {
  reads: Array<Read>;
  evaluations: Array<Evaluation>;
  // Of each read after the first, its points no evaluation judged.
  unjudged: Array<number>;
  // Of each read after the first: its first evaluation's misses.
  missedAtFirstEvaluation: Array<number>;
}

/*
 * A connection read every `intervalMinutes`, `readOffsetMs` after the
 * minute the monitor is evaluated on - every five minutes, clock aligned -
 * for twelve hours, after an hour of history the first read brings.
 */
function run(data: {
  policy: MetricWindowPolicy;
  intervalMinutes: number;
  readOffsetMs: number;
  window: RollingTime;
}): Run {
  const startMs: number = NOW.getTime() + data.readOffsetMs;
  const untilMs: number = NOW.getTime() + 12 * HOUR_MS;
  const windowMs: number = RollingTimeUtil.getWindowInMs(data.window);
  const reads: Array<Read> = simulateReads({
    policy: data.policy,
    intervalMinutes: data.intervalMinutes,
    firstReadMs: startMs,
    untilMs,
  });
  const evaluations: Array<Evaluation> = [];

  for (
    let atMs: number = NOW.getTime() + 5 * MINUTE_MS;
    atMs < untilMs;
    atMs += 5 * MINUTE_MS
  ) {
    const points: Array<number> = [];
    const readTimes: Set<number> = new Set<number>();

    for (const read of reads) {
      if (read.atMs >= atMs) {
        break;
      }

      for (const point of read.points) {
        if (point >= atMs - windowMs && point <= atMs) {
          points.push(point);
          readTimes.add(read.atMs);
        }
      }
    }

    evaluations.push({
      atMs,
      points,
      readTimes: Array.from(readTimes),
    });
  }

  const judged: Set<number> = new Set<number>();

  for (const evaluation of evaluations) {
    for (const point of evaluation.points) {
      judged.add(point);
    }
  }

  const unjudged: Array<number> = [];
  const missedAtFirstEvaluation: Array<number> = [];

  // The first read brings an hour of history, and the last may come after the run.
  for (const read of reads.slice(1, -1)) {
    const first: Evaluation | undefined = evaluations.find(
      (evaluation: Evaluation): boolean => {
        return evaluation.atMs > read.atMs;
      },
    );

    for (const point of read.points) {
      if (!judged.has(point)) {
        unjudged.push(point);
      }

      if (!first || !first.points.includes(point)) {
        missedAtFirstEvaluation.push(point);
      }
    }
  }

  return { reads, evaluations, unjudged, missedAtFirstEvaluation };
}

// The evaluations once the second read is in: the first's history aside.
function settled(result: Run): Array<Evaluation> {
  const second: Read | undefined = result.reads[1];

  return result.evaluations.filter((evaluation: Evaluation): boolean => {
    return Boolean(second) && evaluation.atMs > second!.atMs;
  });
}

function fewestPoints(result: Run): number {
  return Math.min(
    ...settled(result).map((evaluation: Evaluation): number => {
      return evaluation.points.length;
    }),
  );
}

const MINUTE_POLICY: (
  delayMs: number,
  periodSeconds: number,
) => MetricWindowPolicy = (
  delayMs: number,
  periodSeconds: number,
): MetricWindowPolicy => {
  return getMetricWindowPolicy({ periodSeconds, delayMs });
};

const CASES: Array<{
  name: string;
  id: string;
  policy: MetricWindowPolicy;
}> = [
  {
    name: "an AWS metric, five-minute periods read 10 minutes behind",
    id: EC2_CPU,
    policy: MINUTE_POLICY(AWS_METRIC_DELAY_MS, AWS_DEFAULT_PERIOD_SECONDS),
  },
  {
    name: "an Azure metric, a minute a point read 4 minutes behind",
    id: AZURE_VM_CPU,
    policy: MINUTE_POLICY(AZURE_METRIC_DELAY_MS, 60),
  },
  {
    name: "a Google Cloud metric, a minute a point read 4 minutes behind",
    id: GCE_CPU,
    policy: MINUTE_POLICY(GCP_METRIC_DELAY_MS, GCP_ALIGNMENT_PERIOD_SECONDS),
  },
  {
    name: "an Azure metric kept at five minutes, in a call of its own once 15 minutes are there",
    id: APP_HEALTH_CHECK,
    policy: getMetricWindowPolicy({
      periodSeconds: 300,
      delayMs: AZURE_METRIC_DELAY_MS,
      readEveryMs: AZURE_FIVE_MINUTE_READ_MINUTES * MINUTE_MS,
    }),
  },
];

// Reads that come at another second of the monitor's five minutes each time.
const READ_OFFSETS_MS: Array<number> = [
  20 * 1000,
  (1 * 60 + 40) * 1000,
  (3 * 60 + 10) * 1000,
  (4 * 60 + 50) * 1000,
];

describe.each(CASES)(
  "$name",
  (cloud: { name: string; id: string; policy: MetricWindowPolicy }) => {
    const cloudTemplate: CloudAlertTemplate = template(cloud.id);
    const defaultInterval: number = getCloudConnectionDefinition(
      cloudTemplate.provider,
    )!.defaultReadIntervalInMinutes;

    /*
     * Read every interval, at every offset from the monitor's evaluations:
     * the first evaluation after a read judges every point it brought with
     * the read before it, no evaluation finds its window empty, and none
     * holds fewer points than one at the default interval with its
     * template's window.
     */
    test.each(CLOUD_CONNECTION_READ_INTERVALS)(
      "read every %i minutes, its window judges every point, is never empty, and never holds less than at the default",
      (intervalMinutes: number) => {
        const window: RollingTime = getCloudAlertWindow({
          template: cloudTemplate,
          readIntervalInMinutes: intervalMinutes,
        });

        for (const readOffsetMs of READ_OFFSETS_MS) {
          const atDefault: Run = run({
            policy: cloud.policy,
            intervalMinutes: defaultInterval,
            readOffsetMs,
            window: cloudTemplate.rollingTime,
          });
          const result: Run = run({
            policy: cloud.policy,
            intervalMinutes,
            readOffsetMs,
            window,
          });

          expect(result.reads.length).toBeGreaterThan(8);
          expect(result.missedAtFirstEvaluation).toEqual([]);
          expect(result.unjudged).toEqual([]);
          expect(
            settled(result).filter((evaluation: Evaluation): boolean => {
              return evaluation.points.length === 0;
            }),
          ).toEqual([]);
          expect(fewestPoints(result)).toBeGreaterThanOrEqual(
            fewestPoints(atDefault),
          );

          /*
           * The first evaluation after a read holds the read before it too:
           * what "All Values" needs to judge the new points as late, not
           * stopped.
           */
          for (const read of result.reads.slice(2, -1)) {
            const first: Evaluation | undefined = result.evaluations.find(
              (evaluation: Evaluation): boolean => {
                return evaluation.atMs > read.atMs;
              },
            );

            expect(first?.readTimes.length).toBeGreaterThanOrEqual(2);
          }
        }
      },
    );

    // What the issue saw: its template's window, read every hour.
    test("read every 60 minutes with its template's window, as before: most evaluations find nothing, and a read's oldest points are never judged", () => {
      const before: Run = run({
        policy: cloud.policy,
        intervalMinutes: 60,
        readOffsetMs: READ_OFFSETS_MS[1]!,
        window: cloudTemplate.rollingTime,
      });
      const empty: number = settled(before).filter(
        (evaluation: Evaluation): boolean => {
          return evaluation.points.length === 0;
        },
      ).length;

      expect(empty).toBeGreaterThan(settled(before).length / 2);
      expect(before.unjudged.length).toBeGreaterThan(0);
    });
  },
);

/*
 * "All Values" judges a late series as far as its data reaches only once
 * it sees how often its data arrives (MetricWindowCoverage): a window that
 * holds one read's points alone shows a single arrival, and goes stale a
 * minute and a half after it. Read every hour, its template's 15 minutes
 * hold one read at every evaluation; the past 2 hours hold two at all but
 * the last evaluation before the next read.
 */
describe("what All Values makes of an Azure level read every hour", () => {
  const cloudTemplate: CloudAlertTemplate = template(AZURE_VM_CPU);

  function stale(window: RollingTime): { stale: number; judged: number } {
    const result: Run = run({
      policy: MINUTE_POLICY(AZURE_METRIC_DELAY_MS, 60),
      intervalMinutes: 60,
      readOffsetMs: READ_OFFSETS_MS[1]!,
      window,
    });
    const windowMs: number = RollingTimeUtil.getWindowInMs(window);
    let staleCount: number = 0;
    let judgedCount: number = 0;

    for (const evaluation of settled(result)) {
      if (evaluation.points.length === 0) {
        continue;
      }

      // Every row of a read is written within its minute.
      const arrivals: Array<number> = evaluation.readTimes;
      const newestArrivalMs: number = Math.max(...arrivals);
      const arrival: MetricSeriesArrival | null =
        MetricSeriesArrivalUtil.fromAggregates({
          asOfMs: evaluation.atMs,
          aggregates: {
            newestArrivalMs,
            oldestArrivalMs: Math.min(...arrivals),
            arrivalMinuteCount: arrivals.length,
            newestPointArrivalMs: newestArrivalMs,
            newestPointTimeMs: Math.max(...evaluation.points),
          },
        });
      const samples: Array<AggregateModel> = evaluation.points.map(
        (point: number): AggregateModel => {
          return { timestamp: new Date(point), value: 50 };
        },
      );
      const coverage: MetricWindowCoverageResult = MetricWindowCoverage.judge({
        window: {
          startMs: evaluation.atMs - windowMs,
          endMs: evaluation.atMs,
          completeFromMs: null,
        },
        samples,
        monitorIntervalMs: MINUTE_MS,
        arrival,
      });

      if (coverage.shortfall === WindowCoverageShortfall.Stale) {
        staleCount++;
      } else if (coverage.isCovered) {
        judgedCount++;
      }
    }

    return { stale: staleCount, judged: judgedCount };
  }

  test("its template's 15 minutes: stale at almost every evaluation that holds a point", () => {
    const before: { stale: number; judged: number } = stale(
      cloudTemplate.rollingTime,
    );

    expect(before.stale).toBeGreaterThan(before.judged * 2);
  });

  test("the past 2 hours its interval gives it: judged at all but about one evaluation an hour", () => {
    const window: RollingTime = getCloudAlertWindow({
      template: cloudTemplate,
      readIntervalInMinutes: 60,
    });

    expect(window).toBe(RollingTime.Past2Hours);

    const after: { stale: number; judged: number } = stale(window);

    expect(after.judged).toBeGreaterThan(after.stale * 8);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The monitor it makes, and what its stream changes
 * ---------------------------------------------------------------------------
 */

describe("the monitor a template makes", () => {
  test("reads the window its interval gives, and its criteria say so", () => {
    const step: MonitorStep = template(EC2_CPU).getMonitorStep(
      argsFor({ readIntervalInMinutes: 60 }),
    );

    expect(windowOf(step)).toBe(RollingTime.Past2Hours);
    expect(
      step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!.data!
        .description,
    ).toContain("past 2 hours");
    // Made without an interval, it reads its template's, as before.
    expect(windowOf(template(EC2_CPU).getMonitorStep(argsFor()))).toBe(
      RollingTime.Past30Minutes,
    );
  });

  test("its other windows: its template's, then each a slower interval gives it, with that interval", () => {
    expect(getCloudAlertTemplateWindows(template(AZURE_VM_CPU))).toEqual([
      { rollingTime: RollingTime.Past15Minutes },
      { rollingTime: RollingTime.Past30Minutes, readIntervalInMinutes: 10 },
      { rollingTime: RollingTime.Past1Hour, readIntervalInMinutes: 30 },
      { rollingTime: RollingTime.Past2Hours, readIntervalInMinutes: 60 },
    ]);
    expect(getCloudAlertTemplateWindows(template(ACM_EXPIRY))).toEqual([
      { rollingTime: RollingTime.Past2Days },
    ]);
  });

  test("the steps a monitor made at another interval has: every window but the one it would be made with now", () => {
    const steps: Array<MonitorStep> = getCloudAlertTemplateEquivalentSteps(
      template(EC2_CPU),
      argsFor({ readIntervalInMinutes: 30 }),
    );

    expect(steps.map(windowOf)).toEqual([
      RollingTime.Past30Minutes,
      RollingTime.Past2Hours,
    ]);
  });
});

describe("a stream writes what the reads would", () => {
  const AWS_STREAM: JSONObject = {
    metricSources: [
      {
        accountId: "123456789012",
        region: "eu-west-1",
        namespaces: ["AWS/EC2"],
        lastAt: new Date(NOW.getTime() - 2 * MINUTE_MS).toISOString(),
        templateVersion: AWS_STREAM_TEMPLATE_VERSION,
      },
    ],
    logSources: [],
  };

  test("an AWS account whose stream delivered its namespace lately: its templates keep their windows at any interval", () => {
    const streamed: Array<string> = getCloudAlertStreamedMetrics({
      provider: CloudProvider.AWS,
      resourceType: "AWS::EC2::Instance",
      accountId: "123456789012",
      region: "eu-west-1",
      streamSummary: AWS_STREAM,
      now: NOW,
    });

    expect(streamed).toEqual([
      "aws|aws/ec2|cpuutilization",
      "aws|aws/ec2|statuscheckfailed",
    ]);

    for (const id of [EC2_CPU, EC2_STATUS]) {
      expect(isCloudAlertTemplateStreamed(template(id), streamed)).toBe(true);
      expect(
        getCloudAlertWindow({
          template: template(id),
          readIntervalInMinutes: 60,
          streamedMetrics: streamed,
        }),
      ).toBe(RollingTime.Past30Minutes);
    }

    expect(
      windowOf(
        template(EC2_CPU).getMonitorStep(
          argsFor({ readIntervalInMinutes: 60, streamedMetrics: streamed }),
        ),
      ),
    ).toBe(RollingTime.Past30Minutes);
  });

  test("a stream that went quiet, another account's or Region's, or none: read, and widened", () => {
    const quiet: JSONObject = {
      metricSources: [
        {
          ...(AWS_STREAM["metricSources"] as Array<JSONObject>)[0],
          lastAt: new Date(NOW.getTime() - 20 * MINUTE_MS).toISOString(),
        },
      ],
      logSources: [],
    };

    for (const input of [
      { streamSummary: quiet, accountId: "123456789012", region: "eu-west-1" },
      {
        streamSummary: AWS_STREAM,
        accountId: "999999999999",
        region: "eu-west-1",
      },
      {
        streamSummary: AWS_STREAM,
        accountId: "123456789012",
        region: "us-east-1",
      },
      { streamSummary: undefined, accountId: "123456789012", region: "x" },
    ]) {
      const streamed: Array<string> = getCloudAlertStreamedMetrics({
        provider: CloudProvider.AWS,
        resourceType: "AWS::EC2::Instance",
        now: NOW,
        ...input,
      });

      expect(streamed).toEqual([]);
      expect(
        getCloudAlertWindow({
          template: template(EC2_CPU),
          readIntervalInMinutes: 60,
          streamedMetrics: streamed,
        }),
      ).toBe(RollingTime.Past2Hours);
    }
  });

  test("an Azure type its event hubs delivered: its minute metrics are streamed, its five-minute ones still read", () => {
    const streamed: Array<string> = getCloudAlertStreamedMetrics({
      provider: CloudProvider.Azure,
      resourceType: "Microsoft.Web/sites",
      accountId: "3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b",
      region: "westeurope",
      streamSummary: {
        metricSources: [
          {
            accountId: "3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b",
            region: "westeurope",
            namespaces: ["Microsoft.Web/sites"],
            lastAt: new Date(NOW.getTime() - MINUTE_MS).toISOString(),
          },
        ],
        logSources: [],
      },
      now: NOW,
    });

    expect(streamed.length).toBeGreaterThan(0);
    // Its health check is kept at five minutes: a stream sends minutes.
    expect(
      streamed.some((key: string): boolean => {
        return key.includes("healthcheckstatus");
      }),
    ).toBe(false);
    expect(
      isCloudAlertTemplateStreamed(template(APP_HEALTH_CHECK), streamed),
    ).toBe(false);
    expect(
      getCloudAlertWindow({
        template: template(APP_HEALTH_CHECK),
        readIntervalInMinutes: 60,
        streamedMetrics: streamed,
      }),
    ).toBe(RollingTime.Past2Hours);
  });

  test("Google Cloud streams nothing", () => {
    expect(
      getCloudAlertStreamedMetrics({
        provider: CloudProvider.GCP,
        resourceType: "gce_instance",
        accountId: "acme-prod",
        region: "europe-west1",
        streamSummary: AWS_STREAM,
        now: NOW,
      }),
    ).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * When the interval changes
 * ---------------------------------------------------------------------------
 */

describe("a monitor made before its connection's interval changed", () => {
  const RESOURCE_ID: string = "00000000-0000-4000-8000-0000000000e1";

  function contextAt(
    readIntervalInMinutes: number | undefined,
  ): MonitorRecommendationContext {
    return {
      cloudProvider: "aws",
      cloudResourceType: "AWS::EC2::Instance",
      cloudTelemetryAttributes: EC2_ATTRIBUTES,
      cloudReadIntervalInMinutes: readIntervalInMinutes,
    };
  }

  const args: MonitorRecommendationArgs = {
    resourceIdentifier: RESOURCE_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-1",
  };

  function recommendationsAt(
    readIntervalInMinutes: number | undefined,
  ): Array<MonitorRecommendation> {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.CloudResource,
      contextAt(readIntervalInMinutes),
    );
  }

  // The monitor the create flow makes of a recommendation, at an interval.
  function madeAt(
    readIntervalInMinutes: number | undefined,
    templateId: string,
  ): { monitorId: ObjectID; monitorSteps: Array<MonitorStep> } {
    const recommendation: MonitorRecommendation = recommendationsAt(
      readIntervalInMinutes,
    ).find((found: MonitorRecommendation): boolean => {
      return found.templateId === templateId;
    })!;

    // Its step, as MonitorRecommendationUtil.buildMonitorSteps builds it.
    return {
      monitorId: ObjectID.generate(),
      monitorSteps: [
        recommendation.getMonitorStep({
          ...args,
          monitorName: MonitorRecommendationUtil.getTemplateMonitorName({
            recommendation,
            resourceDisplayName: args.monitorName,
          }),
        }),
      ],
    };
  }

  test("the recommendation made at each interval reads that interval's window", () => {
    for (const [minutes, window] of [
      [undefined, RollingTime.Past30Minutes],
      [10, RollingTime.Past30Minutes],
      [30, RollingTime.Past1Hour],
      [60, RollingTime.Past2Hours],
    ] as Array<[number | undefined, RollingTime]>) {
      const made: { monitorSteps: Array<MonitorStep> } = madeAt(
        minutes,
        EC2_CPU,
      );

      expect(made.monitorSteps.map(windowOf)).toEqual([window]);
    }
  });

  test("keeps its window, and still counts as created at every other interval: it is never offered twice", () => {
    for (const madeMinutes of [undefined, 5, 10, 15, 30, 60]) {
      const existing: {
        monitorId: ObjectID;
        monitorSteps: Array<MonitorStep>;
      } = madeAt(madeMinutes, EC2_CPU);

      for (const nowMinutes of [undefined, 5, 10, 15, 30, 60]) {
        const covered: Map<string, ObjectID> =
          MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
            recommendations: recommendationsAt(nowMinutes),
            existingMonitors: [existing],
            args,
          });

        expect([madeMinutes, nowMinutes, covered.size]).toEqual([
          madeMinutes,
          nowMinutes,
          1,
        ]);
        expect(Array.from(covered.values())[0]!.toString()).toBe(
          existing.monitorId.toString(),
        );
      }

      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: recommendationsAt(60),
          existingMonitorSteps: existing.monitorSteps,
          args,
        }).size,
      ).toBe(1);
    }
  });

  test("the monitor it would make now is the one a page links to, when there are both", () => {
    const old: { monitorId: ObjectID; monitorSteps: Array<MonitorStep> } =
      madeAt(undefined, EC2_CPU);
    const current: { monitorId: ObjectID; monitorSteps: Array<MonitorStep> } =
      madeAt(60, EC2_CPU);

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: recommendationsAt(60),
        existingMonitors: [old, current],
        args,
      });

    expect(Array.from(covered.values())[0]!.toString()).toBe(
      current.monitorId.toString(),
    );
  });

  test("a monitor whose window a team set to one no interval gives is not this recommendation", () => {
    const tuned: { monitorId: ObjectID; monitorSteps: Array<MonitorStep> } =
      madeAt(undefined, EC2_CPU);

    tuned.monitorSteps[0]!.data!.metricMonitor!.rollingTime =
      RollingTime.Past6Hours;

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: recommendationsAt(60),
        existingMonitors: [tuned],
        args,
      }).size,
    ).toBe(0);
  });
});
