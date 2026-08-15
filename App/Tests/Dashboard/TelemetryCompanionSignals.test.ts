import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Log from "Common/Models/AnalyticsModels/Log";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepTraceMonitorUtil } from "Common/Types/Monitor/MonitorStepTraceMonitor";
import { MonitorStepExceptionMonitorUtil } from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * TelemetryCompanionSignals imports MetricsCrossSignalPivot (scope reuse),
 * which imports ModelAPI and ProjectUtil — both transitively load
 * Common/UI/Config, which reads `window` at import time and throws in this
 * node environment. Mocking the two keeps the import graph browser-free
 * (same pattern as MetricsCrossSignalPivot.test.ts).
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: jest.fn(),
    },
  };
});

import { SERVICE_NAME_ATTRIBUTE_KEY } from "../../FeatureSet/Dashboard/src/Utils/MetricsCrossSignalPivot";
import {
  CompanionMetricChartPlan,
  CompanionSignalQueries,
  MAX_COMPANION_METRIC_CHARTS,
  TELEMETRY_SNAPSHOT_TAB_ORDER,
  buildCompanionMetricChartPlan,
  buildCompanionMetricNameQuery,
  deriveCompanionSignalQueries,
  getCompanionMetricScopeServiceNames,
  getTelemetrySnapshotTabOrder,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetryCompanionSignals";

const SERVICE_ID_A: string = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
).toString();
const SERVICE_ID_B: string = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
).toString();

/*
 * Persist the way the worker does (anyObjectToJSONObject onto the row) and
 * restore the way the incident / alert pages do (JSONFunctions.deserialize
 * followed by TelemetryQueryTimeRange.hydrate), so the derivation is
 * exercised against the exact shapes it sees in production.
 */
function roundTripTelemetryQuery(raw: TelemetryQuery): TelemetryQuery {
  const stored: JSONObject = JSONFunctions.anyObjectToJSONObject(
    raw as unknown as JSONObject,
  );

  const restored: TelemetryQuery = JSONFunctions.deserialize(
    stored,
  ) as unknown as TelemetryQuery;

  return TelemetryQueryTimeRange.hydrate(restored)!;
}

interface RestoredPrimary {
  telemetryQuery: TelemetryQuery;
  snapshotWindow: InBetween<Date>;
}

function restorePrimary(raw: TelemetryQuery): RestoredPrimary {
  const telemetryQuery: TelemetryQuery = roundTripTelemetryQuery(raw);
  const snapshotWindow: InBetween<Date> | null =
    TelemetryQueryTimeRange.getSnapshotWindow(telemetryQuery);

  expect(snapshotWindow).not.toBeNull();

  return { telemetryQuery, snapshotWindow: snapshotWindow! };
}

function buildLogPrimary(): RestoredPrimary {
  return restorePrimary({
    telemetryType: TelemetryType.Log,
    telemetryQuery: MonitorStepLogMonitorUtil.toQuery({
      ...MonitorStepLogMonitorUtil.getDefault(),
      telemetryServiceIds: [
        new ObjectID(SERVICE_ID_A),
        new ObjectID(SERVICE_ID_B),
      ],
      attributes: { "http.route": "/checkout", retryCount: 3 },
      severityTexts: [LogSeverity.Error],
      entityKeys: ["host:web-1"],
      body: "OutOfMemory",
      lastXSecondsOfLogs: 300,
    }),
    metricViewData: null,
  });
}

function buildTracePrimary(): RestoredPrimary {
  return restorePrimary({
    telemetryType: TelemetryType.Trace,
    telemetryQuery: MonitorStepTraceMonitorUtil.toQuery({
      ...MonitorStepTraceMonitorUtil.getDefault(),
      telemetryServiceIds: [new ObjectID(SERVICE_ID_A)],
      attributes: { "http.method": "GET" },
      spanStatuses: [SpanStatus.Error],
      spanName: "GET /checkout",
      lastXSecondsOfSpans: 120,
    }),
    metricViewData: null,
  });
}

function buildExceptionPrimary(): RestoredPrimary {
  return restorePrimary({
    telemetryType: TelemetryType.Exception,
    telemetryQuery: MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
      ...MonitorStepExceptionMonitorUtil.getDefault(),
      telemetryServiceIds: [new ObjectID(SERVICE_ID_A)],
      exceptionTypes: ["OutOfMemoryError"],
      message: "heap",
      lastXSecondsOfExceptions: 600,
    }),
    metricViewData: null,
  });
}

