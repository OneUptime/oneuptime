import { describe, expect, test } from "@jest/globals";
import {
  AI_INSIGHT_MONITOR_LATENCY_BLOCKER,
  AIInsightMonitorInput,
  AIInsightMonitorSeedIds,
  ERROR_LOG_SPIKE_LOG_SEVERITIES,
  ERROR_LOG_SPIKE_MIN_COUNT,
  ERROR_LOG_SPIKE_MULTIPLIER,
  EXCEPTION_SPIKE_MIN_COUNT,
  EXCEPTION_SPIKE_MULTIPLIER,
  LOG_ERROR_PATTERN_MIN_COUNT,
  METRIC_DRIFT_RELATIVE_CHANGE,
  NEW_EXCEPTION_MIN_COUNT,
  NEW_EXCEPTION_MONITOR_WINDOW_SECONDS,
  SPIKE_MONITOR_WINDOW_SECONDS,
  TRACE_FAILING_OPERATION_MIN_COUNT,
  buildAIInsightMonitorPrefill,
  getAIInsightMonitorBlocker,
  getStableExceptionMessageFragment,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill";
import MonitorCriteriaAlignmentUtil, {
  MonitorStepsAlignmentResult,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaAlignment";
import CriteriaNameUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import ErrorLogSpikeDetector, {
  ERROR_LOG_SEVERITIES,
  ERROR_LOG_SPIKE_MIN_MULTIPLIER,
  ERROR_LOG_SPIKE_MIN_RECENT_COUNT,
  ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES,
} from "../../../Server/Utils/AI/SRE/Insights/Detectors/ErrorLogSpikeDetector";
import ExceptionSpikeDetector, {
  EXCEPTION_SPIKE_MIN_MULTIPLIER,
  EXCEPTION_SPIKE_MIN_RECENT_COUNT,
  EXCEPTION_SPIKE_RECENT_WINDOW_HOURS,
} from "../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionSpikeDetector";
import {
  NEW_EXCEPTION_LOOKBACK_HOURS,
  NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
} from "../../../Server/Utils/AI/SRE/Insights/Detectors/NewExceptionDetector";
import MetricDriftDetector, {
  METRIC_DRIFT_MIN_RELATIVE_CHANGE,
  MetricDriftFinding,
} from "../../../Server/Utils/AI/SRE/Insights/Detectors/MetricDriftDetector";
import { sanitizeExceptionMessage } from "../../../Server/Utils/Telemetry/ExceptionSanitizer";
import ExceptionMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import LogMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import MetricMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import TraceMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/TraceMonitorCriteria";
import {
  TRACE_INSIGHT_MIN_FAILED_PERCENT,
  TRACE_INSIGHT_MIN_FAILED_SPANS,
  TRACE_INSIGHT_WINDOW_MINUTES,
  pickFailingOperations,
} from "../../../Utils/Traces/TraceInsight";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import LogProblemDetector from "../../../Server/Utils/AI/SRE/Insights/Detectors/LogProblemDetector";
import {
  LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT,
  LOG_INSIGHT_WINDOW_MINUTES,
  LogPatternReading,
  pickErrorPatterns,
} from "../../../Utils/Logs/LogInsight";
import { normalizeLogBodyToErrorPattern } from "../../../Utils/Telemetry/LogErrorPattern";
import AIInsightType from "../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Search from "../../../Types/BaseDatabase/Search";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import ExceptionMonitorResponse from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";

/*
 * The half of the "Create Monitor from an insight" contract that only a
 * suite able to import server modules can pin:
 *
 *  - PARITY. The dashboard mirrors the detectors' constants because
 *    Common/Server is server-only. A detector retuned without its mirror
 *    would seed monitors on a rule the detector no longer uses — silently.
 *  - THE MESSAGE FILTER. The insight stores an exception message only after
 *    ExceptionSanitizer replaced its dynamic values with placeholders, while
 *    the exception monitor matches its filter against RAW messages. A filter
 *    that is not a piece of the raw message matches nothing, forever, while
 *    looking configured. Pinned against the real sanitizer, case-insensitive
 *    like the ILIKE the monitor compiles to.
 *  - THE EVALUATORS. A monitor made from an insight must fire on the spike it
 *    was made from and clear below its threshold — judged by the same
 *    criteria classes the telemetry worker runs.
 *  - THE FORM. The steps form re-aligns criteria to the monitor type and
 *    names unnamed ones when it mounts; a prefill it rewrote would lose the
 *    threshold the person was shown.
 */

const SERVICE_ID: string = "11111111-2222-4333-8444-555555555555";
const ENTITY_ID: string = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);

const SEEDS: AIInsightMonitorSeedIds = {
  operationalMonitorStatusId: OPERATIONAL_STATUS_ID,
  offlineMonitorStatusId: OFFLINE_STATUS_ID,
  rankedIncidentSeverityIds: [INCIDENT_SEVERITY_ID],
  rankedAlertSeverityIds: [ALERT_SEVERITY_ID],
};

function build(insight: AIInsightMonitorInput): JSONObject {
  const prefill: JSONObject | null = buildAIInsightMonitorPrefill({
    insight: insight,
    seeds: SEEDS,
  });

  expect(prefill).not.toBeNull();

  return prefill!;
}

function stepsOf(prefill: JSONObject): MonitorSteps {
  return MonitorSteps.fromJSON(prefill["monitorSteps"] as JSONObject);
}

function stepOf(prefill: JSONObject): MonitorStep {
  return stepsOf(prefill).data!.monitorStepsInstanceArray[0]!;
}

function filterOf(
  prefill: JSONObject,
  which: "unhealthy" | "healthy",
): CriteriaFilter {
  const instance: MonitorCriteriaInstance =
    stepOf(prefill).data!.monitorCriteria.data!.monitorCriteriaInstanceArray[
      which === "unhealthy" ? 0 : 1
    ]!;

  // A copy: the evaluators write context back onto the filter.
  return JSON.parse(
    JSON.stringify(instance.data!.filters[0]),
  ) as CriteriaFilter;
}

const errorLogSpikeInsight: AIInsightMonitorInput = {
  insightType: AIInsightType.ErrorLogSpike,
  severity: AIInsightSeverity.Medium,
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    logSpike: {
      recentErrorCount: 640,
      baselineHourlyAverage: 55,
      spikeMultiplier: 11.6,
      windowMinutes: ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES,
      topServices: [{ serviceName: "checkout", count: 520 }],
    },
  },
};

