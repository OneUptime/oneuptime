import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import AIInsightEvidence from "Common/Types/AI/AIInsightEvidence";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightType from "Common/Types/AI/AIInsightType";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import type {
  AIInsightMetricShape,
  AIInsightMonitorInput,
  AIInsightMonitorSeedIds,
} from "../../FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill";

/*
 * "Create Monitor" from an AI insight turns a finding into the monitor that
 * pages on it next time. What AIInsightMonitorPrefill builds is a contract
 * with four parties, none of which fails loudly when it drifts:
 *
 *  - MonitorSteps.fromJSON throws on any envelope but toJSON()'s — at page
 *    mount, in the browser;
 *  - MonitorSteps.getValidationError is what blocks the form's Next button,
 *    with the field to fix possibly folded away;
 *  - the step forms render fixed window options, and a prefilled value
 *    outside them shows as an empty dropdown and is dropped on the first edit;
 *  - the telemetry evaluator matches the step's scope and the criteria's
 *    threshold against real rows, so a wrong scope or threshold makes a
 *    monitor that never fires while looking configured — the worst outcome,
 *    because the team believes it is covered.
 *
 * The detector parity, the sanitizer round trip and the server evaluator are
 * pinned from the Common suite (AIInsightMonitorPrefillContracts.test.ts),
 * which can import server modules; this suite pins everything else in plain
 * Node.
 */

type PrefillModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill");

let Prefill: PrefillModule;

/*
 * Common/UI/Config reads `window` the moment it loads, and the util reaches
 * it through RouteMap (for the Monitor Create route), so the browser stub has
 * to exist before the deferred import runs. Same approach as
 * AIInsightExplorerLinks.test.ts.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Prefill = await import(
    "../../FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill"
  );
});

const SERVICE_ID: string = "11111111-2222-4333-8444-555555555555";
const ENTITY_ID: string = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const OPERATIONAL_STATUS_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OFFLINE_STATUS_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const CRITICAL_INCIDENT_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
const MAJOR_INCIDENT_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
const MINOR_INCIDENT_ID: string = "bbbbbbbb-0000-4000-8000-000000000003";
const HIGH_ALERT_ID: string = "cccccccc-0000-4000-8000-000000000001";
const LOW_ALERT_ID: string = "cccccccc-0000-4000-8000-000000000002";

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readDashboardSource(...relativeParts: Array<string>): string {
  return fs.readFileSync(
    nodePath.join(DASHBOARD_SRC, ...relativeParts),
    "utf8",
  );
}

// A project as it is seeded: three incident severities, two alert ones.
function seeds(
  overrides: Partial<AIInsightMonitorSeedIds> = {},
): AIInsightMonitorSeedIds {
  return {
    operationalMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
    offlineMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
    rankedIncidentSeverityIds: [
      new ObjectID(CRITICAL_INCIDENT_ID),
      new ObjectID(MAJOR_INCIDENT_ID),
      new ObjectID(MINOR_INCIDENT_ID),
    ],
    rankedAlertSeverityIds: [
      new ObjectID(HIGH_ALERT_ID),
      new ObjectID(LOW_ALERT_ID),
    ],
    ...overrides,
  };
}

function errorLogSpike(
  overrides: Partial<AIInsightMonitorInput> = {},
  logSpike: Partial<NonNullable<AIInsightEvidence["logSpike"]>> = {},
): AIInsightMonitorInput {
  return {
    insightType: AIInsightType.ErrorLogSpike,
    severity: AIInsightSeverity.High,
    serviceName: "checkout",
    telemetryServiceId: SERVICE_ID,
    evidence: {
      logSpike: {
        recentErrorCount: 1300,
        baselineHourlyAverage: 40,
        spikeMultiplier: 32.5,
        windowMinutes: 60,
        topServices: [
          { serviceName: "checkout", count: 900 },
          { serviceName: "payments", count: 300 },
          { serviceName: "search", count: 100 },
        ],
        ...logSpike,
      },
    },
    ...overrides,
  };
}

function exceptionInsight(
  insightType: AIInsightType,
  overrides: Partial<AIInsightMonitorInput> = {},
  exception: Partial<NonNullable<AIInsightEvidence["exception"]>> = {},
): AIInsightMonitorInput {
  return {
    insightType: insightType,
    severity: AIInsightSeverity.Medium,
    serviceName: "pd-jas-8004",
    telemetryServiceId: SERVICE_ID,
    evidence: {
      exception: {
        exceptionType: "com.microsoft.sqlserver.jdbc.SQLServerException",
        exceptionMessage:
          "Violation of PRIMARY KEY constraint 'F98950_PK'. Cannot insert duplicate key in object 'dbo.F98950'. The duplicate key value is (<NUMBER>).",
        recentOccurrenceCount: 95,
        baselineHourlyAverage: 6.4,
        spikeMultiplier: 14.8,
        totalOccurrenceCount: 1200,
        ...exception,
      },
    },
    ...overrides,
  };
}

function metricDrift(
  overrides: Partial<AIInsightMonitorInput> = {},
  drift: Partial<NonNullable<AIInsightEvidence["metricDrift"]>> = {},
): AIInsightMonitorInput {
  return {
    insightType: AIInsightType.MetricDrift,
    severity: AIInsightSeverity.Low,
    metricName: "k8s.node.memory.working_set",
    evidence: {
      metricDrift: {
        metricName: "k8s.node.memory.working_set",
        primaryEntityId: ENTITY_ID,
        recentWeekMean: 312,
        priorWeekMean: 120,
        relativeChangePercent: 160,
        recentSampleCount: 10080,
        priorSampleCount: 10080,
        ...drift,
      },
    },
    ...overrides,
  };
}

function build(
  insight: AIInsightMonitorInput,
  seedOverrides: Partial<AIInsightMonitorSeedIds> = {},
  metricShape?: AIInsightMetricShape | null,
): JSONObject {
  const prefill: JSONObject | null = Prefill.buildAIInsightMonitorPrefill({
    insight: insight,
    seeds: seeds(seedOverrides),
    context: { metricShape: metricShape },
  });

  expect(prefill).not.toBeNull();

  return prefill!;
}

function stepsOf(prefill: JSONObject): MonitorSteps {
  return MonitorSteps.fromJSON(prefill["monitorSteps"] as JSONObject);
}

function stepOf(prefill: JSONObject): MonitorStep {
  const step: MonitorStep | undefined =
    stepsOf(prefill).data?.monitorStepsInstanceArray[0];

  expect(step?.data).toBeDefined();

  return step!;
}

function criteriaOf(prefill: JSONObject): Array<MonitorCriteriaInstance> {
  return stepOf(prefill).data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray;
}

function unhealthyOf(prefill: JSONObject): MonitorCriteriaInstance {
  return criteriaOf(prefill)[0]!;
}

function healthyOf(prefill: JSONObject): MonitorCriteriaInstance {
  return criteriaOf(prefill)[1]!;
}

function onlyFilter(instance: MonitorCriteriaInstance): CriteriaFilter {
  expect(instance.data?.filters).toHaveLength(1);
  return instance.data!.filters[0]!;
}

function idsOf(ids: Array<ObjectID> | undefined): Array<string> {
  return (ids || []).map((id: ObjectID) => {
    return id.toString();
  });
}

// Every user-visible sentence the prefill writes outside the step config.
function proseOf(prefill: JSONObject): Array<string> {
  const prose: Array<string> = [
    String(prefill["name"]),
    String(prefill["description"]),
  ];

  for (const instance of criteriaOf(prefill)) {
    prose.push(instance.data?.name || "", instance.data?.description || "");

    for (const incident of instance.data?.incidents || []) {
      prose.push(incident.title, incident.description);
    }

    for (const alert of instance.data?.alerts || []) {
      prose.push(alert.title, alert.description);
    }
  }

  return prose;
}

describe("the deep link", () => {
  test("rides as ?aiInsightId= on Monitor Create", () => {
    expect(Prefill.AI_INSIGHT_MONITOR_QUERY_PARAM).toBe("aiInsightId");

    const route: string = Prefill.buildAIInsightMonitorRoute(
      ` ${SERVICE_ID} `,
    ).toString();

    expect(route).toMatch(/\/monitors\/create\?aiInsightId=/);
    expect(
      new URLSearchParams(route.substring(route.indexOf("?") + 1)).get(
        "aiInsightId",
      ),
    ).toBe(SERVICE_ID);
  });

  test("Monitor Create reads the same parameter it is sent", () => {
    const createSource: string = readDashboardSource(
      "Pages",
      "Monitor",
      "Create.tsx",
    );

    expect(createSource).toContain("AI_INSIGHT_MONITOR_QUERY_PARAM");
    expect(createSource).toContain("preSeedFromAIInsightLink");
    // Refusals reach the user instead of an empty form.
    expect(createSource).toContain("getAIInsightMonitorBlocker");
  });

  test("the insight page links there, gated on creating monitors", () => {
    const viewSource: string = readDashboardSource(
      "Pages",
      "AIInsights",
      "View",
      "Index.tsx",
    ).replace(/\s+/g, " ");

    expect(viewSource).toContain('title="Create Monitor"');
    expect(viewSource).toContain("buildAIInsightMonitorRoute(");
    expect(viewSource).toContain("new Monitor(), ModelAction.Create");
  });
});

describe("the windows are options the step forms offer", () => {
  /*
   * The log and exception forms render the window as a fixed-options
   * dropdown. A prefilled value outside the options renders as an EMPTY
   * dropdown and is silently replaced on the first edit.
   */
  test("the spike window is an option of both count forms", () => {
    expect(Prefill.SPIKE_MONITOR_WINDOW_SECONDS).toBe(3600);

    const logForm: string = readDashboardSource(
      "Components",
      "Form",
      "Monitor",
      "LogMonitor",
      "LogMonitorStepFrom.tsx",
    );
    const exceptionForm: string = readDashboardSource(
      "Components",
      "Form",
      "Monitor",
      "ExceptionMonitor",
      "ExceptionMonitorStepForm.tsx",
    );

    expect(logForm).toContain(`value: ${Prefill.SPIKE_MONITOR_WINDOW_SECONDS}`);
    expect(exceptionForm).toContain(
      `value: ${Prefill.SPIKE_MONITOR_WINDOW_SECONDS}`,
    );
  });

  test("the new-exception window is an option of the exception form", () => {
    expect(Prefill.NEW_EXCEPTION_MONITOR_WINDOW_SECONDS).toBe(86400);

    expect(
      readDashboardSource(
        "Components",
        "Form",
        "Monitor",
        "ExceptionMonitor",
        "ExceptionMonitorStepForm.tsx",
      ),
    ).toContain(`value: ${Prefill.NEW_EXCEPTION_MONITOR_WINDOW_SECONDS}`);
  });

  test("the metric window is a rolling time the picker offers", () => {
    expect(Prefill.METRIC_DRIFT_MONITOR_ROLLING_TIME).toBe(
      RollingTime.Past1Hour,
    );
    expect(Object.values(RollingTime)).toContain(
      Prefill.METRIC_DRIFT_MONITOR_ROLLING_TIME,
    );
  });
});

