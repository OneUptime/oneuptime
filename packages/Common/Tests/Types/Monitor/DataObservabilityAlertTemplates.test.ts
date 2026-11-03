import {
  DATA_STORE_ID_SCOPE_ATTRIBUTE,
  DATA_TABLE_GROUP_BY_ATTRIBUTE,
  DataObservabilityAlertTemplate,
  DataObservabilityAlertTemplateArgs,
  getAllDataObservabilityAlertTemplates,
  getDataObservabilityAlertTemplate,
} from "../../../Types/Monitor/DataObservabilityAlertTemplates";
import {
  DATA_OBSERVABILITY_METRICS,
  DataObservabilityMetricDefinition,
  DataObservabilityMetricName,
} from "../../../Types/DataObservability/DataObservabilityMetric";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
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
 * A data store's table alerts are Metrics monitors over the
 * oneuptime.data.table.* metrics: one monitor per store, scoped by the
 * store's id and grouped by table, so a breach opens one alert per table.
 * Everything here is what makes such a monitor watch the right tables and
 * say which one broke.
 */

const STORE_ID: string = ObjectID.generate().toString();

function buildArgs(): DataObservabilityAlertTemplateArgs {
  return {
    dataStoreId: STORE_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "orders-db - Table Is Late",
  };
}

function getQueries(step: MonitorStep): Array<MetricQueryConfigData> {
  return step.data?.metricMonitor?.metricViewConfig?.queryConfigs || [];
}

