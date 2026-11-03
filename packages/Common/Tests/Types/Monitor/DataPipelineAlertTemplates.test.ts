import {
  DATA_PIPELINE_ID_SCOPE_ATTRIBUTE,
  DataPipelineAlertTemplate,
  DataPipelineAlertTemplateArgs,
  getAllDataPipelineAlertTemplates,
  getDataPipelineAlertTemplate,
} from "../../../Types/Monitor/DataPipelineAlertTemplates";
import {
  DATA_PIPELINE_METRICS,
  DataPipelineMetricDefinition,
  DataPipelineMetricName,
} from "../../../Types/DataObservability/DataPipelineMetric";
import { UNUSUALLY_LONG_RATIO } from "../../../Types/DataObservability/DataPipelineSchedule";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A pipeline's alerts are Metrics monitors over the
 * oneuptime.data.pipeline.* metrics its runs and the five-minute schedule
 * check write: one monitor per pipeline, scoped by the pipeline's id.
 * Everything here is what makes such a monitor watch the right pipeline and
 * fire when its page says something is wrong.
 */

const PIPELINE_ID: string = ObjectID.generate().toString();

function buildArgs(): DataPipelineAlertTemplateArgs {
  return {
    dataPipelineId: PIPELINE_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "load_orders - Pipeline Run Failed",
  };
}

function getQueries(step: MonitorStep): Array<MetricQueryConfigData> {
  return step.data?.metricMonitor?.metricViewConfig?.queryConfigs || [];
}