const exceptionSpikeInsight: AIInsightMonitorInput = {
  insightType: AIInsightType.ExceptionSpike,
  severity: AIInsightSeverity.High,
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    exception: {
      exceptionType: "TimeoutError",
      exceptionMessage: sanitizeExceptionMessage(
        "Query timed out after 30000 ms for order 9f8b2c1a-77de-4b0e-8a5b-0c9a2f1e4d33",
      ),
      recentOccurrenceCount: 84,
      baselineHourlyAverage: 4.25,
      spikeMultiplier: 19.8,
    },
  },
};

// A failing operation Traces' detector filed: 312 of 2,600 spans in its hour.
const failingOperationInsight: AIInsightMonitorInput = {
  insightType: AIInsightType.TraceFailingOperation,
  severity: AIInsightSeverity.Medium,
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    trace: {
      serviceId: SERVICE_ID,
      kind: "Failing",
      operationName: "POST /checkout",
      windowStartTime: "2026-10-24T08:00:00.000Z",
      windowEndTime: "2026-10-24T09:00:00.000Z",
      spanCount: 2600,
      failedSpanCount: 312,
    },
  },
};

/*
 * An error log Logs' detector filed: one payment error, logged with a new
 * amount and order each time. Its search words are what the detector takes
 * from the line as logged (LogProblemDetector.getSearchText).
 */
const PAYMENT_ERROR_LINES: Array<string> = [
  "Payment provider returned 402: card declined for order 9f8b2c1a-77de-4b0e-8a5b-0c9a2f1e4d33",
  "Payment provider returned 409: card declined for order 1c2d3e4f-0000-4b0e-8a5b-0c9a2f1e4d34",
  "Payment provider returned 402: card declined for order 2f3e4d5c-1111-4b0e-8a5b-0c9a2f1e4d35",
];

