/*
 * MonitorCriteriaEvaluator (rendered below) reaches the template renderer,
 * which loads the native isolated-vm addon. Nothing here uses the sandbox
 * and the prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import Dictionary from "../../../../../Types/Dictionary";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../../Types/JSON";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  getKubernetesAlertTemplateById,
  KubernetesAlertTemplate,
} from "../../../../../Types/Monitor/KubernetesAlertTemplates";
import MetricCriteriaContext, {
  MetricComponent,
} from "../../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../../../Types/ObjectID";
import PlatformMetricUnitUtil from "../../../../../Utils/Monitor/PlatformMetricUnitUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE CRITERIA HANDS THE EMAIL ABOUT A RATIO FORMULA.
 *
 * The shipped Kubernetes ratio templates ("High Node Memory Utilization":
 * k8s.node.memory.usage ÷ k8s.node.allocatable_memory × 100, grouped by
 * node) evaluate a FORMULA. Three facts about it used to be lost between
 * MetricMonitorCriteria and the rendered alert:
 *
 *  - its NAME. `metricName` on a formula's context is the expression
 *    "(used_mem / alloc_mem) * 100", which is not something to title a
 *    list with; the template gave the formula a real legend, and
 *    `displayName` is where it now travels. A query titled with just its
 *    own alias has no name worth promoting, so it gets none.
 *  - the series' WORST VALUE, in the unit the criteria compared in
 *    (`sampleValueRange`), so a per-series "Affected Resources" row can be
 *    valued without re-deriving it from raw datapoints.
 *  - the COMPONENTS' units. The template leaves both queries without a
 *    legendUnit, so their values are in the metric's own unit — bytes —
 *    and without the native-unit fallback they printed as bare 12-digit
 *    numbers beneath a formula that read "88.82%".
 *
 * These tests drive the real template's metric view config through
 * MetricMonitorCriteria.evaluateAllSeries with a hand-built worker
 * response, then render the resulting context through the evaluator's
 * metric root cause, as the email does.
 */

const NODE_KEY: string = "resource.k8s.node.name";
const CLUSTER: string = "oneuptime-test";
const FORMULA_ALIAS: string = "node_memory_utilization";
const FORMULA_LEGEND: string = "Node Memory Utilization (%)";
const FORMULA_EXPRESSION: string = "(used_mem / alloc_mem) * 100";

const TIMESTAMPS: Array<Date> = [0, 1, 2].map((minute: number) => {
  return new Date(Date.UTC(2026, 8, 25, 10, minute, 0));
});

type NodeSample = {
  node: string;
  usedBytes: Array<number>;
  allocatableBytes: number;
};

const HOT_NODE: NodeSample = {
  node: "gke-gke-test-cluster-default-pool-662f6819-1nd7",
  allocatableBytes: 257760964608,
  // 86.26% .. 88.82% of allocatable
  usedBytes: [222344608010, 226000000000, 228943289000],
};

const COOL_NODE: NodeSample = {
  node: "gke-gke-test-cluster-db-pool-3e2bfa3b-3am6",
  allocatableBytes: 191483559936,
  // ~52%
  usedBytes: [99000000000, 100000000000, 99800000000],
};

function utilization(node: NodeSample): Array<number> {
  return node.usedBytes.map((used: number) => {
    return (used / node.allocatableBytes) * 100;
  });
}

function templateStep(): MonitorStep {
  const template: KubernetesAlertTemplate | undefined =
    getKubernetesAlertTemplateById("k8s-high-memory");

  if (!template) {
    throw new Error("k8s-high-memory template missing");
  }

  return template.getMonitorStep({
    clusterIdentifier: CLUSTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "oneuptime-test - High Node Memory Utilization",
  } as unknown as Parameters<KubernetesAlertTemplate["getMonitorStep"]>[0]);
}

/*
 * A step carrying a hand-edited copy of the template's view config, for
 * the cases the template itself does not exercise.
 */
function stepWithViewConfig(metricViewConfig: MetricsViewConfig): MonitorStep {
  const step: MonitorStep = templateStep();
  step.data!.kubernetesMonitor!.metricViewConfig = metricViewConfig;
  return step;
}

function templateViewConfig(): MetricsViewConfig {
  return JSON.parse(
    JSON.stringify(MonitorStep.getMetricsViewConfig(templateStep())),
  ) as MetricsViewConfig;
}

