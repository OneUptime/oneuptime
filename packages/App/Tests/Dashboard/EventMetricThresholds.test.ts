import { describe, expect, test } from "@jest/globals";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { getProxmoxAlertTemplateById } from "Common/Types/Monitor/ProxmoxAlertTemplates";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { MetricInvestigationQueries } from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";
import { MetricInvestigationThreshold } from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationThresholds";
import {
  EventRuleMonitor,
  getEventMetricThresholds,
  getMetricIdentityKey,
} from "../../FeatureSet/Dashboard/src/Utils/EventMetricThresholds";

/*
 * Issue #6250: the value the monitor compared the metric with when it
 * opened an incident or alert - found in whichever step holds the criteria
 * the event names, and drawn only while that step still compares the
 * event's metric.
 */

const queryOf: (
  variable: string,
  changes?: Partial<{
    metricName: string;
    aggregation: MetricsAggregationType;
    groupBy: Array<string>;
    attributes: Record<string, unknown>;
  }>,
) => MetricQueryConfigData = (
  variable: string,
  changes?: Partial<{
    metricName: string;
    aggregation: MetricsAggregationType;
    groupBy: Array<string>;
    attributes: Record<string, unknown>;
  }>,
): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: changes?.metricName || `metric.${variable}`,
        aggegationType: changes?.aggregation || MetricsAggregationType.Avg,
        ...(changes?.attributes ? { attributes: changes.attributes } : {}),
      } as never,
      groupByAttributeKeys: changes?.groupBy || ["host.name"],
    },
  };
};

const formulaOf: (variable: string, text: string) => MetricFormulaConfigData = (
  variable: string,
  text: string,
): MetricFormulaConfigData => {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricFormulaData: { metricFormula: text },
  };
};

const ruleOf: (data: {
  id: string;
  alias?: string;
  value?: number;
  filterType?: FilterType;
}) => MonitorCriteriaInstance = (data: {
  id: string;
  alias?: string;
  value?: number;
  filterType?: FilterType;
}): MonitorCriteriaInstance => {
  const rule: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  rule.data = {
    id: data.id,
    name: `Rule ${data.id}`,
    description: "",
    monitorStatusId: undefined,
    filterCondition: "Any" as never,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        filterType: data.filterType || FilterType.GreaterThan,
        value: data.value === undefined ? 90 : data.value,
        metricMonitorOptions: { metricAlias: data.alias || "a" },
      },
    ],
    incidents: [{ id: "i", title: "t", description: "d" } as never],
    alerts: [],
    createIncidents: true,
    createAlerts: false,
  };
  return rule;
};

const stepOf: (data: {
  rules: Array<MonitorCriteriaInstance>;
  queryConfigs?: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
}) => MonitorStep = (data: {
  rules: Array<MonitorCriteriaInstance>;
  queryConfigs?: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
}): MonitorStep => {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: { monitorCriteriaInstanceArray: data.rules } },
    metricMonitor: {
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: data.queryConfigs || [queryOf("a")],
        formulaConfigs: data.formulaConfigs || [],
      },
    },
  } as unknown as MonitorStep["data"];
  return step;
};

const monitorOf: (...steps: Array<MonitorStep>) => EventRuleMonitor = (
  ...steps: Array<MonitorStep>
): EventRuleMonitor => {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = { monitorStepsInstanceArray: steps };
  return { monitorType: MonitorType.Metrics, monitorSteps };
};

const SNAPSHOT: MetricInvestigationQueries = {
  queryConfigs: [queryOf("a")],
  formulaConfigs: [],
};

const valuesOf: (
  thresholds: Array<MetricInvestigationThreshold>,
) => Array<[string, number]> = (
  thresholds: Array<MetricInvestigationThreshold>,
): Array<[string, number]> => {
  return thresholds.map(
    (threshold: MetricInvestigationThreshold): [string, number] => {
      return [threshold.metricVariable, threshold.value];
    },
  );
};

