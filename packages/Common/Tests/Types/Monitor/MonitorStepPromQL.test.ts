import { JSONObject } from "../../../Types/JSON";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStepMetricMonitor, {
  MetricMonitorQueryLanguage,
  MonitorStepMetricMonitorUtil,
  PROMQL_METRIC_ALIAS,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleReadResult,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { describe, expect, test } from "@jest/globals";

/*
 * A Metrics monitor's step written in PromQL (issue #7712): stored beside
 * the builder's queries, which it keeps, and judged as its one expression,
 * series by series.
 */

const builderQuery: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "a",
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  },
  metricQueryData: {
    filterData: { metricName: "http.server.request.duration" },
  },
} as unknown as MetricQueryConfigData;

const promQLStep: (query: string) => MonitorStepMetricMonitor = (
  query: string,
): MonitorStepMetricMonitor => {
  return {
    queryLanguage: MetricMonitorQueryLanguage.PromQL,
    promQLQuery: query,
    metricViewConfig: { queryConfigs: [builderQuery], formulaConfigs: [] },
    rollingTime: RollingTime.Past5Minutes,
  };
};

const OPERATIONAL: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000001",
);
const OFFLINE: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000003");

// A new Metrics monitor's first step, as the form seeds it, in PromQL.
const buildMonitorStep: (
  metricMonitor: MonitorStepMetricMonitor,
) => MonitorStep = (metricMonitor: MonitorStepMetricMonitor): MonitorStep => {
  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Metrics,
    monitorName: "Errors",
    defaultMonitorStatusId: OPERATIONAL,
    onlineMonitorStatusId: OPERATIONAL,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  const step: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;
  step.setMetricMonitor(metricMonitor);
  return step;
};

const readRule: (step: MonitorStep) => TelemetryAlertRuleReadResult = (
  step: MonitorStep,
): TelemetryAlertRuleReadResult => {
  return TelemetryAlertRuleUtil.read({
    monitorType: MonitorType.Metrics,
    monitorStep: step,
    defaultMonitorStatusId: OPERATIONAL,
  });
};

describe("a step's query language", () => {
  test("a step is the builder's until it says PromQL", () => {
    expect(MonitorStepMetricMonitorUtil.isPromQL(undefined)).toBe(false);
    expect(
      MonitorStepMetricMonitorUtil.isPromQL(
        MonitorStepMetricMonitorUtil.getDefault(),
      ),
    ).toBe(false);
    expect(
      MonitorStepMetricMonitorUtil.isPromQL({
        ...promQLStep("up"),
        queryLanguage: MetricMonitorQueryLanguage.Builder,
      }),
    ).toBe(false);
    expect(MonitorStepMetricMonitorUtil.isPromQL(promQLStep("up"))).toBe(true);
  });

  test("the expression is read trimmed, and never as anything but text", () => {
    expect(
      MonitorStepMetricMonitorUtil.getPromQLQuery(promQLStep("  up == 0 \n")),
    ).toBe("up == 0");
    expect(
      MonitorStepMetricMonitorUtil.getPromQLQuery({
        ...promQLStep(""),
        promQLQuery: 5 as unknown as string,
      }),
    ).toBe("");
  });

  test("both survive the JSON a step is stored as, with the builder's queries", () => {
    const stored: JSONObject = MonitorStepMetricMonitorUtil.toJSON(
      promQLStep("sum(rate(x[5m]))"),
    );
    const read: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON(
        JSON.parse(JSON.stringify(stored)) as JSONObject,
      );

    expect(read.queryLanguage).toBe(MetricMonitorQueryLanguage.PromQL);
    expect(read.promQLQuery).toBe("sum(rate(x[5m]))");
    expect(read.metricViewConfig.queryConfigs).toHaveLength(1);
    expect(
      read.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
        .metricName,
    ).toBe("http.server.request.duration");
  });
});

