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
import { JSONObject } from "../../../../Types/JSON";
import Dictionary from "../../../../Types/Dictionary";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "../../../../Utils/Metrics/MetricExplorerUrl";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";
import { describe, expect, test } from "@jest/globals";

import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
// The root cause builders write MarkdownText; these tests read its text.
function textOf(markdown: MarkdownText | null): string | null {
  return markdown === null ? null : markdown.toString();
}

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
    monitorStep?: MonitorStep | undefined;
    metricResponse?: MetricMonitorResponse | null | undefined;
  }) => string | null;
  buildLogsExplorerDeepLink: (input: {
    monitor: Monitor;
    ctx: MetricCriteriaContext;
    monitorStep?: MonitorStep | undefined;
    metricResponse?: MetricMonitorResponse | null | undefined;
  }) => TelemetryExplorerDeepLink | null;
  buildTracesExplorerDeepLink: (input: {
    monitor: Monitor;
    ctx: MetricCriteriaContext;
    monitorStep?: MonitorStep | undefined;
    metricResponse?: MetricMonitorResponse | null | undefined;
  }) => TelemetryExplorerDeepLink | null;
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
    metricResponse?: MetricMonitorResponse | null | undefined;
  }) => MarkdownText | null;
  formatScopeDroppedHint: (dropped: Array<string>) => MarkdownText;
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

  /*
   * Issues #8026 and #8025: a series grouped by an attribute named like
   * what every object inherits is scoped by its own label, as any other.
   * The scope was a plain object written with a plain assignment, so a
   * label named __proto__ was dropped and the link showed every series'
   * logs.
   */
  test.each(INHERITED_PROPERTY_NAMES)(
    "a series label named %s scopes the link, over a criteria filter on the same key",
    (name: string) => {
      // As an incident's labels read back from JSON: own keys.
      const own: (record: Record<string, string>) => JSONObject = (
        record: Record<string, string>,
      ): JSONObject => {
        return JSON.parse(JSON.stringify(record)) as JSONObject;
      };

      const link: TelemetryExplorerDeepLink | null =
        Evaluator.buildLogsExplorerDeepLink({
          monitor: makeMonitor(ObjectID.generate()),
          ctx: makeContext({
            filterAttributes: own({ [name]: "any", "k8s.pod.name": "web-1" }),
            seriesLabels: own({ [name]: "prod-01" }),
          }),
        });

      const params: URLSearchParams = getQueryParams(link!.url);

      expect(JSON.parse(params.get("filters") as string)).toEqual([
        [`attributes.${name}`, ["prod-01"]],
        ["attributes.k8s.pod.name", ["web-1"]],
      ]);
    },
  );
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
    const context: string | null = textOf(
      Evaluator.buildMetricRootCauseContext({
        criteriaInstance: makeCriteriaInstance(makeContext()),
        monitor: makeMonitor(ObjectID.generate()),
        monitorStep: makeMetricMonitorStep([new ObjectID(SERVICE_ID_A)]),
      }),
    );

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
    const context: string | null = textOf(
      Evaluator.buildMetricRootCauseContext({
        criteriaInstance: makeCriteriaInstance(makeContext()),
        monitor: makeMonitor(ObjectID.generate()),
      }),
    );

    expect(context).toContain("[Open metric in dashboard](");
    expect(context).toContain("[Open logs in dashboard](");
    expect(context).toContain("[Open traces in dashboard](");
  });

  test("emits no links at all when the monitor has no project id", () => {
    const context: string | null = textOf(
      Evaluator.buildMetricRootCauseContext({
        criteriaInstance: makeCriteriaInstance(makeContext()),
        monitor: makeMonitor(),
      }),
    );

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
      textOf(
        Evaluator.buildMetricRootCauseContext({
          criteriaInstance: instance,
          monitor: makeMonitor(ObjectID.generate()),
        }),
      ),
    ).toBeNull();
  });
});

