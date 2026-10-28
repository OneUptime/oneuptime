import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleReadResult,
  TelemetryAlertRuleRecovery,
  TelemetryAlertRuleShapeProblem,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { describe, expect, test } from "@jest/globals";

/*
 * A telemetry monitor's criteria, read as one rule and written back.
 *
 * The rule editor (the monitor form's "When to alert" and "What happens")
 * shows a Logs, Traces, Exceptions or Metrics monitor's criteria as one
 * rule in plain words. These tests pin which stored criteria are such a
 * rule - the out-of-the-box defaults, the AI insight and recommendation
 * pairs, the metric templates' dead band - and which are not, so they open
 * in the full criteria editor instead; and that writing a rule back keeps
 * every field it does not show, so a monitor saved unchanged saves exactly
 * what it held.
 */

const OPERATIONAL: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000001",
);
const DEGRADED: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000002");
const OFFLINE: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000003");
const INCIDENT_SEVERITY: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000004",
);
const ALERT_SEVERITY: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000005",
);
const POLICY: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000006");
const LABEL: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000007");

const TELEMETRY_TYPES: Array<MonitorType> = [
  MonitorType.Logs,
  MonitorType.Traces,
  MonitorType.Exceptions,
  MonitorType.Metrics,
];

type DefaultStepFunction = (monitorType: MonitorType) => MonitorStep;

// A new monitor's first step, as the form seeds it.
const defaultStep: DefaultStepFunction = (
  monitorType: MonitorType,
): MonitorStep => {
  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType,
    monitorName: "Shop",
    defaultMonitorStatusId: OPERATIONAL,
    onlineMonitorStatusId: OPERATIONAL,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: INCIDENT_SEVERITY,
    defaultAlertSeverityId: ALERT_SEVERITY,
  });

  return steps.data!.monitorStepsInstanceArray[0]!;
};

type MetricStepFunction = (aliases?: Array<string>) => MonitorStep;

// A Metrics step reading one query per alias, with no criteria yet.
const metricStep: MetricStepFunction = (
  aliases: Array<string> = ["a"],
): MonitorStep => {
  const step: MonitorStep = defaultStep(MonitorType.Metrics);

  step.setMetricMonitor({
    metricViewConfig: {
      queryConfigs: aliases.map((alias: string) => {
        return {
          metricAliasData: {
            metricVariable: alias,
            title: "",
            description: "",
            legend: "",
            legendUnit: "%",
          },
          metricQueryData: {
            filterData: {
              metricName: "system.cpu.utilization",
              aggegationType: "Avg",
            },
          },
        } as any;
      }),
      formulaConfigs: [],
    },
    rollingTime: RollingTime.Past5Minutes,
  });

  return step;
};

type CriteriaFunction = (
  instances: Array<MonitorCriteriaInstance>,
) => MonitorCriteria;

const criteriaOf: CriteriaFunction = (
  instances: Array<MonitorCriteriaInstance>,
): MonitorCriteria => {
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: instances };
  return criteria;
};

type InstanceFunction = (data: {
  filters: Array<CriteriaFilter>;
  monitorStatusId?: ObjectID | undefined;
  changeMonitorStatus?: boolean;
  createIncidents?: boolean;
  createAlerts?: boolean;
  incidentCount?: number;
  alertCount?: number;
  isEnabled?: boolean;
  name?: string;
}) => MonitorCriteriaInstance;

const instanceOf: InstanceFunction = (data: {
  filters: Array<CriteriaFilter>;
  monitorStatusId?: ObjectID | undefined;
  changeMonitorStatus?: boolean;
  createIncidents?: boolean;
  createAlerts?: boolean;
  incidentCount?: number;
  alertCount?: number;
  isEnabled?: boolean;
  name?: string;
}): MonitorCriteriaInstance => {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.monitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: data.filters,
    incidents: Array.from({ length: data.incidentCount ?? 0 }).map(
      (_item: unknown, index: number) => {
        return {
          id: ObjectID.generate().toString(),
          title: `Incident ${index + 1}`,
          description: "What went wrong.",
          incidentSeverityId: INCIDENT_SEVERITY,
          autoResolveIncident: true,
          onCallPolicyIds: [POLICY],
          labelIds: [LABEL],
          remediationNotes: "Restart the worker.",
        };
      },
    ),
    alerts: Array.from({ length: data.alertCount ?? 0 }).map(
      (_item: unknown, index: number) => {
        return {
          id: ObjectID.generate().toString(),
          title: `Alert ${index + 1}`,
          description: "",
          alertSeverityId: ALERT_SEVERITY,
          autoResolveAlert: true,
          onCallPolicyIds: [],
        };
      },
    ),
    changeMonitorStatus: data.changeMonitorStatus ?? true,
    createIncidents: data.createIncidents ?? false,
    createAlerts: data.createAlerts ?? false,
    isEnabled: data.isEnabled ?? true,
    name: data.name ?? "A rule",
    description: "A description nobody sees in the rule editor.",
  };

  return instance;
};

type ReadFunction = (
  monitorType: MonitorType,
  step: MonitorStep,
) => TelemetryAlertRuleReadResult;

const read: ReadFunction = (
  monitorType: MonitorType,
  step: MonitorStep,
): TelemetryAlertRuleReadResult => {
  return TelemetryAlertRuleUtil.read({
    monitorType,
    monitorStep: step,
    defaultMonitorStatusId: OPERATIONAL,
  });
};

type RuleOfFunction = (
  monitorType: MonitorType,
  step: MonitorStep,
) => TelemetryAlertRule;

const ruleOf: RuleOfFunction = (
  monitorType: MonitorType,
  step: MonitorStep,
): TelemetryAlertRule => {
  const result: TelemetryAlertRuleReadResult = read(monitorType, step);

  if (!result.rule) {
    throw new Error(`not a rule: ${result.problem}`);
  }

  return result.rule;
};

type JsonOfFunction = (step: MonitorStep) => JSONObject;

const jsonOf: JsonOfFunction = (step: MonitorStep): JSONObject => {
  return JSON.parse(JSON.stringify(step.toJSON())) as JSONObject;
};