function buildMetricPrimaryViewData(): MetricViewData {
  const endDate: Date = new Date("2026-08-10T12:00:00.000Z");
  const startDate: Date = new Date("2026-08-10T11:45:00.000Z");

  return {
    startAndEndDate: new InBetween<Date>(startDate, endDate),
    queryConfigs: [
      {
        metricQueryData: {
          filterData: {
            metricName: "http.server.duration",
            aggegationType: MetricsAggregationType.Avg,
            attributes: {
              [SERVICE_NAME_ATTRIBUTE_KEY]: "cart-service",
              "http.status_code": "500",
              severityText: "error",
              "container.name": new Search("web"),
            },
          },
        },
      },
    ],
    formulaConfigs: [],
  };
}

function buildMetricPrimary(): RestoredPrimary {
  return restorePrimary({
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: buildMetricPrimaryViewData(),
  });
}

function expectWindowEquals(actual: unknown, expected: InBetween<Date>): void {
  const actualWindow: InBetween<Date> | null =
    TelemetryQueryTimeRange.toDateWindow(actual);

  expect(actualWindow).not.toBeNull();
  expect(actualWindow!.startValue.getTime()).toBe(
    expected.startValue.getTime(),
  );
  expect(actualWindow!.endValue.getTime()).toBe(expected.endValue.getTime());
}

function includesValues(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return (value as Includes).values.map(
    (item: string | number | ObjectID): string => {
      return item.toString();
    },
  );
}

describe("deriveCompanionSignalQueries: log monitor primary", () => {
  const primary: RestoredPrimary = buildLogPrimary();
  const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
    telemetryQuery: primary.telemetryQuery,
    snapshotWindow: primary.snapshotWindow,
  });

  test("the primary pillar renders through the page, not a companion", () => {
    expect(companions.primaryType).toBe(TelemetryType.Log);
    expect(companions.logs).toBeNull();
    expect(companions.traces).not.toBeNull();
    expect(companions.metrics).not.toBeNull();
    expect(companions.exceptions).not.toBeNull();
  });

  test("the traces companion carries scope and the exact window", () => {
    const spanQuery: JSONObject = companions.traces!
      .spanQuery as unknown as JSONObject;

    expectWindowEquals(spanQuery["startTime"], primary.snapshotWindow);
    expect(includesValues(spanQuery["primaryEntityId"])).toEqual([
      SERVICE_ID_A,
      SERVICE_ID_B,
    ]);
    expect(spanQuery["attributes"]).toEqual({
      "http.route": "/checkout",
      retryCount: 3,
    });
    expect(includesValues(spanQuery["entityKeys"])).toEqual(["host:web-1"]);
  });

  test("the exceptions companion carries scope and the exact window", () => {
    const exceptionQuery: JSONObject = companions.exceptions!
      .exceptionQuery as unknown as JSONObject;

    expectWindowEquals(exceptionQuery["time"], primary.snapshotWindow);
    expect(includesValues(exceptionQuery["primaryEntityId"])).toEqual([
      SERVICE_ID_A,
      SERVICE_ID_B,
    ]);
    expect(includesValues(exceptionQuery["entityKeys"])).toEqual([
      "host:web-1",
    ]);
  });

  test("the metrics companion carries scope and the exact window", () => {
    expect(companions.metrics!.serviceIds).toEqual([
      SERVICE_ID_A,
      SERVICE_ID_B,
    ]);
    expect(companions.metrics!.entityKeys).toEqual(["host:web-1"]);
    expect(companions.metrics!.attributes).toEqual({
      "http.route": "/checkout",
      retryCount: 3,
    });
    expectWindowEquals(companions.metrics!.window, primary.snapshotWindow);
  });

  test("log-only filters are reported, never dropped silently", () => {
    for (const notCarried of [
      companions.traces!.notCarried,
      companions.metrics!.notCarried,
      companions.exceptions!.notCarried,
    ]) {
      expect(notCarried).toContain("log body search");
      expect(notCarried).toContain("severity filter");
    }
  });

  test("companion windows are defensive copies of the snapshot window", () => {
    expect(companions.metrics!.window).not.toBe(primary.snapshotWindow);

    const spanQuery: JSONObject = companions.traces!
      .spanQuery as unknown as JSONObject;

    expect(spanQuery["startTime"]).not.toBe(primary.snapshotWindow);
  });
});