const errorLogInsight: AIInsightMonitorInput = {
  insightType: AIInsightType.LogErrorPattern,
  severity: AIInsightSeverity.High,
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    log: {
      serviceId: SERVICE_ID,
      kind: "Error",
      windowStartTime: "2026-10-24T08:00:00.000Z",
      windowEndTime: "2026-10-24T09:00:00.000Z",
      logCount: 18400,
      errorLogCount: 2100,
      pattern: normalizeLogBodyToErrorPattern(PAYMENT_ERROR_LINES[0]!),
      patternCount: 1240,
      severities: ["Error"],
      searchText: LogProblemDetector.getSearchText({
        pattern: normalizeLogBodyToErrorPattern(PAYMENT_ERROR_LINES[0]!),
        sampleBody: PAYMENT_ERROR_LINES[0]!,
      }),
    },
  },
};

const newExceptionInsight: AIInsightMonitorInput = {
  ...exceptionSpikeInsight,
  insightType: AIInsightType.NewException,
};

const metricDriftInsight: AIInsightMonitorInput = {
  insightType: AIInsightType.MetricDrift,
  severity: AIInsightSeverity.Low,
  metricName: "queue.depth",
  evidence: {
    metricDrift: {
      metricName: "queue.depth",
      primaryEntityId: ENTITY_ID,
      recentWeekMean: 412,
      priorWeekMean: 160,
      relativeChangePercent: 157.5,
      recentSampleCount: 10080,
      priorSampleCount: 10080,
    },
  },
};

