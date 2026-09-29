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
import { MetricAnomalyBaseline } from "../../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
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
 * list renders them. σ is NOT one of those quantities: it is a count of
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

interface AnomalyInputs {
  metricNativeUnit: string;
  metricName: string;
  sampleValue: number;
  /*
   * The unit the user picked on the query alias. The worker has already
   * converted samples into it; the baseline is still in the native unit.
   * Defaults to the native unit (no conversion).
   */
  legendUnit?: string;
  /*
   * What the worker ships as MetricMonitorResponse.nativeUnitsByMetricName.
   * Defaults to { <lowercased metric name>: metricNativeUnit }; pass null to
   * model a payload from before the map existed.
   */
  nativeUnitsByMetricName?: { [key: string]: string } | null;
  filterType?: FilterType;
}

function buildInputs(input: AnomalyInputs): {
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
    legendUnit:
      input.legendUnit !== undefined
        ? input.legendUnit
        : input.metricNativeUnit,
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

  const nativeUnitsByMetricName: { [key: string]: string } | undefined =
    input.nativeUnitsByMetricName === null
      ? undefined
      : input.nativeUnitsByMetricName || {
          [input.metricName.toLowerCase()]: input.metricNativeUnit,
        };

  return {
    criteriaFilter: {
      checkOn: CheckOn.MetricValue,
      filterType: input.filterType || FilterType.AnomalouslyHigh,
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
      nativeUnitsByMetricName,
    },
    projectId,
  };
}

async function evaluateAnomaly(input: AnomalyInputs): Promise<{
  message: string | null;
  anomalyBaseline: MetricAnomalyBaseline | undefined;
}> {
  const inputs: ReturnType<typeof buildInputs> = buildInputs(input);

  const message: string | null =
    await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      criteriaFilter: inputs.criteriaFilter,
      monitorStep: inputs.monitorStep,
      dataToProcess: inputs.dataToProcess,
      projectId: inputs.projectId,
    } as never);

  return {
    message,
    anomalyBaseline:
      inputs.criteriaFilter.metricCriteriaContext?.anomalyBaseline,
  };
}