describe("finding the rule that opened the event", () => {
  test("in a monitor with one step", () => {
    expect(
      getEventMetricThresholds({
        createdCriteriaId: "rule-1",
        monitors: [monitorOf(stepOf({ rules: [ruleOf({ id: "rule-1" })] }))],
        snapshotQueries: SNAPSHOT,
      }),
    ).toEqual([
      {
        metricVariable: "a",
        value: 90,
        unit: undefined,
        name: "Rule rule-1",
        filterType: FilterType.GreaterThan,
        isForecast: false,
        color: "#ef4444",
        shade: "above",
        onlyAtInterval: null,
      },
    ]);
  });

  test("in whichever of several steps holds it, and only that criteria", () => {
    const monitor: EventRuleMonitor = monitorOf(
      stepOf({
        rules: [ruleOf({ id: "rule-1", value: 50 })],
        queryConfigs: [queryOf("a", { metricName: "cpu" })],
      }),
      stepOf({
        rules: [
          ruleOf({ id: "rule-2", value: 80 }),
          ruleOf({ id: "rule-3", value: 95 }),
        ],
      }),
    );

    expect(
      valuesOf(
        getEventMetricThresholds({
          createdCriteriaId: "rule-3",
          monitors: [monitor],
          snapshotQueries: SNAPSHOT,
        }),
      ),
    ).toEqual([["a", 95]]);
  });

  test("on whichever of the event's monitors holds it", () => {
    expect(
      valuesOf(
        getEventMetricThresholds({
          createdCriteriaId: "rule-2",
          monitors: [
            monitorOf(stepOf({ rules: [ruleOf({ id: "rule-1", value: 10 })] })),
            monitorOf(stepOf({ rules: [ruleOf({ id: "rule-2", value: 20 })] })),
          ],
          snapshotQueries: SNAPSHOT,
        }),
      ),
    ).toEqual([["a", 20]]);
  });

  test.each([
    ["no criteria named", undefined],
    ["an empty criteria id", "  "],
    ["a criteria no step holds any more", "deleted"],
  ])(
    "draws nothing for %s",
    (_name: string, criteriaId: string | undefined) => {
      expect(
        getEventMetricThresholds({
          createdCriteriaId: criteriaId,
          monitors: [monitorOf(stepOf({ rules: [ruleOf({ id: "rule-1" })] }))],
          snapshotQueries: SNAPSHOT,
        }),
      ).toEqual([]);
    },
  );

  test("draws nothing without a monitor, or for a rule with no number", () => {
    expect(
      getEventMetricThresholds({
        createdCriteriaId: "rule-1",
        monitors: [],
        snapshotQueries: SNAPSHOT,
      }),
    ).toEqual([]);
    expect(
      getEventMetricThresholds({
        createdCriteriaId: "rule-1",
        monitors: [
          monitorOf(
            stepOf({
              rules: [
                ruleOf({
                  id: "rule-1",
                  filterType: FilterType.AnomalouslyHigh,
                }),
              ],
            }),
          ),
        ],
        snapshotQueries: SNAPSHOT,
      }),
    ).toEqual([]);
  });
});

describe("a monitor edited since the event", () => {
  const editedTo: (
    queryConfigs: Array<MetricQueryConfigData>,
    formulaConfigs?: Array<MetricFormulaConfigData>,
    alias?: string,
  ) => Array<MetricInvestigationThreshold> = (
    queryConfigs: Array<MetricQueryConfigData>,
    formulaConfigs?: Array<MetricFormulaConfigData>,
    alias?: string,
  ): Array<MetricInvestigationThreshold> => {
    return getEventMetricThresholds({
      createdCriteriaId: "rule-1",
      monitors: [
        monitorOf(
          stepOf({
            rules: [ruleOf({ id: "rule-1", ...(alias ? { alias } : {}) })],
            queryConfigs,
            formulaConfigs: formulaConfigs || [],
          }),
        ),
      ],
      snapshotQueries: {
        queryConfigs: [queryOf("a"), queryOf("b")],
        formulaConfigs: [formulaOf("c", "a / b * 100")],
      },
    });
  };

  test.each([
    ["another metric", { metricName: "other" }],
    ["another aggregation", { aggregation: MetricsAggregationType.Max }],
    ["another grouping", { groupBy: ["service.name"] }],
  ])(
    "draws no line once its query reads %s",
    (_name: string, changes: Record<string, unknown>) => {
      expect(editedTo([queryOf("a", changes), queryOf("b")])).toEqual([]);
    },
  );

  test("keeps the line through a change of filters: the event's own series filter is not the monitor's", () => {
    expect(
      valuesOf(
        editedTo([
          queryOf("a", { attributes: { "service.name": "api" } }),
          queryOf("b"),
        ]),
      ),
    ).toEqual([["a", 90]]);
  });

  test("a formula's line goes with a change to it or to a query it reads", () => {
    expect(
      valuesOf(
        editedTo(
          [queryOf("a"), queryOf("b")],
          [formulaOf("c", "a / b * 100")],
          "c",
        ),
      ),
    ).toEqual([["c", 90]]);
    expect(
      editedTo([queryOf("a"), queryOf("b")], [formulaOf("c", "a / b")], "c"),
    ).toEqual([]);
    expect(
      editedTo(
        [queryOf("a"), queryOf("b", { metricName: "x" })],
        [formulaOf("c", "a / b * 100")],
        "c",
      ),
    ).toEqual([]);
  });

  test("a query the event never charted draws nothing", () => {
    expect(
      getEventMetricThresholds({
        createdCriteriaId: "rule-1",
        monitors: [
          monitorOf(
            stepOf({
              rules: [ruleOf({ id: "rule-1", alias: "z" })],
              queryConfigs: [queryOf("a"), queryOf("z")],
            }),
          ),
        ],
        snapshotQueries: SNAPSHOT,
      }),
    ).toEqual([]);
  });
});