describe("parity with the detectors", () => {
  test("ErrorLogSpike: floor, multiplier, severities and window", () => {
    expect(ERROR_LOG_SPIKE_MIN_COUNT).toBe(ERROR_LOG_SPIKE_MIN_RECENT_COUNT);
    expect(ERROR_LOG_SPIKE_MULTIPLIER).toBe(ERROR_LOG_SPIKE_MIN_MULTIPLIER);
    expect([...ERROR_LOG_SPIKE_LOG_SEVERITIES]).toEqual(ERROR_LOG_SEVERITIES);
    expect(SPIKE_MONITOR_WINDOW_SECONDS).toBe(
      ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES * 60,
    );
  });

  test("ExceptionSpike: floor, multiplier and window", () => {
    expect(EXCEPTION_SPIKE_MIN_COUNT).toBe(EXCEPTION_SPIKE_MIN_RECENT_COUNT);
    expect(EXCEPTION_SPIKE_MULTIPLIER).toBe(EXCEPTION_SPIKE_MIN_MULTIPLIER);
    expect(SPIKE_MONITOR_WINDOW_SECONDS).toBe(
      EXCEPTION_SPIKE_RECENT_WINDOW_HOURS * 3600,
    );
  });

  test("NewException: recurrence count and novelty window", () => {
    expect(NEW_EXCEPTION_MIN_COUNT).toBe(NEW_EXCEPTION_MIN_OCCURRENCE_COUNT);
    expect(NEW_EXCEPTION_MONITOR_WINDOW_SECONDS).toBe(
      NEW_EXCEPTION_LOOKBACK_HOURS * 3600,
    );
  });

  test("MetricDrift: relative change", () => {
    expect(METRIC_DRIFT_RELATIVE_CHANGE).toBe(METRIC_DRIFT_MIN_RELATIVE_CHANGE);
  });

  test("TraceFailingOperation: the floor of failed spans and the hour it reads", () => {
    expect(TRACE_FAILING_OPERATION_MIN_COUNT).toBe(
      TRACE_INSIGHT_MIN_FAILED_SPANS,
    );
    expect(SPIKE_MONITOR_WINDOW_SECONDS).toBe(
      TRACE_INSIGHT_WINDOW_MINUTES * 60,
    );

    // The monitor's bar is the count the detector starts filing at.
    const threshold: number = Number(
      filterOf(build(failingOperationInsight), "unhealthy").value,
    );
    const operation: (failedSpanCount: number) => {
      name: string;
      spanCount: number;
      failedSpanCount: number;
      p50Ms: number;
      p99Ms: number;
    } = (failedSpanCount: number) => {
      return {
        name: "POST /checkout",
        // A share well over the detector's 5%, so only the count decides.
        spanCount: Math.ceil(
          (failedSpanCount * 100) / TRACE_INSIGHT_MIN_FAILED_PERCENT,
        ),
        failedSpanCount: failedSpanCount,
        p50Ms: 90,
        p99Ms: 900,
      };
    };

    expect(pickFailingOperations([operation(threshold)])).toHaveLength(1);
    expect(pickFailingOperations([operation(threshold - 1)])).toHaveLength(0);
  });

  test("LogErrorPattern: the floor of lines and the hour it reads", () => {
    expect(LOG_ERROR_PATTERN_MIN_COUNT).toBe(
      LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT,
    );
    expect(SPIKE_MONITOR_WINDOW_SECONDS).toBe(LOG_INSIGHT_WINDOW_MINUTES * 60);

    // The monitor's bar is the count the detector starts filing at.
    const threshold: number = Number(
      filterOf(build(errorLogInsight), "unhealthy").value,
    );
    const reading: (count: number) => LogPatternReading = (count: number) => {
      return {
        pattern: "Payment provider returned <num>: card declined",
        count,
        severities: ["Error"],
        searchText: "Payment provider returned",
        traceCount: 0,
        sampleTraceIds: [],
        hasException: false,
      };
    };

    expect(pickErrorPatterns([reading(threshold)])).toHaveLength(1);
    expect(pickErrorPatterns([reading(threshold - 1)])).toHaveLength(0);
  });

  test("the monitor's threshold is exactly where the detector starts calling it a spike", () => {
    // ErrorLogSpike: baseline 55/hour, so 165 is a spike and 164 is not.
    const threshold: number = Number(
      filterOf(
        build({
          ...errorLogSpikeInsight,
          serviceName: undefined,
          telemetryServiceId: undefined,
        }),
        "unhealthy",
      ).value,
    );

    expect(threshold).toBe(165);
    expect(
      ErrorLogSpikeDetector.evaluateSpike(threshold, 55 * 24).isSpike,
    ).toBe(true);
    expect(
      ErrorLogSpikeDetector.evaluateSpike(threshold - 1, 55 * 24).isSpike,
    ).toBe(false);

    // ExceptionSpike: baseline 4.25/hour, so 22 is a spike and 21 is not.
    const exceptionThreshold: number = Number(
      filterOf(build(exceptionSpikeInsight), "unhealthy").value,
    );

    expect(exceptionThreshold).toBe(22);
    expect(
      ExceptionSpikeDetector.evaluateSpike(exceptionThreshold, 4.25 * 24)
        .isSpike,
    ).toBe(true);
    expect(
      ExceptionSpikeDetector.evaluateSpike(exceptionThreshold - 1, 4.25 * 24)
        .isSpike,
    ).toBe(false);
  });

  test("the drift threshold is exactly the relative change the detector files at", () => {
    const threshold: number = Number(
      filterOf(build(metricDriftInsight), "unhealthy").value,
    );

    expect(threshold).toBe(240);

    const findingAt: (recentMean: number) => Array<MetricDriftFinding> = (
      recentMean: number,
    ): Array<MetricDriftFinding> => {
      return MetricDriftDetector.evaluateDrift([
        {
          name: "queue.depth",
          primaryEntityId: ENTITY_ID,
          window: "recent",
          mean: recentMean,
          sampleCount: 10080,
        },
        {
          name: "queue.depth",
          primaryEntityId: ENTITY_ID,
          window: "prior",
          mean: 160,
          sampleCount: 10080,
        },
      ] as never);
    };

    expect(findingAt(threshold)).toHaveLength(1);
    expect(findingAt(threshold - 0.01)).toHaveLength(0);
  });
});