describe("getStableExceptionMessageFragment", () => {
  test("nothing to filter on yields an empty fragment", () => {
    expect(Prefill.getStableExceptionMessageFragment(undefined)).toBe("");
    expect(Prefill.getStableExceptionMessageFragment("")).toBe("");
    expect(
      Prefill.getStableExceptionMessageFragment(42 as unknown as string),
    ).toBe("");
    expect(Prefill.getStableExceptionMessageFragment("<UUID>")).toBe("");
  });

  test("a message with no placeholders is kept whole", () => {
    expect(
      Prefill.getStableExceptionMessageFragment(
        "  Connection refused by upstream payments gateway  ",
      ),
    ).toBe("Connection refused by upstream payments gateway");
  });

  test("cuts at placeholders and keeps the longest run", () => {
    expect(
      Prefill.getStableExceptionMessageFragment(
        "Violation of PRIMARY KEY constraint 'F98950_PK'. Cannot insert duplicate key in object 'dbo.F98950'. The duplicate key value is (<NUMBER>).",
      ),
    ).toBe(
      "Violation of PRIMARY KEY constraint 'F98950_PK'. Cannot insert duplicate key in object 'dbo.F98950'. The duplicate key value is",
    );

    expect(
      Prefill.getStableExceptionMessageFragment(
        "User <UUID> not found in tenant <OBJECT_ID> after retry",
      ),
    ).toBe("not found in tenant");
  });

  test("never keeps a placeholder or a redaction marker", () => {
    const fragments: Array<string> = [
      "Order <NUMBER> for <EMAIL> failed at <TIMESTAMP> on <IP>",
      "Login failed for [redacted-email] from [redacted-ip] with key [redacted]",
      "Token [redacted-github-token] rejected by <HEX_ID> at <MEMORY_ADDR>",
      "Lookup <IPV6> then <STRIPE_ID> then <SERVICE_ID> then <BASE64>",
    ].map((message: string) => {
      return Prefill.getStableExceptionMessageFragment(message);
    });

    for (const fragment of fragments) {
      expect(fragment).not.toMatch(/<[A-Z][A-Z0-9_]*>/);
      expect(fragment).not.toMatch(/\[redacted/);
    }

    expect(fragments[1]).toBe("Login failed for");
  });

  test("drops the text a normalizer rule invents in front of its placeholder", () => {
    /*
     * "sessionId: 'abc'" is rewritten as "session_id=<SESSION>": the
     * "session_id=" was never in the raw message, so a filter keeping it
     * would match nothing.
     */
    expect(
      Prefill.getStableExceptionMessageFragment(
        "Cannot load the shopping cart session_id=<SESSION>",
      ),
    ).toBe("Cannot load the shopping cart");
    expect(
      Prefill.getStableExceptionMessageFragment(
        "Worker crashed while draining queue PID:<PID>",
      ),
    ).toBe("Worker crashed while draining queue");
    expect(
      Prefill.getStableExceptionMessageFragment(
        "Upstream rejected the request: Bearer [redacted-token]",
      ),
    ).toBe("Upstream rejected the request");
    expect(
      Prefill.getStableExceptionMessageFragment(
        "No invoice matches the lookup id=<ID>",
      ),
    ).toBe("No invoice matches the lookup");
  });

  test("is always one line", () => {
    const fragment: string = Prefill.getStableExceptionMessageFragment(
      "Payment provider timed out\n  while confirming the charge\r\nretry scheduled",
    );

    expect(fragment).not.toMatch(/[\r\n]/);
    expect(fragment).toBe("while confirming the charge");
  });

  test("a fragment too short to mean anything is dropped", () => {
    expect(
      Prefill.getStableExceptionMessageFragment("Bad <NUMBER> id <UUID>"),
    ).toBe("");
    expect(
      "x".repeat(Prefill.MIN_EXCEPTION_MESSAGE_FRAGMENT_LENGTH - 1).length,
    ).toBeLessThan(Prefill.MIN_EXCEPTION_MESSAGE_FRAGMENT_LENGTH);
    expect(
      Prefill.getStableExceptionMessageFragment(
        "x".repeat(Prefill.MIN_EXCEPTION_MESSAGE_FRAGMENT_LENGTH - 1),
      ),
    ).toBe("");
    expect(
      Prefill.getStableExceptionMessageFragment(
        "x".repeat(Prefill.MIN_EXCEPTION_MESSAGE_FRAGMENT_LENGTH),
      ),
    ).toBe("x".repeat(Prefill.MIN_EXCEPTION_MESSAGE_FRAGMENT_LENGTH));
  });

  test("a long run is cut to a readable filter, still a piece of the message", () => {
    const message: string = `Timeout ${"waiting for the replica to catch up ".repeat(20)}`;
    const fragment: string = Prefill.getStableExceptionMessageFragment(message);

    expect(fragment.length).toBeLessThanOrEqual(
      Prefill.MAX_EXCEPTION_MESSAGE_FRAGMENT_LENGTH,
    );
    expect(fragment.length).toBeGreaterThan(100);
    expect(message).toContain(fragment);
  });

  test("a long run is cut between characters, never inside one", () => {
    /*
     * 199 letters then an emoji: a cut by UTF-16 units would keep the
     * emoji's first half only, which reaches the database as U+FFFD.
     */
    const message: string = `${"a".repeat(
      Prefill.MAX_EXCEPTION_MESSAGE_FRAGMENT_LENGTH - 1,
    )}\u{1F680}${"b".repeat(50)}`;
    const fragment: string = Prefill.getStableExceptionMessageFragment(message);

    expect(Array.from(fragment)).toHaveLength(
      Prefill.MAX_EXCEPTION_MESSAGE_FRAGMENT_LENGTH,
    );
    expect(fragment.endsWith("\u{1F680}")).toBe(true);
    expect(message.startsWith(fragment)).toBe(true);
    expect(fragment).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  test("whatever it returns is a piece of the sanitized message", () => {
    const messages: Array<string> = [
      "Violation of PRIMARY KEY constraint 'F98950_PK'. Cannot insert duplicate key in object 'dbo.F98950'. The duplicate key value is (<NUMBER>).",
      "ECONNRESET: socket hang up calling https://api.example.com/v1/orders/<ID>",
      "Request request_id=<REQUEST> failed: upstream returned 502 Bad Gateway",
      "'<ID>' is not a valid account reference for tenant <UUID>",
      "at Object.handler (/srv/app/dist/handler.js:<LINE>:<COL>)",
    ];

    for (const message of messages) {
      const fragment: string =
        Prefill.getStableExceptionMessageFragment(message);

      expect(fragment.length).toBeGreaterThan(0);
      expect(message).toContain(fragment);
    }
  });
});

describe("getAIInsightMonitorBlocker", () => {
  test("an error-log spike can always become a monitor", () => {
    expect(Prefill.getAIInsightMonitorBlocker(errorLogSpike())).toBeNull();
    expect(
      Prefill.getAIInsightMonitorBlocker({
        insightType: AIInsightType.ErrorLogSpike,
      }),
    ).toBeNull();
  });

  test("a latency regression is refused with the reason, not silently", () => {
    expect(
      Prefill.getAIInsightMonitorBlocker({
        insightType: AIInsightType.TraceLatencyRegression,
        serviceName: "pd-rte-83",
        telemetryServiceId: SERVICE_ID,
      }),
    ).toBe(Prefill.AI_INSIGHT_MONITOR_LATENCY_BLOCKER);
    expect(Prefill.AI_INSIGHT_MONITOR_LATENCY_BLOCKER).toMatch(/span/i);
  });

  test("an unknown or absent insight type is refused, never a crash", () => {
    expect(
      Prefill.getAIInsightMonitorBlocker({ insightType: "SomeFutureDetector" }),
    ).toBe(Prefill.AI_INSIGHT_MONITOR_UNKNOWN_TYPE_BLOCKER);
    expect(Prefill.getAIInsightMonitorBlocker({})).toBe(
      Prefill.AI_INSIGHT_MONITOR_UNKNOWN_TYPE_BLOCKER,
    );
  });

  test("an exception insight needs a type or a usable message to be scoped", () => {
    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]) {
      expect(
        Prefill.getAIInsightMonitorBlocker(exceptionInsight(insightType)),
      ).toBeNull();

      // Type only.
      expect(
        Prefill.getAIInsightMonitorBlocker(
          exceptionInsight(insightType, {}, { exceptionMessage: undefined }),
        ),
      ).toBeNull();

      // Message only.
      expect(
        Prefill.getAIInsightMonitorBlocker(
          exceptionInsight(insightType, {}, { exceptionType: "  " }),
        ),
      ).toBeNull();

      // Neither: a monitor on every exception of the service is not this insight.
      expect(
        Prefill.getAIInsightMonitorBlocker(
          exceptionInsight(
            insightType,
            {},
            { exceptionType: undefined, exceptionMessage: "<UUID> <NUMBER>" },
          ),
        ),
      ).toBe(Prefill.AI_INSIGHT_MONITOR_EXCEPTION_SCOPE_BLOCKER);

      expect(
        Prefill.getAIInsightMonitorBlocker({
          insightType: insightType,
          evidence: "not-an-object" as unknown as AIInsightEvidence,
        }),
      ).toBe(Prefill.AI_INSIGHT_MONITOR_EXCEPTION_SCOPE_BLOCKER);
    }
  });

  test("a metric drift needs its metric", () => {
    expect(
      Prefill.getAIInsightMonitorBlocker(
        metricDrift({ metricName: undefined }, { metricName: " " }),
      ),
    ).toBe(Prefill.AI_INSIGHT_MONITOR_METRIC_NAME_BLOCKER);

    // The evidence's copy of the name is enough.
    expect(
      Prefill.getAIInsightMonitorBlocker(
        metricDrift({ metricName: undefined }),
      ),
    ).toBeNull();
  });

  test("a metric drift needs a usable baseline to start a threshold from", () => {
    for (const priorWeekMean of [0, NaN, Infinity]) {
      expect(
        Prefill.getAIInsightMonitorBlocker(
          metricDrift({}, { priorWeekMean: priorWeekMean }),
        ),
      ).toBe(Prefill.AI_INSIGHT_MONITOR_METRIC_BASELINE_BLOCKER);
    }

    expect(
      Prefill.getAIInsightMonitorBlocker(
        metricDrift(
          {},
          {
            relativeChangePercent: undefined as unknown as number,
            recentWeekMean: 120,
          },
        ),
      ),
    ).toBe(Prefill.AI_INSIGHT_MONITOR_METRIC_BASELINE_BLOCKER);

    expect(
      Prefill.getAIInsightMonitorBlocker({
        insightType: AIInsightType.MetricDrift,
        metricName: "cpu",
      }),
    ).toBe(Prefill.AI_INSIGHT_MONITOR_METRIC_BASELINE_BLOCKER);
  });

  test("a cumulative counter is refused: its threshold would fire once and never clear", () => {
    expect(
      Prefill.getAIInsightMonitorBlocker(metricDrift(), {
        metricShape: {
          pointType: MetricPointType.Sum,
          isMonotonic: true,
          aggregationTemporality: AggregationTemporality.Cumulative,
        },
      }),
    ).toBe(Prefill.AI_INSIGHT_MONITOR_CUMULATIVE_COUNTER_BLOCKER);
  });

  test("delta counters, up-down counters and gauges are fine", () => {
    const shapes: Array<AIInsightMetricShape> = [
      {
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        aggregationTemporality: AggregationTemporality.Delta,
      },
      {
        pointType: MetricPointType.Sum,
        isMonotonic: false,
        aggregationTemporality: AggregationTemporality.Cumulative,
      },
      {
        pointType: MetricPointType.Gauge,
        isMonotonic: null,
        aggregationTemporality: null,
      },
    ];

    for (const shape of shapes) {
      expect(
        Prefill.getAIInsightMonitorBlocker(metricDrift(), {
          metricShape: shape,
        }),
      ).toBeNull();
    }
  });

  test("a distribution is refused: the drift was measured on numbers a monitor does not read", () => {
    for (const pointType of [
      MetricPointType.Histogram,
      MetricPointType.ExponentialHistogram,
      MetricPointType.Summary,
    ]) {
      expect(
        Prefill.getAIInsightMonitorBlocker(metricDrift(), {
          metricShape: {
            pointType: pointType,
            isMonotonic: null,
            aggregationTemporality: null,
          },
        }),
      ).toBe(Prefill.AI_INSIGHT_MONITOR_HISTOGRAM_BLOCKER);
    }
  });

  test("an unknown shape is never held against the metric", () => {
    expect(
      Prefill.getAIInsightMonitorBlocker(metricDrift(), { metricShape: null }),
    ).toBeNull();
    expect(
      Prefill.getAIInsightMonitorBlocker(metricDrift(), {
        metricShape: {
          pointType: null,
          isMonotonic: null,
          aggregationTemporality: null,
        },
      }),
    ).toBeNull();
    expect(Prefill.getAIInsightMonitorBlocker(metricDrift())).toBeNull();
  });

  test("a refused insight builds nothing", () => {
    expect(
      Prefill.buildAIInsightMonitorPrefill({
        insight: { insightType: AIInsightType.TraceLatencyRegression },
        seeds: seeds(),
      }),
    ).toBeNull();
    expect(
      Prefill.buildAIInsightMonitorPrefill({
        insight: metricDrift(),
        seeds: seeds(),
        context: {
          metricShape: {
            pointType: MetricPointType.Sum,
            isMonotonic: true,
            aggregationTemporality: AggregationTemporality.Cumulative,
          },
        },
      }),
    ).toBeNull();
  });
});

describe("every prefill is a monitor the form can save", () => {
  const cases: Array<{ name: string; insight: () => AIInsightMonitorInput }> = [
    {
      name: "error-log spike",
      insight: () => {
        return errorLogSpike();
      },
    },
    {
      name: "project-wide error-log spike",
      insight: () => {
        return errorLogSpike({
          serviceName: undefined,
          telemetryServiceId: undefined,
        });
      },
    },
    {
      name: "exception spike",
      insight: () => {
        return exceptionInsight(AIInsightType.ExceptionSpike);
      },
    },
    {
      name: "new exception",
      insight: () => {
        return exceptionInsight(AIInsightType.NewException);
      },
    },
    {
      name: "metric drift up",
      insight: () => {
        return metricDrift();
      },
    },
    {
      name: "metric drift down",
      insight: () => {
        return metricDrift(
          {},
          { recentWeekMean: 30, relativeChangePercent: -75 },
        );
      },
    },
  ];

  cases.forEach(
    (testCase: { name: string; insight: () => AIInsightMonitorInput }) => {
      describe(testCase.name, () => {
        test("serializes monitorSteps in the envelope fromJSON accepts", () => {
          const prefill: JSONObject = build(testCase.insight());
          const envelope: JSONObject = prefill["monitorSteps"] as JSONObject;

          expect(envelope["_type"]).toBe("MonitorSteps");
          expect(() => {
            return MonitorSteps.fromJSON(envelope);
          }).not.toThrow();
        });

        test("passes the validation that gates the form's Next button", () => {
          const prefill: JSONObject = build(testCase.insight());

          expect(
            MonitorSteps.getValidationError(
              stepsOf(prefill),
              prefill["monitorType"] as MonitorType,
            ),
          ).toBeNull();
        });

        test("has a name the Monitor.name column holds and the form accepts", () => {
          const name: string = String(build(testCase.insight())["name"]);

          expect(name.length).toBeGreaterThanOrEqual(2);
          expect(name.length).toBeLessThanOrEqual(
            Prefill.MAX_MONITOR_NAME_LENGTH,
          );
          expect(name).toBe(name.trim());
        });

        test("carries the operational status as the steps' default", () => {
          expect(
            stepsOf(
              build(testCase.insight()),
            ).data?.defaultMonitorStatusId?.toString(),
          ).toBe(OPERATIONAL_STATUS_ID);
        });

        test("ships an unhealthy criteria that opens an incident and a healthy one that clears it", () => {
          const prefill: JSONObject = build(testCase.insight());

          expect(criteriaOf(prefill)).toHaveLength(2);

          const unhealthy: MonitorCriteriaInstance = unhealthyOf(prefill);
          const healthy: MonitorCriteriaInstance = healthyOf(prefill);

          expect(unhealthy.data?.createIncidents).toBe(true);
          expect(unhealthy.data?.changeMonitorStatus).toBe(true);
          expect(unhealthy.data?.monitorStatusId?.toString()).toBe(
            OFFLINE_STATUS_ID,
          );
          expect(unhealthy.data?.incidents).toHaveLength(1);
          expect(unhealthy.data?.incidents[0]?.autoResolveIncident).toBe(true);
          expect(unhealthy.data?.incidents[0]?.title).toBe(prefill["name"]);

          // The alert is ready for a team that prefers one, but off.
          expect(unhealthy.data?.createAlerts).toBe(false);
          expect(unhealthy.data?.alerts).toHaveLength(1);
          expect(unhealthy.data?.alerts[0]?.autoResolveAlert).toBe(true);

          expect(healthy.data?.createIncidents).toBe(false);
          expect(healthy.data?.createAlerts).toBe(false);
          expect(healthy.data?.changeMonitorStatus).toBe(true);
          expect(healthy.data?.monitorStatusId?.toString()).toBe(
            OPERATIONAL_STATUS_ID,
          );

          for (const instance of [unhealthy, healthy]) {
            expect(instance.data?.isEnabled).toBe(true);
            expect(instance.data?.name?.trim()).toBeTruthy();
          }
        });

        test("the healthy filter is the exact mirror of the unhealthy one", () => {
          const prefill: JSONObject = build(testCase.insight());
          const unhealthy: CriteriaFilter = onlyFilter(unhealthyOf(prefill));
          const healthy: CriteriaFilter = onlyFilter(healthyOf(prefill));

          expect(healthy.checkOn).toBe(unhealthy.checkOn);
          expect(healthy.value).toBe(unhealthy.value);
          expect(healthy.filterType).toBe(
            // getInverseFilterType's pairs, without importing the evaluator.
            {
              [FilterType.GreaterThanOrEqualTo]: FilterType.LessThan,
              [FilterType.LessThanOrEqualTo]: FilterType.GreaterThan,
            }[unhealthy.filterType as string],
          );
          // A copy each, never one shared object (the criteria form mutates it).
          if (unhealthy.metricMonitorOptions) {
            expect(healthy.metricMonitorOptions).toEqual(
              unhealthy.metricMonitorOptions,
            );
            expect(healthy.metricMonitorOptions).not.toBe(
              unhealthy.metricMonitorOptions,
            );
          }
        });

        test("never fills in the triggering telemetry's text outside the step's filters", () => {
          /*
           * Incident descriptions render as markdown, and an exception message
           * is shaped by whoever can make a service throw. The message reaches
           * only the exception monitor's message FILTER.
           */
          const hostile: AIInsightMonitorInput = testCase.insight();

          if (hostile.evidence?.exception) {
            hostile.evidence.exception.exceptionMessage =
              "Upload failed ![x](https://evil.example/beacon.png) [click](https://evil.example/login) <NUMBER>";
          }

          for (const sentence of proseOf(build(hostile))) {
            expect(sentence).not.toContain("evil.example");
            expect(sentence).not.toContain("](");
          }
        });
      });
    },
  );
});

describe("ErrorLogSpike → Logs monitor", () => {
  test("a service-scoped spike watches that service's Error and Fatal logs over an hour", () => {
    const prefill: JSONObject = build(errorLogSpike());

    expect(prefill["monitorType"]).toBe(MonitorType.Logs);
    expect(prefill["name"]).toBe("Error-log spike in checkout");

    const logMonitor: MonitorStepLogMonitor = stepOf(prefill).data!.logMonitor!;

    expect(logMonitor.severityTexts).toEqual([
      LogSeverity.Error,
      LogSeverity.Fatal,
    ]);
    expect(idsOf(logMonitor.telemetryServiceIds)).toEqual([SERVICE_ID]);
    expect(logMonitor.lastXSecondsOfLogs).toBe(3600);
    // Nothing the detector does not filter on.
    expect(logMonitor.body).toBe("");
    expect(logMonitor.attributes).toEqual({});
    expect(logMonitor.entityKeys).toEqual([]);
    expect(logMonitor.groupByAttributes).toEqual([]);

    // Every key of the type's default is present, so the form renders them all.
    for (const key of Object.keys(MonitorStepLogMonitorUtil.getDefault())) {
      expect(Object.keys(logMonitor)).toContain(key);
    }
  });

  test("the severities are the detector's, by their wire values", () => {
    expect(Prefill.ERROR_LOG_SPIKE_LOG_SEVERITIES).toEqual(["Error", "Fatal"]);
  });

  test("the threshold is the detector's bar: 3x the hourly baseline, never below 100", () => {
    // max(100, ceil(3 * 40)) = 120, and checkout's 900 is above it.
    const prefill: JSONObject = build(errorLogSpike());
    const unhealthy: CriteriaFilter = onlyFilter(unhealthyOf(prefill));

    expect(unhealthy.checkOn).toBe(CheckOn.LogCount);
    expect(unhealthy.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(unhealthy.value).toBe(120);
    expect(String(prefill["description"])).toContain(
      "3 times the project's hourly baseline",
    );

    // A quiet baseline: the floor wins.
    expect(
      onlyFilter(
        unhealthyOf(build(errorLogSpike({}, { baselineHourlyAverage: 2 }))),
      ).value,
    ).toBe(100);
  });

  test("a service that logged less than the project's bar gets its own spike as the bar", () => {
    /*
     * Baseline 400/hour: the project's bar is 1200, but checkout logged 900
     * during the spike. A checkout-scoped monitor at 1200 would not have
     * fired on the very spike it was made from.
     */
    const prefill: JSONObject = build(
      errorLogSpike({}, { baselineHourlyAverage: 400 }),
    );

    expect(onlyFilter(unhealthyOf(prefill)).value).toBe(900);
    expect(String(prefill["description"])).toContain(
      "900 is what checkout logged during the spike",
    );
    expect(String(prefill["description"])).toContain("1200");
  });

  test("a service count is floored, so a repeat of the spike still fires", () => {
    expect(
      onlyFilter(
        unhealthyOf(
          build(
            errorLogSpike(
              {},
              {
                baselineHourlyAverage: 400,
                topServices: [{ serviceName: "checkout", count: 412.7 }],
              },
            ),
          ),
        ),
      ).value,
    ).toBe(412);
  });

  test("never below the detector's floor, and says so instead of claiming the service's count", () => {
    const prefill: JSONObject = build(
      errorLogSpike(
        {},
        {
          baselineHourlyAverage: 400,
          topServices: [{ serviceName: "checkout", count: 40 }],
        },
      ),
    );

    expect(onlyFilter(unhealthyOf(prefill)).value).toBe(100);
    expect(String(prefill["description"])).not.toContain(
      "is what checkout logged",
    );
    expect(String(prefill["description"])).toContain(
      "the fewest Error or Fatal lines in an hour",
    );
  });

  test("getErrorLogSpikeThreshold names the rule that set the number", () => {
    const evidence: NonNullable<AIInsightEvidence["logSpike"]> =
      errorLogSpike().evidence!.logSpike!;

    expect(
      Prefill.getErrorLogSpikeThreshold({
        evidence: evidence,
        serviceName: "checkout",
        isServiceScoped: true,
      }),
    ).toEqual({
      threshold: 120,
      projectBar: 120,
      basis: Prefill.ErrorLogSpikeThresholdBasis.ProjectBar,
    });

    expect(
      Prefill.getErrorLogSpikeThreshold({
        evidence: { ...evidence, baselineHourlyAverage: 400 },
        serviceName: "payments",
        isServiceScoped: true,
      }),
    ).toEqual({
      threshold: 300,
      projectBar: 1200,
      basis: Prefill.ErrorLogSpikeThresholdBasis.ServiceSpike,
    });

    expect(
      Prefill.getErrorLogSpikeThreshold({
        evidence: { ...evidence, baselineHourlyAverage: 400 },
        serviceName: "search",
        isServiceScoped: true,
      }),
    ).toEqual({
      threshold: 100,
      projectBar: 1200,
      basis: Prefill.ErrorLogSpikeThresholdBasis.ServiceSpike,
    });

    // The floor IS the project's bar: no separate reason to give.
    expect(
      Prefill.getErrorLogSpikeThreshold({
        evidence: {
          ...evidence,
          baselineHourlyAverage: 10,
          topServices: [{ serviceName: "checkout", count: 50 }],
        },
        serviceName: "checkout",
        isServiceScoped: true,
      }),
    ).toEqual({
      threshold: 100,
      projectBar: 100,
      basis: Prefill.ErrorLogSpikeThresholdBasis.ProjectBar,
    });

    // A service missing from the attribution list keeps the project's bar.
    expect(
      Prefill.getErrorLogSpikeThreshold({
        evidence: { ...evidence, baselineHourlyAverage: 400 },
        serviceName: "inventory",
        isServiceScoped: true,
      }).threshold,
    ).toBe(1200);
  });

  test("a spike attributed to no Service is watched project-wide, the detector's own scope", () => {
    /*
     * A spike attributed to a host or a cluster stores its raw entity id as
     * the "service name" and no service id: a filter on either would match
     * nothing.
     */
    const prefill: JSONObject = build(
      errorLogSpike({
        serviceName: "0b7e1c38-0d5f-4a8e-9f2a-2f6f0f1b9d11",
        telemetryServiceId: undefined,
      }),
    );

    expect(prefill["name"]).toBe("Error-log spike across the project");
    expect(stepOf(prefill).data!.logMonitor!.telemetryServiceIds).toEqual([]);
    // The project-wide bar, never capped by a service count.
    expect(onlyFilter(unhealthyOf(prefill)).value).toBe(120);
  });

  test("malformed evidence degrades to the floor rather than a broken monitor", () => {
    for (const evidence of [
      undefined,
      {},
      { logSpike: null },
      { logSpike: "nope" },
      { logSpike: { baselineHourlyAverage: "40", topServices: "x" } },
      { logSpike: { baselineHourlyAverage: NaN, topServices: [null, 7] } },
    ]) {
      const prefill: JSONObject = build(
        errorLogSpike({ evidence: evidence as unknown as AIInsightEvidence }),
      );

      expect(onlyFilter(unhealthyOf(prefill)).value).toBe(100);
    }
  });
});

describe("exception insights → Exceptions monitor", () => {
  test("an exception spike watches the exception in its service for an hour", () => {
    const prefill: JSONObject = build(
      exceptionInsight(AIInsightType.ExceptionSpike),
    );

    expect(prefill["monitorType"]).toBe(MonitorType.Exceptions);
    expect(prefill["name"]).toBe(
      "Exception spike: com.microsoft.sqlserver.jdbc.SQLServerException in pd-jas-8004",
    );

    const exceptionMonitor: MonitorStepExceptionMonitor =
      stepOf(prefill).data!.exceptionMonitor!;

    expect(idsOf(exceptionMonitor.telemetryServiceIds)).toEqual([SERVICE_ID]);
    expect(exceptionMonitor.exceptionTypes).toEqual([
      "com.microsoft.sqlserver.jdbc.SQLServerException",
    ]);
    expect(exceptionMonitor.message).toBe(
      "Violation of PRIMARY KEY constraint 'F98950_PK'. Cannot insert duplicate key in object 'dbo.F98950'. The duplicate key value is",
    );
    expect(exceptionMonitor.lastXSecondsOfExceptions).toBe(3600);
    // Resolving the exception closes the incident.
    expect(exceptionMonitor.includeResolved).toBe(false);
    expect(exceptionMonitor.includeArchived).toBe(false);
    expect(exceptionMonitor.environments).toEqual([]);
    expect(exceptionMonitor.entityKeys).toEqual([]);

    for (const key of Object.keys(
      MonitorStepExceptionMonitorUtil.getDefault(),
    )) {
      expect(Object.keys(exceptionMonitor)).toContain(key);
    }
  });

  test("an exception spike's threshold is the detector's: 5x its hourly baseline, never below 10", () => {
    // max(10, ceil(5 * 6.4)) = 32.
    const unhealthy: CriteriaFilter = onlyFilter(
      unhealthyOf(build(exceptionInsight(AIInsightType.ExceptionSpike))),
    );

    expect(unhealthy.checkOn).toBe(CheckOn.ExceptionCount);
    expect(unhealthy.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(unhealthy.value).toBe(32);

    // A dormant exception that woke up: the floor.
    expect(
      onlyFilter(
        unhealthyOf(
          build(
            exceptionInsight(
              AIInsightType.ExceptionSpike,
              {},
              { baselineHourlyAverage: 0 },
            ),
          ),
        ),
      ).value,
    ).toBe(10);

    expect(Prefill.getExceptionSpikeThreshold(null)).toBe(10);
    expect(
      Prefill.getExceptionSpikeThreshold({ baselineHourlyAverage: 2.01 }),
    ).toBe(11);
  });

  test("a new exception watches its first-day recurrence rule: 3 or more in 24 hours", () => {
    const prefill: JSONObject = build(
      exceptionInsight(AIInsightType.NewException),
    );

    expect(prefill["name"]).toBe(
      "Exception: com.microsoft.sqlserver.jdbc.SQLServerException in pd-jas-8004",
    );
    expect(
      stepOf(prefill).data!.exceptionMonitor!.lastXSecondsOfExceptions,
    ).toBe(86400);
    expect(onlyFilter(unhealthyOf(prefill)).value).toBe(3);
    expect(String(prefill["description"])).toContain("within 24 hours");
  });

  test("an exception with no known service is not scoped to one", () => {
    const prefill: JSONObject = build(
      exceptionInsight(AIInsightType.ExceptionSpike, {
        serviceName: undefined,
        telemetryServiceId: undefined,
      }),
    );

    expect(stepOf(prefill).data!.exceptionMonitor!.telemetryServiceIds).toEqual(
      [],
    );
    expect(prefill["name"]).toBe(
      "Exception spike: com.microsoft.sqlserver.jdbc.SQLServerException",
    );
  });

  test("a type-less exception is scoped by its message, which stays out of the name", () => {
    const prefill: JSONObject = build(
      exceptionInsight(
        AIInsightType.NewException,
        {},
        {
          exceptionType: undefined,
        },
      ),
    );

    expect(stepOf(prefill).data!.exceptionMonitor!.exceptionTypes).toEqual([]);
    expect(stepOf(prefill).data!.exceptionMonitor!.message).toContain(
      "Violation of PRIMARY KEY constraint",
    );
    expect(prefill["name"]).toBe("Recurring exception in pd-jas-8004");
    for (const sentence of proseOf(prefill)) {
      expect(sentence).not.toContain("PRIMARY KEY");
    }

    expect(
      build(
        exceptionInsight(
          AIInsightType.ExceptionSpike,
          {},
          {
            exceptionType: undefined,
          },
        ),
      )["name"],
    ).toBe("Exception spike in pd-jas-8004");

    expect(
      build(
        exceptionInsight(
          AIInsightType.ExceptionSpike,
          { serviceName: undefined, telemetryServiceId: undefined },
          { exceptionType: undefined },
        ),
      )["name"],
    ).toBe("Exception spike");
  });

  test("a placeholder-only message adds no message filter", () => {
    const prefill: JSONObject = build(
      exceptionInsight(
        AIInsightType.ExceptionSpike,
        {},
        {
          exceptionMessage: "<UUID>: <NUMBER>",
        },
      ),
    );

    expect(stepOf(prefill).data!.exceptionMonitor!.message).toBe("");
  });

  test("a malformed service id is not used as a scope", () => {
    const prefill: JSONObject = build(
      exceptionInsight(AIInsightType.ExceptionSpike, {
        telemetryServiceId: "not-a-uuid",
      }),
    );

    expect(stepOf(prefill).data!.exceptionMonitor!.telemetryServiceIds).toEqual(
      [],
    );
  });
});

describe("MetricDrift → Metrics monitor", () => {
  test("watches the metric's hourly average on the entity it drifted on", () => {
    const prefill: JSONObject = build(metricDrift());

    expect(prefill["monitorType"]).toBe(MonitorType.Metrics);
    expect(prefill["name"]).toBe("Metric drift: k8s.node.memory.working_set");

    const metricMonitor: MonitorStepMetricMonitor =
      stepOf(prefill).data!.metricMonitor!;

    expect(metricMonitor.rollingTime).toBe(RollingTime.Past1Hour);
    expect(idsOf(metricMonitor.telemetryServiceIds)).toEqual([ENTITY_ID]);
    expect(metricMonitor.metricViewConfig.formulaConfigs).toEqual([]);
    expect(metricMonitor.metricViewConfig.queryConfigs).toHaveLength(1);

    const query: MonitorStepMetricMonitor["metricViewConfig"]["queryConfigs"][number] =
      metricMonitor.metricViewConfig.queryConfigs[0]!;

    expect(query.metricAliasData?.metricVariable).toBe(
      Prefill.METRIC_DRIFT_MONITOR_METRIC_ALIAS,
    );
    expect(query.metricQueryData.filterData.metricName).toBe(
      "k8s.node.memory.working_set",
    );
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      AggregationType.Avg,
    );
    expect(query.metricQueryData.filterData.attributes).toEqual({});
    // One number for the entity, not one alert per series.
    expect(query.metricQueryData.groupByAttributeKeys).toBeUndefined();
  });

  test("a metric that drifted up fires at 50% above the prior week's mean", () => {
    // 120 * 1.5 = 180.
    const prefill: JSONObject = build(metricDrift());
    const unhealthy: CriteriaFilter = onlyFilter(unhealthyOf(prefill));

    expect(unhealthy.checkOn).toBe(CheckOn.MetricValue);
    expect(unhealthy.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(unhealthy.value).toBe(180);
    // The criteria names the query, and compares the window's mean once.
    expect(unhealthy.metricMonitorOptions).toEqual({
      metricAggregationType: EvaluateOverTimeType.Average,
      metricAlias: "a",
    });
    expect(String(prefill["description"])).toContain("50% above");
  });

  test("a metric that drifted down fires at 50% below the prior week's mean", () => {
    const prefill: JSONObject = build(
      metricDrift({}, { recentWeekMean: 30, relativeChangePercent: -75 }),
    );
    const unhealthy: CriteriaFilter = onlyFilter(unhealthyOf(prefill));

    expect(unhealthy.filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(unhealthy.value).toBe(60);
    expect(onlyFilter(healthyOf(prefill)).filterType).toBe(
      FilterType.GreaterThan,
    );
    expect(String(prefill["description"])).toContain("50% below");
  });

  test("the bar is relative to |prior|, so a negative-valued metric moves the right way", () => {
    expect(
      onlyFilter(
        unhealthyOf(
          build(
            metricDrift(
              {},
              {
                priorWeekMean: -20,
                recentWeekMean: -5,
                relativeChangePercent: 75,
              },
            ),
          ),
        ),
      ).value,
    ).toBe(-10);

    expect(
      onlyFilter(
        unhealthyOf(
          build(
            metricDrift(
              {},
              {
                priorWeekMean: -20,
                recentWeekMean: -40,
                relativeChangePercent: -100,
              },
            ),
          ),
        ),
      ).value,
    ).toBe(-30);
  });

  test("the direction falls back to recent vs prior when the change is not stored", () => {
    const prefill: JSONObject = build(
      metricDrift(
        {},
        {
          relativeChangePercent: undefined as unknown as number,
          recentWeekMean: 20,
        },
      ),
    );

    expect(onlyFilter(unhealthyOf(prefill)).filterType).toBe(
      FilterType.LessThanOrEqualTo,
    );
    expect(onlyFilter(unhealthyOf(prefill)).value).toBe(60);
  });

  test("a non-UUID entity is not used as a scope, and the description does not claim one", () => {
    const prefill: JSONObject = build(
      metricDrift({}, { primaryEntityId: "host-42" }),
    );

    expect(stepOf(prefill).data!.metricMonitor!.telemetryServiceIds).toEqual(
      [],
    );
    expect(String(prefill["description"])).not.toContain("Only the entity");

    expect(String(build(metricDrift())["description"])).toContain(
      "Only the entity",
    );
  });

  test("the metric name comes from the evidence when the column is empty", () => {
    const prefill: JSONObject = build(metricDrift({ metricName: undefined }));

    expect(
      stepOf(prefill).data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
        .metricQueryData.filterData.metricName,
    ).toBe("k8s.node.memory.working_set");
  });

  test("roundMetricThreshold keeps four significant digits and never zeroes a small metric", () => {
    expect(Prefill.roundMetricThreshold(180)).toBe(180);
    expect(Prefill.roundMetricThreshold(123456.7)).toBe(123500);
    expect(Prefill.roundMetricThreshold(0.000123456)).toBe(0.0001235);
    expect(Prefill.roundMetricThreshold(-0.33333333)).toBe(-0.3333);
    expect(Prefill.roundMetricThreshold(0)).toBe(0);
    expect(Prefill.roundMetricThreshold(NaN)).toBe(0);
    expect(
      Prefill.getMetricDriftThreshold({ priorWeekMean: 0.0002, direction: 1 }),
    ).toBe(0.0003);
  });
});

describe("severity", () => {
  test("a High insight opens the project's most severe incident", () => {
    const unhealthy: MonitorCriteriaInstance = unhealthyOf(
      build(errorLogSpike()),
    );

    expect(unhealthy.data?.incidents[0]?.incidentSeverityId?.toString()).toBe(
      CRITICAL_INCIDENT_ID,
    );
    expect(unhealthy.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
      HIGH_ALERT_ID,
    );
  });

  test("anything else opens the next one down", () => {
    for (const severity of [
      AIInsightSeverity.Medium,
      AIInsightSeverity.Low,
      undefined,
      "Bogus",
    ]) {
      const unhealthy: MonitorCriteriaInstance = unhealthyOf(
        build(errorLogSpike({ severity: severity })),
      );

      expect(unhealthy.data?.incidents[0]?.incidentSeverityId?.toString()).toBe(
        MAJOR_INCIDENT_ID,
      );
      expect(unhealthy.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
        LOW_ALERT_ID,
      );
    }
  });

  test("getAIInsightMonitorSeverityLevel maps onto the recommendation scale", () => {
    expect(
      Prefill.getAIInsightMonitorSeverityLevel(AIInsightSeverity.High),
    ).toBe("Critical");
    expect(
      Prefill.getAIInsightMonitorSeverityLevel(AIInsightSeverity.Medium),
    ).toBe("Warning");
    expect(
      Prefill.getAIInsightMonitorSeverityLevel(AIInsightSeverity.Low),
    ).toBe("Warning");
  });

  test("a project with one severity uses it for both levels", () => {
    for (const severity of [AIInsightSeverity.High, AIInsightSeverity.Low]) {
      const unhealthy: MonitorCriteriaInstance = unhealthyOf(
        build(errorLogSpike({ severity: severity }), {
          rankedIncidentSeverityIds: [new ObjectID(MINOR_INCIDENT_ID)],
        }),
      );

      expect(unhealthy.data?.incidents[0]?.incidentSeverityId?.toString()).toBe(
        MINOR_INCIDENT_ID,
      );
    }
  });

  test("a project with no incident severity gets no incident — never one the form cannot save", () => {
    const prefill: JSONObject = build(errorLogSpike(), {
      rankedIncidentSeverityIds: [],
      rankedAlertSeverityIds: [],
    });
    const unhealthy: MonitorCriteriaInstance = unhealthyOf(prefill);

    expect(unhealthy.data?.createIncidents).toBe(false);
    expect(unhealthy.data?.incidents).toEqual([]);
    expect(unhealthy.data?.alerts).toEqual([]);
    expect(
      MonitorSteps.getValidationError(stepsOf(prefill), MonitorType.Logs),
    ).toBeNull();
  });
});

describe("a project missing its statuses", () => {
  test("no offline status: the unhealthy criteria opens the incident without changing the status", () => {
    const unhealthy: MonitorCriteriaInstance = unhealthyOf(
      build(errorLogSpike(), { offlineMonitorStatusId: null }),
    );

    expect(unhealthy.data?.changeMonitorStatus).toBe(false);
    expect(unhealthy.data?.monitorStatusId).toBeFalsy();
    expect(unhealthy.data?.createIncidents).toBe(true);
  });

  test("no operational status: no default status, which the form then asks for", () => {
    const prefill: JSONObject = build(errorLogSpike(), {
      operationalMonitorStatusId: null,
    });

    expect(stepsOf(prefill).data?.defaultMonitorStatusId).toBeFalsy();
    expect(healthyOf(prefill).data?.changeMonitorStatus).toBe(false);
    expect(
      MonitorSteps.getValidationError(stepsOf(prefill), MonitorType.Logs),
    ).toBe("Default Monitor Status is required");
  });
});

describe("names", () => {
  test("a long name is cut to the column, on a character boundary", () => {
    const prefill: JSONObject = build(
      exceptionInsight(
        AIInsightType.ExceptionSpike,
        {
          serviceName: `svc-${"é".repeat(60)}`,
        },
        {
          exceptionType: `org.example.${"Deep".repeat(30)}Exception`,
        },
      ),
    );
    const name: string = String(prefill["name"]);

    expect(Array.from(name).length).toBeLessThanOrEqual(
      Prefill.MAX_MONITOR_NAME_LENGTH,
    );
    expect(name.startsWith("Exception spike: org.example.")).toBe(true);
    // The incident title follows the clamped name, not the long one.
    expect(unhealthyOf(prefill).data?.incidents[0]?.title).toBe(name);
  });
});
