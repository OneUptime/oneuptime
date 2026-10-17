/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import CriteriaInEffect, {
  OpenCriteriaRecord,
} from "../../../../../Server/Utils/Monitor/CriteriaInEffect";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
} from "../../../../../Types/MessageQueue/MessageQueueMetricCatalog";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import { EvaluateOverTimeType } from "../../../../../Types/Monitor/CriteriaFilter";
import {
  MessageQueueAlertTemplate,
  getMessageQueueAlertTemplateForMetric,
} from "../../../../../Types/Monitor/MessageQueueAlertTemplates";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import { MonitorStepKubernetesMonitorUtil } from "../../../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import {
  METRIC_FIXTURES,
  MetricFixture,
} from "../../../../Types/MessageQueue/MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * "All Values" over a Metrics monitor whose source delivers its data late
 * by design (#4793, review).
 *
 * The aws_cloudwatch receiver asks CloudWatch, once per collection_interval
 * (5 minutes), for the one-minute periods that ended at least `delay` (10
 * minutes) before, and stamps each point with its period's start
 * (MessageQueueAlertTemplates, WINDOWS AND LATE SOURCES): its newest point
 * is 11 to 16 minutes old. The shipped SQS templates read 30 minutes for
 * that reason, and "All Values" holds every point the window has. Judged
 * fresh against now, every point of such a monitor would look as if its
 * queue had stopped reporting, and the monitor would never fire again; a
 * Metrics monitor's series are judged against its own newest data point
 * instead. The infrastructure monitors, whose collectors send what they
 * read as they read it, are still judged against now.
 *
 * The data is what the Metrics monitor's read returns: a point per minute
 * bucket, which for CloudWatch is its period's start. Every time is fixed.
 */

const MINUTE: number = 60_000;
const START: number = Date.UTC(2026, 9, 16, 12, 0, 0);

// Messages visible: above the template's 1,000, and below its 900 recovery.
const HIGH: number = 2500;
const LOW: number = 100;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// The shipped CloudWatch SQS backlog template: ApproximateNumberOfMessagesVisible.
const descriptor: MessageQueueMetricDescriptor =
  getMessageQueueMetricDescriptorsByName(
    "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
  ).find((candidate: MessageQueueMetricDescriptor) => {
    return candidate.system === "aws_sqs";
  })!;

const template: MessageQueueAlertTemplate =
  getMessageQueueAlertTemplateForMetric(descriptor)!;

// The stored datapoint of the "orders" queue the resolver suites use.
const ordersFixture: MetricFixture = METRIC_FIXTURES.find(
  (candidate: MetricFixture) => {
    return (
      candidate.metricName === template.metricName &&
      candidate.expected?.system === template.system
    );
  },
)!;

const sqsStep: MonitorStep = template.getMonitorStep({
  observedSeries: [ordersFixture.attributes],
  onlineMonitorStatusId: ONLINE,
  offlineMonitorStatusId: OFFLINE,
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Queue orders",
})!;

const sqsView: MetricsViewConfig = MonitorStep.getMetricsViewConfig(sqsStep)!;

const instances: Array<MonitorCriteriaInstance> =
  sqsStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
// At or above 1,000 messages, All Values: opens an incident.
const backlogHigh: MonitorCriteriaInstance = instances[0]!;
// Below 900, All Values: back online.
const healthy: MonitorCriteriaInstance = instances[1]!;

/*
 * The same view and criteria read by an infrastructure monitor - its
 * collector sends what it reads as it reads it.
 */
const infrastructureStep: MonitorStep = new MonitorStep().setKubernetesMonitor({
  ...MonitorStepKubernetesMonitorUtil.getDefault(),
  clusterIdentifier: "prod",
  metricViewConfig: sqsView,
  rollingTime: RollingTime.Past30Minutes,
});

// The check at `minute` minutes and 30 seconds past 12:00.
function checkAt(minute: number): number {
  return START + minute * MINUTE + 30_000;
}

/*
 * Where the periods the receiver has delivered by a check end: its last
 * collection, on the five-minute mark, read up to ten minutes before it.
 */
function deliveredUntilMs(checkMs: number): number {
  return Math.floor(checkMs / (5 * MINUTE)) * 5 * MINUTE - 10 * MINUTE;
}

/*
 * The points the Metrics monitor's read holds at a check: one per delivered
 * period inside the 30-minute window, valued `backlog(periodStart)`, or
 * none for a period it gives null.
 */
function cloudWatchPoints(
  checkMs: number,
  backlog: (periodStartMs: number) => number | null,
): { window: InBetween<Date>; data: Array<AggregateModel> } {
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    RollingTime.Past30Minutes,
    new Date(checkMs),
  );
  const startMs: number = (window.startValue as Date).getTime();
  const data: Array<AggregateModel> = [];

  for (
    let periodMs: number = Math.ceil(startMs / MINUTE) * MINUTE;
    periodMs + MINUTE <= deliveredUntilMs(checkMs);
    periodMs += MINUTE
  ) {
    const value: number | null = backlog(periodMs);

    if (value !== null) {
      data.push({ timestamp: new Date(periodMs), value: value });
    }
  }

  return { window, data };
}