function getInstances(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function getFilter(instance: MonitorCriteriaInstance): CriteriaFilter {
  return instance.data!.filters[0]!;
}

function getStep(id: string): MonitorStep {
  const template: DataPipelineAlertTemplate | undefined =
    getDataPipelineAlertTemplate(id);

  if (!template) {
    throw new Error(`No template ${id}`);
  }

  return template.getMonitorStep(buildArgs());
}

const TEMPLATES: Array<DataPipelineAlertTemplate> =
  getAllDataPipelineAlertTemplates();

describe("DataPipelineAlertTemplates", () => {
  test("ships failed, unusually long and late", () => {
    expect(
      TEMPLATES.map((template: DataPipelineAlertTemplate) => {
        return template.id;
      }),
    ).toEqual([
      "data-pipeline-run-failed",
      "data-pipeline-run-unusually-long",
      "data-pipeline-late",
    ]);
    expect(getDataPipelineAlertTemplate("no-such-template")).toBe(undefined);
  });

  test("every template reads a metric pipelines write", () => {
    const written: Set<string> = new Set(
      DATA_PIPELINE_METRICS.map((metric: DataPipelineMetricDefinition) => {
        return metric.name;
      }),
    );

    for (const template of TEMPLATES) {
      expect(template.monitorType).toBe(MonitorType.Metrics);
      expect(written.has(template.metricName)).toBe(true);
    }
  });

  describe.each(TEMPLATES)("$id", (template: DataPipelineAlertTemplate) => {
    const step: MonitorStep = template.getMonitorStep(buildArgs());

    test("watches this pipeline and nothing else, as one series", () => {
      const queries: Array<MetricQueryConfigData> = getQueries(step);

      expect(queries).toHaveLength(1);
      expect(queries[0]!.metricQueryData.filterData.metricName).toBe(
        template.metricName,
      );
      expect(queries[0]!.metricQueryData.filterData.attributes).toEqual({
        [DATA_PIPELINE_ID_SCOPE_ATTRIBUTE]: PIPELINE_ID,
      });
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
    });

    test("is a valid Metrics step", () => {
      expect(MonitorStep.getValidationError(step, MonitorType.Metrics)).toBe(
        null,
      );
    });

    test("has a breach and a recovery, the breach raising an alert", () => {
      const instances: Array<MonitorCriteriaInstance> = getInstances(step);

      expect(instances).toHaveLength(2);
      expect(instances[0]!.data?.createAlerts).toBe(true);
      expect(instances[0]!.data?.alerts?.[0]?.title).toContain("[Data]");
      expect(instances[1]!.data?.createAlerts).toBe(false);
    });

    test("recovers on exactly the values that do not breach", () => {
      const [breach, recovery] = getInstances(step);

      expect(getFilter(recovery!).value).toBe(getFilter(breach!).value);
      expect(
        getFilter(recovery!).metricMonitorOptions?.metricAggregationType,
      ).toBe(EvaluateOverTimeType.AllValues);
    });

    test("survives a round trip through JSON", () => {
      const restored: MonitorStep = MonitorStep.fromJSON(step.toJSON());

      expect(getQueries(restored)).toEqual(getQueries(step));
      expect(MonitorStep.fromJSON(restored.toJSON()).toJSON()).toEqual(
        restored.toJSON(),
      );
    });
  });

  test("Pipeline Run Failed fires on any failed run in the hour", () => {
    const [breach, recovery] = getInstances(
      getStep("data-pipeline-run-failed"),
    );

    expect(getFilter(breach!).filterType).toBe(FilterType.GreaterThan);
    expect(getFilter(breach!).value).toBe(0);
    expect(getFilter(breach!).metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    expect(getFilter(recovery!).filterType).toBe(FilterType.LessThanOrEqualTo);
  });

  test("Pipeline Run Unusually Long fires at twice the typical run, no baseline needed", () => {
    const step: MonitorStep = getStep("data-pipeline-run-unusually-long");
    const [breach, recovery] = getInstances(step);

    expect(getQueries(step)[0]!.metricQueryData.filterData.metricName).toBe(
      DataPipelineMetricName.RunDurationRatio,
    );
    expect(getFilter(breach!).filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(getFilter(breach!).value).toBe(UNUSUALLY_LONG_RATIO);
    // Learned from the pipeline's runs, not an hour-of-week baseline.
    expect(getFilter(breach!).metricMonitorOptions?.anomalyDetection).toBe(
      undefined,
    );
    expect(getFilter(recovery!).filterType).toBe(FilterType.LessThan);
  });

  test("Pipeline Is Late fires on lateness sustained for the window", () => {
    const step: MonitorStep = getStep("data-pipeline-late");
    const [breach, recovery] = getInstances(step);

    expect(getQueries(step)[0]!.metricQueryData.filterData.metricName).toBe(
      DataPipelineMetricName.OverdueSeconds,
    );
    expect(getFilter(breach!).filterType).toBe(FilterType.GreaterThan);
    expect(getFilter(breach!).value).toBe(0);
    expect(getFilter(breach!).metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AllValues,
    );
    expect(getFilter(recovery!).filterType).toBe(FilterType.LessThanOrEqualTo);
  });

  test("an alert can name the pipeline it is about", () => {
    expect(
      SeriesLabelDisplay.getFriendlyLabelName("oneuptime.data.pipeline.name"),
    ).toBe("Pipeline");
    expect(
      SeriesLabelDisplay.isKnownLabelKey(DATA_PIPELINE_ID_SCOPE_ATTRIBUTE),
    ).toBe(true);
  });
});

describe("the data pipeline in the recommendations catalog", () => {
  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.DataPipeline,
    );

  test("offers every template, for every pipeline", () => {
    expect(
      recommendations.map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      }),
    ).toEqual(
      TEMPLATES.map((template: DataPipelineAlertTemplate) => {
        return template.id;
      }),
    );

    for (const recommendation of recommendations) {
      expect(recommendation.recommendationId).toBe(
        `DataPipeline:${recommendation.templateId}`,
      );
    }
  });

  test("a created monitor reads back as this pipeline's, and no other's", () => {
    const otherPipelineId: string = ObjectID.generate().toString();

    for (const recommendation of recommendations) {
      const build: (resourceIdentifier: string) => MonitorStep = (
        resourceIdentifier: string,
      ): MonitorStep => {
        return recommendation.getMonitorStep({
          resourceIdentifier,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "load_orders",
        });
      };

      expect(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          build(PIPELINE_ID),
        )?.resourceIdentifier,
      ).toBe(PIPELINE_ID);
      expect(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          build(otherPipelineId),
        )?.resourceIdentifier,
      ).toBe(otherPipelineId);
    }
  });
});