describe("deriveCompanionSignalQueries: trace monitor primary", () => {
  const primary: RestoredPrimary = buildTracePrimary();
  const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
    telemetryQuery: primary.telemetryQuery,
    snapshotWindow: primary.snapshotWindow,
  });

  test("companions cover the other three pillars", () => {
    expect(companions.primaryType).toBe(TelemetryType.Trace);
    expect(companions.traces).toBeNull();
    expect(companions.logs).not.toBeNull();
    expect(companions.metrics).not.toBeNull();
    expect(companions.exceptions).not.toBeNull();
  });

  test("the logs companion pins the viewer to the snapshot window", () => {
    expect(companions.logs!.serviceIds).toEqual([SERVICE_ID_A]);

    const logQuery: JSONObject = companions.logs!
      .logQuery as unknown as JSONObject;

    expectWindowEquals(logQuery["time"], primary.snapshotWindow);
    expect(logQuery["attributes"]).toEqual({ "http.method": "GET" });

    /*
     * The exact mechanism DashboardLogsViewer pins with: an explicit `time`
     * on logQuery resolves to a CUSTOM picker range at the same instants.
     */
    const pinned: RangeStartAndEndDateTime | null =
      TelemetryQueryTimeRange.getPinnedRangeForQuery(
        companions.logs!.logQuery as Query<Log>,
        TelemetryType.Log,
      );

    expect(pinned).not.toBeNull();
    expect(pinned!.range).toBe(TimeRange.CUSTOM);
    expectWindowEquals(pinned!.startAndEndDate, primary.snapshotWindow);
  });

  test("trace-only filters are reported on every companion", () => {
    for (const notCarried of [
      companions.logs!.notCarried,
      companions.metrics!.notCarried,
      companions.exceptions!.notCarried,
    ]) {
      expect(notCarried).toContain("span name search");
      expect(notCarried).toContain("span status filter");
    }
  });
});

describe("deriveCompanionSignalQueries: exception monitor primary", () => {
  const primary: RestoredPrimary = buildExceptionPrimary();
  const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
    telemetryQuery: primary.telemetryQuery,
    snapshotWindow: primary.snapshotWindow,
  });

  test("companions cover the other three pillars", () => {
    expect(companions.primaryType).toBe(TelemetryType.Exception);
    expect(companions.exceptions).toBeNull();
    expect(companions.logs).not.toBeNull();
    expect(companions.traces).not.toBeNull();
    expect(companions.metrics).not.toBeNull();
  });

  test("service scope and window carry to logs and traces", () => {
    const logQuery: JSONObject = companions.logs!
      .logQuery as unknown as JSONObject;
    const spanQuery: JSONObject = companions.traces!
      .spanQuery as unknown as JSONObject;

    expect(companions.logs!.serviceIds).toEqual([SERVICE_ID_A]);
    expectWindowEquals(logQuery["time"], primary.snapshotWindow);
    expect(includesValues(spanQuery["primaryEntityId"])).toEqual([
      SERVICE_ID_A,
    ]);
    expectWindowEquals(spanQuery["startTime"], primary.snapshotWindow);
  });

  test("exception-only filters are reported on every companion", () => {
    for (const notCarried of [
      companions.logs!.notCarried,
      companions.traces!.notCarried,
      companions.metrics!.notCarried,
    ]) {
      expect(notCarried).toContain("exception type filter");
      expect(notCarried).toContain("exception message search");
    }
  });
});