function queryRow(input: {
  node: string;
  timestamp: Date;
  value: number;
}): AggregateModel {
  // A per-series query row keeps one raw datapoint's full attribute map.
  return {
    timestamp: input.timestamp,
    value: input.value,
    attributes: {
      [NODE_KEY]: input.node,
      "resource.k8s.cluster.name": CLUSTER,
    },
  } as unknown as AggregateModel;
}

function formulaRow(input: {
  node: string;
  timestamp: Date;
  value: number;
}): AggregateModel {
  // A formula row carries only its group attributes.
  return {
    timestamp: input.timestamp,
    value: input.value,
    attributes: { [NODE_KEY]: input.node },
  } as unknown as AggregateModel;
}

/*
 * The worker's response for the template: one series per node, aligned
 * [used_mem, alloc_mem, node_memory_utilization].
 */
function workerResponse(input: {
  nodes: Array<NodeSample>;
  nativeUnitsByMetricName?: Dictionary<string> | undefined;
}): MetricMonitorResponse {
  const seriesBreakdown: Array<MetricSeriesResult> = input.nodes.map(
    (node: NodeSample): MetricSeriesResult => {
      const used: AggregatedResult = {
        data: TIMESTAMPS.map((timestamp: Date, i: number) => {
          return queryRow({
            node: node.node,
            timestamp,
            value: node.usedBytes[i]!,
          });
        }),
      };
      const allocatable: AggregatedResult = {
        data: TIMESTAMPS.map((timestamp: Date) => {
          return queryRow({
            node: node.node,
            timestamp,
            value: node.allocatableBytes,
          });
        }),
      };
      const ratio: Array<number> = utilization(node);
      const formula: AggregatedResult = {
        data: TIMESTAMPS.map((timestamp: Date, i: number) => {
          return formulaRow({
            node: node.node,
            timestamp,
            value: ratio[i]!,
          });
        }),
      };

      return {
        fingerprint: `fp-${node.node}`,
        labels: { [NODE_KEY]: node.node } as JSONObject,
        aggregatedResults: [used, allocatable, formula],
      };
    },
  );

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    seriesBreakdown: seriesBreakdown,
    ...(input.nativeUnitsByMetricName
      ? { nativeUnitsByMetricName: input.nativeUnitsByMetricName }
      : {}),
  } as MetricMonitorResponse;
}

/*
 * What the exporters declare for the two metrics: bytes, in UCUM.
 */
const DECLARED_UNITS: Dictionary<string> = {
  "k8s.node.memory.usage": "By",
  "k8s.node.allocatable_memory": "By",
};

function criteria(input: {
  alias: string;
  value: number;
  thresholdUnit?: string | undefined;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: input.value,
    metricMonitorOptions: {
      metricAlias: input.alias,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
      ...(input.thresholdUnit ? { thresholdUnit: input.thresholdUnit } : {}),
    },
  } as CriteriaFilter;
}

async function evaluate(input: {
  criteriaFilter: CriteriaFilter;
  response: MetricMonitorResponse;
  monitorStep?: MonitorStep | undefined;
}): Promise<Array<MetricSeriesEvaluationResult>> {
  return MetricMonitorCriteria.evaluateAllSeries({
    dataToProcess: input.response,
    criteriaFilter: input.criteriaFilter,
    monitorStep: input.monitorStep || templateStep(),
  });
}

function forNode(
  results: Array<MetricSeriesEvaluationResult>,
  node: NodeSample,
): MetricSeriesEvaluationResult {
  const result: MetricSeriesEvaluationResult | undefined = results.find(
    (r: MetricSeriesEvaluationResult) => {
      return r.labels[NODE_KEY] === node.node;
    },
  );

  expect(result).toBeDefined();
  return result as MetricSeriesEvaluationResult;
}

