/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MetricMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MetricAliasData from "../../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import { describe, expect, test } from "@jest/globals";

/*
 * REGRESSION: a decimal metric threshold typed in the dashboard was
 * truncated to an integer before it was compared.
 *
 * The criteria form saves CriteriaFilter.value as the STRING the user
 * typed, and MetricMonitorCriteria read it through
 * CompareCriteria.convertToNumber, which runs parseInt. So "0.9" on a
 * ratio metric was compared as 0 — "error ratio > 0.9" fired on every
 * non-zero sample — and "85.5" was compared as 85. The evaluation log
 * meanwhile rendered the threshold with Number(), so it read "expected
 * to be greater than 0.9" right next to a criteria it said was met by
 * 0.5.
 *
 * Metric-value thresholds are now parsed with parseFloat. Every other
 * checkOn keeps parseInt (ProfileMonitorCriteria.test.ts pins that).
 */

const CRITERIA_ID: string = "decimal-threshold";

function buildStep(criteriaInstance: MonitorCriteriaInstance): MonitorStep {
  const metricAliasData: MetricAliasData = {
    metricVariable: "a",
    title: "Error Ratio",
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  };

  const queryConfig: MetricQueryConfigData = {
    metricAliasData,
    metricQueryData: {
      filterData: { metricName: "http.server.error_rate" },
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [],
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = {
    monitorCriteriaInstanceArray: [criteriaInstance],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: criteria,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past1Minute,
  };

  return monitorStep;
}

function buildResponse(sampleValues: Array<number>): MetricMonitorResponse {
  const aggregated: AggregatedResult = {
    data: sampleValues.map((value: number) => {
      return {
        timestamp: new Date("2026-09-25T00:00:00.000Z"),
        value,
      } as AggregateModel;
    }),
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [aggregated],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
  } as unknown as MetricMonitorResponse;
}

// The filter exactly as the dashboard criteria form saves it.
function dashboardFilter(input: {
  filterType: FilterType;
  value: string;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: input.filterType,
    value: input.value,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  };
}

function criteriaInstance(filter: CriteriaFilter): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: CRITERIA_ID,
    name: "Error ratio breach",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [filter],
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

async function processMonitorStep(input: {
  filter: CriteriaFilter;
  sampleValues: Array<number>;
}): Promise<{
  response: ProbeApiIngestResponse;
  filterResult: MonitorEvaluationFilterResult;
}> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Metrics;
  monitor.name = "Error ratio";

  const summary: MonitorEvaluationSummary = {
    criteriaResults: [],
    events: [],
  } as unknown as MonitorEvaluationSummary;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: buildResponse(input.sampleValues),
      monitorStep: buildStep(criteriaInstance(input.filter)),
      monitor,
      probeApiIngestResponse: {
        monitorId: monitor.id!,
        rootCause: null,
      },
      evaluationSummary: summary,
    });

  const criteriaResult: MonitorEvaluationCriteriaResult | undefined =
    summary.criteriaResults[0];
  expect(criteriaResult).toBeDefined();

  const filterResult: MonitorEvaluationFilterResult | undefined =
    criteriaResult!.filters[0];
  expect(filterResult).toBeDefined();

  return { response, filterResult: filterResult! };
}

async function metricCriteriaMet(input: {
  filter: CriteriaFilter;
  sampleValues: Array<number>;
}): Promise<string | null> {
  const criteria: MonitorCriteriaInstance = criteriaInstance(input.filter);

  return await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(input.sampleValues),
    criteriaFilter: input.filter,
    monitorStep: buildStep(criteria),
  });
}

describe("decimal metric thresholds, end to end through processMonitorStep", () => {
  test('"> 0.9" does not fire on a 0.5 sample', async () => {
    /*
     * The bug: "0.9" was parsed as 0, and 0.5 > 0 met the criteria and
     * opened an incident.
     */
    const { response, filterResult } = await processMonitorStep({
      filter: dashboardFilter({
        filterType: FilterType.GreaterThan,
        value: "0.9",
      }),
      sampleValues: [0.5],
    });

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.rootCause).toBeNull();
    expect(filterResult.met).toBe(false);
    expect(filterResult.value).toBe("0.9");
  });

  test('"> 0.9" fires on a 0.95 sample and the root cause quotes 0.9', async () => {
    const { response, filterResult } = await processMonitorStep({
      filter: dashboardFilter({
        filterType: FilterType.GreaterThan,
        value: "0.9",
      }),
      sampleValues: [0.95],
    });

    expect(response.criteriaMetId).toBe(CRITERIA_ID);
    expect(filterResult.met).toBe(true);
    expect(response.rootCause).toContain("0.9");
  });

  test('"> 85.5" does not fire on 85.2, which is above the old truncated 85', async () => {
    const { response, filterResult } = await processMonitorStep({
      filter: dashboardFilter({
        filterType: FilterType.GreaterThan,
        value: "85.5",
      }),
      sampleValues: [85.2],
    });

    expect(response.criteriaMetId).toBeUndefined();
    expect(filterResult.met).toBe(false);
  });

  test('"> 85.5" fires on 85.7', async () => {
    const { response, filterResult } = await processMonitorStep({
      filter: dashboardFilter({
        filterType: FilterType.GreaterThan,
        value: "85.5",
      }),
      sampleValues: [85.7],
    });

    expect(response.criteriaMetId).toBe(CRITERIA_ID);
    expect(filterResult.met).toBe(true);
  });

  test("the evaluation log quotes the threshold that was actually compared", async () => {
    /*
     * Before the fix this filter was logged as met, with the message
     * "Error Ratio was 0.5 in 1 reading, above the 0 threshold."
     */
    const notMet: { filterResult: MonitorEvaluationFilterResult } =
      await processMonitorStep({
        filter: dashboardFilter({
          filterType: FilterType.GreaterThan,
          value: "0.9",
        }),
        sampleValues: [0.5],
      });

    expect(notMet.filterResult.met).toBe(false);
    expect(notMet.filterResult.message).toContain(
      "expected to be greater than 0.9",
    );
    expect(notMet.filterResult.message).not.toContain("the 0 threshold");

    const met: { filterResult: MonitorEvaluationFilterResult } =
      await processMonitorStep({
        filter: dashboardFilter({
          filterType: FilterType.GreaterThan,
          value: "0.9",
        }),
        sampleValues: [0.95],
      });

    expect(met.filterResult.met).toBe(true);
    expect(met.filterResult.message).toContain("0.9 threshold");
  });
});