function ordersResponse(
  checkMs: number,
  backlog: (periodStartMs: number) => number | null,
): MetricMonitorResponse {
  const points: { window: InBetween<Date>; data: Array<AggregateModel> } =
    cloudWatchPoints(checkMs, backlog);

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: sqsView,
    metricResult: [{ data: points.data }],
    startAndEndDate: points.window,
  };
}

async function evaluate(input: {
  step: MonitorStep;
  criteria: MonitorCriteriaInstance;
  response: MetricMonitorResponse;
}): Promise<Array<MetricSeriesEvaluationResult>> {
  return await MetricMonitorCriteria.evaluateAllSeries({
    dataToProcess: input.response as DataToProcess,
    // A copy: the evaluator writes its context back onto the filter.
    criteriaFilter: JSON.parse(
      JSON.stringify(input.criteria.data!.filters[0]!),
    ),
    monitorStep: input.step,
  });
}

function always(value: number): (periodStartMs: number) => number {
  return (): number => {
    return value;
  };
}

describe("the shipped CloudWatch SQS backlog template", () => {
  test("is the late source this is about: All Values over 30 minutes of a Metrics monitor", () => {
    expect(template.receiver).toBe("aws_cloudwatch");
    expect(template.evaluation).toBe(EvaluateOverTimeType.AllValues);
    expect(template.rollingTime).toBe(RollingTime.Past30Minutes);
    expect(sqsStep.data!.metricMonitor).toBeDefined();

    // At 12:45:30 the newest point delivered is 12:34's: 11.5 minutes old.
    const data: Array<AggregateModel> = cloudWatchPoints(
      checkAt(45),
      always(HIGH),
    ).data;
    expect((data[data.length - 1]!.timestamp as Date).getTime()).toBe(
      START + 34 * MINUTE,
    );
  });

  test("a backlog high at every point the window holds fires, though the newest point is minutes old", async () => {
    const [orders] = await evaluate({
      step: sqsStep,
      criteria: backlogHigh,
      response: ordersResponse(checkAt(45), always(HIGH)),
    });

    expect(orders!.rootCause).not.toBeNull();
    expect(orders!.context.windowWait).toBeUndefined();
  });

  test("read by an infrastructure monitor, the same points wait: there, data that stopped coming has stopped", async () => {
    const [orders] = await evaluate({
      step: infrastructureStep,
      criteria: backlogHigh,
      response: ordersResponse(checkAt(45), always(HIGH)),
    });

    expect(orders!.rootCause).toBeNull();
    expect(orders!.context.windowWait?.shortfall).toBe("Stale");
    // 12:34's period ended at 12:35, ten and a half minutes before 12:45:30.
    expect(orders!.context.windowWait?.message).toContain(
      "Waiting for 30 minutes of data: no new data point for the last 10 minutes.",
    );
  });

  test("a queue that began reporting part way through the window waits", async () => {
    const [orders] = await evaluate({
      step: sqsStep,
      criteria: backlogHigh,
      response: ordersResponse(checkAt(45), (periodStartMs: number) => {
        return periodStartMs >= START + 24 * MINUTE ? HIGH : null;
      }),
    });

    expect(orders!.rootCause).toBeNull();
    expect(orders!.context.windowWait?.shortfall).toBe("StartsLate");
  });

  test("a gap of three periods waits", async () => {
    const [orders] = await evaluate({
      step: sqsStep,
      criteria: backlogHigh,
      response: ordersResponse(checkAt(45), (periodStartMs: number) => {
        return periodStartMs >= START + 25 * MINUTE &&
          periodStartMs < START + 28 * MINUTE
          ? null
          : HIGH;
      }),
    });

    expect(orders!.rootCause).toBeNull();
    expect(orders!.context.windowWait?.shortfall).toBe("Hole");
  });

  test("a drained queue meets the recovery criteria the same way", async () => {
    const [orders] = await evaluate({
      step: sqsStep,
      criteria: healthy,
      response: ordersResponse(checkAt(45), always(LOW)),
    });

    expect(orders!.rootCause).not.toBeNull();
  });

  /*
   * Two queues through one monitor: "orders" as late as CloudWatch always
   * is, "refunds" with nothing since 12:28 - six periods before orders'
   * newest. Judged against the monitor's newest data, refunds stopped.
   */
  test("a queue whose points stopped while the monitor's others kept coming still waits", async () => {
    const orders: { window: InBetween<Date>; data: Array<AggregateModel> } =
      cloudWatchPoints(checkAt(45), always(HIGH));
    const refunds: Array<AggregateModel> = orders.data.filter(
      (point: AggregateModel) => {
        return (point.timestamp as Date).getTime() <= START + 28 * MINUTE;
      },
    );
    const series: (
      name: string,
      data: Array<AggregateModel>,
    ) => MetricSeriesResult = (
      name: string,
      data: Array<AggregateModel>,
    ): MetricSeriesResult => {
      return {
        fingerprint: name,
        labels: { "Dimensions.QueueName": name },
        aggregatedResults: [{ data }],
      };
    };

    const evaluations: Array<MetricSeriesEvaluationResult> = await evaluate({
      step: sqsStep,
      criteria: backlogHigh,
      response: {
        projectId: ObjectID.generate(),
        monitorId: ObjectID.generate(),
        metricViewConfig: sqsView,
        metricResult: [],
        seriesBreakdown: [
          series("orders", orders.data),
          series("refunds", refunds),
        ],
        startAndEndDate: orders.window,
      },
    });

    const byQueue: Record<string, MetricSeriesEvaluationResult> = {};
    for (const evaluation of evaluations) {
      byQueue[evaluation.fingerprint!] = evaluation;
    }

    expect(byQueue["orders"]!.rootCause).not.toBeNull();
    expect(byQueue["refunds"]!.rootCause).toBeNull();
    expect(byQueue["refunds"]!.context.windowWait?.shortfall).toBe("Stale");
    // 12:28's period ended at 12:29, sixteen and a half minutes ago.
    expect(byQueue["refunds"]!.context.windowWait?.message).toContain(
      "no new data point for the last 16 minutes.",
    );
  });
});