describe("deriveCompanionSignalQueries: metric monitor primary", () => {
  const primary: RestoredPrimary = buildMetricPrimary();

  test("with resolved service ids, companions scope by primaryEntityId", () => {
    const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
      telemetryQuery: primary.telemetryQuery,
      snapshotWindow: primary.snapshotWindow,
      serviceIdsByName: { "cart-service": SERVICE_ID_A },
    });

    expect(companions.primaryType).toBe(TelemetryType.Metric);
    expect(companions.metrics).toBeNull();

    expect(companions.logs!.serviceIds).toEqual([SERVICE_ID_A]);

    const logQuery: JSONObject = companions.logs!
      .logQuery as unknown as JSONObject;

    expectWindowEquals(logQuery["time"], primary.snapshotWindow);
    expect(logQuery["attributes"]).toEqual({ "http.status_code": "500" });

    // The metric's severityText equality rides as a real log severity scope.
    expect(includesValues(logQuery["severityText"])).toEqual(["Error"]);

    const spanQuery: JSONObject = companions.traces!
      .spanQuery as unknown as JSONObject;

    expect(includesValues(spanQuery["primaryEntityId"])).toEqual([
      SERVICE_ID_A,
    ]);
    expectWindowEquals(spanQuery["startTime"], primary.snapshotWindow);
  });

  test("without resolution, a single service name degrades to an attribute", () => {
    const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
      telemetryQuery: primary.telemetryQuery,
      snapshotWindow: primary.snapshotWindow,
    });

    expect(companions.logs!.serviceIds).toEqual([]);

    const logQuery: JSONObject = companions.logs!
      .logQuery as unknown as JSONObject;

    expect(logQuery["attributes"]).toEqual({
      [SERVICE_NAME_ATTRIBUTE_KEY]: "cart-service",
      "http.status_code": "500",
    });
  });

  test("severity and inexpressible metric filters are reported", () => {
    const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
      telemetryQuery: primary.telemetryQuery,
      snapshotWindow: primary.snapshotWindow,
      serviceIdsByName: { "cart-service": SERVICE_ID_A },
    });

    // The Search-operator attribute cannot be carried as equality scope.
    for (const notCarried of [
      companions.logs!.notCarried,
      companions.traces!.notCarried,
      companions.exceptions!.notCarried,
    ]) {
      expect(notCarried).toContain("container.name");
    }

    // Spans and exceptions have no severity dimension; logs do.
    expect(companions.traces!.notCarried).toContain("severity filter");
    expect(companions.exceptions!.notCarried).toContain("severity filter");
    expect(companions.logs!.notCarried).not.toContain("severity filter");
  });

  test("getCompanionMetricScopeServiceNames surfaces the names to resolve", () => {
    expect(getCompanionMetricScopeServiceNames(primary.telemetryQuery)).toEqual(
      ["cart-service"],
    );

    expect(getCompanionMetricScopeServiceNames(null)).toEqual([]);
    expect(
      getCompanionMetricScopeServiceNames(buildLogPrimary().telemetryQuery),
    ).toEqual([]);
  });
});

describe("deriveCompanionSignalQueries: an unscoped monitor stays unscoped", () => {
  test("a whole-project log monitor yields window-only companions", () => {
    const primary: RestoredPrimary = restorePrimary({
      telemetryType: TelemetryType.Log,
      telemetryQuery: MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 60,
      }),
      metricViewData: null,
    });

    const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
      telemetryQuery: primary.telemetryQuery,
      snapshotWindow: primary.snapshotWindow,
    });

    const spanQuery: JSONObject = companions.traces!
      .spanQuery as unknown as JSONObject;

    // The monitor watched everything, so parity is window-only — no hint.
    expect(Object.keys(spanQuery)).toEqual(["startTime"]);
    expect(companions.traces!.notCarried).toEqual([]);
    expect(companions.metrics!.serviceIds).toEqual([]);
    expect(companions.metrics!.notCarried).toEqual([]);
  });
});

