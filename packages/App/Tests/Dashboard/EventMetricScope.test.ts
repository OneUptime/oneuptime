import { describe, expect, test } from "@jest/globals";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import Dictionary from "Common/Types/Dictionary";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorStepMetricQueries from "Common/Utils/Monitor/MonitorStepMetricQueries";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { MetricInvestigationQueries } from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";
import {
  EventMetricScope,
  getEventMetricScope,
} from "../../FeatureSet/Dashboard/src/Utils/EventMetricScope";
import { EventRuleMonitor } from "../../FeatureSet/Dashboard/src/Utils/EventMetricThresholds";

/*
 * Issue #6265: an incident or alert whose snapshot was stored before it
 * kept its monitor's scope charts, from the monitor as it is now, what the
 * monitor reads - the cluster, host or fleet it watches - instead of the
 * metric for every resource in the project. A snapshot that keeps its scope
 * is charted as it is.
 */

const RULE_ID: string = "rule-1";

const queryOf: (data: {
  variable?: string;
  metricName?: string;
  attributes?: Dictionary<unknown>;
  groupBy?: Array<string>;
  aggregation?: MetricsAggregationType;
}) => MetricQueryConfigData = (data: {
  variable?: string;
  metricName?: string;
  attributes?: Dictionary<unknown>;
  groupBy?: Array<string>;
  aggregation?: MetricsAggregationType;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: data.variable || "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName || "pve_cpu_usage_ratio",
        aggegationType: data.aggregation || MetricsAggregationType.Avg,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      } as never,
      ...(data.groupBy ? { groupByAttributeKeys: data.groupBy } : {}),
    },
  };
};

const ruleOf: (id: string) => MonitorCriteriaInstance = (
  id: string,
): MonitorCriteriaInstance => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = { id: id } as unknown as MonitorCriteriaInstance["data"];
  return instance;
};

interface StepData {
  settings: Dictionary<unknown>;
  queryConfigs: Array<MetricQueryConfigData>;
  criteriaIds?: Array<string>;
}

const monitorOf: (
  monitorType: MonitorType,
  steps: Array<StepData>,
) => EventRuleMonitor = (
  monitorType: MonitorType,
  steps: Array<StepData>,
): EventRuleMonitor => {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps.map(
      (data: StepData, index: number): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.data = {
          id: `step-${index}`,
          monitorCriteria: {
            data: {
              monitorCriteriaInstanceArray: (data.criteriaIds || []).map(
                ruleOf,
              ),
            },
          },
          [MonitorStepMetricQueries.getStepKey(monitorType)!]: {
            ...data.settings,
            metricViewConfig: {
              queryConfigs: data.queryConfigs,
              formulaConfigs: [],
            },
          },
        } as unknown as MonitorStep["data"];
        return step;
      },
    ),
  } as unknown as MonitorSteps["data"];

  return { monitorType: monitorType, monitorSteps: monitorSteps };
};

const snapshotOf: (
  queryConfigs: Array<MetricQueryConfigData>,
  formulaConfigs?: Array<MetricFormulaConfigData>,
) => MetricInvestigationQueries = (
  queryConfigs: Array<MetricQueryConfigData>,
  formulaConfigs: Array<MetricFormulaConfigData> = [],
): MetricInvestigationQueries => {
  return { queryConfigs: queryConfigs, formulaConfigs: formulaConfigs };
};

const attributesOf: (scope: EventMetricScope, index?: number) => unknown = (
  scope: EventMetricScope,
  index: number = 0,
): unknown => {
  return scope.queries.queryConfigs[index]?.metricQueryData.filterData
    .attributes;
};

const PROXMOX: EventRuleMonitor = monitorOf(MonitorType.Proxmox, [
  {
    settings: {
      clusterIdentifier: "pve-prod",
      resourceFilters: { nodeName: "pve1" },
    },
    queryConfigs: [queryOf({})],
    criteriaIds: [RULE_ID],
  },
]);