function getInstances(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function getFilters(instance: MonitorCriteriaInstance): Array<CriteriaFilter> {
  return instance.data?.filters || [];
}

function getTemplate(id: string): DataObservabilityAlertTemplate {
  const template: DataObservabilityAlertTemplate | undefined =
    getDataObservabilityAlertTemplate(id);

  if (!template) {
    throw new Error(`No template ${id}`);
  }

  return template;
}

const TEMPLATES: Array<DataObservabilityAlertTemplate> =
  getAllDataObservabilityAlertTemplates();

describe("DataObservabilityAlertTemplates", () => {
  test("ships the freshness, volume, schema and collection checks", () => {
    expect(
      TEMPLATES.map((template: DataObservabilityAlertTemplate) => {
        return template.id;
      }),
    ).toEqual([
      "data-store-table-late",
      "data-store-row-count-fell-sharply",
      "data-store-row-count-unusually-low",
      "data-store-schema-changed",
      "data-store-table-health-stopped-reporting",
    ]);

    expect(
      new Set(
        TEMPLATES.map((template: DataObservabilityAlertTemplate) => {
          return template.category;
        }),
      ),
    ).toEqual(new Set(["Freshness", "Volume", "Schema", "Collection"]));
  });

  test("template ids are unique and found by id", () => {
    const ids: Array<string> = TEMPLATES.map(
      (template: DataObservabilityAlertTemplate) => {
        return template.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(getTemplate(id).id).toBe(id);
    }

    expect(getDataObservabilityAlertTemplate("no-such-template")).toBe(
      undefined,
    );
  });

  test("every template reads a metric table health writes", () => {
    const written: Set<string> = new Set(
      DATA_OBSERVABILITY_METRICS.map(
        (metric: DataObservabilityMetricDefinition) => {
          return metric.name;
        },
      ),
    );

    for (const template of TEMPLATES) {
      expect(template.monitorType).toBe(MonitorType.Metrics);
      expect(written.has(template.metricName)).toBe(true);

      const queries: Array<MetricQueryConfigData> = getQueries(
        template.getMonitorStep(buildArgs()),
      );

      expect(queries).toHaveLength(1);
      expect(queries[0]!.metricQueryData.filterData.metricName).toBe(
        template.metricName,
      );
    }
  });

  describe.each(TEMPLATES)(
    "$id",
    (template: DataObservabilityAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      test("watches this store's tables and nothing else", () => {
        for (const query of getQueries(step)) {
          expect(query.metricQueryData.filterData.attributes).toEqual({
            [DATA_STORE_ID_SCOPE_ATTRIBUTE]: STORE_ID,
          });
        }
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
        expect(instances[0]!.data?.alerts?.length).toBeGreaterThan(0);
        expect(instances[1]!.data?.createAlerts).toBe(false);
        expect(instances[0]!.data?.alerts?.[0]?.title).toContain("[Data]");
      });

      test("survives a round trip through JSON", () => {
        // fromJSON fills defaults in (isEnabled), so compare what the template built.
        const restored: MonitorStep = MonitorStep.fromJSON(step.toJSON());

        expect(getQueries(restored)).toEqual(getQueries(step));
        expect(
          getInstances(restored).map((instance: MonitorCriteriaInstance) => {
            return getFilters(instance);
          }),
        ).toEqual(
          getInstances(step).map((instance: MonitorCriteriaInstance) => {
            return getFilters(instance);
          }),
        );
        expect(MonitorStep.fromJSON(restored.toJSON()).toJSON()).toEqual(
          restored.toJSON(),
        );
      });
    },
  );

  test("per-table templates group by table, so each table alerts on its own", () => {
    for (const template of TEMPLATES) {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const groupBy: Array<string> = MonitorStep.getGroupByAttributeKeys(step);

      if (template.id === "data-store-table-health-stopped-reporting") {
        // The whole store is one series: an empty window is the store gone quiet.
        expect(groupBy).toEqual([]);
        continue;
      }

      expect(groupBy).toEqual([DATA_TABLE_GROUP_BY_ATTRIBUTE]);
    }

    // ...and the alert can name the table.
    expect(
      SeriesLabelDisplay.isKnownLabelKey(DATA_TABLE_GROUP_BY_ATTRIBUTE),
    ).toBe(true);
    expect(
      SeriesLabelDisplay.getFriendlyLabelName(DATA_TABLE_GROUP_BY_ATTRIBUTE),
    ).toBe("Table");
  });

  test("Table Is Late fires on overdue time sustained for the window", () => {
    const step: MonitorStep = getTemplate(
      "data-store-table-late",
    ).getMonitorStep(buildArgs());
    const [breach, recovery] = getInstances(step);
    const filter: CriteriaFilter = getFilters(breach!)[0]!;

    expect(filter.filterType).toBe(FilterType.GreaterThan);
    expect(filter.value).toBe(0);
    expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AllValues,
    );
    expect(getFilters(recovery!)[0]!.filterType).toBe(
      FilterType.LessThanOrEqualTo,
    );
    expect(getFilters(recovery!)[0]!.value).toBe(0);
    expect(getQueries(step)[0]!.metricQueryData.filterData.metricName).toBe(
      DataObservabilityMetricName.OverdueSeconds,
    );
  });

  test("Row Count Fell Sharply fires on the collection that saw half the rows go", () => {
    const step: MonitorStep = getTemplate(
      "data-store-row-count-fell-sharply",
    ).getMonitorStep(buildArgs());
    const [breach, recovery] = getInstances(step);
    const filter: CriteriaFilter = getFilters(breach!)[0]!;

    expect(filter.filterType).toBe(FilterType.LessThanOrEqualTo);
    expect(filter.value).toBe(-50);
    // An event: the next collection reads the smaller table as its normal.
    expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    expect(getFilters(recovery!)[0]!.filterType).toBe(FilterType.GreaterThan);
    expect(getFilters(recovery!)[0]!.value).toBe(-50);
  });

  test("Row Count Unusually Low compares each table with its own baseline", () => {
    const template: DataObservabilityAlertTemplate = getTemplate(
      "data-store-row-count-unusually-low",
    );
    const step: MonitorStep = template.getMonitorStep(buildArgs());
    const [breach, recovery] = getInstances(step);
    const filter: CriteriaFilter = getFilters(breach!)[0]!;

    expect(template.isLearned).toBe(true);
    expect(filter.filterType).toBe(FilterType.AnomalouslyLow);
    expect(filter.metricMonitorOptions?.anomalyDetection).toBeDefined();
    // Anything not anomalous is healthy: row counts are never negative.
    expect(getFilters(recovery!)[0]!.filterType).toBe(
      FilterType.GreaterThanOrEqualTo,
    );
    expect(getFilters(recovery!)[0]!.value).toBe(0);
    expect(
      getFilters(recovery!)[0]!.metricMonitorOptions?.anomalyDetection,
    ).toBeUndefined();
  });

  test("only the baseline template waits to learn", () => {
    expect(
      TEMPLATES.filter((template: DataObservabilityAlertTemplate) => {
        return template.isLearned;
      }).map((template: DataObservabilityAlertTemplate) => {
        return template.id;
      }),
    ).toEqual(["data-store-row-count-unusually-low"]);
  });

  test("Schema Changed fires on a collection that saw a column change", () => {
    const step: MonitorStep = getTemplate(
      "data-store-schema-changed",
    ).getMonitorStep(buildArgs());
    const filter: CriteriaFilter = getFilters(getInstances(step)[0]!)[0]!;

    expect(filter.filterType).toBe(FilterType.GreaterThan);
    expect(filter.value).toBe(0);
    expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.AnyValue,
    );
  });

  test("Table Health Stopped Reporting fires when nothing arrives at all", () => {
    const step: MonitorStep = getTemplate(
      "data-store-table-health-stopped-reporting",
    ).getMonitorStep(buildArgs());
    const query: MetricQueryConfigData = getQueries(step)[0]!;
    const filter: CriteriaFilter = getFilters(getInstances(step)[0]!)[0]!;

    expect(query.metricQueryData.filterData.metricName).toBe(
      DataObservabilityMetricName.SchemaChanges,
    );
    expect(query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Count,
    );
    expect(filter.metricMonitorOptions?.onNoDataPolicy).toBe(
      NoDataPolicy.Trigger,
    );
  });
});

describe("the data store in the recommendations catalog", () => {
  const recommendations: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.DataStore,
    );

  test("offers every template, for every store", () => {
    expect(
      recommendations.map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      }),
    ).toEqual(
      TEMPLATES.map((template: DataObservabilityAlertTemplate) => {
        return template.id;
      }),
    );

    for (const recommendation of recommendations) {
      expect(recommendation.recommendationId).toBe(
        `DataStore:${recommendation.templateId}`,
      );
    }
  });

  test("a created monitor reads back as this store's", () => {
    for (const recommendation of recommendations) {
      const step: MonitorStep = recommendation.getMonitorStep({
        resourceIdentifier: STORE_ID,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "orders-db",
      });

      expect(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(step)
          ?.resourceIdentifier,
      ).toBe(STORE_ID);
    }
  });

  test("two stores' monitors never read as the same", () => {
    const otherStoreId: string = ObjectID.generate().toString();

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
          monitorName: "a store",
        });
      };

      expect(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(build(STORE_ID))
          ?.resourceIdentifier,
      ).not.toBe(
        MonitorRecommendationUtil.getFingerprintFromMonitorStep(
          build(otherStoreId),
        )?.resourceIdentifier,
      );
    }
  });
});