describe("deriveCompanionSignalQueries: missing or malformed input", () => {
  const validWindow: InBetween<Date> = new InBetween<Date>(
    new Date("2026-08-10T11:00:00.000Z"),
    new Date("2026-08-10T11:05:00.000Z"),
  );

  function expectNoCompanions(companions: CompanionSignalQueries): void {
    expect(companions.primaryType).toBeNull();
    expect(companions.logs).toBeNull();
    expect(companions.traces).toBeNull();
    expect(companions.metrics).toBeNull();
    expect(companions.exceptions).toBeNull();
  }

  test("no telemetryQuery at all", () => {
    expectNoCompanions(
      deriveCompanionSignalQueries({
        telemetryQuery: null,
        snapshotWindow: validWindow,
      }),
    );
    expectNoCompanions(
      deriveCompanionSignalQueries({
        telemetryQuery: undefined,
        snapshotWindow: validWindow,
      }),
    );
  });

  test("a profile monitor stores no companion-derivable query", () => {
    expectNoCompanions(
      deriveCompanionSignalQueries({
        telemetryQuery: {
          telemetryType: TelemetryType.Profile,
          telemetryQuery: null,
          metricViewData: null,
        },
        snapshotWindow: validWindow,
      }),
    );
  });

  test("a primary with a missing or non-record query", () => {
    for (const telemetryQuery of [
      null,
      "not-a-query",
      42,
      ["primaryEntityId"],
    ]) {
      expectNoCompanions(
        deriveCompanionSignalQueries({
          telemetryQuery: {
            telemetryType: TelemetryType.Log,
            telemetryQuery: telemetryQuery as never,
            metricViewData: null,
          },
          snapshotWindow: validWindow,
        }),
      );
    }
  });

  test("a metric primary with missing or malformed view data", () => {
    expectNoCompanions(
      deriveCompanionSignalQueries({
        telemetryQuery: {
          telemetryType: TelemetryType.Metric,
          telemetryQuery: null,
          metricViewData: null,
        },
        snapshotWindow: validWindow,
      }),
    );

    expectNoCompanions(
      deriveCompanionSignalQueries({
        telemetryQuery: {
          telemetryType: TelemetryType.Metric,
          telemetryQuery: null,
          metricViewData: {
            startAndEndDate: validWindow,
            queryConfigs: "corrupt" as never,
            formulaConfigs: [],
          },
        },
        snapshotWindow: validWindow,
      }),
    );
  });

  test("no snapshot window means no companions, never a rolling default", () => {
    const primary: RestoredPrimary = buildLogPrimary();

    expectNoCompanions(
      deriveCompanionSignalQueries({
        telemetryQuery: primary.telemetryQuery,
        snapshotWindow: null,
      }),
    );

    expectNoCompanions(
      deriveCompanionSignalQueries({
        telemetryQuery: primary.telemetryQuery,
        snapshotWindow: {} as never,
      }),
    );
  });

  test("a window restored as ISO strings still derives (and stays exact)", () => {
    const primary: RestoredPrimary = buildLogPrimary();

    const rawWindow: unknown = {
      _type: "InBetween",
      startValue: primary.snapshotWindow.startValue.toISOString(),
      endValue: primary.snapshotWindow.endValue.toISOString(),
    };

    const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
      telemetryQuery: primary.telemetryQuery,
      snapshotWindow: rawWindow as never,
    });

    expect(companions.traces).not.toBeNull();
    expectWindowEquals(
      (companions.traces!.spanQuery as unknown as JSONObject)["startTime"],
      primary.snapshotWindow,
    );
  });

  test("unreadable filter values degrade to entity+window with a hint", () => {
    const primary: RestoredPrimary = buildLogPrimary();

    const corruptQuery: JSONObject = {
      primaryEntityId: { unexpected: "shape" },
      attributes: {
        "http.route": "/checkout",
        nested: { object: true },
      },
      kind: "SERVER",
    };

    const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
      telemetryQuery: {
        telemetryType: TelemetryType.Log,
        telemetryQuery: corruptQuery as never,
        metricViewData: null,
      },
      snapshotWindow: primary.snapshotWindow,
    });

    expect(companions.traces).not.toBeNull();

    const spanQuery: JSONObject = companions.traces!
      .spanQuery as unknown as JSONObject;

    // The readable attribute survives; the unreadable pieces are reported.
    expect(spanQuery["attributes"]).toEqual({ "http.route": "/checkout" });
    expect(spanQuery["primaryEntityId"]).toBeUndefined();
    expect(companions.traces!.notCarried).toContain("service filter");
    expect(companions.traces!.notCarried).toContain('attribute "nested"');
    expect(companions.traces!.notCarried).toContain("kind");
  });
});