describe("a snapshot stored before is narrowed to what its monitor watches now", () => {
  test("Proxmox: the cluster and node it watches, and the card can name the cluster", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [PROXMOX],
    });

    expect(attributesOf(scope)).toEqual({
      "resource.proxmox.cluster.name": "pve-prod",
      "pve.scope": "node",
      "pve.id": "pve1",
    });
    expect(scope.isFromMonitorNow).toBe(true);
    expect(scope.resourceName).toBe("pve-prod");
  });

  test("Host: the host, as ingest stores its name", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([
        queryOf({ metricName: "system.cpu.utilization" }),
      ]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [
        monitorOf(MonitorType.Host, [
          {
            settings: { hostIdentifier: "Web-01" },
            queryConfigs: [queryOf({ metricName: "system.cpu.utilization" })],
            criteriaIds: [RULE_ID],
          },
        ]),
      ],
    });

    expect(attributesOf(scope)).toEqual({ "resource.host.name": "web-01" });
    expect(scope.resourceName).toBe("Web-01");
  });

  test("Kubernetes: the event's own series filter stays beside the cluster and namespace", () => {
    const grouped: MetricQueryConfigData = queryOf({
      metricName: "k8s.node.cpu.utilization",
      groupBy: ["resource.k8s.node.name"],
    });

    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([
        // Narrowed to its own series by the page (MetricSeriesScope).
        queryOf({
          metricName: "k8s.node.cpu.utilization",
          groupBy: ["resource.k8s.node.name"],
          attributes: { "resource.k8s.node.name": "node-7" },
        }),
      ]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [
        monitorOf(MonitorType.Kubernetes, [
          {
            settings: {
              clusterIdentifier: "prod",
              resourceFilters: { namespace: "payments" },
            },
            queryConfigs: [grouped],
            criteriaIds: [RULE_ID],
          },
        ]),
      ],
    });

    expect(attributesOf(scope)).toEqual({
      "resource.k8s.node.name": "node-7",
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
    });
  });

  test("IoT: the fleet whatever its case, as the operator the worker reads it with", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({ metricName: "iot.temperature" })]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [
        monitorOf(MonitorType.IoTDevice, [
          {
            settings: { fleetIdentifier: "Sensors" },
            queryConfigs: [queryOf({ metricName: "iot.temperature" })],
            criteriaIds: [RULE_ID],
          },
        ]),
      ],
    });

    const fleet: unknown = (attributesOf(scope) as Dictionary<unknown>)[
      "resource.iot.fleet.name"
    ];
    expect(fleet).toBeInstanceOf(Wildcard);
    expect((fleet as Wildcard<string>).values).toEqual(["Sensors"]);
  });

  test("a filter of the query's own that the monitor overrides is read as the monitor reads it", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([
        queryOf({ attributes: { "resource.proxmox.cluster.name": "typed" } }),
      ]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [PROXMOX],
    });

    expect(
      (attributesOf(scope) as Dictionary<unknown>)[
        "resource.proxmox.cluster.name"
      ],
    ).toBe("pve-prod");
  });

  test("each query by what it compares; formulas, and queries no step reads, as they are", () => {
    const formula: MetricFormulaConfigData = {
      metricAliasData: {
        metricVariable: "c",
        title: "",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricFormulaData: { metricFormula: "a / b" },
    };
    const gone: MetricQueryConfigData = queryOf({
      variable: "b",
      metricName: "pve_memory_usage_bytes",
    });

    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({}), gone], [formula]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [PROXMOX],
    });

    expect(attributesOf(scope, 0)).toMatchObject({
      "resource.proxmox.cluster.name": "pve-prod",
    });
    expect(scope.queries.queryConfigs[1]).toBe(gone);
    expect(scope.queries.formulaConfigs).toEqual([formula]);
  });

  test("the step holding the event's criteria is read first", () => {
    const monitor: EventRuleMonitor = monitorOf(MonitorType.Proxmox, [
      {
        settings: { clusterIdentifier: "pve-lab" },
        queryConfigs: [queryOf({})],
        criteriaIds: ["other-rule"],
      },
      {
        settings: { clusterIdentifier: "pve-prod" },
        queryConfigs: [queryOf({})],
        criteriaIds: [RULE_ID],
      },
    ]);

    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [monitor],
    });

    expect(attributesOf(scope)).toEqual({
      "resource.proxmox.cluster.name": "pve-prod",
    });
  });

  test("a criteria gone from the monitor: any of its steps that reads the metric", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: null,
      createdCriteriaId: "deleted-rule",
      monitors: [PROXMOX],
    });

    expect(attributesOf(scope)).toMatchObject({
      "resource.proxmox.cluster.name": "pve-prod",
    });
  });

  test("an event on several monitors: the first whose step reads the metric", () => {
    const other: EventRuleMonitor = monitorOf(MonitorType.Host, [
      {
        settings: { hostIdentifier: "web-01" },
        queryConfigs: [queryOf({ metricName: "system.cpu.utilization" })],
      },
    ]);

    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [other, PROXMOX],
    });

    expect(attributesOf(scope)).toMatchObject({
      "resource.proxmox.cluster.name": "pve-prod",
    });
    expect(scope.resourceName).toBe("pve-prod");
  });
});

