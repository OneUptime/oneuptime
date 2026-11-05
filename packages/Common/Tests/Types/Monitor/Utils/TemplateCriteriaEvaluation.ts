import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import { CriteriaFilter } from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../../Types/ObjectID";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";

/*
 * Run an alert template's criteria through the real metric evaluator
 * (MetricMonitorCriteria), the way the telemetry worker hands it one
 * series' data: one data point per minute for each query, ending at the
 * window's end, and every formula evaluated over them as
 * MonitorTelemetryMonitor.appendFormulaResults does.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// One value per minute for each query alias, oldest first.
export type SamplesByAlias = Record<string, Array<number>>;

export const WINDOW_END_MS: number = Date.UTC(2026, 9, 30, 12, 0, 0);

export function buildMetricResponse(data: {
  viewConfig: MetricsViewConfig;
  samplesByAlias: SamplesByAlias;
  // The template's window: what "All Values" judges a series' coverage by.
  windowMinutes: number;
}): MetricMonitorResponse {
  const results: Array<AggregatedResult> = data.viewConfig.queryConfigs.map(
    (queryConfig: MetricQueryConfigData): AggregatedResult => {
      const samples: Array<number> =
        data.samplesByAlias[
          queryConfig.metricAliasData?.metricVariable || ""
        ] || [];
      const firstMinuteMs: number = WINDOW_END_MS - samples.length * 60000;

      return {
        data: samples.map((value: number, index: number): AggregateModel => {
          return {
            timestamp: new Date(firstMinuteMs + index * 60000),
            value: value,
          } as AggregateModel;
        }),
      };
    },
  );

  (data.viewConfig.formulaConfigs || []).forEach(
    (formulaConfig: MetricFormulaConfigData, index: number) => {
      results.push(
        MetricFormulaEvaluator.evaluateFormula({
          formula: formulaConfig.metricFormulaData.metricFormula,
          queryConfigs: data.viewConfig.queryConfigs,
          formulaConfigs: (data.viewConfig.formulaConfigs || []).slice(
            0,
            index,
          ),
          results: results,
        }),
      );
    },
  );

  return {
    projectId: ObjectID.generate(),
    metricViewConfig: data.viewConfig,
    monitorId: ObjectID.generate(),
    startAndEndDate: {
      startValue: new Date(WINDOW_END_MS - data.windowMinutes * 60000),
      endValue: new Date(WINDOW_END_MS),
    } as NonNullable<MetricMonitorResponse["startAndEndDate"]>,
    metricResult: results,
  };
}

// Whether a criteria instance is met, combining its filters as it says.
export async function isCriteriaInstanceMet(
  step: MonitorStep,
  instance: MonitorCriteriaInstance,
  response: MetricMonitorResponse,
): Promise<boolean> {
  const results: Array<boolean> = [];

  for (const filter of instance.data!.filters) {
    const rootCause: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        // A copy: the evaluator writes its context back onto the filter.
        criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
        monitorStep: step,
      });

    results.push(rootCause !== null);
  }

  return instance.data!.filterCondition === FilterCondition.All
    ? results.every((met: boolean): boolean => {
        return met;
      })
    : results.some((met: boolean): boolean => {
        return met;
      });
}

/*
 * Whether a template's firing criteria (the first) and recovery criteria
 * (the last) are met by one series' samples.
 */
export async function evaluateTemplateCriteria(data: {
  step: MonitorStep;
  viewConfig: MetricsViewConfig;
  samplesByAlias: SamplesByAlias;
  windowMinutes: number;
}): Promise<{ breached: boolean; healthy: boolean }> {
  const response: MetricMonitorResponse = buildMetricResponse({
    viewConfig: data.viewConfig,
    samplesByAlias: data.samplesByAlias,
    windowMinutes: data.windowMinutes,
  });
  const instances: Array<MonitorCriteriaInstance> =
    data.step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    breached: await isCriteriaInstanceMet(
      data.step,
      instances[0] as MonitorCriteriaInstance,
      response,
    ),
    healthy: await isCriteriaInstanceMet(
      data.step,
      instances[instances.length - 1] as MonitorCriteriaInstance,
      response,
    ),
  };
}