/*
 * A step as the form holds it: read back from JSON once, which fills in
 * what a freshly built criteria leaves unset (isEnabled). What the form
 * saves is compared with this.
 */
const savedJsonOf: JsonOfFunction = (step: MonitorStep): JSONObject => {
  return jsonOf(MonitorStep.clone(step));
};

type CountFilterFunction = (
  checkOn: CheckOn,
  filterType: FilterType,
  value: number | string | undefined,
) => CriteriaFilter;

const countFilter: CountFilterFunction = (
  checkOn: CheckOn,
  filterType: FilterType,
  value: number | string | undefined,
): CriteriaFilter => {
  return { checkOn, filterType, value };
};

describe("Which monitor types have a rule", () => {
  test("Logs, Traces, Exceptions and Metrics, each with its own measure", () => {
    expect(
      TELEMETRY_TYPES.map((monitorType: MonitorType) => {
        return TelemetryAlertRuleUtil.getMeasureCheckOn(monitorType);
      }),
    ).toEqual([
      CheckOn.LogCount,
      CheckOn.SpanCount,
      CheckOn.ExceptionCount,
      CheckOn.MetricValue,
    ]);

    for (const monitorType of TELEMETRY_TYPES) {
      expect(TelemetryAlertRuleUtil.isRuleMonitorType(monitorType)).toBe(true);
    }
  });

  test("every other monitor type keeps the full criteria editor", () => {
    const others: Array<MonitorType> = (
      Object.values(MonitorType) as Array<MonitorType>
    ).filter((monitorType: MonitorType) => {
      return !TELEMETRY_TYPES.includes(monitorType);
    });

    expect(others.length).toBeGreaterThan(20);

    for (const monitorType of others) {
      expect(TelemetryAlertRuleUtil.isRuleMonitorType(monitorType)).toBe(false);
      expect(TelemetryAlertRuleUtil.getMeasureCheckOn(monitorType)).toBeNull();
      expect(read(monitorType, defaultStep(MonitorType.Logs)).problem).toBe(
        TelemetryAlertRuleShapeProblem.NotARuleMonitorType,
      );
    }

    expect(TelemetryAlertRuleUtil.isRuleMonitorType(undefined)).toBe(false);
  });

  test("counts are Logs, Traces and Exceptions; Metrics is not a count", () => {
    expect(TelemetryAlertRuleUtil.isCountMonitorType(MonitorType.Logs)).toBe(
      true,
    );
    expect(TelemetryAlertRuleUtil.isCountMonitorType(MonitorType.Traces)).toBe(
      true,
    );
    expect(
      TelemetryAlertRuleUtil.isCountMonitorType(MonitorType.Exceptions),
    ).toBe(true);
    expect(TelemetryAlertRuleUtil.isCountMonitorType(MonitorType.Metrics)).toBe(
      false,
    );
  });
});

describe("The comparisons the rule editor offers", () => {
  test("the threshold comparisons, then the anomaly ones where the server has a baseline", () => {
    const threshold: Array<FilterType> = [
      FilterType.GreaterThan,
      FilterType.GreaterThanOrEqualTo,
      FilterType.LessThan,
      FilterType.LessThanOrEqualTo,
      FilterType.EqualTo,
    ];
    const anomaly: Array<FilterType> = [
      FilterType.AnomalouslyHigh,
      FilterType.AnomalouslyLow,
      FilterType.Anomalous,
    ];

    expect(
      TelemetryAlertRuleUtil.getComparisons({ monitorType: MonitorType.Logs }),
    ).toEqual([...threshold, ...anomaly]);
    expect(
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Traces,
      }),
    ).toEqual([...threshold, ...anomaly]);
    expect(
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Metrics,
      }),
    ).toEqual([...threshold, ...anomaly]);
    // ExceptionMonitorCriteria has no baseline to compare with.
    expect(
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Exceptions,
      }),
    ).toEqual(threshold);
  });

  test("a rule holding Not Equal To is offered it back, and nobody else is", () => {
    expect(
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Logs,
        current: FilterType.NotEqualTo,
      }),
    ).toContain(FilterType.NotEqualTo);
    expect(
      TelemetryAlertRuleUtil.getComparisons({ monitorType: MonitorType.Logs }),
    ).not.toContain(FilterType.NotEqualTo);
    expect(
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Logs,
        current: FilterType.Contains,
      }),
    ).not.toContain(FilterType.Contains);
  });
});