describe("snapshot tab order", () => {
  test("the primary pillar is hoisted to the front", () => {
    expect(getTelemetrySnapshotTabOrder(TelemetryType.Log)).toEqual([
      TelemetryType.Log,
      TelemetryType.Trace,
      TelemetryType.Metric,
      TelemetryType.Exception,
    ]);
    expect(getTelemetrySnapshotTabOrder(TelemetryType.Metric)).toEqual([
      TelemetryType.Metric,
      TelemetryType.Log,
      TelemetryType.Trace,
      TelemetryType.Exception,
    ]);
  });

  test("unknown primaries fall back to the canonical order", () => {
    expect(getTelemetrySnapshotTabOrder(null)).toEqual(
      TELEMETRY_SNAPSHOT_TAB_ORDER,
    );
    expect(getTelemetrySnapshotTabOrder(TelemetryType.Profile)).toEqual(
      TELEMETRY_SNAPSHOT_TAB_ORDER,
    );
  });
});

describe("companion metric name discovery query", () => {
  const primary: RestoredPrimary = buildLogPrimary();
  const companions: CompanionSignalQueries = deriveCompanionSignalQueries({
    telemetryQuery: primary.telemetryQuery,
    snapshotWindow: primary.snapshotWindow,
  });
  const projectId: ObjectID = new ObjectID(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );

  test("carries the scope and the exact window", () => {
    const query: JSONObject = buildCompanionMetricNameQuery({
      spec: companions.metrics!,
      projectId: projectId,
    }) as unknown as JSONObject;

    expect(query["projectId"]).toBe(projectId);
    expectWindowEquals(query["time"], primary.snapshotWindow);
    expect(includesValues(query["primaryEntityId"])).toEqual([
      SERVICE_ID_A,
      SERVICE_ID_B,
    ]);
    expect(includesValues(query["entityKeys"])).toEqual(["host:web-1"]);
    expect(query["attributes"]).toEqual({
      "http.route": "/checkout",
      retryCount: 3,
    });
  });

  test("omits empty scope dimensions entirely", () => {
    const query: JSONObject = buildCompanionMetricNameQuery({
      spec: {
        serviceIds: [],
        entityKeys: [],
        attributes: {},
        window: primary.snapshotWindow,
        notCarried: [],
      },
      projectId: projectId,
    }) as unknown as JSONObject;

    expect(Object.keys(query).sort()).toEqual(["projectId", "time"]);
  });
});

describe("companion metric chart plan", () => {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date("2026-08-10T11:00:00.000Z"),
    new Date("2026-08-10T11:05:00.000Z"),
  );

  test("caps, sorts, and dedupes the chart list", () => {
    const plan: CompanionMetricChartPlan = buildCompanionMetricChartPlan({
      metricNames: ["z.metric", "a.metric", "a.metric", "", "  ", "m.metric"],
      serviceNames: [],
      spec: {
        serviceIds: [],
        entityKeys: [],
        attributes: {},
        window: window,
        notCarried: [],
      },
      maxCharts: 2,
    });

    expect(
      plan.queryConfigs.map((config: MetricQueryConfigData): string => {
        return config.metricQueryData.filterData.metricName as string;
      }),
    ).toEqual(["a.metric", "m.metric"]);
    expect(plan.omittedMetricCount).toBe(1);
    expect(plan.chartScopeNotes).toEqual([]);
  });

  test("defaults to the shared chart cap", () => {
    const manyNames: Array<string> = Array.from(
      { length: MAX_COMPANION_METRIC_CHARTS + 3 },
      (_unused: unknown, index: number): string => {
        return `metric.${index}`;
      },
    );

    const plan: CompanionMetricChartPlan = buildCompanionMetricChartPlan({
      metricNames: manyNames,
      serviceNames: [],
      spec: {
        serviceIds: [],
        entityKeys: [],
        attributes: {},
        window: window,
        notCarried: [],
      },
    });

    expect(plan.queryConfigs.length).toBe(MAX_COMPANION_METRIC_CHARTS);
    expect(plan.omittedMetricCount).toBe(3);
  });

  test("scopes chart values through the service-name attribute", () => {
    const singleService: CompanionMetricChartPlan =
      buildCompanionMetricChartPlan({
        metricNames: ["cpu.usage"],
        serviceNames: ["cart-service"],
        spec: {
          serviceIds: [SERVICE_ID_A],
          entityKeys: [],
          attributes: { "http.route": "/checkout" },
          window: window,
          notCarried: [],
        },
      });

    const attributes: Dictionary<unknown> = singleService.queryConfigs[0]!
      .metricQueryData.filterData.attributes as Dictionary<unknown>;

    expect(attributes["http.route"]).toBe("/checkout");
    expect(attributes[SERVICE_NAME_ATTRIBUTE_KEY]).toBe("cart-service");
    expect(
      singleService.queryConfigs[0]!.metricQueryData.filterData.aggegationType,
    ).toBe(MetricsAggregationType.Avg);
    expect(singleService.chartScopeNotes).toEqual([]);

    const multiService: CompanionMetricChartPlan =
      buildCompanionMetricChartPlan({
        metricNames: ["cpu.usage"],
        serviceNames: ["cart-service", "billing-service"],
        spec: {
          serviceIds: [SERVICE_ID_A, SERVICE_ID_B],
          entityKeys: [],
          attributes: {},
          window: window,
          notCarried: [],
        },
      });

    const multiAttributes: Dictionary<unknown> = multiService.queryConfigs[0]!
      .metricQueryData.filterData.attributes as Dictionary<unknown>;

    expect(includesValues(multiAttributes[SERVICE_NAME_ATTRIBUTE_KEY])).toEqual(
      ["cart-service", "billing-service"],
    );
  });

  test("unscopeable chart dimensions are noted, never silent", () => {
    const plan: CompanionMetricChartPlan = buildCompanionMetricChartPlan({
      metricNames: ["cpu.usage"],
      serviceNames: [],
      spec: {
        serviceIds: [SERVICE_ID_A],
        entityKeys: ["host:web-1"],
        attributes: {},
        window: window,
        notCarried: [],
      },
    });

    expect(plan.chartScopeNotes.length).toBe(2);
    expect(plan.chartScopeNotes.join(" ")).toContain(
      "service name could not be resolved",
    );
    expect(plan.chartScopeNotes.join(" ")).toContain("entity-key scope");
  });
});

