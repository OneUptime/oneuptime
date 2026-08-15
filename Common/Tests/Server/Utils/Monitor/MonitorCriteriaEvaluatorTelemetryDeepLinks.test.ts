/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, and the prebuilt binary cannot always dlopen in the
 * test environment — so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator, {
  TelemetryExplorerDeepLink,
} from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { DashboardClientUrl } from "../../../../Server/EnvironmentConfig";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MetricCriteriaContext from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import { CheckOn } from "../../../../Types/Monitor/CriteriaFilter";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Cross-signal sibling deep links: alongside the existing metric-explorer
 * link, a metric breach now also carries Logs and Traces explorer links
 * scoped to the same breach window, the criteria's attribute filters
 * (overlaid with per-series labels) and the monitor step's telemetry
 * service scope. These tests pin:
 *
 *  - the URL shape each builder emits (path + params the explorers parse),
 *  - the breach window math (breach -30min .. +15min, last-hour fallback),
 *  - the scope hand-off (filterAttributes + seriesLabels + serviceIds),
 *  - that the existing metric-explorer link behavior is UNCHANGED,
 *  - the root-cause markdown attach point for all three links.
 */

type EvaluatorPrivate = {
  buildMetricExplorerDeepLink: (input: {
    monitor: Monitor;
    ctx: MetricCriteriaContext;
  }) => string | null;
  buildLogsExplorerDeepLink: (input: {
    monitor: Monitor;
    ctx: MetricCriteriaContext;
    monitorStep?: MonitorStep | undefined;
  }) => TelemetryExplorerDeepLink | null;
  buildTracesExplorerDeepLink: (input: {
    monitor: Monitor;
    ctx: MetricCriteriaContext;
    monitorStep?: MonitorStep | undefined;
  }) => TelemetryExplorerDeepLink | null;
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => string | null;
  formatScopeDroppedHint: (dropped: Array<string>) => string;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const BREACH_TIME: Date = new Date("2026-08-14T10:30:00.000Z");
const EXPECTED_WINDOW_START: string = "2026-08-14T10:00:00.000Z";
const EXPECTED_WINDOW_END: string = "2026-08-14T10:45:00.000Z";

const SERVICE_ID_A: string = "651a000000000000000000aa";
const SERVICE_ID_B: string = "651a000000000000000000bb";

function makeMonitor(projectId?: ObjectID): Monitor {
  const monitor: Monitor = new Monitor();
  if (projectId) {
    monitor.projectId = projectId;
  }
  return monitor;
}

function makeContext(
  overrides: Partial<MetricCriteriaContext> = {},
): MetricCriteriaContext {
  return {
    metricName: "container.cpu.time",
    alias: "a",
    unit: null,
    aggregationType: null,
    isFormula: false,
    filterAttributes: {
      "k8s.pod.name": "web-1",
      "http.status_code": 500,
    },
    groupBy: [],
    breachingSample: {
      value: 97,
      timestamp: BREACH_TIME,
      attributes: {},
    },
    seriesLabels: { "host.name": "prod-01" },
    ...overrides,
  };
}

function makeMetricMonitorStep(
  telemetryServiceIds: Array<ObjectID>,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.metricMonitor = {
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    rollingTime: RollingTime.Past1Minute,
    telemetryServiceIds,
  };
  return step;
}

function getQueryParams(url: string): URLSearchParams {
  return new URLSearchParams(url.split("?")[1] || "");
}

describe("MonitorCriteriaEvaluator - logs explorer deep link", () => {
  test("builds the /logs URL with the filters tuples the logs explorer parses", () => {
    const projectId: ObjectID = ObjectID.generate();
    const step: MonitorStep = makeMetricMonitorStep([
      new ObjectID(SERVICE_ID_A),
      new ObjectID(SERVICE_ID_B),
    ]);

    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildLogsExplorerDeepLink({
        monitor: makeMonitor(projectId),
        ctx: makeContext(),
        monitorStep: step,
      });

    expect(link).not.toBeNull();
    expect(
      link!.url.startsWith(
        `${DashboardClientUrl.toString()}/${projectId.toString()}/logs?`,
      ),
    ).toBe(true);

    const params: URLSearchParams = getQueryParams(link!.url);

    // Shape: Array<[facetKey, values[]]> — LogsViewer.readInitialUrlState.
    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["primaryEntityId", [SERVICE_ID_A, SERVICE_ID_B]],
      ["attributes.k8s.pod.name", ["web-1"]],
      ["attributes.http.status_code", ["500"]],
      ["attributes.host.name", ["prod-01"]],
    ]);

    expect(link!.dropped).toEqual([]);
  });

  test("carries the breach window as a Custom range (breach -30min .. +15min)", () => {
    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildLogsExplorerDeepLink({
        monitor: makeMonitor(ObjectID.generate()),
        ctx: makeContext(),
      });

    const params: URLSearchParams = getQueryParams(link!.url);

    expect(params.get("range")).toBe("Custom");
    expect(params.get("start")).toBe(EXPECTED_WINDOW_START);
    expect(params.get("end")).toBe(EXPECTED_WINDOW_END);
  });

  test("falls back to the last hour when there is no breaching sample", () => {
    const before: number = Date.now();
    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildLogsExplorerDeepLink({
        monitor: makeMonitor(ObjectID.generate()),
        ctx: makeContext({ breachingSample: undefined }),
      });
    const after: number = Date.now();

    const params: URLSearchParams = getQueryParams(link!.url);
    const start: number = new Date(params.get("start") as string).getTime();
    const end: number = new Date(params.get("end") as string).getTime();

    expect(end - start).toBe(60 * 60 * 1000);
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(after);
  });

  test("per-series labels override criteria filters on the same attribute key", () => {
    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildLogsExplorerDeepLink({
        monitor: makeMonitor(ObjectID.generate()),
        ctx: makeContext({
          filterAttributes: { "host.name": "any-host" },
          seriesLabels: { "host.name": "prod-01" },
        }),
      });

    const params: URLSearchParams = getQueryParams(link!.url);

    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["attributes.host.name", ["prod-01"]],
    ]);
  });

  test("non-primitive attribute values are not carried into the scope", () => {
    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildLogsExplorerDeepLink({
        monitor: makeMonitor(ObjectID.generate()),
        ctx: makeContext({
          filterAttributes: {
            "k8s.pod.name": "web-1",
            nested: { not: "carried" },
          },
          seriesLabels: undefined,
        }),
      });

    const params: URLSearchParams = getQueryParams(link!.url);

    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["attributes.k8s.pod.name", ["web-1"]],
    ]);
  });

  test("no monitor step means no service scope — attribute filters only", () => {
    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildLogsExplorerDeepLink({
        monitor: makeMonitor(ObjectID.generate()),
        ctx: makeContext(),
      });

    const params: URLSearchParams = getQueryParams(link!.url);
    const tuples: Array<[string, Array<string>]> = JSON.parse(
      params.get("filters") as string,
    );

    for (const [facetKey] of tuples) {
      expect(facetKey).not.toBe("primaryEntityId");
    }
  });

  test("returns null when the monitor has no project id", () => {
    expect(
      Evaluator.buildLogsExplorerDeepLink({
        monitor: makeMonitor(),
        ctx: makeContext(),
      }),
    ).toBeNull();
  });
});