describe("The out-of-the-box criteria read as a rule", () => {
  test("Logs: no matching logs in the last minute opens an incident, with its opposite as the recovery", () => {
    const rule: TelemetryAlertRule = ruleOf(
      MonitorType.Logs,
      defaultStep(MonitorType.Logs),
    );

    expect(rule.filterType).toBe(FilterType.EqualTo);
    expect(rule.threshold).toBe(0);
    expect(rule.windowInSeconds).toBe(60);
    expect(rule.action).toBe(TelemetryAlertRuleAction.Incident);
    expect(rule.monitorStatusId?.toString()).toBe(OFFLINE.toString());
    expect(rule.incident?.incidentSeverityId?.toString()).toBe(
      INCIDENT_SEVERITY.toString(),
    );
    expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.Opposite);
    expect(rule.name).toBe("Check if Shop is offline");
  });

  test("Traces: no spans in the last minute opens an incident", () => {
    const rule: TelemetryAlertRule = ruleOf(
      MonitorType.Traces,
      defaultStep(MonitorType.Traces),
    );

    expect(rule.filterType).toBe(FilterType.EqualTo);
    expect(rule.threshold).toBe(0);
    expect(rule.windowInSeconds).toBe(60);
    expect(rule.action).toBe(TelemetryAlertRuleAction.Incident);
    expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.Opposite);
  });

  test("Exceptions: any exception opens an incident", () => {
    const rule: TelemetryAlertRule = ruleOf(
      MonitorType.Exceptions,
      defaultStep(MonitorType.Exceptions),
    );

    expect(rule.filterType).toBe(FilterType.GreaterThan);
    expect(rule.threshold).toBe(0);
    expect(rule.action).toBe(TelemetryAlertRuleAction.Incident);
    expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.Opposite);
  });

  test("Metrics: a value of 0 opens an incident, over the rolling time", () => {
    const step: MonitorStep = metricStep();
    step.setMonitorCriteria(
      defaultStep(MonitorType.Metrics).data!.monitorCriteria,
    );

    const rule: TelemetryAlertRule = ruleOf(MonitorType.Metrics, step);

    expect(rule.filterType).toBe(FilterType.EqualTo);
    expect(rule.threshold).toBe(0);
    expect(rule.rollingTime).toBe(RollingTime.Past5Minutes);
    expect(rule.windowInSeconds).toBeUndefined();
    expect(rule.metricAggregationType).toBe(EvaluateOverTimeType.AnyValue);
    // No alias: the evaluator reads the first query.
    expect(rule.metricAlias).toBeUndefined();
    /*
     * "Greater Than 0" is healthy, "Equal To 0" opens the incident, and a
     * negative value matches neither: the default status, the same healthy
     * status. Never both, so it is the rule's recovery.
     */
    expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.Disjoint);
  });

  test("each default saves back unchanged, byte for byte", () => {
    for (const monitorType of TELEMETRY_TYPES) {
      const step: MonitorStep =
        monitorType === MonitorType.Metrics
          ? metricStep()
          : defaultStep(monitorType);

      if (monitorType === MonitorType.Metrics) {
        step.setMonitorCriteria(
          defaultStep(MonitorType.Metrics).data!.monitorCriteria,
        );
      }

      const written: MonitorStep = TelemetryAlertRuleUtil.write({
        monitorType,
        monitorStep: step,
        rule: ruleOf(monitorType, step),
      });

      expect(jsonOf(written)).toEqual(savedJsonOf(step));
    }
  });

  test("a changed Metrics default writes its recovery as the rule's exact opposite", () => {
    const step: MonitorStep = metricStep();
    step.setMonitorCriteria(
      defaultStep(MonitorType.Metrics).data!.monitorCriteria,
    );

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: {
        ...ruleOf(MonitorType.Metrics, step),
        filterType: FilterType.GreaterThan,
        threshold: 80,
      },
    });

    expect(
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!
        .filters[0],
    ).toMatchObject({
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.LessThanOrEqualTo,
      value: 80,
    });
    expect(ruleOf(MonitorType.Metrics, written).recovery).toBe(
      TelemetryAlertRuleRecovery.Opposite,
    );
  });
});

