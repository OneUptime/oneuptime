/*
 * The baseline lookup is the only thing standing between this test and
 * ClickHouse. Stub it so the anomaly branch runs against a known baseline
 * and the assertions are about the SENTENCE, which is what an alert email
 * shows.
 */
jest.mock("../../../../../Server/Services/MetricBaselineService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/Services/MetricBaselineService",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getBaseline: jest.fn(),
    },
  };
});

import MetricMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MetricBaselineService, {
  BaselineSummary,
} from "../../../../../Server/Services/MetricBaselineService";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MetricAliasData from "../../../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE ANOMALY SENTENCE.
 *
 * An anomaly breach produces its own root cause — it never reaches
 * CompareCriteria — and it used to print `value.toFixed(3)` with the raw
 * exporter unit glued on:
 *
 *   "container.memory.usage value 1073741824.000 By is 4.20σ above ..."
 *
 * The quantities in it are now rendered exactly as the Breaching Samples
 * table renders them. σ is NOT one of those quantities: it is a count of
 * standard deviations, dimensionless by construction, and must stay a
 * bare number no matter what unit the metric carries.
 */

const BASELINE_MEAN: number = 268435456;
const BASELINE_STDDEV: number = 134217728;
const BREACHING_VALUE: number = 1073741824;

function baseline(): BaselineSummary {
  return {
    sampleCount: 480,
    mean: BASELINE_MEAN,
    stddev: BASELINE_STDDEV,
    median: BASELINE_MEAN,
    p95: BASELINE_MEAN,
    minObserved: 0,
    maxObserved: BREACHING_VALUE,
    isReliable: true,
    windowDays: 14,
    hourOfWeek: 0,
  } as BaselineSummary;
}

function buildInputs(input: {
  metricNativeUnit: string;
  metricName: string;
  sampleValue: number;
}): {
  criteriaFilter: CriteriaFilter;
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
  projectId: ObjectID;
} {
  const aliasData: MetricAliasData = {
    metricVariable: "a",
    title: input.metricName,
    description: undefined,
    legend: undefined,
    legendUnit: input.metricNativeUnit,
  };

  const queryConfig: MetricQueryConfigData = {
    metricAliasData: aliasData,
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
      },
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined } as never,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past1Minute,
  };

  const aggregated: AggregatedResult = {
    data: [
      {
        timestamp: new Date("2026-08-14T10:30:00.000Z"),
        value: input.sampleValue,
      } as AggregateModel,
    ],
  };

  const projectId: ObjectID = ObjectID.generate();

  return {
    criteriaFilter: {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.AnomalouslyHigh,
      metricMonitorOptions: {
        metricAlias: "a",
      },
    } as CriteriaFilter,
    monitorStep,
    dataToProcess: {
      projectId: projectId,
      metricResult: [aggregated],
      metricViewConfig,
      monitorId: ObjectID.generate(),
    },
    projectId,
  };
}

async function anomalyRootCause(input: {
  metricNativeUnit: string;
  metricName: string;
  sampleValue: number;
}): Promise<string> {
  const inputs: ReturnType<typeof buildInputs> = buildInputs(input);

  const message: string | null =
    await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      criteriaFilter: inputs.criteriaFilter,
      monitorStep: inputs.monitorStep,
      dataToProcess: inputs.dataToProcess,
      projectId: inputs.projectId,
    } as never);

  expect(message).toBeTruthy();
  return message as string;
}

describe("MetricMonitorCriteria - anomaly root cause units", () => {
  beforeEach(() => {
    (MetricBaselineService.getBaseline as unknown as jest.Mock).mockReset();
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue(baseline() as never);
  });

  test("value, mean and stddev are all rendered at human scale", async () => {
    const rootCause: string = await anomalyRootCause({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      sampleValue: BREACHING_VALUE,
    });

    expect(rootCause).toContain("value 1.07 GB");
    expect(rootCause).toContain("mean 268 MB");
    expect(rootCause).toContain("σ 134 MB");

    // The old rendering, in full.
    expect(rootCause).not.toContain("1073741824.000");
    expect(rootCause).not.toContain("268435456.000");
    expect(rootCause).not.toContain("By");
  });

  /*
   * The σ COUNT is not a quantity in the metric's unit — "6.00σ above the
   * baseline" is six standard deviations, and rendering it as "6 GB"
   * would be nonsense. It keeps its own two-decimal format.
   */
  test("the sigma count stays a bare number", async () => {
    const rootCause: string = await anomalyRootCause({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      sampleValue: BREACHING_VALUE,
    });

    expect(rootCause).toMatch(/is \d+\.\d{2}σ above the same-hour baseline/);
    expect(rootCause).not.toMatch(/is [\d.]+ [A-Za-z]+σ/);
  });

  test("a metric with no unit keeps its exact digits", async () => {
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue({
      ...baseline(),
      mean: 100,
      stddev: 20,
    } as never);

    const rootCause: string = await anomalyRootCause({
      metricName: "http.server.request.count",
      metricNativeUnit: "",
      sampleValue: 5000,
    });

    expect(rootCause).toContain("value 5000 ");
    expect(rootCause).not.toContain("5K");
  });

  test("a ratio metric reads as a percentage", async () => {
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue({
      ...baseline(),
      mean: 0.2,
      stddev: 0.05,
    } as never);

    const rootCause: string = await anomalyRootCause({
      metricName: "system.cpu.utilization",
      metricNativeUnit: "1",
      sampleValue: 0.85,
    });

    expect(rootCause).toContain("value 85.00%");
    expect(rootCause).toContain("mean 20.00%");
    expect(rootCause).not.toContain("0.85 1");
  });
});