/*
 * Page and card wiring, pinned by reading the sources — the App suite runs
 * in plain Node with no renderer (same constraint and technique as
 * TelemetryPreviewSnapshotWindow.test.ts). Comment-stripped and
 * whitespace-squashed first so a prettier re-wrap cannot fake a regression.
 */
const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);
const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");
const COMPANION_TABS: string = readSource(
  "Components",
  "Telemetry",
  "TelemetryCompanionSignalTabs.tsx",
);

describe("page and card wiring", () => {
  test.each([
    ["incident", INCIDENT_VIEW, "incident"],
    ["alert", ALERT_VIEW, "alert"],
  ])(
    "%s page routes its snapshot through the shared tabbed card",
    (_name: string, source: string, eventNoun: string) => {
      expect(source).toContain("<TelemetryCompanionSignalTabs");
      expect(source).toContain("telemetryQuery={telemetryQuery}");
      expect(source).toContain("snapshotWindow={telemetrySnapshotWindow}");
      expect(source).toContain("snapshotWindowAlert={snapshotWindowAlert}");
      expect(source).toContain(`eventNoun="${eventNoun}"`);
      expect(source).toContain("primarySignalElement={");
    },
  );

  test("the card derives companions with the shared pure util", () => {
    expect(COMPANION_TABS).toContain("deriveCompanionSignalQueries({");
    expect(COMPANION_TABS).toContain("snapshotWindow: props.snapshotWindow");
  });

  test("companion tables never restore URL filters over the pin", () => {
    // The trace and exception companions, like the primary embeds.
    expect(COMPANION_TABS.split("disableUrlState={true}").length - 1).toBe(2);
  });

  test("the logs companion feeds the viewer's pinned-window mechanism", () => {
    expect(COMPANION_TABS).toContain("logQuery={props.spec.logQuery}");
  });

  test("the metrics companion pins EmbeddedMetricCard to the window", () => {
    expect(COMPANION_TABS).toContain("range: TimeRange.CUSTOM");
    expect(COMPANION_TABS).toContain("timeRange={timeRange}");
    expect(COMPANION_TABS).not.toContain("MetricsViewer");
  });

  test("companions render nothing extra when derivation yields no tabs", () => {
    expect(COMPANION_TABS).toContain(
      "if (tabs.length <= 1) { return props.primarySignalElement; }",
    );
  });
});