describe("Pairs written elsewhere read as a rule", () => {
  test("an AI insight's spike monitor: at least N, with fewer than N as the recovery", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [
            countFilter(CheckOn.LogCount, FilterType.GreaterThanOrEqualTo, 42),
          ],
          monitorStatusId: OFFLINE,
          createIncidents: true,
          incidentCount: 1,
          alertCount: 1,
        }),
        instanceOf({
          filters: [countFilter(CheckOn.LogCount, FilterType.LessThan, 42)],
          monitorStatusId: OPERATIONAL,
          name: "Healthy",
        }),
      ]),
    );

    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);

    expect(rule.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(rule.threshold).toBe(42);
    // The alert row is kept but off: the rule opens an incident only.
    expect(rule.action).toBe(TelemetryAlertRuleAction.Incident);
    expect(rule.alert?.title).toBe("Alert 1");
    expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.Opposite);
  });

  test("the healthy criteria may come first", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    const healthy: MonitorCriteriaInstance = instanceOf({
      filters: [countFilter(CheckOn.LogCount, FilterType.LessThanOrEqualTo, 9)],
      monitorStatusId: OPERATIONAL,
    });
    const problem: MonitorCriteriaInstance = instanceOf({
      filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 9)],
      monitorStatusId: DEGRADED,
      createAlerts: true,
      alertCount: 1,
    });
    step.setMonitorCriteria(criteriaOf([healthy, problem]));

    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);

    expect(rule.ruleCriteriaId).toBe(problem.data!.id);
    expect(rule.action).toBe(TelemetryAlertRuleAction.Alert);
    expect(rule.monitorStatusId?.toString()).toBe(DEGRADED.toString());

    // And it stays second.
    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...rule, threshold: 20 },
    });

    const instances: Array<MonitorCriteriaInstance> =
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

    expect(instances[0]!.data!.id).toBe(healthy.data!.id);
    expect(instances[0]!.data!.filters[0]!.value).toBe(20);
    expect(instances[1]!.data!.filters[0]!.value).toBe(20);
  });

  test("a recommendation's metric pair with its 10% dead band", () => {
    const step: MonitorStep = metricStep();
    const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
      offlineMonitorStatusId: OFFLINE,
      incidentSeverityId: INCIDENT_SEVERITY,
      alertSeverityId: ALERT_SEVERITY,
      monitorName: "Shop",
      metricAlias: "a",
      filterType: FilterType.GreaterThan,
      value: 90,
    });
    const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
      onlineMonitorStatusId: OPERATIONAL,
      metricAlias: "a",
      filterType: getRecoveryFilterType(FilterType.GreaterThan),
      value: 90,
    });
    step.setMonitorCriteria(criteriaOf([unhealthy, healthy]));

    const rule: TelemetryAlertRule = ruleOf(MonitorType.Metrics, step);

    expect(rule.filterType).toBe(FilterType.GreaterThan);
    expect(rule.threshold).toBe(90);
    expect(rule.metricAlias).toBe("a");
    expect(rule.metricAggregationType).toBe(EvaluateOverTimeType.AllValues);
    expect(rule.action).toBe(TelemetryAlertRuleAction.AlertAndIncident);
    expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.OppositeWithMargin);

    // A new threshold moves the dead band with it.
    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: { ...rule, threshold: 50 },
    });

    const filters: Array<CriteriaFilter> =
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.map(
        (instance: MonitorCriteriaInstance) => {
          return instance.data!.filters[0]!;
        },
      );

    expect(filters[0]!.value).toBe(50);
    expect(filters[1]!.filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(filters[1]!.value).toBe(45);
  });

  test("a metric pair whose recovery is a value of its own: never both, so still the rule's recovery", () => {
    const step: MonitorStep = metricStep();
    step.setMonitorCriteria(
      criteriaOf([
        buildUnhealthyCriteriaInstance({
          offlineMonitorStatusId: OFFLINE,
          incidentSeverityId: INCIDENT_SEVERITY,
          alertSeverityId: ALERT_SEVERITY,
          monitorName: "Shop",
          metricAlias: "a",
          filterType: FilterType.GreaterThan,
          value: 90,
        }),
        buildHealthyCriteriaInstance({
          onlineMonitorStatusId: OPERATIONAL,
          metricAlias: "a",
          filterType: FilterType.LessThanOrEqualTo,
          value: 90,
          recoveryValue: 60,
        }),
      ]),
    );

    const rule: TelemetryAlertRule = ruleOf(MonitorType.Metrics, step);

    // 61 to 90 match neither: the default status, the same healthy one.
    expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.Disjoint);

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: { ...rule, threshold: 95 },
    });

    expect(
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!
        .filters[0],
    ).toMatchObject({ filterType: FilterType.LessThanOrEqualTo, value: 95 });
  });

  test("a metric recovery reading another query, unit or aggregation is a rule of its own", () => {
    for (const recoveryOptions of [
      { metricAlias: "b" },
      { metricAlias: "a", thresholdUnit: "ms" },
      {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    ]) {
      const step: MonitorStep = metricStep(["a", "b"]);
      step.setMonitorCriteria(
        criteriaOf([
          instanceOf({
            filters: [
              {
                checkOn: CheckOn.MetricValue,
                filterType: FilterType.GreaterThan,
                value: 80,
                metricMonitorOptions: {
                  metricAlias: "a",
                  metricAggregationType: EvaluateOverTimeType.AllValues,
                },
              },
            ],
            monitorStatusId: OFFLINE,
            createIncidents: true,
            incidentCount: 1,
          }),
          instanceOf({
            filters: [
              {
                checkOn: CheckOn.MetricValue,
                filterType: FilterType.LessThanOrEqualTo,
                value: 80,
                metricMonitorOptions: {
                  metricAggregationType: EvaluateOverTimeType.AllValues,
                  ...recoveryOptions,
                },
              },
            ],
            monitorStatusId: OPERATIONAL,
          }),
        ]),
      );

      expect(read(MonitorType.Metrics, step).problem).toBe(
        TelemetryAlertRuleShapeProblem.SeveralRules,
      );
    }
  });

  test("a recovery that sets a status other than the default is a rule of its own", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 5)],
          monitorStatusId: OFFLINE,
          createIncidents: true,
          incidentCount: 1,
        }),
        instanceOf({
          filters: [
            countFilter(CheckOn.LogCount, FilterType.LessThanOrEqualTo, 5),
          ],
          monitorStatusId: DEGRADED,
        }),
      ]),
    );

    expect(read(MonitorType.Logs, step).problem).toBe(
      TelemetryAlertRuleShapeProblem.SeveralRules,
    );
  });

  test("a second criteria that is not the rule's opposite is a rule of its own", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 5)],
          monitorStatusId: OFFLINE,
          createIncidents: true,
          incidentCount: 1,
        }),
        instanceOf({
          // Overlaps the rule from 6 to 9: it would decide those counts.
          filters: [countFilter(CheckOn.LogCount, FilterType.LessThan, 10)],
          monitorStatusId: OPERATIONAL,
        }),
      ]),
    );

    expect(read(MonitorType.Logs, step).problem).toBe(
      TelemetryAlertRuleShapeProblem.SeveralRules,
    );
  });

  test("two criteria that both open something are two rules", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 50)],
          monitorStatusId: OFFLINE,
          createIncidents: true,
          incidentCount: 1,
        }),
        instanceOf({
          filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 10)],
          monitorStatusId: DEGRADED,
          createAlerts: true,
          alertCount: 1,
        }),
      ]),
    );

    expect(read(MonitorType.Logs, step).problem).toBe(
      TelemetryAlertRuleShapeProblem.SeveralRules,
    );
  });
});