/*
 * The same, for readings with their own times rather than one a minute: a real recording's. They
 * land in one-minute buckets the way a monitor's read does, each by its query's own aggregation.
 */
export interface TimedSample {
  timeMs: number;
  value: number;
}

export type TimedSamplesByAlias = Record<string, Array<TimedSample>>;

const MINUTE_MS: number = 60000;

function bucketsOf(data: {
  samples: ReadonlyArray<TimedSample>;
  aggregation: unknown;
  windowStartMs: number;
  windowEndMs: number;
}): Array<AggregateModel> {
  const buckets: Map<number, Array<number>> = new Map();
  for (const sample of data.samples) {
    if (
      sample.timeMs < data.windowStartMs ||
      sample.timeMs >= data.windowEndMs
    ) {
      continue;
    }
    const minute: number = Math.floor(sample.timeMs / MINUTE_MS) * MINUTE_MS;
    buckets.set(minute, [...(buckets.get(minute) || []), sample.value]);
  }
  return Array.from(buckets.entries())
    .sort((first: [number, Array<number>], second: [number, Array<number>]) => {
      return first[0] - second[0];
    })
    .map(([minute, values]: [number, Array<number>]): AggregateModel => {
      const value: number =
        data.aggregation === MetricsAggregationType.Min
          ? Math.min(...values)
          : data.aggregation === MetricsAggregationType.Avg
            ? values.reduce((sum: number, one: number): number => {
                return sum + one;
              }, 0) / values.length
            : Math.max(...values);
      return { timestamp: new Date(minute), value } as AggregateModel;
    });
}

export function buildMetricResponseOverWindow(data: {
  viewConfig: MetricsViewConfig;
  samplesByAlias: TimedSamplesByAlias;
  windowStartMs: number;
  windowEndMs: number;
}): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    metricViewConfig: data.viewConfig,
    monitorId: ObjectID.generate(),
    startAndEndDate: {
      startValue: new Date(data.windowStartMs),
      endValue: new Date(data.windowEndMs),
    } as NonNullable<MetricMonitorResponse["startAndEndDate"]>,
    metricResult: data.viewConfig.queryConfigs.map(
      (queryConfig: MetricQueryConfigData): AggregatedResult => {
        return {
          data: bucketsOf({
            samples:
              data.samplesByAlias[
                queryConfig.metricAliasData?.metricVariable || ""
              ] || [],
            aggregation: queryConfig.metricQueryData.filterData.aggegationType,
            windowStartMs: data.windowStartMs,
            windowEndMs: data.windowEndMs,
          }),
        };
      },
    ),
  };
}

export interface TemplateWalkStep {
  atMs: number;
  breached: boolean;
  healthy: boolean;
}

// A monitor's every evaluation, a minute apart, along a recording.
export async function walkTemplateCriteria(data: {
  step: MonitorStep;
  viewConfig: MetricsViewConfig;
  samplesByAlias: TimedSamplesByAlias;
  windowMinutes: number;
  startMs: number;
  endMs: number;
}): Promise<Array<TemplateWalkStep>> {
  const instances: Array<MonitorCriteriaInstance> =
    data.step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  const steps: Array<TemplateWalkStep> = [];
  for (let atMs: number = data.startMs; atMs <= data.endMs; atMs += MINUTE_MS) {
    const response: MetricMonitorResponse = buildMetricResponseOverWindow({
      viewConfig: data.viewConfig,
      samplesByAlias: data.samplesByAlias,
      windowStartMs: atMs - data.windowMinutes * MINUTE_MS,
      windowEndMs: atMs,
    });
    steps.push({
      atMs,
      breached: await isCriteriaInstanceMet(
        data.step,
        instances[0] as MonitorCriteriaInstance,
        response,
      ),
      healthy: await isCriteriaInstanceMet(
        data.step,
        instances[instances.length - 1] as MonitorCriteriaInstance,
        response,
      ),
    });
  }
  return steps;
}