describe("the exception message filter matches the raw messages", () => {
  /*
   * Raw messages as services throw them: ids, emails, numbers, IPs,
   * timestamps, tokens and file positions in every position the
   * normalizer's rules care about.
   */
  const RAW_MESSAGES: Array<string> = [
    "Violation of PRIMARY KEY constraint 'F98950_PK'. Cannot insert duplicate key in object 'dbo.F98950'. The duplicate key value is (1043992817).",
    "User 550e8400-e29b-41d4-a716-446655440000 not found in tenant 507f1f77bcf86cd799439011",
    "Payment pi_3NiYbLKZ8lUwqzXa1bc2D3eF failed for customer cus_NffrFeUfNV2Hib",
    "Could not reach 10.4.12.9:5432 after 3 attempts (connect ETIMEDOUT)",
    "Invite to jane.doe@example.com bounced at 2026-10-08T09:14:22.123Z",
    "Request rejected: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U is expired",
    "Lookup failed for sessionId: 'a8f5f167f44f4964e6c998dee827110c' while loading cart",
    "Worker crashed pid 48211 while draining queue billing-events",
    "No invoice matches the lookup ID: 77812 for account acct_1032D82eZvKYlo2C",
    "Cache miss storm on key user:profile:0x7ffe5367e044 (hit ratio 0.12)",
    "TypeError: Cannot read properties of undefined (reading 'id')\n    at Object.handler (/srv/app/dist/handler.js:41:17)",
    "deadline exceeded calling inventory.v1.Stock/Reserve with request_id=4bf92f3577b34da6 after 5000ms",
    "Access denied: password=hunter2xyz rejected for service account svc-reporting",
    "Upload of 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 failed: checksum mismatch",
  ];

  test("every fragment is a piece of its raw message, case-insensitively", () => {
    let filtered: number = 0;

    for (const raw of RAW_MESSAGES) {
      const fragment: string = getStableExceptionMessageFragment(
        sanitizeExceptionMessage(raw),
      );

      if (!fragment) {
        continue;
      }

      filtered++;
      expect(raw.toLowerCase()).toContain(fragment.toLowerCase());
    }

    // Not vacuous: nearly every message yields a filter.
    expect(filtered).toBeGreaterThanOrEqual(RAW_MESSAGES.length - 2);
  });

  test("every variant of one failure mode matches the same fragment", () => {
    /*
     * One exception group, many raw messages: what makes the group one
     * group is exactly what the fragment keeps.
     */
    const variants: Array<string> = [
      "Order 104399 for jane@example.com failed: card declined by issuer",
      "Order 2 for bob@example.org failed: card declined by issuer",
      "Order 88812301 for x@y.io failed: card declined by issuer",
    ];

    const fragments: Array<string> = variants.map((raw: string) => {
      return getStableExceptionMessageFragment(sanitizeExceptionMessage(raw));
    });

    expect(new Set(fragments).size).toBe(1);
    expect(fragments[0]).toBe("failed: card declined by issuer");

    for (const raw of variants) {
      expect(raw.toLowerCase()).toContain(fragments[0]!.toLowerCase());
    }
  });

  test("the built monitor's message filter is that fragment", () => {
    const exceptionMonitorConfig: ReturnType<
      typeof MonitorStepExceptionMonitorUtil.getDefault
    > = stepOf(build(exceptionSpikeInsight)).data!.exceptionMonitor!;

    /*
     * "30000" survives: the normalizer keeps numbers shorter than seven
     * digits, so they are part of the failure mode's identity — every raw
     * message of this exception group carries them too.
     */
    expect(exceptionMonitorConfig.message).toBe(
      "Query timed out after 30000 ms for order",
    );
    expect(
      "Query timed out after 30000 ms for order 9f8b2c1a-77de-4b0e-8a5b-0c9a2f1e4d33".toLowerCase(),
    ).toContain(exceptionMonitorConfig.message.toLowerCase());
  });
});

/*
 * An error log's Logs monitor matches its body filter as a case-insensitive
 * substring of the RAW line (ILIKE '%...%'), while the insight keeps only
 * the message's pattern. The search words are taken from the pattern and
 * checked against a line as it was logged, so every line of the failure
 * mode holds them - whatever amount or order it was logged with.
 */