describe("Criteria that are not one rule open in the full editor", () => {
  type ProblemCase = {
    name: string;
    instance: MonitorCriteriaInstance;
    problem: TelemetryAlertRuleShapeProblem;
  };

  const cases: Array<ProblemCase> = [
    {
      name: "a disabled rule",
      instance: instanceOf({
        filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 1)],
        isEnabled: false,
      }),
      problem: TelemetryAlertRuleShapeProblem.DisabledRule,
    },
    {
      name: "two filters",
      instance: instanceOf({
        filters: [
          countFilter(CheckOn.LogCount, FilterType.GreaterThan, 1),
          countFilter(CheckOn.LogCount, FilterType.LessThan, 100),
        ],
      }),
      problem: TelemetryAlertRuleShapeProblem.SeveralFilters,
    },
    {
      name: "no filter",
      instance: instanceOf({ filters: [] }),
      problem: TelemetryAlertRuleShapeProblem.SeveralFilters,
    },
    {
      name: "a check the type does not measure",
      instance: instanceOf({
        filters: [countFilter(CheckOn.SpanCount, FilterType.GreaterThan, 1)],
      }),
      problem: TelemetryAlertRuleShapeProblem.OtherCheck,
    },
    {
      name: "a text comparison",
      instance: instanceOf({
        filters: [countFilter(CheckOn.LogCount, FilterType.Contains, "a")],
      }),
      problem: TelemetryAlertRuleShapeProblem.UnsupportedCondition,
    },
    {
      name: "a filter judged over time",
      instance: instanceOf({
        filters: [
          {
            ...countFilter(CheckOn.LogCount, FilterType.GreaterThan, 1),
            evaluateOverTime: true,
          },
        ],
      }),
      problem: TelemetryAlertRuleShapeProblem.UnsupportedCondition,
    },
    {
      name: "two incidents",
      instance: instanceOf({
        filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 1)],
        createIncidents: true,
        incidentCount: 2,
      }),
      problem: TelemetryAlertRuleShapeProblem.SeveralIncidentsOrAlerts,
    },
    {
      name: "an incident switched on with no incident to open",
      instance: instanceOf({
        filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 1)],
        createIncidents: true,
        incidentCount: 0,
      }),
      problem: TelemetryAlertRuleShapeProblem.SeveralIncidentsOrAlerts,
    },
  ];

  for (const testCase of cases) {
    test(`${testCase.name}`, () => {
      const step: MonitorStep = defaultStep(MonitorType.Logs);
      step.setMonitorCriteria(criteriaOf([testCase.instance]));

      const result: TelemetryAlertRuleReadResult = read(MonitorType.Logs, step);

      expect(result.rule).toBeNull();
      expect(result.problem).toBe(testCase.problem);
    });
  }

  test("a rule still waiting for its value is a rule, with no value", () => {
    for (const value of ["", undefined]) {
      const step: MonitorStep = defaultStep(MonitorType.Logs);
      step.setMonitorCriteria(
        criteriaOf([
          instanceOf({
            filters: [
              countFilter(CheckOn.LogCount, FilterType.GreaterThan, value),
            ],
            monitorStatusId: DEGRADED,
            createAlerts: true,
            alertCount: 1,
          }),
        ]),
      );

      expect(ruleOf(MonitorType.Logs, step).threshold).toBeUndefined();
      // Saving it is refused until it has one.
      expect(
        MonitorCriteria.getValidationError(
          step.data!.monitorCriteria,
          MonitorType.Logs,
        ),
      ).toContain("Value is required");
    }
  });

  test("three criteria", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(
      criteriaOf(
        [1, 2, 3].map((value: number) => {
          return instanceOf({
            filters: [
              countFilter(CheckOn.LogCount, FilterType.GreaterThan, value),
            ],
          });
        }),
      ),
    );

    expect(read(MonitorType.Logs, step).problem).toBe(
      TelemetryAlertRuleShapeProblem.SeveralRules,
    );
  });

  test("no criteria", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(criteriaOf([]));

    expect(read(MonitorType.Logs, step).problem).toBe(
      TelemetryAlertRuleShapeProblem.NoCriteria,
    );
  });

  test("grouped incidents (an incoming request's) are not a rule", () => {
    const instance: MonitorCriteriaInstance = instanceOf({
      filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 1)],
    });
    instance.data!.incidentGrouping = { groupByJSONPath: "requestBody.a" };

    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(criteriaOf([instance]));

    expect(read(MonitorType.Logs, step).problem).toBe(
      TelemetryAlertRuleShapeProblem.GroupedIncidents,
    );
  });

  test("a metric rule naming a query the monitor no longer has", () => {
    const step: MonitorStep = metricStep(["a"]);
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [
            {
              checkOn: CheckOn.MetricValue,
              filterType: FilterType.GreaterThan,
              value: 80,
              metricMonitorOptions: { metricAlias: "b" },
            },
          ],
        }),
      ]),
    );

    expect(read(MonitorType.Metrics, step).problem).toBe(
      TelemetryAlertRuleShapeProblem.UnknownMetric,
    );
  });

  test("a metric rule may name any query or formula of the monitor", () => {
    const step: MonitorStep = metricStep(["a", "b"]);
    step.data!.metricMonitor!.metricViewConfig.formulaConfigs = [
      {
        metricAliasData: {
          metricVariable: "c",
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricFormulaData: { metricFormula: "a / b" },
      },
    ];

    expect(TelemetryAlertRuleUtil.getMetricAliases(step)).toEqual([
      "a",
      "b",
      "c",
    ]);

    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [
            {
              checkOn: CheckOn.MetricValue,
              filterType: FilterType.GreaterThan,
              value: 0.5,
              metricMonitorOptions: { metricAlias: "c" },
            },
          ],
          createAlerts: true,
          alertCount: 1,
          monitorStatusId: DEGRADED,
        }),
      ]),
    );

    expect(ruleOf(MonitorType.Metrics, step).metricAlias).toBe("c");
  });
});