describe("MetricMonitorCriteria context.displayName", () => {
  test("a formula criteria carries the formula's legend", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE, COOL_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    const hot: MetricCriteriaContext = forNode(results, HOT_NODE).context;

    expect(forNode(results, HOT_NODE).rootCause).not.toBeNull();
    expect(hot.displayName).toBe(FORMULA_LEGEND);
    expect(hot.isFormula).toBe(true);
    // metricName is the expression, which is exactly why displayName exists.
    expect(hot.metricName).toBe(FORMULA_EXPRESSION);
    expect(hot.formulaExpression).toBe(FORMULA_EXPRESSION);
    expect(hot.unit).toBe("%");
  });

  test("a series that did not breach carries the same name", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE, COOL_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    const cool: MetricSeriesEvaluationResult = forNode(results, COOL_NODE);

    expect(cool.rootCause).toBeNull();
    expect(cool.context.displayName).toBe(FORMULA_LEGEND);
  });

  /*
   * The template titles each query with its own alias ("used_mem"). That
   * is not a name worth promoting over the metric name.
   */
  test("a query titled with just its alias has no display name", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: "used_mem", value: 1 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    const context: MetricCriteriaContext = forNode(results, HOT_NODE).context;

    expect(context.displayName).toBeUndefined();
    expect(Object.keys(context)).not.toContain("displayName");
    expect(context.metricName).toBe("k8s.node.memory.usage");
  });

  test("a query with a real legend carries it", async () => {
    const viewConfig: MetricsViewConfig = templateViewConfig();
    const usedQuery: MetricQueryConfigData = viewConfig.queryConfigs[0]!;
    usedQuery.metricAliasData!.legend = "Node Memory Used";

    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: "used_mem", value: 1 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
      monitorStep: stepWithViewConfig(viewConfig),
    });

    expect(forNode(results, HOT_NODE).context.displayName).toBe(
      "Node Memory Used",
    );
  });

  describe("getAliasDisplayName", () => {
    test("prefers the legend over the title", () => {
      expect(
        MetricMonitorCriteria.getAliasDisplayName({
          aliasData: {
            metricVariable: "a",
            title: "Memory",
            description: undefined,
            legend: "Node Memory Utilization (%)",
            legendUnit: "%",
          },
          metricAlias: "a",
        }),
      ).toBe("Node Memory Utilization (%)");
    });

    test("falls back to the title when the legend is empty or just the alias", () => {
      expect(
        MetricMonitorCriteria.getAliasDisplayName({
          aliasData: {
            metricVariable: "a",
            title: "Memory Used",
            description: undefined,
            legend: "   ",
            legendUnit: undefined,
          },
          metricAlias: "a",
        }),
      ).toBe("Memory Used");
      expect(
        MetricMonitorCriteria.getAliasDisplayName({
          aliasData: {
            metricVariable: "used_mem",
            title: "Memory Used",
            description: undefined,
            legend: "USED_MEM",
            legendUnit: undefined,
          },
          metricAlias: "used_mem",
        }),
      ).toBe("Memory Used");
    });

    test("trims what it returns", () => {
      expect(
        MetricMonitorCriteria.getAliasDisplayName({
          aliasData: {
            metricVariable: "a",
            title: undefined,
            description: undefined,
            legend: "  Memory Used  ",
            legendUnit: undefined,
          },
          metricAlias: "a",
        }),
      ).toBe("Memory Used");
    });

    test("undefined when title and legend both only repeat the alias", () => {
      expect(
        MetricMonitorCriteria.getAliasDisplayName({
          aliasData: {
            metricVariable: "container_restarts",
            title: "container_restarts",
            description: "container_restarts",
            legend: " Container_Restarts ",
            legendUnit: undefined,
          },
          metricAlias: "container_restarts",
        }),
      ).toBeUndefined();
    });

    test("undefined with no alias data at all", () => {
      expect(
        MetricMonitorCriteria.getAliasDisplayName({
          aliasData: undefined,
          metricAlias: "a",
        }),
      ).toBeUndefined();
    });
  });
});