describe("an error log's body filter matches the lines it was found in", () => {
  test("every line of the failure mode holds the search words, case-insensitively", () => {
    const words: string = String(errorLogInsight.evidence!.log!.searchText);

    expect(words).toBe("Payment provider returned");

    for (const line of PAYMENT_ERROR_LINES) {
      expect(line.toLowerCase()).toContain(words.toLowerCase());
      // One failure mode, one pattern, the same words.
      expect(
        LogProblemDetector.getSearchText({
          pattern: normalizeLogBodyToErrorPattern(line),
          sampleBody: line,
        }),
      ).toBe(words);
    }
  });

  test("the built monitor's body filter is those words", () => {
    expect(stepOf(build(errorLogInsight)).data!.logMonitor!.body).toBe(
      "Payment provider returned",
    );
  });
});

describe("the step queries the worker compiles", () => {
  test("an error log's Logs monitor counts the service's Error and Fatal lines holding its words", () => {
    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(
      stepOf(build(errorLogInsight)).data!.logMonitor!,
    );

    expect((query.severityText as Includes).values).toEqual(["Error", "Fatal"]);
    expect(query.body).toBeInstanceOf(Search);
    expect((query.body as Search<string>).toString()).toBe(
      "Payment provider returned",
    );
    expect(
      ((query.primaryEntityId as Includes).values as Array<ObjectID>).map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([SERVICE_ID]);

    const window: InBetween<Date> = query.time as InBetween<Date>;

    expect(
      (window.endValue as Date).getTime() -
        (window.startValue as Date).getTime(),
    ).toBe(3600 * 1000);
  });

  test("a Logs monitor counts the service's Error and Fatal lines in the past hour", () => {
    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(
      stepOf(build(errorLogSpikeInsight)).data!.logMonitor!,
    );

    expect(query.severityText).toBeInstanceOf(Includes);
    expect((query.severityText as Includes).values).toEqual(["Error", "Fatal"]);
    expect(query.primaryEntityId).toBeInstanceOf(Includes);
    expect(
      ((query.primaryEntityId as Includes).values as Array<ObjectID>).map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([SERVICE_ID]);
    expect(query.body).toBeUndefined();
    expect(query.attributes).toBeUndefined();

    const window: InBetween<Date> = query.time as InBetween<Date>;

    expect(
      (window.endValue as Date).getTime() -
        (window.startValue as Date).getTime(),
    ).toBe(3600 * 1000);
  });

  test("an Exceptions monitor counts the exception's type and message in its service", () => {
    const query: Query<ExceptionInstance> =
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(
        stepOf(build(exceptionSpikeInsight)).data!.exceptionMonitor!,
      );

    expect((query.exceptionType as Includes).values).toEqual(["TimeoutError"]);
    expect(query.message).toBeInstanceOf(Search);
    expect((query.message as Search<string>).toString()).toBe(
      "Query timed out after 30000 ms for order",
    );
    expect(
      ((query.primaryEntityId as Includes).values as Array<ObjectID>).map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([SERVICE_ID]);
  });
});

describe("a failing operation's Traces monitor queries what the detector counted", () => {
  test("the operation's spans with the Error status, in its service, over the past hour", () => {
    const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(
      stepOf(build(failingOperationInsight)).data!.traceMonitor!,
    );

    expect(query.name).toBeInstanceOf(Search);
    expect((query.name as Search<string>).toString()).toBe("POST /checkout");
    expect((query.statusCode as Includes).values).toEqual([SpanStatus.Error]);
    expect(
      ((query.primaryEntityId as Includes).values as Array<ObjectID>).map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([SERVICE_ID]);
    expect(query.attributes).toBeUndefined();

    const window: InBetween<Date> = query.startTime as InBetween<Date>;

    expect(
      (window.endValue as Date).getTime() -
        (window.startValue as Date).getTime(),
    ).toBe(3600 * 1000);
  });

  test("its criteria fire at the floor and clear one below it", async () => {
    const prefill: JSONObject = build(failingOperationInsight);
    const threshold: number = Number(filterOf(prefill, "unhealthy").value);

    const response: (spanCount: number) => TraceMonitorResponse = (
      spanCount: number,
    ): TraceMonitorResponse => {
      return {
        projectId: ObjectID.generate(),
        spanCount: spanCount,
        spanQuery: {},
        monitorId: ObjectID.generate(),
      };
    };

    // The 312 failed spans it was filed for, and the floor itself.
    for (const spanCount of [312, threshold]) {
      expect(
        await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(spanCount),
          criteriaFilter: filterOf(prefill, "unhealthy"),
        }),
      ).not.toBeNull();
      expect(
        await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(spanCount),
          criteriaFilter: filterOf(prefill, "healthy"),
        }),
      ).toBeNull();
    }

    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response(threshold - 1),
        criteriaFilter: filterOf(prefill, "unhealthy"),
      }),
    ).toBeNull();
    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response(threshold - 1),
        criteriaFilter: filterOf(prefill, "healthy"),
      }),
    ).not.toBeNull();
  });
});