describe("a snapshot stored since keeps its scope beside its queries", () => {
  test("each query is charted with the scope it was read with, whatever the monitor watches now", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: [{ "resource.proxmox.cluster.name": "pve-old" }],
      createdCriteriaId: RULE_ID,
      monitors: [PROXMOX],
    });

    expect(attributesOf(scope)).toEqual({
      "resource.proxmox.cluster.name": "pve-old",
    });
    // Nothing to say: this is what the check read.
    expect(scope.isFromMonitorNow).toBe(false);
    expect(scope.resourceName).toBe("");
  });

  test("its scope sits beside the event's own series filter and the query's own filters", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([
        queryOf({
          metricName: "k8s.node.cpu.utilization",
          groupBy: ["resource.k8s.node.name"],
          attributes: {
            "own.key": "x",
            "resource.k8s.node.name": "node-7",
          },
        }),
      ]),
      storedScopes: [{ "resource.k8s.cluster.name": "prod" }],
      createdCriteriaId: RULE_ID,
      monitors: [],
    });

    expect(attributesOf(scope)).toEqual({
      "own.key": "x",
      "resource.k8s.node.name": "node-7",
      "resource.k8s.cluster.name": "prod",
    });
  });

  test("with or without its monitor: the monitor is not needed", () => {
    const withMonitor: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: [{ "resource.host.name": "web-01" }],
      createdCriteriaId: RULE_ID,
      monitors: [PROXMOX],
    });
    const withoutMonitor: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: [{ "resource.host.name": "web-01" }],
      createdCriteriaId: undefined,
      monitors: [],
    });

    expect(withMonitor.queries).toEqual(withoutMonitor.queries);
    expect(attributesOf(withoutMonitor)).toEqual({
      "resource.host.name": "web-01",
    });
  });

  test("a scope that is an operator is charted as that operator", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([queryOf({ metricName: "iot.temperature" })]),
      storedScopes: [
        { "resource.iot.fleet.name": new Wildcard<string>(["Sensors"]) },
      ],
      createdCriteriaId: RULE_ID,
      monitors: [],
    });

    expect(
      (attributesOf(scope) as Dictionary<unknown>)["resource.iot.fleet.name"],
    ).toBeInstanceOf(Wildcard);
  });
});

describe("charted as it is", () => {
  const unchanged: (input: {
    snapshotQueries: MetricInvestigationQueries;
    storedScopes?: Array<Dictionary<unknown> | null>;
    monitors: Array<EventRuleMonitor>;
    createdCriteriaId?: string;
  }) => void = (input: {
    snapshotQueries: MetricInvestigationQueries;
    storedScopes?: Array<Dictionary<unknown> | null>;
    monitors: Array<EventRuleMonitor>;
    createdCriteriaId?: string;
  }): void => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: input.snapshotQueries,
      storedScopes: input.storedScopes || null,
      createdCriteriaId:
        input.createdCriteriaId === undefined
          ? RULE_ID
          : input.createdCriteriaId,
      monitors: input.monitors,
    });

    expect(scope.queries).toBe(input.snapshotQueries);
    expect(scope.isFromMonitorNow).toBe(false);
    expect(scope.resourceName).toBe("");
  };

  test("a snapshot that keeps its scope, and its monitor added nothing", () => {
    unchanged({
      snapshotQueries: snapshotOf([queryOf({})]),
      storedScopes: [null],
      monitors: [PROXMOX],
    });
  });

  test("no monitor to read: deleted, or the reader may not read it", () => {
    unchanged({ snapshotQueries: snapshotOf([queryOf({})]), monitors: [] });
  });

  test("a Metrics monitor, which adds nothing to its queries' own filters", () => {
    unchanged({
      snapshotQueries: snapshotOf([
        queryOf({ attributes: { "resource.service.name": "api" } }),
      ]),
      monitors: [
        monitorOf(MonitorType.Metrics, [
          {
            settings: {},
            queryConfigs: [
              queryOf({ attributes: { "resource.service.name": "api" } }),
            ],
            criteriaIds: [RULE_ID],
          },
        ]),
      ],
    });
  });

  test.each([
    ["another metric", queryOf({ metricName: "pve_memory_usage_bytes" })],
    [
      "another aggregation",
      queryOf({ aggregation: MetricsAggregationType.Max }),
    ],
    ["another grouping", queryOf({ groupBy: ["id"] })],
  ])(
    "a monitor whose step reads %s now",
    (_name: string, stepQuery: MetricQueryConfigData) => {
      unchanged({
        snapshotQueries: snapshotOf([queryOf({})]),
        monitors: [
          monitorOf(MonitorType.Proxmox, [
            {
              settings: { clusterIdentifier: "pve-prod" },
              queryConfigs: [stepQuery],
              criteriaIds: [RULE_ID],
            },
          ]),
        ],
      });
    },
  );

  test("a snapshot that already reads what the monitor adds", () => {
    unchanged({
      snapshotQueries: snapshotOf([
        queryOf({
          attributes: {
            "resource.proxmox.cluster.name": "pve-prod",
            "pve.scope": "node",
            "pve.id": "pve1",
          },
        }),
      ]),
      monitors: [PROXMOX],
    });
  });

  test("a monitor whose steps cannot be read, or hold another type's settings", () => {
    unchanged({
      snapshotQueries: snapshotOf([queryOf({})]),
      monitors: [
        { monitorType: MonitorType.Proxmox, monitorSteps: undefined },
        {
          monitorType: MonitorType.Proxmox,
          monitorSteps: monitorOf(MonitorType.Host, [
            {
              settings: { hostIdentifier: "web-01" },
              queryConfigs: [queryOf({})],
            },
          ]).monitorSteps,
        },
      ],
    });
  });

  test("what is not a query is left where it is", () => {
    const scope: EventMetricScope = getEventMetricScope({
      snapshotQueries: snapshotOf([null as never, queryOf({})]),
      storedScopes: null,
      createdCriteriaId: RULE_ID,
      monitors: [PROXMOX],
    });

    expect(scope.queries.queryConfigs[0]).toBeNull();
    expect(attributesOf(scope, 1)).toMatchObject({
      "resource.proxmox.cluster.name": "pve-prod",
    });
  });
});