describe("decimal metric thresholds in MetricMonitorCriteria", () => {
  test('"< 0.5" fires on 0.3 (it compared as "< 0" before and never fired)', async () => {
    expect(
      await metricCriteriaMet({
        filter: dashboardFilter({
          filterType: FilterType.LessThan,
          value: "0.5",
        }),
        sampleValues: [0.3],
      }),
    ).toBeTruthy();
  });

  test('"< 0.5" does not fire on 0.7', async () => {
    expect(
      await metricCriteriaMet({
        filter: dashboardFilter({
          filterType: FilterType.LessThan,
          value: "0.5",
        }),
        sampleValues: [0.7],
      }),
    ).toBeNull();
  });

  test('">= 0.25" treats the boundary as met and 0.2 as not met', async () => {
    const filter: CriteriaFilter = dashboardFilter({
      filterType: FilterType.GreaterThanOrEqualTo,
      value: "0.25",
    });

    expect(
      await metricCriteriaMet({ filter, sampleValues: [0.25] }),
    ).toBeTruthy();
    expect(await metricCriteriaMet({ filter, sampleValues: [0.2] })).toBeNull();
  });

  test('"= 0.25" matches 0.25 and not 0', async () => {
    const filter: CriteriaFilter = dashboardFilter({
      filterType: FilterType.EqualTo,
      value: "0.25",
    });

    expect(
      await metricCriteriaMet({ filter, sampleValues: [0.25] }),
    ).toBeTruthy();
    expect(await metricCriteriaMet({ filter, sampleValues: [0] })).toBeNull();
  });

  test('a leading-dot ".5" is 0.5 (parseInt made it NaN, so the criteria never fired)', async () => {
    expect(
      await metricCriteriaMet({
        filter: dashboardFilter({
          filterType: FilterType.GreaterThan,
          value: ".5",
        }),
        sampleValues: [0.6],
      }),
    ).toBeTruthy();
  });

  test("a negative decimal threshold keeps its fraction", async () => {
    const filter: CriteriaFilter = dashboardFilter({
      filterType: FilterType.LessThan,
      value: "-0.5",
    });

    // parseInt("-0.5") is -0, so -0.2 < -0 used to fire.
    expect(
      await metricCriteriaMet({ filter, sampleValues: [-0.2] }),
    ).toBeNull();
    expect(
      await metricCriteriaMet({ filter, sampleValues: [-0.7] }),
    ).toBeTruthy();
  });

  test("an integer string threshold behaves exactly as before", async () => {
    const filter: CriteriaFilter = dashboardFilter({
      filterType: FilterType.GreaterThan,
      value: "90",
    });

    expect(
      await metricCriteriaMet({ filter, sampleValues: [91] }),
    ).toBeTruthy();
    expect(await metricCriteriaMet({ filter, sampleValues: [90] })).toBeNull();
  });

  test("a numeric (template-authored) decimal threshold is unchanged", async () => {
    const filter: CriteriaFilter = {
      ...dashboardFilter({ filterType: FilterType.GreaterThan, value: "" }),
      value: 0.9,
    };

    expect(
      await metricCriteriaMet({ filter, sampleValues: [0.95] }),
    ).toBeTruthy();
    expect(await metricCriteriaMet({ filter, sampleValues: [0.5] })).toBeNull();
  });

  test("a non-numeric or empty threshold leaves the criteria inert", async () => {
    for (const value of ["abc", "", "   "]) {
      expect(
        await metricCriteriaMet({
          filter: dashboardFilter({
            filterType: FilterType.GreaterThan,
            value,
          }),
          sampleValues: [1000],
        }),
      ).toBeNull();
      expect(
        await metricCriteriaMet({
          filter: dashboardFilter({ filterType: FilterType.LessThan, value }),
          sampleValues: [-1000],
        }),
      ).toBeNull();
    }
  });
});