describe("the telemetry worker's criteria fire on the spike and clear below it", () => {
  test("Logs: the spike's own count opens the incident; one below the bar is healthy", async () => {
    const prefill: JSONObject = build(errorLogSpikeInsight);
    const threshold: number = Number(filterOf(prefill, "unhealthy").value);

    const response: (logCount: number) => LogMonitorResponse = (
      logCount: number,
    ): LogMonitorResponse => {
      return {
        projectId: ObjectID.generate(),
        logCount: logCount,
        logQuery: {},
        monitorId: ObjectID.generate(),
      };
    };

    // checkout logged 520 during the spike.
    for (const logCount of [520, threshold]) {
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(logCount),
          criteriaFilter: filterOf(prefill, "unhealthy"),
        }),
      ).not.toBeNull();
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(logCount),
          criteriaFilter: filterOf(prefill, "healthy"),
        }),
      ).toBeNull();
    }

    expect(
      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response(threshold - 1),
        criteriaFilter: filterOf(prefill, "unhealthy"),
      }),
    ).toBeNull();
    expect(
      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response(threshold - 1),
        criteriaFilter: filterOf(prefill, "healthy"),
      }),
    ).not.toBeNull();
  });

  test("Logs: an error log's monitor fires at the detector's floor and clears one below it", async () => {
    const prefill: JSONObject = build(errorLogInsight);
    const threshold: number = Number(filterOf(prefill, "unhealthy").value);

    const response: (logCount: number) => LogMonitorResponse = (
      logCount: number,
    ): LogMonitorResponse => {
      return {
        projectId: ObjectID.generate(),
        logCount: logCount,
        logQuery: {},
        monitorId: ObjectID.generate(),
      };
    };

    expect(threshold).toBe(LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT);

    for (const logCount of [1240, threshold]) {
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(logCount),
          criteriaFilter: filterOf(prefill, "unhealthy"),
        }),
      ).not.toBeNull();
    }

    expect(
      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response(threshold - 1),
        criteriaFilter: filterOf(prefill, "unhealthy"),
      }),
    ).toBeNull();
    expect(
      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response(threshold - 1),
        criteriaFilter: filterOf(prefill, "healthy"),
      }),
    ).not.toBeNull();
  });

  test("Exceptions: the spike's own count opens the incident; one below the bar is healthy", async () => {
    for (const insight of [exceptionSpikeInsight, newExceptionInsight]) {
      const prefill: JSONObject = build(insight);
      const threshold: number = Number(filterOf(prefill, "unhealthy").value);

      const response: (exceptionCount: number) => ExceptionMonitorResponse = (
        exceptionCount: number,
      ): ExceptionMonitorResponse => {
        return {
          projectId: ObjectID.generate(),
          exceptionCount: exceptionCount,
          exceptionQuery: {},
          monitorId: ObjectID.generate(),
        };
      };

      // 84 occurrences in the spike hour.
      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(84),
          criteriaFilter: filterOf(prefill, "unhealthy"),
        }),
      ).not.toBeNull();
      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(threshold - 1),
          criteriaFilter: filterOf(prefill, "unhealthy"),
        }),
      ).toBeNull();
      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(threshold - 1),
          criteriaFilter: filterOf(prefill, "healthy"),
        }),
      ).not.toBeNull();
      // No occurrences at all is healthy, not silent.
      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(0),
          criteriaFilter: filterOf(prefill, "healthy"),
        }),
      ).not.toBeNull();
    }
  });

  test("Metrics: an hour averaging the drifted level opens the incident; the old level is healthy", async () => {
    const prefill: JSONObject = build(metricDriftInsight);
    const step: MonitorStep = stepOf(prefill);
    const queryConfig: MetricQueryConfigData =
      step.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!;

    const response: (samples: Array<number>) => MetricMonitorResponse = (
      samples: Array<number>,
    ): MetricMonitorResponse => {
      const start: number = Date.UTC(2026, 9, 8, 11, 0, 0);
      const result: AggregatedResult = {
        data: samples.map((value: number, index: number): AggregateModel => {
          return {
            timestamp: new Date(start + index * 60000),
            value: value,
          } as AggregateModel;
        }),
      };

      return {
        projectId: ObjectID.generate(),
        metricResult: [result],
        metricViewConfig: step.data!.metricMonitor!.metricViewConfig,
        monitorId: ObjectID.generate(),
      } as MetricMonitorResponse;
    };

    const evaluate: (
      which: "unhealthy" | "healthy",
      samples: Array<number>,
    ) => Promise<string | null> = async (
      which: "unhealthy" | "healthy",
      samples: Array<number>,
    ): Promise<string | null> => {
      return await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response(samples),
        criteriaFilter: filterOf(prefill, which),
        monitorStep: step,
      });
    };

    expect(queryConfig.metricAliasData?.metricVariable).toBe("a");

    // The drifted level (~412) for the hour, with one quiet minute in it.
    const drifted: Array<number> = [...new Array(59).fill(415), 150];
    // The prior week's level (~160).
    const normal: Array<number> = new Array(60).fill(160);
    // Spiky but averaging under the bar: Average compares the mean, once.
    const spikyButNormal: Array<number> = [
      ...new Array(50).fill(150),
      ...new Array(10).fill(500),
    ];

    expect(await evaluate("unhealthy", drifted)).not.toBeNull();
    expect(await evaluate("healthy", drifted)).toBeNull();

    expect(await evaluate("unhealthy", normal)).toBeNull();
    expect(await evaluate("healthy", normal)).not.toBeNull();

    expect(await evaluate("unhealthy", spikyButNormal)).toBeNull();
    expect(await evaluate("healthy", spikyButNormal)).not.toBeNull();
  });
});