/*
 * The same monitor end to end through MonitorCriteriaEvaluator - the call
 * MonitorResource makes - checked once a minute while the receiver delivers
 * CloudWatch's periods every five minutes, ten minutes late. The backlog is
 * high from 12:00 to 13:00. What MonitorResource keeps between checks (the
 * status, and whether the incident is open) is handed back to it, as in
 * production.
 */
describe("checked once a minute while CloudWatch's data arrives late", () => {
  interface Kept {
    status: ObjectID;
    incidentOpen: boolean;
  }

  async function runChecks(
    backlog: (periodStartMs: number) => number,
  ): Promise<Array<{ minute: number; met: string | null }>> {
    const checks: Array<{ minute: number; met: string | null }> = [];
    let kept: Kept = { status: ONLINE, incidentOpen: false };

    for (let minute: number = 0; minute <= 100; minute++) {
      const monitor: Monitor = new Monitor();
      monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
      monitor.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
      monitor.monitorType = MonitorType.Metrics;
      monitor.currentMonitorStatusId = kept.status;

      const open: boolean = kept.incidentOpen;
      const summary: MonitorEvaluationSummary = {
        evaluatedAt: new Date(checkAt(minute)),
        criteriaResults: [],
        events: [],
      };

      const result: ProbeApiIngestResponse =
        await MonitorCriteriaEvaluator.processMonitorStep({
          dataToProcess: ordersResponse(checkAt(minute), backlog),
          monitorStep: sqsStep,
          monitor: monitor,
          probeApiIngestResponse: { monitorId: monitor.id, rootCause: null },
          evaluationSummary: summary,
          criteriaInEffect: new CriteriaInEffect({
            monitor: monitor,
            readOpenRecords: async (): Promise<Array<OpenCriteriaRecord>> => {
              return open
                ? [
                    {
                      createdCriteriaId: backlogHigh.data!.id,
                      seriesFingerprint: undefined,
                    },
                  ]
                : [];
            },
          }),
        });

      const met: string | null = result.criteriaMetId?.toString() || null;
      checks.push({ minute, met });

      if (met === backlogHigh.data!.id) {
        kept = { status: OFFLINE, incidentOpen: true };
      } else if (met === healthy.data!.id || kept.status !== ONLINE) {
        // Healthy, or no criteria met: back to the default status, resolved.
        kept = { status: ONLINE, incidentOpen: false };
      }
    }

    return checks;
  }

  function minutesWhen(
    checks: Array<{ minute: number; met: string | null }>,
    criteria: MonitorCriteriaInstance | null,
  ): Array<number> {
    return checks
      .filter((check: { minute: number; met: string | null }) => {
        return check.met === (criteria ? criteria.data!.id : null);
      })
      .map((check: { minute: number; met: string | null }) => {
        return check.minute;
      });
  }

  function range(from: number, to: number): Array<number> {
    const minutes: Array<number> = [];
    for (let minute: number = from; minute <= to; minute++) {
      minutes.push(minute);
    }
    return minutes;
  }

  test("the incident opens once every point the window holds is high, and resolves once the drain reaches the window", async () => {
    const checks: Array<{ minute: number; met: string | null }> =
      await runChecks((periodStartMs: number) => {
        return periodStartMs >= START && periodStartMs < START + 60 * MINUTE
          ? HIGH
          : LOW;
      });

    /*
     * Until 12:15 the receiver has delivered nothing from 12:00 on: every
     * point is low, and the queue is healthy.
     *
     * 12:29:30: the window starts at 11:59:30, so its first period is
     * 12:00's, and every period delivered since - to 12:14 - is high. A
     * check earlier still holds 11:59's low period.
     */
    expect(minutesWhen(checks, healthy).slice(0, 15)).toEqual(range(0, 14));
    expect(minutesWhen(checks, backlogHigh)).toEqual(range(29, 74));

    /*
     * 13:15:30: the collection at 13:15 delivers 13:00's period, the first
     * low one, so the backlog is no longer high at every point; the queue
     * is healthy at every point from 13:29:30, when 12:59's high period has
     * left the window. In between, neither: the monitor goes back to its
     * default status.
     */
    expect(minutesWhen(checks, null)).toEqual([
      ...range(15, 28),
      ...range(75, 88),
    ]);
    expect(minutesWhen(checks, healthy)).toEqual([
      ...range(0, 14),
      ...range(89, 100),
    ]);
  });
});