describe("whatever an old snapshot and its monitor hold (seeded)", () => {
  test("each narrowed query reads its own filters and what the monitor adds; nothing handed in changes", () => {
    const random: SeededRandom = seededRandom(6265);
    const types: Array<MonitorType> =
      MonitorStepMetricQueries.getMonitorTypes();

    for (let round: number = 0; round < 300; round++) {
      const monitorType: MonitorType = types[random(types.length)]!;
      const own: Dictionary<unknown> = {};
      if (random(2) === 0) {
        own[`own.${random(3)}`] = `v${random(3)}`;
      }

      const snapshotQuery: MetricQueryConfigData = queryOf({
        metricName: `metric.${random(2)}`,
        ...(Object.keys(own).length > 0 ? { attributes: { ...own } } : {}),
      });
      const stepQuery: MetricQueryConfigData = queryOf({
        metricName: `metric.${random(2)}`,
      });
      const settings: Dictionary<unknown> = {
        hostIdentifier: `host-${random(3)}`,
        clusterIdentifier: `cluster-${random(3)}`,
        fleetIdentifier: `fleet-${random(3)}`,
        vcenterIdentifier: `vc-${random(3)}`,
        arrayIdentifier: `array-${random(3)}`,
        cloudIdentifier: `cloud-${random(3)}`,
      };
      const monitor: EventRuleMonitor = monitorOf(monitorType, [
        { settings, queryConfigs: [stepQuery], criteriaIds: [RULE_ID] },
      ]);
      const snapshot: MetricInvestigationQueries = snapshotOf([snapshotQuery]);
      const stepSettings: () => unknown = (): unknown => {
        return (
          monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!
            .data as unknown as Dictionary<unknown>
        )[MonitorStepMetricQueries.getStepKey(monitorType)!];
      };
      const before: string = JSON.stringify({
        snapshot,
        settings: stepSettings(),
      });

      const scope: EventMetricScope = getEventMetricScope({
        snapshotQueries: snapshot,
        storedScopes: null,
        createdCriteriaId: RULE_ID,
        monitors: [monitor],
      });

      const sameMetric: boolean =
        snapshotQuery.metricQueryData.filterData.metricName ===
        stepQuery.metricQueryData.filterData.metricName;
      const read: Dictionary<unknown> =
        (MonitorStepMetricQueries.getReadAttributes({
          monitorType,
          settings: MonitorStepMetricQueries.getSettings({
            monitorType,
            monitorStep:
              monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
          })!,
          queryConfig: stepQuery,
        }) as Dictionary<unknown> | undefined) || {};

      if (!sameMetric || Object.keys(read).length === 0) {
        expect(scope.queries).toBe(snapshot);
        expect(scope.isFromMonitorNow).toBe(false);
      } else {
        expect(attributesOf(scope)).toEqual({ ...own, ...read });
        expect(scope.isFromMonitorNow).toBe(true);
      }

      expect(JSON.stringify({ snapshot, settings: stepSettings() })).toBe(
        before,
      );
    }
  });
});