describe("the steps form keeps the prefill as built", () => {
  const SEED_OPTIONS: Parameters<
    typeof MonitorCriteriaAlignmentUtil.alignMonitorStepsWithMonitorType
  >[0]["seedOptions"] = {
    onlineMonitorStatusId: OPERATIONAL_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
    monitorName: "",
  };

  const insights: Array<[string, AIInsightMonitorInput]> = [
    ["error-log spike", errorLogSpikeInsight],
    ["exception spike", exceptionSpikeInsight],
    ["new exception", newExceptionInsight],
    ["metric drift", metricDriftInsight],
    ["failing operation", failingOperationInsight],
    ["error log", errorLogInsight],
  ];

  for (const [name, insight] of insights) {
    test(`${name}: re-aligning to its own monitor type changes nothing`, () => {
      const prefill: JSONObject = build(insight);
      const steps: MonitorSteps = stepsOf(prefill);

      const aligned: MonitorStepsAlignmentResult =
        MonitorCriteriaAlignmentUtil.alignMonitorStepsWithMonitorType({
          monitorSteps: steps,
          monitorType: prefill["monitorType"] as MonitorType,
          seedOptions: {
            ...SEED_OPTIONS,
            monitorName: String(prefill["name"]),
          },
        });

      expect(aligned.didChange).toBe(false);
      expect(aligned.monitorSteps).toBe(steps);
    });

    test(`${name}: naming unnamed criteria changes nothing`, () => {
      expect(
        CriteriaNameUtil.nameUnnamedCriteria(stepsOf(build(insight))).didChange,
      ).toBe(false);
    });
  }

  test("a latency regression never reaches the form", () => {
    expect(
      getAIInsightMonitorBlocker({
        insightType: AIInsightType.TraceLatencyRegression,
      }),
    ).toBe(AI_INSIGHT_MONITOR_LATENCY_BLOCKER);
  });
});