describe("MetricMonitorCriteria context.sampleValueRange", () => {
  test("is the series' smallest and largest sample in the formula's %", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE, COOL_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    const hotRatio: Array<number> = utilization(HOT_NODE);
    const coolRatio: Array<number> = utilization(COOL_NODE);

    expect(forNode(results, HOT_NODE).context.sampleValueRange).toEqual({
      min: Math.min(...hotRatio),
      max: Math.max(...hotRatio),
    });
    expect(
      forNode(results, HOT_NODE).context.sampleValueRange!.max,
    ).toBeCloseTo(88.82, 2);
    expect(
      forNode(results, HOT_NODE).context.sampleValueRange!.min,
    ).toBeCloseTo(86.26, 2);

    // Set whether or not the series breached.
    expect(forNode(results, COOL_NODE).rootCause).toBeNull();
    expect(forNode(results, COOL_NODE).context.sampleValueRange).toEqual({
      min: Math.min(...coolRatio),
      max: Math.max(...coolRatio),
    });
  });

  test("is in the native unit when the criteria has no threshold unit", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: "used_mem", value: 1 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    const context: MetricCriteriaContext = forNode(results, HOT_NODE).context;

    expect(context.unit).toBe("By");
    expect(context.sampleValueRange).toEqual({
      min: 222344608010,
      max: 228943289000,
    });
  });

  /*
   * A threshold typed in GB converts every sample into GB before the
   * comparison. The range must be in that same unit, or a row valued
   * from it would print bytes under a "GB" label.
   */
  test("is converted into the threshold unit, like the breaching samples", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({
        alias: "used_mem",
        value: 225,
        thresholdUnit: "GB",
      }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    const result: MetricSeriesEvaluationResult = forNode(results, HOT_NODE);
    const context: MetricCriteriaContext = result.context;

    expect(result.rootCause).not.toBeNull();
    expect(context.unit).toBe("GB");
    expect(context.sampleValueRange!.min).toBeCloseTo(222.34460801, 6);
    expect(context.sampleValueRange!.max).toBeCloseTo(228.943289, 6);
    expect(
      (context.breachingSamples || []).map((sample: { value: number }) => {
        return sample.value;
      }),
    ).toEqual([226, context.sampleValueRange!.max]);
  });

  test("is absent when the series has no samples", async () => {
    const response: MetricMonitorResponse = workerResponse({
      nodes: [HOT_NODE],
      nativeUnitsByMetricName: DECLARED_UNITS,
    });
    response.seriesBreakdown![0]!.aggregatedResults = [
      { data: [] },
      { data: [] },
      { data: [] },
    ];

    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response,
    });

    expect(forNode(results, HOT_NODE).context.sampleValueRange).toBeUndefined();
  });
});

describe("MetricMonitorCriteria formula components' units", () => {
  function componentsFor(
    results: Array<MetricSeriesEvaluationResult>,
  ): Array<MetricComponent> {
    return forNode(results, HOT_NODE).context.components || [];
  }

  test("a query without a legendUnit takes the metric's native unit", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    expect(componentsFor(results)).toEqual([
      {
        alias: "used_mem",
        name: "k8s.node.memory.usage",
        unit: "By",
        isFormula: false,
      },
      {
        alias: "alloc_mem",
        name: "k8s.node.allocatable_memory",
        unit: "By",
        isFormula: false,
      },
    ]);
  });

  /*
   * The worker builds the map with PlatformMetricUnitUtil, which lets the
   * Kubernetes catalog overrule the declared unit — "bytes" for both.
   */
  test("the catalog-overlaid map the worker sends works the same way", async () => {
    const nativeUnits: Dictionary<string> =
      PlatformMetricUnitUtil.buildUnitsByMetricName({
        platform: "kubernetes",
        metricNames: ["k8s.node.memory.usage", "k8s.node.allocatable_memory"],
        declaredUnitsByMetricName: new Map<string, string>(
          Object.entries(DECLARED_UNITS),
        ),
      });

    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: nativeUnits,
      }),
    });

    expect(
      componentsFor(results).map((component: MetricComponent) => {
        return component.unit;
      }),
    ).toEqual(["bytes", "bytes"]);
  });

  test("a query's own legendUnit wins over the native unit", async () => {
    const viewConfig: MetricsViewConfig = templateViewConfig();
    viewConfig.queryConfigs[0]!.metricAliasData!.legendUnit = "GB";

    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
      monitorStep: stepWithViewConfig(viewConfig),
    });

    expect(
      componentsFor(results).map((component: MetricComponent) => {
        return [component.alias, component.unit];
      }),
    ).toEqual([
      ["used_mem", "GB"],
      ["alloc_mem", "By"],
    ]);
  });

  test("the native-unit map is keyed by the lowercased metric name", async () => {
    const viewConfig: MetricsViewConfig = templateViewConfig();
    viewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName =
      "K8s.Node.Memory.Usage";

    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
      monitorStep: stepWithViewConfig(viewConfig),
    });

    expect(componentsFor(results)[0]).toEqual({
      alias: "used_mem",
      name: "K8s.Node.Memory.Usage",
      unit: "By",
      isFormula: false,
    });
  });

  test("no legendUnit and no native unit leaves the component unitless", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({ nodes: [HOT_NODE] }),
    });

    expect(
      componentsFor(results).map((component: MetricComponent) => {
        return component.unit;
      }),
    ).toEqual([null, null]);
  });

  test("breaching samples record each component's value at the breach", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({
        nodes: [HOT_NODE],
        nativeUnitsByMetricName: DECLARED_UNITS,
      }),
    });

    const context: MetricCriteriaContext = forNode(results, HOT_NODE).context;

    expect(context.breachingSamples).toHaveLength(3);
    expect(context.breachingSamples![2]!.componentValues).toEqual([
      { alias: "used_mem", value: 228943289000 },
      { alias: "alloc_mem", value: 257760964608 },
    ]);
  });
});