describe("MonitorCriteriaEvaluator - traces explorer deep link", () => {
  test("builds the /traces URL with search tokens and service chips", () => {
    const projectId: ObjectID = ObjectID.generate();
    const step: MonitorStep = makeMetricMonitorStep([
      new ObjectID(SERVICE_ID_A),
    ]);

    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildTracesExplorerDeepLink({
        monitor: makeMonitor(projectId),
        ctx: makeContext(),
        monitorStep: step,
      });

    expect(link).not.toBeNull();
    expect(
      link!.url.startsWith(
        `${DashboardClientUrl.toString()}/${projectId.toString()}/traces?`,
      ),
    ).toBe(true);

    const params: URLSearchParams = getQueryParams(link!.url);

    // The traces search DSL: @<attribute>:<value> tokens (TracesViewer.tsx).
    expect(params.get("search")).toBe(
      "@k8s.pod.name:web-1 @http.status_code:500 @host.name:prod-01",
    );

    // Shape: Array<[facetKey, value]> pairs — TracesViewer.readInitialUrlState.
    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["primaryEntityId", SERVICE_ID_A],
    ]);

    expect(params.get("range")).toBe("Custom");
    expect(params.get("start")).toBe(EXPECTED_WINDOW_START);
    expect(params.get("end")).toBe(EXPECTED_WINDOW_END);

    expect(link!.dropped).toEqual([]);
  });

  test("attribute values the search DSL cannot carry become filter chips", () => {
    const link: TelemetryExplorerDeepLink | null =
      Evaluator.buildTracesExplorerDeepLink({
        monitor: makeMonitor(ObjectID.generate()),
        ctx: makeContext({
          filterAttributes: { "cache.hit.ratio": "99%" },
          seriesLabels: undefined,
        }),
      });

    const params: URLSearchParams = getQueryParams(link!.url);

    expect(params.get("search")).toBeNull();
    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["attributes.cache.hit.ratio", "99%"],
    ]);
  });

  test("returns null when the monitor has no project id", () => {
    expect(
      Evaluator.buildTracesExplorerDeepLink({
        monitor: makeMonitor(),
        ctx: makeContext(),
      }),
    ).toBeNull();
  });
});