describe("Counts are compared as whole numbers", () => {
  type OppositeCase = {
    rule: [FilterType, number];
    recovery: [FilterType, number];
    // How the second criteria reads: the rule's recovery, or not (null).
    kind: TelemetryAlertRuleRecovery | null;
  };

  const cases: Array<OppositeCase> = [
    {
      rule: [FilterType.EqualTo, 0],
      recovery: [FilterType.GreaterThan, 0],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      rule: [FilterType.EqualTo, 0],
      recovery: [FilterType.NotEqualTo, 0],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      rule: [FilterType.EqualTo, 0],
      recovery: [FilterType.GreaterThanOrEqualTo, 1],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      rule: [FilterType.GreaterThan, 0],
      recovery: [FilterType.EqualTo, 0],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      rule: [FilterType.GreaterThan, 10],
      recovery: [FilterType.LessThanOrEqualTo, 10],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      rule: [FilterType.GreaterThan, 10],
      recovery: [FilterType.LessThan, 11],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      rule: [FilterType.GreaterThanOrEqualTo, 10],
      recovery: [FilterType.LessThan, 10],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      rule: [FilterType.LessThan, 5],
      recovery: [FilterType.GreaterThanOrEqualTo, 5],
      kind: TelemetryAlertRuleRecovery.Opposite,
    },
    {
      // 10 matches neither: the default status decides it.
      rule: [FilterType.GreaterThan, 10],
      recovery: [FilterType.LessThan, 10],
      kind: TelemetryAlertRuleRecovery.Disjoint,
    },
    {
      rule: [FilterType.GreaterThan, 10],
      recovery: [FilterType.LessThanOrEqualTo, 9],
      kind: TelemetryAlertRuleRecovery.Disjoint,
    },
    {
      rule: [FilterType.EqualTo, 3],
      recovery: [FilterType.GreaterThan, 3],
      kind: TelemetryAlertRuleRecovery.Disjoint,
    },
    {
      // 6 to 9 match both: the second criteria is a rule of its own.
      rule: [FilterType.GreaterThan, 5],
      recovery: [FilterType.LessThan, 10],
      kind: null,
    },
    {
      rule: [FilterType.EqualTo, 0],
      recovery: [FilterType.GreaterThanOrEqualTo, 0],
      kind: null,
    },
  ];

  for (const testCase of cases) {
    test(`${testCase.rule.join(" ")} against ${testCase.recovery.join(" ")}: ${
      testCase.kind || "two rules"
    }`, () => {
      const step: MonitorStep = defaultStep(MonitorType.Traces);
      step.setMonitorCriteria(
        criteriaOf([
          instanceOf({
            filters: [
              countFilter(
                CheckOn.SpanCount,
                testCase.rule[0],
                testCase.rule[1],
              ),
            ],
            monitorStatusId: OFFLINE,
            createIncidents: true,
            incidentCount: 1,
          }),
          instanceOf({
            filters: [
              countFilter(
                CheckOn.SpanCount,
                testCase.recovery[0],
                testCase.recovery[1],
              ),
            ],
            monitorStatusId: OPERATIONAL,
          }),
        ]),
      );

      const result: TelemetryAlertRuleReadResult = read(
        MonitorType.Traces,
        step,
      );

      if (testCase.kind) {
        expect(result.rule?.recovery).toBe(testCase.kind);
      } else {
        expect(result.problem).toBe(
          TelemetryAlertRuleShapeProblem.SeveralRules,
        );
      }
    });
  }

  test("a value saved as text reads as its number, and saves back as text", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [
            countFilter(CheckOn.LogCount, FilterType.GreaterThan, "10"),
          ],
          monitorStatusId: DEGRADED,
          createAlerts: true,
          alertCount: 1,
        }),
      ]),
    );

    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);
    expect(rule.threshold).toBe(10);

    const unchanged: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule,
    });

    expect(jsonOf(unchanged)).toEqual(savedJsonOf(step));

    const changed: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...rule, threshold: 12 },
    });

    expect(
      changed.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
        .filters[0]!.value,
    ).toBe(12);
  });
});