describe("what a PromQL step is judged as", () => {
  test("one query, its expression, under the PromQL alias", () => {
    const viewConfig: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getEvaluatedViewConfig(
        promQLStep("up == 0"),
      );

    expect(viewConfig.formulaConfigs).toEqual([]);
    expect(viewConfig.queryConfigs).toHaveLength(1);
    expect(viewConfig.queryConfigs[0]!.metricAliasData?.metricVariable).toBe(
      PROMQL_METRIC_ALIAS,
    );
    // A root cause names the expression it compared.
    expect(viewConfig.queryConfigs[0]!.metricAliasData?.title).toBe("up == 0");
    // No metric of the builder's to read.
    expect(
      viewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName,
    ).toBeUndefined();
  });

  test("the builder's own editor still reads the builder's queries", () => {
    expect(
      MonitorStepMetricMonitorUtil.getMetricViewConfig(promQLStep("up"))
        .queryConfigs,
    ).toEqual([builderQuery]);
    expect(
      MonitorStepMetricMonitorUtil.getEvaluatedViewConfig({
        ...promQLStep("up"),
        queryLanguage: MetricMonitorQueryLanguage.Builder,
      }).queryConfigs,
    ).toEqual([builderQuery]);
  });

  test("the criteria evaluator reads the expression, series by series", () => {
    const step: MonitorStep = buildMonitorStep(promQLStep("up == 0"));

    expect(
      MonitorStep.getMetricsViewConfig(step)?.queryConfigs[0]?.metricAliasData
        ?.metricVariable,
    ).toBe(PROMQL_METRIC_ALIAS);
    // Every series its own, though nothing is grouped by attributes.
    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
    expect(MonitorStep.isJudgedPerSeries(step)).toBe(true);
  });

  test("a builder step is per series only when it is grouped", () => {
    const step: MonitorStep = buildMonitorStep({
      ...promQLStep("up"),
      queryLanguage: MetricMonitorQueryLanguage.Builder,
    });

    expect(MonitorStep.isJudgedPerSeries(step)).toBe(false);

    step.setMetricMonitor({
      ...step.data!.metricMonitor!,
      metricViewConfig: {
        queryConfigs: [
          {
            ...builderQuery,
            metricQueryData: {
              ...builderQuery.metricQueryData,
              groupByAttributeKeys: ["host.name"],
            },
          },
        ],
        formulaConfigs: [],
      },
    });

    expect(MonitorStep.isJudgedPerSeries(step)).toBe(true);
  });
});

describe("a PromQL step is refused until its expression can run", () => {
  test.each([
    [
      "",
      "Write the PromQL expression this monitor evaluates, such as sum(rate(http_requests_total[5m])).",
    ],
    ["up[5m]", "The PromQL expression is a range vector"],
    ["sum(", "The PromQL expression does not parse: "],
  ])("%j", (query: string, message: string) => {
    expect(
      MonitorStep.getValidationError(
        buildMonitorStep(promQLStep(query)),
        MonitorType.Metrics,
      ),
    ).toContain(message);
  });

  test("an expression that runs passes", () => {
    expect(
      MonitorStep.getValidationError(
        buildMonitorStep(promQLStep("sum by (job) (rate(errors[5m])) > 1")),
        MonitorType.Metrics,
      ),
    ).toBeNull();
  });

  test("a builder step keeps whatever expression it holds unchecked", () => {
    expect(
      MonitorStep.getValidationError(
        buildMonitorStep({
          ...promQLStep("sum("),
          queryLanguage: MetricMonitorQueryLanguage.Builder,
        }),
        MonitorType.Metrics,
      ),
    ).toBeNull();
  });
});

describe("When to alert, on a PromQL step", () => {
  test("names the expression as the one thing a rule compares", () => {
    expect(
      TelemetryAlertRuleUtil.getMetricAliases(
        buildMonitorStep(promQLStep("up")),
      ),
    ).toEqual([PROMQL_METRIC_ALIAS]);
  });

  test("still reads as a rule when its criteria name a builder query", () => {
    const step: MonitorStep = buildMonitorStep(promQLStep("up"));
    const read: TelemetryAlertRuleReadResult = readRule(step);

    expect(read.problem).toBeNull();

    // A rule written while the step read the builder's query "a".
    const rule: TelemetryAlertRule = read.rule!;
    const written: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: {
        ...rule,
        metricAlias: "a",
        filterType: FilterType.EqualTo,
        threshold: 0,
      },
    });

    expect(readRule(written).problem).toBeNull();
    expect(readRule(written).rule).toMatchObject({
      filterType: FilterType.EqualTo,
      threshold: 0,
    });

    // On a builder step without that query, the same criteria is no rule.
    written.setMetricMonitor({
      ...written.data!.metricMonitor!,
      queryLanguage: MetricMonitorQueryLanguage.Builder,
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    });
    expect(readRule(written).problem).not.toBeNull();
    written.setMetricMonitor({
      ...written.data!.metricMonitor!,
      queryLanguage: MetricMonitorQueryLanguage.PromQL,
    });
    // Writing the rule leaves the expression and its language as they were.
    expect(written.data?.metricMonitor?.promQLQuery).toBe("up");
    expect(written.data?.metricMonitor?.queryLanguage).toBe(
      MetricMonitorQueryLanguage.PromQL,
    );
    expect(
      written.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray[0]?.data
        ?.filters[0]?.checkOn,
    ).toBe(CheckOn.MetricValue);
  });

  test("offers no anomaly conditions: an expression has no hourly baseline", () => {
    const comparisons: Array<FilterType> =
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Metrics,
        isPromQL: true,
      });

    expect(comparisons).toContain(FilterType.GreaterThan);
    expect(comparisons).toContain(FilterType.ForecastAbove);
    expect(comparisons).not.toContain(FilterType.AnomalouslyHigh);
    expect(
      TelemetryAlertRuleUtil.getComparisons({
        monitorType: MonitorType.Metrics,
      }),
    ).toContain(FilterType.AnomalouslyHigh);
  });
});