describe("MonitorCriteriaEvaluator - partial-scope hint formatting", () => {
  test("renders nothing when the scope carried fully", () => {
    expect(Evaluator.formatScopeDroppedHint([]).toString()).toBe("");
  });

  test("names the fields that were not applied", () => {
    expect(
      Evaluator.formatScopeDroppedHint(["severityTexts", "spanIds"]).toString(),
    ).toBe(
      " _(scope partially carried — not applied: severityTexts, spanIds)_",
    );
  });
});

/*
 * A RESOURCE MONITOR'S LINKS OPEN WHAT IT READ (#10451).
 *
 * A Host, Docker, Podman or IoT Device monitor reads its metric narrowed to
 * its host, containers or fleet, and says so on its response
 * (MetricMonitorResponse.queryAttributes). Its links used to open the
 * metric for every host, and logs and spans by the metric's own attributes
 * (a Windows service's `name`), which no log line or span carries. Each
 * link is read back here as its explorer reads it: the metric explorer's
 * own parser for `metricQueries`, the logs explorer's `filters` tuples and
 * the traces explorer's `search` tokens.
 */
describe("MonitorCriteriaEvaluator - a resource monitor's links (#10451)", () => {
  const HOST: string = "web-01";

  interface LinkInput {
    monitor: Monitor;
    ctx: MetricCriteriaContext;
    monitorStep?: MonitorStep | undefined;
    metricResponse: MetricMonitorResponse;
  }

  function queryOf(data: {
    variable: string;
    metricName: string;
    attributes?: JSONObject;
  }): MetricQueryConfigData {
    return {
      metricAliasData: {
        metricVariable: data.variable,
        title: undefined,
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: data.metricName,
          attributes: data.attributes || {},
        },
      },
    } as MetricQueryConfigData;
  }

  function responseOf(data: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs?: Array<MetricFormulaConfigData>;
    queryAttributes?: Array<Dictionary<unknown> | undefined>;
    queryServiceIds?: Array<string>;
  }): MetricMonitorResponse {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: {
        queryConfigs: data.queryConfigs,
        formulaConfigs: data.formulaConfigs || [],
      },
      metricResult: [],
      ...(data.queryAttributes
        ? { queryAttributes: data.queryAttributes }
        : {}),
      ...(data.queryServiceIds
        ? { queryServiceIds: data.queryServiceIds }
        : {}),
    } as MetricMonitorResponse;
  }

  function monitorOf(monitorType: MonitorType): Monitor {
    const monitor: Monitor = makeMonitor(ObjectID.generate());
    monitor.monitorType = monitorType;
    return monitor;
  }

  function stepOf(monitorType: MonitorType, data: JSONObject): MonitorStep {
    const step: MonitorStep = new MonitorStep();
    const config: JSONObject = {
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      rollingTime: RollingTime.Past5Minutes,
      ...data,
    };

    switch (monitorType) {
      case MonitorType.Host:
        step.data!.hostMonitor = config as never;
        break;
      case MonitorType.Docker:
        step.data!.dockerMonitor = config as never;
        break;
      case MonitorType.Podman:
        step.data!.podmanMonitor = config as never;
        break;
      case MonitorType.IoTDevice:
        step.data!.iotMonitor = config as never;
        break;
      default:
        step.data!.metricMonitor = config as never;
    }

    return step;
  }

  function criteriaOf(ctx: MetricCriteriaContext): MonitorCriteriaInstance {
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

  // The metric explorer's own reading of the link's queries.
  function metricQueriesOf(url: string): Array<SerializedMetricQuery> {
    return MetricExplorerUrl.parseMetricQueriesParam(
      getQueryParams(url).get("metricQueries") || "",
    );
  }

  // The logs explorer's `filters`: [facetKey, values[]] tuples.
  function logsFiltersOf(url: string): Array<[string, Array<string>]> {
    const raw: string | null = getQueryParams(url).get("filters");
    return raw ? JSON.parse(raw) : [];
  }

  describe("a Windows service's monitor, as Create Monitor makes it: Spooler on web-01", () => {
    const spooler: MetricQueryConfigData = queryOf({
      variable: "service_status",
      metricName: "windows.service.status",
      attributes: { name: "Spooler" },
    });

    const ctx: MetricCriteriaContext = makeContext({
      metricName: "windows.service.status",
      alias: "service_status",
      filterAttributes: { name: "Spooler" },
      seriesLabels: undefined,
    });

    const input: LinkInput = {
      monitor: monitorOf(MonitorType.Host),
      ctx: ctx,
      monitorStep: stepOf(MonitorType.Host, { hostIdentifier: HOST }),
      metricResponse: responseOf({
        queryConfigs: [spooler],
        // What monitorHost read: the service, on the host.
        queryAttributes: [{ name: "Spooler", "resource.host.name": HOST }],
      }),
    };

    test("Open metric charts Spooler on web-01, not on every host", () => {
      expect(
        metricQueriesOf(Evaluator.buildMetricExplorerDeepLink(input)!),
      ).toEqual([
        {
          metricName: "windows.service.status",
          attributes: { name: "Spooler", "resource.host.name": HOST },
        },
      ]);
    });

    test("Open logs reads web-01's logs, not logs whose own `name` is Spooler", () => {
      const link: TelemetryExplorerDeepLink =
        Evaluator.buildLogsExplorerDeepLink(input)!;

      expect(logsFiltersOf(link.url)).toEqual([
        ["attributes.resource.host.name", [HOST]],
      ]);
      expect(link.dropped).toEqual([]);
      expect(getQueryParams(link.url).get("range")).toBe("Custom");
    });

    test("Open traces reads web-01's spans, not spans named Spooler", () => {
      const link: TelemetryExplorerDeepLink =
        Evaluator.buildTracesExplorerDeepLink(input)!;
      const params: URLSearchParams = getQueryParams(link.url);

      expect(params.get("search")).toBe(`@resource.host.name:${HOST}`);
      expect(params.get("filters")).toBeNull();
      expect(link.dropped).toEqual([]);
    });

    test("the root cause carries all three, with no partial-scope hint", () => {
      const context: string = textOf(
        Evaluator.buildMetricRootCauseContext({
          criteriaInstance: criteriaOf(ctx),
          ...input,
        }),
      )!;

      expect(context).toContain("[Open metric in dashboard](");
      expect(context).toContain("[Open logs in dashboard](");
      expect(context).toContain("[Open traces in dashboard](");
      expect(context).not.toContain("scope partially carried");
    });
  });

  test("a systemd unit's logs are its journal lines on its host", () => {
    const unitAttributes: JSONObject = {
      "resource.systemd.unit.name": "nginx.service",
      "systemd.unit.active_state": "active",
    };

    const link: TelemetryExplorerDeepLink = Evaluator.buildLogsExplorerDeepLink(
      {
        monitor: monitorOf(MonitorType.Host),
        ctx: makeContext({
          metricName: "systemd.unit.state",
          alias: "unit_active",
          filterAttributes: unitAttributes,
          seriesLabels: undefined,
        }),
        monitorStep: stepOf(MonitorType.Host, { hostIdentifier: HOST }),
        metricResponse: responseOf({
          queryConfigs: [
            queryOf({
              variable: "unit_active",
              metricName: "systemd.unit.state",
              attributes: unitAttributes,
            }),
          ],
          queryAttributes: [{ ...unitAttributes, "resource.host.name": HOST }],
        }),
      },
    )!;

    expect(logsFiltersOf(link.url)).toEqual([
      ["attributes.resource.host.name", [HOST]],
      ["attributes.systemd.unit.name", ["nginx.service"]],
    ]);
  });

  test("a CPU monitor of every host, grouped by host: the host whose series breached", () => {
    const input: LinkInput = {
      monitor: monitorOf(MonitorType.Host),
      ctx: makeContext({
        metricName: "system.cpu.utilization",
        alias: "cpu",
        filterAttributes: { state: "user" },
        seriesLabels: { "resource.host.name": "web-07" },
      }),
      monitorStep: stepOf(MonitorType.Host, { hostIdentifier: "" }),
      // Nothing added: a monitor of every host is read for every host.
      metricResponse: responseOf({
        queryConfigs: [
          queryOf({
            variable: "cpu",
            metricName: "system.cpu.utilization",
            attributes: { state: "user" },
          }),
        ],
        queryAttributes: [{ state: "user" }],
      }),
    };

    expect(
      metricQueriesOf(Evaluator.buildMetricExplorerDeepLink(input)!),
    ).toEqual([
      { metricName: "system.cpu.utilization", attributes: { state: "user" } },
    ]);
    expect(
      logsFiltersOf(Evaluator.buildLogsExplorerDeepLink(input)!.url),
    ).toEqual([["attributes.resource.host.name", ["web-07"]]]);
    expect(
      getQueryParams(Evaluator.buildTracesExplorerDeepLink(input)!.url).get(
        "search",
      ),
    ).toBe("@resource.host.name:web-07");
  });

  test("a monitor of every host, ungrouped: the window alone, no host and no `state`", () => {
    const input: LinkInput = {
      monitor: monitorOf(MonitorType.Host),
      ctx: makeContext({
        metricName: "system.cpu.utilization",
        alias: "cpu",
        filterAttributes: { state: "user" },
        seriesLabels: undefined,
      }),
      monitorStep: stepOf(MonitorType.Host, { hostIdentifier: "" }),
      metricResponse: responseOf({
        queryConfigs: [
          queryOf({
            variable: "cpu",
            metricName: "system.cpu.utilization",
            attributes: { state: "user" },
          }),
        ],
        queryAttributes: [{ state: "user" }],
      }),
    };

    const logs: URLSearchParams = getQueryParams(
      Evaluator.buildLogsExplorerDeepLink(input)!.url,
    );
    const traces: URLSearchParams = getQueryParams(
      Evaluator.buildTracesExplorerDeepLink(input)!.url,
    );

    expect(logs.get("filters")).toBeNull();
    expect(logs.get("range")).toBe("Custom");
    expect(traces.get("search")).toBeNull();
    expect(traces.get("filters")).toBeNull();
  });

  describe.each([
    [MonitorType.Docker, "docker"],
    [MonitorType.Podman, "podman"],
  ])("a %s monitor's links", (monitorType: MonitorType, runtime: string) => {
    function inputOf(containerName: string): LinkInput {
      return {
        monitor: monitorOf(monitorType),
        ctx: makeContext({
          metricName: "container.restarts",
          alias: "restarts",
          filterAttributes: {},
          seriesLabels: undefined,
        }),
        monitorStep: stepOf(monitorType, {
          hostIdentifier: "dock-01",
          containerFilters: containerName ? { containerName } : {},
        }),
        // What monitorDocker / monitorPodman read.
        metricResponse: responseOf({
          queryConfigs: [
            queryOf({ variable: "restarts", metricName: "container.restarts" }),
          ],
          queryAttributes: [
            {
              "resource.host.name": "dock-01",
              "resource.container.runtime": runtime,
              ...(containerName
                ? { "resource.container.name": containerName }
                : {}),
            },
          ],
        }),
      };
    }

    test("Open metric charts the containers it read: host, runtime and container", () => {
      expect(
        metricQueriesOf(Evaluator.buildMetricExplorerDeepLink(inputOf("web"))!),
      ).toEqual([
        {
          metricName: "container.restarts",
          attributes: {
            "resource.host.name": "dock-01",
            "resource.container.runtime": runtime,
            "resource.container.name": "web",
          },
        },
      ]);
    });

    test("Open logs: the host's container logs, and it says the container is not applied", () => {
      const link: TelemetryExplorerDeepLink =
        Evaluator.buildLogsExplorerDeepLink(inputOf("web"))!;

      expect(logsFiltersOf(link.url)).toEqual([
        ["attributes.resource.host.name", ["dock-01"]],
        ["attributes.resource.container.runtime", [runtime]],
      ]);
      expect(link.dropped).toEqual(["resource.container.name"]);
    });

    test("Open traces: the host's spans, and the same word on the container", () => {
      const link: TelemetryExplorerDeepLink =
        Evaluator.buildTracesExplorerDeepLink(inputOf("web"))!;

      expect(getQueryParams(link.url).get("search")).toBe(
        "@resource.host.name:dock-01",
      );
      expect(link.dropped).toEqual(["resource.container.name"]);
    });

    test("with no container filter, nothing is left out", () => {
      expect(Evaluator.buildLogsExplorerDeepLink(inputOf(""))!.dropped).toEqual(
        [],
      );
      expect(
        Evaluator.buildTracesExplorerDeepLink(inputOf(""))!.dropped,
      ).toEqual([]);
    });

    test("the root cause says, beside both links, what they could not narrow to", () => {
      const input: LinkInput = inputOf("web");
      const context: string = textOf(
        Evaluator.buildMetricRootCauseContext({
          criteriaInstance: criteriaOf(input.ctx),
          ...input,
        }),
      )!;

      expect(
        context.split(
          "_(scope partially carried — not applied: resource.container.name)_",
        ).length - 1,
      ).toBe(2);
    });
  });

  test("an IoT Device monitor: the fleet it read, case aside, and logs by the fleet's name", () => {
    const input: LinkInput = {
      monitor: monitorOf(MonitorType.IoTDevice),
      ctx: makeContext({
        metricName: "temperature",
        alias: "temperature",
        filterAttributes: {},
        seriesLabels: { "device.id": "dev-17" },
      }),
      monitorStep: stepOf(MonitorType.IoTDevice, {
        fleetIdentifier: "Warehouse",
        resourceFilters: {},
      }),
      metricResponse: responseOf({
        queryConfigs: [
          queryOf({ variable: "temperature", metricName: "temperature" }),
        ],
        queryAttributes: [
          { "resource.iot.fleet.name": new Wildcard<string>(["Warehouse"]) },
        ],
      }),
    };

    const fleet: unknown = metricQueriesOf(
      Evaluator.buildMetricExplorerDeepLink(input)!,
    )[0]!.attributes?.["resource.iot.fleet.name"];

    // The explorer rebuilds the operator the worker read with.
    expect(fleet).toBeInstanceOf(Wildcard);
    expect((fleet as Wildcard<string>).values).toEqual(["Warehouse"]);

    const logs: TelemetryExplorerDeepLink =
      Evaluator.buildLogsExplorerDeepLink(input)!;

    expect(logsFiltersOf(logs.url)).toEqual([
      ["attributes.resource.iot.fleet.name", ["Warehouse"]],
    ]);
    expect(logs.dropped).toEqual(["device.id"]);
  });

  test("a formula of a Host monitor: every query it was computed from, on the host", () => {
    const user: MetricQueryConfigData = queryOf({
      variable: "a",
      metricName: "system.cpu.time",
      attributes: { state: "user" },
    });
    const system: MetricQueryConfigData = queryOf({
      variable: "b",
      metricName: "system.cpu.time",
      attributes: { state: "system" },
    });
    const formula: MetricFormulaConfigData = {
      metricAliasData: {
        metricVariable: "c",
        title: undefined,
        description: undefined,
        legend: "CPU Busy (%)",
        legendUnit: "%",
      },
      metricFormulaData: { metricFormula: "a + b" },
    } as MetricFormulaConfigData;

    const url: string = Evaluator.buildMetricExplorerDeepLink({
      monitor: monitorOf(MonitorType.Host),
      ctx: makeContext({
        metricName: "a + b",
        alias: "c",
        isFormula: true,
        filterAttributes: {},
        seriesLabels: undefined,
      }),
      monitorStep: stepOf(MonitorType.Host, {
        hostIdentifier: HOST,
        metricViewConfig: {
          queryConfigs: [user, system],
          formulaConfigs: [formula],
        },
      }),
      metricResponse: responseOf({
        queryConfigs: [user, system],
        formulaConfigs: [formula],
        queryAttributes: [
          { state: "user", "resource.host.name": HOST },
          { state: "system", "resource.host.name": HOST },
        ],
      }),
    })!;

    expect(
      metricQueriesOf(url).map((query: SerializedMetricQuery) => {
        return query.attributes;
      }),
    ).toEqual([
      { state: "user", "resource.host.name": HOST },
      { state: "system", "resource.host.name": HOST },
    ]);
    // The step's own queries are as they were.
    expect(user.metricQueryData.filterData.attributes).toEqual({
      state: "user",
    });
  });

  describe("a Metrics monitor's links", () => {
    const latency: MetricQueryConfigData = queryOf({
      variable: "a",
      metricName: "http.server.duration",
      attributes: { "http.route": "/checkout" },
    });

    test("Open metric is read for the services the monitor reads", () => {
      const url: string = Evaluator.buildMetricExplorerDeepLink({
        monitor: monitorOf(MonitorType.Metrics),
        ctx: makeContext({
          metricName: "http.server.duration",
          alias: "a",
          filterAttributes: { "http.route": "/checkout" },
        }),
        metricResponse: responseOf({
          queryConfigs: [latency],
          queryAttributes: [{ "http.route": "/checkout" }],
          queryServiceIds: [SERVICE_ID_A],
        }),
      })!;

      expect(metricQueriesOf(url)).toEqual([
        {
          metricName: "http.server.duration",
          attributes: { "http.route": "/checkout" },
          serviceIds: [SERVICE_ID_A],
        },
      ]);
    });

    test("its logs and traces keep the metric's own attributes: a span-derived metric shares its spans'", () => {
      const input: LinkInput = {
        monitor: monitorOf(MonitorType.Metrics),
        ctx: makeContext({
          metricName: "http.server.duration",
          alias: "a",
          filterAttributes: { "http.route": "/checkout" },
          seriesLabels: { "resource.host.name": "api-3" },
        }),
        monitorStep: makeMetricMonitorStep([new ObjectID(SERVICE_ID_A)]),
        metricResponse: responseOf({
          queryConfigs: [latency],
          queryAttributes: [{ "http.route": "/checkout" }],
          queryServiceIds: [SERVICE_ID_A],
        }),
      };

      expect(
        logsFiltersOf(Evaluator.buildLogsExplorerDeepLink(input)!.url),
      ).toEqual([
        ["primaryEntityId", [SERVICE_ID_A]],
        ["attributes.http.route", ["/checkout"]],
        ["attributes.resource.host.name", ["api-3"]],
      ]);
    });
  });

  test("a response that does not say what each query was read with changes nothing", () => {
    const url: string = Evaluator.buildMetricExplorerDeepLink({
      monitor: monitorOf(MonitorType.Host),
      ctx: makeContext({
        metricName: "windows.service.status",
        alias: "service_status",
        filterAttributes: { name: "Spooler" },
      }),
      metricResponse: responseOf({
        queryConfigs: [
          queryOf({
            variable: "service_status",
            metricName: "windows.service.status",
          }),
          queryOf({ variable: "other", metricName: "other" }),
        ],
        // One read for two queries: not lined up, so not read.
        queryAttributes: [{ "resource.host.name": HOST }],
      }),
    })!;

    expect(metricQueriesOf(url)[0]!.attributes).toEqual({ name: "Spooler" });
  });
});