/*
 * The rendered half: the context above, through the evaluator's metric
 * root cause, the "Metric Details" + "Breaching Samples" block of the
 * email.
 */
type EvaluatorPrivate = {
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => string | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

function renderRootCause(context: MetricCriteriaContext): string {
  const filter: CriteriaFilter = {
    ...criteria({ alias: FORMULA_ALIAS, value: 85 }),
    metricCriteriaContext: context,
  };

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [filter],
    incidents: [],
    alerts: [],
    name: "High Memory - Utilization > 85%",
    description: "High Memory - Utilization > 85%",
    id: ObjectID.generate().toString(),
  };

  const rendered: string | null = Evaluator.buildMetricRootCauseContext({
    criteriaInstance: instance,
    monitor: new Monitor(),
  });

  expect(rendered).not.toBeNull();
  return rendered as string;
}

async function renderedHotNode(
  nativeUnitsByMetricName: Dictionary<string> = DECLARED_UNITS,
): Promise<string> {
  const results: Array<MetricSeriesEvaluationResult> = await evaluate({
    criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
    response: workerResponse({
      nodes: [HOT_NODE, COOL_NODE],
      nativeUnitsByMetricName: nativeUnitsByMetricName,
    }),
  });

  return renderRootCause(forNode(results, HOT_NODE).context);
}

/*
 * The lines of the Breaching Samples item whose title is `timestamp`:
 * its "1. `<iso>` — **<value>**" line and the detail bullets under it.
 */
const LIST_ITEM_LINE: RegExp = /^\d+\. /;
const DETAIL_LINE: RegExp = /^ {3,4}- /;

function sampleItemLines(text: string, timestamp: Date): Array<string> {
  const iso: string = timestamp.toISOString();
  const lines: Array<string> = text.split("\n");
  const index: number = lines.findIndex((line: string) => {
    return LIST_ITEM_LINE.test(line) && line.includes(iso);
  });

  expect(index).toBeGreaterThan(-1);

  const itemLines: Array<string> = [lines[index] as string];

  for (const line of lines.slice(index + 1)) {
    if (!DETAIL_LINE.test(line)) {
      break;
    }

    itemLines.push(line);
  }

  return itemLines;
}

describe("MonitorCriteriaEvaluator metric root cause for a ratio formula", () => {
  test("the Components list names each component's unit", async () => {
    const text: string = await renderedHotNode();

    expect(text).toContain(
      [
        "- Components:",
        "  - `used_mem` = `k8s.node.memory.usage` — unit: Bytes",
        "  - `alloc_mem` = `k8s.node.allocatable_memory` — unit: Bytes",
      ].join("\n"),
    );
    expect(text).toContain("- Unit: Percent");
    expect(text).toContain(`- Formula: \`${FORMULA_EXPRESSION}\``);
  });

  test("the catalog's 'bytes' reads the same as the exporter's 'By'", async () => {
    const text: string = await renderedHotNode(
      PlatformMetricUnitUtil.buildUnitsByMetricName({
        platform: "kubernetes",
        metricNames: ["k8s.node.memory.usage", "k8s.node.allocatable_memory"],
        declaredUnitsByMetricName: new Map<string, string>(
          Object.entries(DECLARED_UNITS),
        ),
      }),
    );

    expect(text).toContain(
      "  - `used_mem` = `k8s.node.memory.usage` — unit: Bytes",
    );
    expect(text).toContain(
      "  - `alloc_mem` = `k8s.node.allocatable_memory` — unit: Bytes",
    );
  });

  test("each breaching sample reads in % with its components in GB", async () => {
    const text: string = await renderedHotNode();

    const first: Array<string> = sampleItemLines(text, TIMESTAMPS[0]!);
    const last: Array<string> = sampleItemLines(text, TIMESTAMPS[2]!);

    expect(first[0]).toBe(
      `1. \`${TIMESTAMPS[0]!.toISOString()}\` — **86.26%**`,
    );
    expect(first).toContain("   - `used_mem`: 222 GB");
    expect(first).toContain("   - `alloc_mem`: 258 GB");

    expect(last[0]).toBe(`3. \`${TIMESTAMPS[2]!.toISOString()}\` — **88.82%**`);
    expect(last).toContain("   - `used_mem`: 229 GB");
    expect(last).toContain("   - `alloc_mem`: 258 GB");
  });

  test("no raw byte count reaches the text", async () => {
    const text: string = await renderedHotNode();

    expect(text).not.toContain("228943289000");
    expect(text).not.toContain("257760964608");
    expect(text).not.toMatch(/\b\d{10,}\b/);
  });

  test("without any unit for the components their digits are all that is left", async () => {
    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: FORMULA_ALIAS, value: 85 }),
      response: workerResponse({ nodes: [HOT_NODE] }),
    });

    const text: string = renderRootCause(forNode(results, HOT_NODE).context);

    /*
     * The control for the fallback above: this is the email the native
     * unit fixes — bare bytes under a percentage.
     */
    expect(text).toContain("  - `used_mem` = `k8s.node.memory.usage`\n");
    expect(sampleItemLines(text, TIMESTAMPS[2]!)).toContain(
      "   - `used_mem`: 228943289000",
    );
  });
});