async function anomalyRootCause(input: AnomalyInputs): Promise<string> {
  const { message } = await evaluateAnomaly(input);

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

/*
 * THE BASELINE IS IN THE NATIVE UNIT; THE SAMPLES ARE NOT.
 *
 * The worker converts every sample from the metric's native unit into the
 * query's legendUnit before criteria run. The baseline never goes through
 * that step: the ClickHouse MV aggregates the raw stored values, so its
 * mean and stddev stay in the native unit. With a legendUnit of "MB" on a
 * native "By" metric, the evaluator used to compare a sample of ~1074 MB
 * against a mean of 268435456 "MB" — and when something did get rendered
 * it read "value 1.07 GB ... (mean 268 TB, σ 134 TB ...)".
 */
describe("MetricMonitorCriteria - anomaly baseline is converted into the sample unit", () => {
  beforeEach(() => {
    (MetricBaselineService.getBaseline as unknown as jest.Mock).mockReset();
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue(baseline() as never);
  });

  // 1 GiB, 256 MiB and 128 MiB expressed in decimal megabytes.
  const BREACHING_VALUE_MB: number = BREACHING_VALUE / 1e6;
  const BASELINE_MEAN_MB: number = BASELINE_MEAN / 1e6;
  const BASELINE_STDDEV_MB: number = BASELINE_STDDEV / 1e6;

  test("a native-bytes baseline is compared and rendered in the legend unit", async () => {
    const { message, anomalyBaseline } = await evaluateAnomaly({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      legendUnit: "MB",
      sampleValue: BREACHING_VALUE_MB,
    });

    expect(message).toBeTruthy();
    const rootCause: string = message as string;

    // Same scale on both sides of the comparison.
    expect(rootCause).toContain("value 1.07 GB");
    expect(rootCause).toContain("mean 268 MB");
    expect(rootCause).toContain("σ 134 MB");
    expect(rootCause).toContain("is 6.00σ above the same-hour baseline");

    // The unconverted baseline read as megabytes.
    expect(rootCause).not.toContain("TB");
    expect(rootCause).not.toContain("PB");

    expect(anomalyBaseline?.state).toBe("Anomalous");
    expect(anomalyBaseline?.mean).toBeCloseTo(BASELINE_MEAN_MB, 6);
    expect(anomalyBaseline?.stddev).toBeCloseTo(BASELINE_STDDEV_MB, 6);
    expect(anomalyBaseline?.expectedHigh).toBeCloseTo(
      BASELINE_MEAN_MB + 3 * BASELINE_STDDEV_MB,
      6,
    );
    expect(anomalyBaseline?.expectedLow).toBeCloseTo(
      BASELINE_MEAN_MB - 3 * BASELINE_STDDEV_MB,
      6,
    );
    expect(anomalyBaseline?.observedValue).toBeCloseTo(BREACHING_VALUE_MB, 6);
    expect(anomalyBaseline?.observedSigma).toBeCloseTo(6, 6);
  });

  /*
   * Before the fix this sample could never breach: a ~1074 MB value sits
   * far below a 268435456 "MB" mean, so an AnomalouslyHigh monitor on a
   * legendUnit-converted metric was silently dead.
   */
  test("a real spike in the legend unit fires AnomalouslyHigh", async () => {
    const { message } = await evaluateAnomaly({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      legendUnit: "MB",
      sampleValue: BREACHING_VALUE_MB,
      filterType: FilterType.AnomalouslyHigh,
    });

    expect(message).not.toBeNull();
  });

  /*
   * ...and the mirror image: every legendUnit-scaled sample sat far below
   * the native-unit mean, so AnomalouslyLow fired on a value that is
   * exactly the baseline mean. A tight σ (1 MB) keeps the lower band
   * positive, which is what let the old comparison fire.
   */
  const TIGHT_STDDEV: number = 1e6;

  test("a value at the baseline mean does not fire AnomalouslyLow", async () => {
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue({
      ...baseline(),
      stddev: TIGHT_STDDEV,
    } as never);

    const { message, anomalyBaseline } = await evaluateAnomaly({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      legendUnit: "MB",
      sampleValue: BASELINE_MEAN_MB,
      filterType: FilterType.AnomalouslyLow,
    });

    expect(message).toBeNull();
    expect(anomalyBaseline?.state).toBe("Normal");
    expect(anomalyBaseline?.mean).toBeCloseTo(BASELINE_MEAN_MB, 6);
    expect(anomalyBaseline?.stddev).toBeCloseTo(1, 6);
    expect(anomalyBaseline?.expectedHigh).toBeCloseTo(BASELINE_MEAN_MB + 3, 6);
    expect(anomalyBaseline?.expectedLow).toBeCloseTo(BASELINE_MEAN_MB - 3, 6);
  });

  test("a value at the baseline mean does not fire Anomalous", async () => {
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue({
      ...baseline(),
      stddev: TIGHT_STDDEV,
    } as never);

    const { message } = await evaluateAnomaly({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      legendUnit: "GB",
      sampleValue: BASELINE_MEAN / 1e9,
      filterType: FilterType.Anomalous,
    });

    expect(message).toBeNull();
  });

  test("a fraction baseline is compared against percent samples", async () => {
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue({
      ...baseline(),
      mean: 0.2,
      stddev: 0.05,
    } as never);

    const { message, anomalyBaseline } = await evaluateAnomaly({
      metricName: "system.cpu.utilization",
      metricNativeUnit: "1",
      legendUnit: "%",
      sampleValue: 85,
    });

    expect(message).toBeTruthy();
    expect(message).toContain("value 85.00%");
    expect(message).toContain("mean 20.00%");
    expect(message).toContain("σ 5.00%");
    expect(message).toContain("is 13.00σ above");

    expect(anomalyBaseline?.mean).toBeCloseTo(20, 6);
    expect(anomalyBaseline?.stddev).toBeCloseTo(5, 6);
  });

  test("a native-seconds baseline is compared against millisecond samples", async () => {
    (
      MetricBaselineService.getBaseline as unknown as jest.Mock
    ).mockResolvedValue({
      ...baseline(),
      mean: 0.2,
      stddev: 0.1,
    } as never);

    const { message, anomalyBaseline } = await evaluateAnomaly({
      metricName: "http.server.request.duration",
      metricNativeUnit: "s",
      legendUnit: "ms",
      sampleValue: 1500,
    });

    expect(message).toBeTruthy();
    expect(message).toContain("is 13.00σ above");
    expect(anomalyBaseline?.mean).toBeCloseTo(200, 6);
    expect(anomalyBaseline?.stddev).toBeCloseTo(100, 6);
  });

  /*
   * The worker keys nativeUnitsByMetricName by the lowercased metric name;
   * the criteria keeps the name as the user typed it.
   */
  test("the native unit is looked up case-insensitively", async () => {
    const { message, anomalyBaseline } = await evaluateAnomaly({
      metricName: "Container.Memory.Usage",
      metricNativeUnit: "By",
      legendUnit: "MB",
      sampleValue: BREACHING_VALUE_MB,
      nativeUnitsByMetricName: { "container.memory.usage": "By" },
    });

    expect(message).toBeTruthy();
    expect(message).toContain("mean 268 MB");
    expect(anomalyBaseline?.mean).toBeCloseTo(BASELINE_MEAN_MB, 6);
  });

  test("the baseline passes through unchanged when the native unit is unknown", async () => {
    const { anomalyBaseline } = await evaluateAnomaly({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      legendUnit: "MB",
      sampleValue: BASELINE_MEAN_MB,
      nativeUnitsByMetricName: null,
    });

    expect(anomalyBaseline?.mean).toBe(BASELINE_MEAN);
    expect(anomalyBaseline?.stddev).toBe(BASELINE_STDDEV);
  });

  test("the baseline passes through unchanged when the units aren't convertible", async () => {
    const { anomalyBaseline } = await evaluateAnomaly({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      legendUnit: "ms",
      sampleValue: BASELINE_MEAN,
    });

    expect(anomalyBaseline?.mean).toBe(BASELINE_MEAN);
    expect(anomalyBaseline?.stddev).toBe(BASELINE_STDDEV);
  });

  test("no legendUnit leaves samples and baseline both in the native unit", async () => {
    const rootCause: string = await anomalyRootCause({
      metricName: "container.memory.usage",
      metricNativeUnit: "By",
      legendUnit: "",
      sampleValue: BREACHING_VALUE,
    });

    expect(rootCause).toContain("value 1.07 GB");
    expect(rootCause).toContain("mean 268 MB");
    expect(rootCause).toContain("σ 134 MB");
    expect(rootCause).toContain("is 6.00σ above");
  });
});