describe("an infrastructure monitor's incident", () => {
  test("Proxmox High Node Memory: the line at 85 on the share, through the event's own node filter", () => {
    const step: MonitorStep = getProxmoxAlertTemplateById(
      "pve-node-high-memory",
    )!.getMonitorStep({
      clusterIdentifier: "pve",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Proxmox",
    });

    const criteriaId: string =
      step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!.data!
        .id;

    // The snapshot as the incident page shows it: narrowed to node/pve1.
    const snapshot: MetricInvestigationQueries =
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: {
          startAndEndDate: null,
          queryConfigs:
            step.data!.proxmoxMonitor!.metricViewConfig.queryConfigs,
          formulaConfigs:
            step.data!.proxmoxMonitor!.metricViewConfig.formulaConfigs,
        },
        seriesLabels: { id: "node/pve1" },
      })!;

    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = { monitorStepsInstanceArray: [step] };

    expect(
      getEventMetricThresholds({
        createdCriteriaId: criteriaId,
        monitors: [{ monitorType: MonitorType.Proxmox, monitorSteps }],
        snapshotQueries: snapshot,
      }),
    ).toEqual([
      expect.objectContaining({
        metricVariable: "node_memory_utilization",
        value: 85,
        name: "High Node Memory - Utilization > 85%",
        shade: "above",
      }),
    ]);
  });
});

describe("what a series compares", () => {
  test("a query: its metric, aggregation, grouping and rate, not its filters", () => {
    const base: MetricInvestigationQueries = {
      queryConfigs: [queryOf("a")],
      formulaConfigs: [],
    };
    const filtered: MetricInvestigationQueries = {
      queryConfigs: [queryOf("a", { attributes: { "host.name": "web-01" } })],
      formulaConfigs: [],
    };

    expect(getMetricIdentityKey(base, "a")).toBe(
      getMetricIdentityKey(filtered, "a"),
    );
    expect(getMetricIdentityKey(base, "a")).not.toBe(
      getMetricIdentityKey(
        {
          queryConfigs: [{ ...queryOf("a"), transformAsRate: true }],
          formulaConfigs: [],
        },
        "a",
      ),
    );
    // Grouping keys in any order are the same grouping.
    expect(
      getMetricIdentityKey(
        {
          queryConfigs: [queryOf("a", { groupBy: ["x", "y"] })],
          formulaConfigs: [],
        },
        "a",
      ),
    ).toBe(
      getMetricIdentityKey(
        {
          queryConfigs: [queryOf("a", { groupBy: ["y", "x"] })],
          formulaConfigs: [],
        },
        "a",
      ),
    );
    expect(getMetricIdentityKey(base, "missing")).toBeNull();
  });

  test("never says two different metrics are the same (seeded)", () => {
    const random: SeededRandom = seededRandom(6250);
    const NAMES: Array<string> = ["cpu", "mem", "disk", "net"];
    const AGGREGATIONS: Array<MetricsAggregationType> = [
      MetricsAggregationType.Avg,
      MetricsAggregationType.Sum,
      MetricsAggregationType.Max,
    ];

    for (let round: number = 0; round < 300; round++) {
      const first: MetricQueryConfigData = queryOf("a", {
        metricName: NAMES[random(NAMES.length)]!,
        aggregation: AGGREGATIONS[random(AGGREGATIONS.length)]!,
      });
      const second: MetricQueryConfigData = queryOf("a", {
        metricName: NAMES[random(NAMES.length)]!,
        aggregation: AGGREGATIONS[random(AGGREGATIONS.length)]!,
      });

      const isSame: boolean =
        first.metricQueryData.filterData.metricName ===
          second.metricQueryData.filterData.metricName &&
        first.metricQueryData.filterData.aggegationType ===
          second.metricQueryData.filterData.aggegationType;

      expect(
        getMetricIdentityKey(
          { queryConfigs: [first], formulaConfigs: [] },
          "a",
        ) ===
          getMetricIdentityKey(
            { queryConfigs: [second], formulaConfigs: [] },
            "a",
          ),
      ).toBe(isSame);
    }
  });
});