describe("Writing a rule back", () => {
  type AlertRuleStepFunction = () => MonitorStep;

  // More than 10 error logs in 5 minutes: an alert, the monitor Degraded.
  const alertRuleStep: AlertRuleStepFunction = (): MonitorStep => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.setLogMonitor({
      ...step.data!.logMonitor!,
      lastXSecondsOfLogs: 300,
    });
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [countFilter(CheckOn.LogCount, FilterType.GreaterThan, 10)],
          monitorStatusId: DEGRADED,
          createAlerts: true,
          alertCount: 1,
          incidentCount: 1,
          name: "More than 10 matching logs in 5 minutes",
        }),
      ]),
    );

    return step;
  };

  test("an unchanged rule saves what was there, for every shape read", () => {
    const step: MonitorStep = alertRuleStep();

    expect(
      jsonOf(
        TelemetryAlertRuleUtil.write({
          monitorType: MonitorType.Logs,
          monitorStep: step,
          rule: ruleOf(MonitorType.Logs, step),
        }),
      ),
    ).toEqual(savedJsonOf(step));
  });

  test("the handed-in step is never changed", () => {
    const step: MonitorStep = alertRuleStep();
    const before: JSONObject = jsonOf(step);

    TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: {
        ...ruleOf(MonitorType.Logs, step),
        threshold: 99,
        windowInSeconds: 900,
      },
    });

    expect(jsonOf(step)).toEqual(before);
  });

  test("the window is written where each type keeps it", () => {
    for (const monitorType of [
      MonitorType.Logs,
      MonitorType.Traces,
      MonitorType.Exceptions,
    ]) {
      const step: MonitorStep = defaultStep(monitorType);
      const written: MonitorStep = TelemetryAlertRuleUtil.write({
        monitorType,
        monitorStep: step,
        rule: { ...ruleOf(monitorType, step), windowInSeconds: 900 },
      });

      expect(
        TelemetryAlertRuleUtil.getWindowInSeconds({
          monitorType,
          monitorStep: written,
        }),
      ).toBe(900);
    }

    expect(
      defaultStep(MonitorType.Traces).data!.traceMonitor!.lastXSecondsOfSpans,
    ).toBe(60);

    const metric: MonitorStep = metricStep();
    metric.setMonitorCriteria(
      defaultStep(MonitorType.Metrics).data!.monitorCriteria,
    );

    const writtenMetric: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: metric,
      rule: {
        ...ruleOf(MonitorType.Metrics, metric),
        rollingTime: RollingTime.Past15Minutes,
      },
    });

    expect(writtenMetric.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
  });

  test("a step without its sub-configuration gets the defaults with the window", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    step.data!.logMonitor = undefined;

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...ruleOf(MonitorType.Logs, step), windowInSeconds: 300 },
    });

    expect(written.data!.logMonitor!.lastXSecondsOfLogs).toBe(300);
    expect(written.data!.logMonitor!.severityTexts).toEqual([]);
  });

  test("a new threshold keeps the opposite recovery the opposite", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...rule, filterType: FilterType.GreaterThan, threshold: 10 },
    });

    const filters: Array<CriteriaFilter> =
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.map(
        (instance: MonitorCriteriaInstance) => {
          return instance.data!.filters[0]!;
        },
      );

    expect(filters[0]).toMatchObject({
      checkOn: CheckOn.LogCount,
      filterType: FilterType.GreaterThan,
      value: 10,
    });
    expect(filters[1]).toMatchObject({
      checkOn: CheckOn.LogCount,
      filterType: FilterType.LessThanOrEqualTo,
      value: 10,
    });
    expect(ruleOf(MonitorType.Logs, written).recovery).toBe(
      TelemetryAlertRuleRecovery.Opposite,
    );
  });

  test("back to none: the opposite of 'is 0' is written as 'more than 0'", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);
    const raised: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...rule, filterType: FilterType.GreaterThan, threshold: 3 },
    });
    const back: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: raised,
      rule: {
        ...ruleOf(MonitorType.Logs, raised),
        filterType: FilterType.EqualTo,
        threshold: 0,
      },
    });

    expect(
      back.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!
        .filters[0],
    ).toMatchObject({ filterType: FilterType.GreaterThan, value: 0 });
  });

  test("an anomaly drops the recovery and keeps its sensitivity on the filter", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: {
        ...rule,
        filterType: FilterType.AnomalouslyHigh,
        threshold: undefined,
        anomalyDetection: { sensitivity: AnomalyDetectionSensitivity.High },
      },
    });

    const instances: Array<MonitorCriteriaInstance> =
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

    expect(instances).toHaveLength(1);
    expect(instances[0]!.data!.filters[0]).toMatchObject({
      checkOn: CheckOn.LogCount,
      filterType: FilterType.AnomalouslyHigh,
      value: undefined,
      metricMonitorOptions: {
        anomalyDetection: { sensitivity: AnomalyDetectionSensitivity.High },
      },
    });

    const anomalyRule: TelemetryAlertRule = ruleOf(MonitorType.Logs, written);
    expect(anomalyRule.threshold).toBeUndefined();
    expect(anomalyRule.anomalyDetection?.sensitivity).toBe(
      AnomalyDetectionSensitivity.High,
    );
    expect(anomalyRule.recovery).toBe(TelemetryAlertRuleRecovery.DefaultStatus);
  });

  test("the action: alert, incident, both, or the status only", () => {
    const step: MonitorStep = alertRuleStep();
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);

    type WriteActionFunction = (
      action: TelemetryAlertRuleAction,
    ) => MonitorCriteriaInstance;

    const writeAction: WriteActionFunction = (
      action: TelemetryAlertRuleAction,
    ): MonitorCriteriaInstance => {
      return TelemetryAlertRuleUtil.write({
        monitorType: MonitorType.Logs,
        monitorStep: step,
        rule: { ...rule, action },
      }).data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
    };

    expect(writeAction(TelemetryAlertRuleAction.Incident).data).toMatchObject({
      createIncidents: true,
      createAlerts: false,
    });
    expect(writeAction(TelemetryAlertRuleAction.Alert).data).toMatchObject({
      createIncidents: false,
      createAlerts: true,
    });
    expect(
      writeAction(TelemetryAlertRuleAction.AlertAndIncident).data,
    ).toMatchObject({
      createIncidents: true,
      createAlerts: true,
    });
    expect(writeAction(TelemetryAlertRuleAction.StatusOnly).data).toMatchObject(
      {
        createIncidents: false,
        createAlerts: false,
      },
    );

    // The rows of an action switched off stay, as in the full editor.
    expect(
      writeAction(TelemetryAlertRuleAction.Alert).data!.incidents,
    ).toHaveLength(1);
  });

  test("the status while it matches; none means the status is left alone", () => {
    const step: MonitorStep = alertRuleStep();
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);

    const offline: MonitorCriteriaInstance = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...rule, monitorStatusId: OFFLINE },
    }).data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;

    expect(offline.data!.changeMonitorStatus).toBe(true);
    expect(offline.data!.monitorStatusId?.toString()).toBe(OFFLINE.toString());

    const none: MonitorCriteriaInstance = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...rule, monitorStatusId: undefined },
    }).data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;

    expect(none.data!.changeMonitorStatus).toBe(false);
    expect(none.data!.monitorStatusId).toBeUndefined();
  });

  test("the incident and alert keep every field the rule does not show", () => {
    const step: MonitorStep = alertRuleStep();
    const rule: TelemetryAlertRule = ruleOf(MonitorType.Logs, step);

    const written: MonitorCriteriaInstance = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: {
        ...rule,
        action: TelemetryAlertRuleAction.Incident,
        incident: { ...rule.incident!, title: "Checkout is erroring" },
      },
    }).data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;

    expect(written.data!.incidents[0]).toMatchObject({
      title: "Checkout is erroring",
      remediationNotes: "Restart the worker.",
      autoResolveIncident: true,
    });
    expect(written.data!.incidents[0]!.onCallPolicyIds?.[0]?.toString()).toBe(
      POLICY.toString(),
    );
    expect(written.data!.incidents[0]!.labelIds?.[0]?.toString()).toBe(
      LABEL.toString(),
    );
    expect(written.data!.description).toBe(
      "A description nobody sees in the rule editor.",
    );
  });

  test("a metric rule's query, aggregation, unit and no-data policy", () => {
    const step: MonitorStep = metricStep(["a", "b"]);
    step.setMonitorCriteria(
      criteriaOf([
        instanceOf({
          filters: [
            {
              checkOn: CheckOn.MetricValue,
              filterType: FilterType.GreaterThan,
              value: 80,
              metricMonitorOptions: {
                metricAlias: "a",
                metricAggregationType: EvaluateOverTimeType.Average,
              },
            },
          ],
          createAlerts: true,
          alertCount: 1,
          monitorStatusId: DEGRADED,
        }),
      ]),
    );

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: {
        ...ruleOf(MonitorType.Metrics, step),
        metricAlias: "b",
        metricAggregationType: EvaluateOverTimeType.MaximumValue,
        thresholdUnit: "%",
        onNoDataPolicy: NoDataPolicy.Trigger,
      },
    });

    expect(
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
        .filters[0]!.metricMonitorOptions,
    ).toEqual({
      metricAlias: "b",
      metricAggregationType: EvaluateOverTimeType.MaximumValue,
      thresholdUnit: "%",
      onNoDataPolicy: NoDataPolicy.Trigger,
    });
  });

  test("a metric recovery follows the rule's query, aggregation and unit, keeping its own no-data policy", () => {
    const step: MonitorStep = metricStep(["a", "b"]);
    const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
      offlineMonitorStatusId: OFFLINE,
      incidentSeverityId: INCIDENT_SEVERITY,
      alertSeverityId: ALERT_SEVERITY,
      monitorName: "Shop",
      metricAlias: "a",
      filterType: FilterType.GreaterThan,
      value: 90,
    });
    const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
      onlineMonitorStatusId: OPERATIONAL,
      metricAlias: "a",
      filterType: getRecoveryFilterType(FilterType.GreaterThan),
      value: 90,
      treatNoDataAsZero: true,
    });
    step.setMonitorCriteria(criteriaOf([unhealthy, healthy]));

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: {
        ...ruleOf(MonitorType.Metrics, step),
        metricAlias: "b",
        metricAggregationType: EvaluateOverTimeType.Average,
      },
    });

    expect(
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!
        .filters[0]!.metricMonitorOptions,
    ).toEqual({
      metricAlias: "b",
      metricAggregationType: EvaluateOverTimeType.Average,
      onNoDataPolicy: NoDataPolicy.TreatAsZero,
    });
  });

  test("a rule that is not one of the criteria (a recipe) takes their place", () => {
    const step: MonitorStep = defaultStep(MonitorType.Logs);
    const rule: TelemetryAlertRule = {
      ...ruleOf(MonitorType.Logs, step),
      ruleCriteriaId: ObjectID.generate().toString(),
      filterType: FilterType.GreaterThan,
      threshold: 10,
      action: TelemetryAlertRuleAction.Alert,
      alert: {
        id: ObjectID.generate().toString(),
        title: "Shop: more than 10 error logs",
        description: "",
        alertSeverityId: ALERT_SEVERITY,
        autoResolveAlert: true,
        onCallPolicyIds: [],
      },
      monitorStatusId: DEGRADED,
      name: "More than 10 matching logs in 5 minutes",
      recovery: TelemetryAlertRuleRecovery.DefaultStatus,
      windowInSeconds: 300,
    };

    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule,
    });

    const instances: Array<MonitorCriteriaInstance> =
      written.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

    expect(instances).toHaveLength(1);
    expect(instances[0]!.data).toMatchObject({
      id: rule.ruleCriteriaId,
      name: "More than 10 matching logs in 5 minutes",
      createAlerts: true,
      createIncidents: false,
      changeMonitorStatus: true,
      isEnabled: true,
    });
    expect(written.data!.logMonitor!.lastXSecondsOfLogs).toBe(300);

    const reRead: TelemetryAlertRule = ruleOf(MonitorType.Logs, written);
    expect(reRead.threshold).toBe(10);
    expect(reRead.recovery).toBe(TelemetryAlertRuleRecovery.DefaultStatus);
    expect(
      MonitorCriteriaInstance.getValidationError(
        instances[0]!,
        MonitorType.Logs,
      ),
    ).toBeNull();
  });
});