/*
 * THE SAMPLE'S ATTRIBUTE MAP IS NOT A VALUE.
 *
 * Every row the telemetry worker hands the criteria — the SQL path a
 * grouped generic Metrics monitor takes (MetricService.aggregateBy with
 * groupByAttributeKeys) as well as the raw-row path of the platform
 * monitors — carries its attributes NESTED, under one `attributes` key.
 * MetricMonitorCriteria.extractLabelAttributes copies that key onto the
 * breaching sample as-is, and the evaluator reads it that way when it
 * names a platform resource (getSampleRawAttributes unwraps it). The
 * Breaching Samples list does not: it String()s every top-level value, so
 * each sample of a grouped Metrics monitor's email says
 *
 *     - `attributes`: `[object Object]`
 *
 * instead of naming the host the sample came from.
 */
describe("MonitorCriteriaEvaluator metric root cause for a grouped Metrics monitor", () => {
  function genericGroupedStep(): MonitorStep {
    const metricViewConfig: MetricsViewConfig = {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: "a",
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: { metricName: "system.memory.usage" },
            groupByAttributeKeys: ["host.name"],
          },
        } as unknown as MetricQueryConfigData,
      ],
      formulaConfigs: [],
    };

    const step: MonitorStep = new MonitorStep();
    step.data = {
      id: ObjectID.generate().toString(),
      monitorCriteria: { data: undefined } as never,
    } as unknown as MonitorStep["data"];
    step.data!.metricMonitor = {
      metricViewConfig: metricViewConfig,
    } as unknown as NonNullable<MonitorStep["data"]>["metricMonitor"];

    return step;
  }

  test("a breaching sample names its host, never `[object Object]`", async () => {
    // What MetricService.aggregateBy returns for one host's bucket.
    const row: AggregateModel = {
      timestamp: TIMESTAMPS[0]!,
      value: 17179869184,
      attributes: { "host.name": "prod-db-01" },
    } as unknown as AggregateModel;

    const response: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricResult: [{ data: [row] }],
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      seriesBreakdown: [
        {
          fingerprint: "fp-prod-db-01",
          labels: { "host.name": "prod-db-01" } as JSONObject,
          aggregatedResults: [{ data: [row] }],
        },
      ],
      nativeUnitsByMetricName: { "system.memory.usage": "By" },
    } as MetricMonitorResponse;

    const results: Array<MetricSeriesEvaluationResult> = await evaluate({
      criteriaFilter: criteria({ alias: "a", value: 1000000000 }),
      response: response,
      monitorStep: genericGroupedStep(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.rootCause).not.toBeNull();

    const text: string = renderRootCause(results[0]!.context);
    const item: Array<string> = sampleItemLines(text, TIMESTAMPS[0]!);

    expect(item[0]).toBe(
      `1. \`${TIMESTAMPS[0]!.toISOString()}\` — **17.2 GB**`,
    );
    expect(text).not.toContain("[object Object]");
    expect(item.join("\n")).toContain("prod-db-01");
  });
});