describe("MonitorCriteriaEvaluator - metric explorer deep link is unchanged", () => {
  test("still builds the /metrics/view URL from metricQueries + startTime/endTime", () => {
    const projectId: ObjectID = ObjectID.generate();

    const url: string | null = Evaluator.buildMetricExplorerDeepLink({
      monitor: makeMonitor(projectId),
      ctx: makeContext(),
    });

    expect(url).not.toBeNull();
    expect(
      url!.startsWith(
        `${DashboardClientUrl.toString()}/${projectId.toString()}/metrics/view?`,
      ),
    ).toBe(true);

    const params: URLSearchParams = getQueryParams(url!);

    /*
     * The metric link keeps its historical scope: the criteria's
     * filterAttributes with native types preserved (500 stays a number)
     * and NO per-series labels, NO service scope, NO range token.
     */
    expect(JSON.parse(params.get("metricQueries") as string)).toEqual([
      {
        metricName: "container.cpu.time",
        attributes: {
          "k8s.pod.name": "web-1",
          "http.status_code": 500,
        },
      },
    ]);

    expect(params.get("startTime")).toBe(EXPECTED_WINDOW_START);
    expect(params.get("endTime")).toBe(EXPECTED_WINDOW_END);
    expect(params.get("range")).toBeNull();
    expect(params.get("filters")).toBeNull();
    expect(params.get("search")).toBeNull();
  });

  test("still returns null without a project id", () => {
    expect(
      Evaluator.buildMetricExplorerDeepLink({
        monitor: makeMonitor(),
        ctx: makeContext(),
      }),
    ).toBeNull();
  });
});

describe("MonitorCriteriaEvaluator - root cause context carries all three links", () => {
  function makeCriteriaInstance(
    ctx: MetricCriteriaContext,
  ): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data!.filters = [
      {
        checkOn: CheckOn.MetricValue,
        filterType: undefined,
        value: undefined,
        metricCriteriaContext: ctx,
      },
    ];
    return instance;
  }

  test("appends metric, logs and traces links in that order", () => {
    const context: string | null = Evaluator.buildMetricRootCauseContext({
      criteriaInstance: makeCriteriaInstance(makeContext()),
      monitor: makeMonitor(ObjectID.generate()),
      monitorStep: makeMetricMonitorStep([new ObjectID(SERVICE_ID_A)]),
    });

    expect(context).not.toBeNull();
    expect(context).toContain("[Open metric in dashboard](");
    expect(context).toContain("[Open logs in dashboard](");
    expect(context).toContain("[Open traces in dashboard](");

    const metricIndex: number = context!.indexOf("[Open metric in dashboard](");
    const logsIndex: number = context!.indexOf("[Open logs in dashboard](");
    const tracesIndex: number = context!.indexOf("[Open traces in dashboard](");

    expect(metricIndex).toBeGreaterThan(-1);
    expect(logsIndex).toBeGreaterThan(metricIndex);
    expect(tracesIndex).toBeGreaterThan(logsIndex);

    // The evaluator-derived scope carries fully, so no partial-scope hint.
    expect(context).not.toContain("scope partially carried");
  });

  test("still emits sibling links when no monitor step is passed (backward compatible)", () => {
    const context: string | null = Evaluator.buildMetricRootCauseContext({
      criteriaInstance: makeCriteriaInstance(makeContext()),
      monitor: makeMonitor(ObjectID.generate()),
    });

    expect(context).toContain("[Open metric in dashboard](");
    expect(context).toContain("[Open logs in dashboard](");
    expect(context).toContain("[Open traces in dashboard](");
  });

  test("emits no links at all when the monitor has no project id", () => {
    const context: string | null = Evaluator.buildMetricRootCauseContext({
      criteriaInstance: makeCriteriaInstance(makeContext()),
      monitor: makeMonitor(),
    });

    expect(context).not.toBeNull();
    expect(context).not.toContain("[Open metric in dashboard](");
    expect(context).not.toContain("[Open logs in dashboard](");
    expect(context).not.toContain("[Open traces in dashboard](");
  });

  test("returns null when no filter carries a metric context", () => {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data!.filters = [
      {
        checkOn: CheckOn.MetricValue,
        filterType: undefined,
        value: undefined,
      },
    ];

    expect(
      Evaluator.buildMetricRootCauseContext({
        criteriaInstance: instance,
        monitor: makeMonitor(ObjectID.generate()),
      }),
    ).toBeNull();
  });
});

describe("MonitorCriteriaEvaluator - partial-scope hint formatting", () => {
  test("renders nothing when the scope carried fully", () => {
    expect(Evaluator.formatScopeDroppedHint([])).toBe("");
  });

  test("names the fields that were not applied", () => {
    expect(Evaluator.formatScopeDroppedHint(["severityTexts", "spanIds"])).toBe(
      " _(scope partially carried — not applied: severityTexts, spanIds)_",
    );
  });
});