describe("Building a new rule's criteria", () => {
  test("one criteria, which returns to the default status when it stops matching", () => {
    const criteria: MonitorCriteria = TelemetryAlertRuleUtil.buildCriteria({
      monitorType: MonitorType.Exceptions,
      rule: {
        filterType: FilterType.GreaterThan,
        threshold: 0,
        windowInSeconds: 300,
        rollingTime: undefined,
        metricAlias: undefined,
        metricAggregationType: undefined,
        onNoDataPolicy: undefined,
        thresholdUnit: undefined,
        anomalyDetection: undefined,
        action: TelemetryAlertRuleAction.Alert,
        monitorStatusId: DEGRADED,
        incident: undefined,
        alert: {
          id: ObjectID.generate().toString(),
          title: "Shop: an exception happened",
          description: "",
          alertSeverityId: ALERT_SEVERITY,
          autoResolveAlert: true,
          onCallPolicyIds: [],
        },
        name: "Any exception in 5 minutes",
        ruleCriteriaId: "",
        recovery: TelemetryAlertRuleRecovery.DefaultStatus,
      },
    });

    const instances: Array<MonitorCriteriaInstance> =
      criteria.data!.monitorCriteriaInstanceArray;

    expect(instances).toHaveLength(1);
    expect(instances[0]!.data!.id).toBeTruthy();
    expect(instances[0]!.data!.filters).toEqual([
      {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ]);
    expect(
      MonitorCriteria.getValidationError(criteria, MonitorType.Exceptions),
    ).toBeNull();
  });
});

describe("Matching a value, as the server compares one number", () => {
  test("each comparison", () => {
    const at: (filterType: FilterType, value: number) => boolean = (
      filterType: FilterType,
      value: number,
    ): boolean => {
      return TelemetryAlertRuleUtil.matches({
        filterType,
        threshold: 10,
        value,
      });
    };

    expect(
      [9, 10, 11].map((v: number) => {
        return at(FilterType.GreaterThan, v);
      }),
    ).toEqual([false, false, true]);
    expect(
      [9, 10, 11].map((v: number) => {
        return at(FilterType.GreaterThanOrEqualTo, v);
      }),
    ).toEqual([false, true, true]);
    expect(
      [9, 10, 11].map((v: number) => {
        return at(FilterType.LessThan, v);
      }),
    ).toEqual([true, false, false]);
    expect(
      [9, 10, 11].map((v: number) => {
        return at(FilterType.LessThanOrEqualTo, v);
      }),
    ).toEqual([true, true, false]);
    expect(
      [9, 10, 11].map((v: number) => {
        return at(FilterType.EqualTo, v);
      }),
    ).toEqual([false, true, false]);
    expect(
      [9, 10, 11].map((v: number) => {
        return at(FilterType.NotEqualTo, v);
      }),
    ).toEqual([true, false, true]);
    expect(at(FilterType.AnomalouslyHigh, 1000)).toBe(false);
  });

  test("numbers and numeric text are numbers; anything else is not", () => {
    expect(TelemetryAlertRuleUtil.toNumber(5)).toBe(5);
    expect(TelemetryAlertRuleUtil.toNumber(" 5.5 ")).toBe(5.5);
    expect(TelemetryAlertRuleUtil.toNumber("")).toBeUndefined();
    expect(TelemetryAlertRuleUtil.toNumber("ten")).toBeUndefined();
    expect(TelemetryAlertRuleUtil.toNumber(Number.NaN)).toBeUndefined();
    expect(TelemetryAlertRuleUtil.toNumber(undefined)).toBeUndefined();
    expect(TelemetryAlertRuleUtil.toNumber(null)).toBeUndefined();
  });
});
