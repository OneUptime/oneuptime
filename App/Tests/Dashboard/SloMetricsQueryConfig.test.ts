import { describe, expect, test } from "@jest/globals";
import {
  buildSloAlertMetricQueryConfigs,
  buildSloIncidentMetricQueryConfigs,
  buildSloMetricQueryConfigs,
  getSloAlertMetricDescription,
  getSloIncidentMetricDescription,
  getSloMetricCategories,
  SLO_ALERT_METRICS_CARD,
  SLO_EVENT_METRICS_DEFAULT_TIME_RANGE,
  SLO_INCIDENT_METRICS_CARD,
  SLO_METRICS_DEFAULT_TIME_RANGE,
  SLO_METRICS_TABS,
  SLO_TARGET_SERIES_COLOR,
  SloMetricCategory,
  SloMetricsTab,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloMetricsQueryConfig";
import AlertMetricType from "Common/Types/Alerts/AlertMetricType";
import Search from "Common/Types/BaseDatabase/Search";
import IncidentMetricType from "Common/Types/Incident/IncidentMetricType";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import ObjectID from "Common/Types/ObjectID";
import SloMetricType from "Common/Types/ServiceLevelObjective/SloMetricType";
import TimeRange from "Common/Types/Time/TimeRange";
import AlertMetricTypeUtil from "Common/Utils/Alerts/AlertMetricType";
import IncidentMetricTypeUtil from "Common/Utils/Incident/IncidentMetricType";
import SloMetricTypeUtil, {
  SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE,
} from "Common/Utils/Slo/SloMetricType";

/*
 * The SLO Metrics page is four tabs of metric queries. A query that names the
 * wrong series, filters on the wrong attribute key or groups by attributes
 * still renders - as an empty or split chart - so the builders that produce
 * those queries are pinned here as plain data, with no renderer. The emitter
 * side of the same keys is pinned by SloMetricUtil.test.ts and
 * SloAffectedResourceMetricAttributes.test.ts, through the same constants.
 */

const SLO_ID: ObjectID = new ObjectID("0193c0de-5555-4aaa-8bbb-000000000005");
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

type Attributes = Record<string, unknown>;

function attributesOf(queryConfig: MetricQueryConfigData): Attributes {
  return queryConfig.metricQueryData.filterData.attributes as Attributes;
}

function filterDataOf(queryConfig: MetricQueryConfigData): JSONObject {
  return queryConfig.metricQueryData.filterData as unknown as JSONObject;
}

function allSloQueryConfigs(): Array<MetricQueryConfigData> {
  return buildSloMetricQueryConfigs({
    sloId: SLO_ID,
    projectId: PROJECT_ID,
    metrics: SloMetricTypeUtil.getAll(),
  });
}

function configFor(
  queryConfigs: Array<MetricQueryConfigData>,
  metricName: string,
): MetricQueryConfigData {
  const queryConfig: MetricQueryConfigData | undefined = queryConfigs.find(
    (candidate: MetricQueryConfigData): boolean => {
      return candidate.metricQueryData.filterData.metricName === metricName;
    },
  );

  expect(queryConfig).toBeDefined();
  return queryConfig!;
}

describe("tabs and default ranges", () => {
  test("the page has exactly four tabs, in reading order", () => {
    expect([...SLO_METRICS_TABS]).toEqual([
      "SLO Metrics",
      "Error Budget History",
      "Incident Metrics",
      "Alert Metrics",
    ]);
    expect(Object.values(SloMetricsTab).sort()).toEqual(
      [...SLO_METRICS_TABS].sort(),
    );
  });

  test("SLO series open on the past day - a few hundred points, not a monitor's dozen", () => {
    expect(SLO_METRICS_DEFAULT_TIME_RANGE).toEqual({
      range: TimeRange.PAST_ONE_DAY,
    });
  });

  test("incident and alert cards open on the past week, where rare burn-rate events are visible", () => {
    expect(SLO_EVENT_METRICS_DEFAULT_TIME_RANGE).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });
  });
});

describe("getSloMetricCategories", () => {
  const categories: Array<SloMetricCategory> = getSloMetricCategories();

  test("groups the series into Objective, Burn and Status cards", () => {
    expect(
      categories.map((category: SloMetricCategory): string => {
        return category.title;
      }),
    ).toEqual(["Objective", "Burn", "Status"]);
  });

  test("charts every SloMetricType exactly once across the cards", () => {
    const charted: Array<SloMetricType> = categories.flatMap(
      (category: SloMetricCategory): Array<SloMetricType> => {
        return category.metrics;
      },
    );

    expect([...charted].sort()).toEqual(
      [...(Object.values(SloMetricType) as Array<SloMetricType>)].sort(),
    );
    expect(new Set(charted).size).toBe(charted.length);
  });

  test("every card has a stable unique id and a description", () => {
    const ids: Array<string> = categories.map(
      (category: SloMetricCategory): string => {
        return category.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);

    for (const category of categories) {
      expect(category.description.trim()).not.toBe("");
      expect(category.metrics.length).toBeGreaterThan(0);
    }
  });

  test("the Objective card puts the target right after the SLI, so it overlays on the SLI's panel", () => {
    expect(categories[0]!.metrics).toEqual([
      SloMetricType.SliPercent,
      SloMetricType.TargetPercent,
      SloMetricType.ErrorBudgetRemainingPercent,
    ]);
  });

  test("returns fresh data, so one caller mutating it cannot change another's cards", () => {
    getSloMetricCategories()[0]!.metrics.pop();

    expect(getSloMetricCategories()[0]!.metrics).toHaveLength(3);
  });
});

describe("buildSloMetricQueryConfigs", () => {
  test("builds one query per requested series, in order, named through SloMetricType", () => {
    const queryConfigs: Array<MetricQueryConfigData> = allSloQueryConfigs();

    expect(
      queryConfigs.map((queryConfig: MetricQueryConfigData): string => {
        return queryConfig.metricQueryData.filterData.metricName as string;
      }),
    ).toEqual(SloMetricTypeUtil.getAll());

    for (const queryConfig of queryConfigs) {
      expect(queryConfig.metricAliasData?.metricVariable).toBe(
        queryConfig.metricQueryData.filterData.metricName,
      );
    }
  });

  test("filters on exactly the SLO id and the project, never on the SLO name", () => {
    for (const queryConfig of allSloQueryConfigs()) {
      expect(attributesOf(queryConfig)).toEqual({
        sloId: SLO_ID.toString(),
        projectId: PROJECT_ID,
      });
    }
  });

  test("aggregates through the misspelled aggegationType key the query layer reads", () => {
    for (const queryConfig of allSloQueryConfigs()) {
      const metricType: SloMetricType = queryConfig.metricQueryData.filterData
        .metricName as SloMetricType;

      expect(filterDataOf(queryConfig)["aggegationType"]).toBe(
        SloMetricTypeUtil.getAggregationType(metricType),
      );
      expect(
        Object.prototype.hasOwnProperty.call(
          filterDataOf(queryConfig),
          "aggregationType",
        ),
      ).toBe(false);
    }
  });

  test("never groups, so an SLO renamed or relabelled stays one line", () => {
    for (const queryConfig of allSloQueryConfigs()) {
      expect(queryConfig.metricQueryData.groupBy).toBeUndefined();
      expect(queryConfig.metricQueryData.groupByAttributeKeys).toBeUndefined();
    }
  });

  test("titles, legends and units come from SloMetricTypeUtil, so the chart matches the catalog", () => {
    for (const queryConfig of allSloQueryConfigs()) {
      const metricType: SloMetricType = queryConfig.metricQueryData.filterData
        .metricName as SloMetricType;

      expect(queryConfig.metricAliasData).toEqual({
        metricVariable: metricType,
        title: SloMetricTypeUtil.getTitle(metricType),
        description: SloMetricTypeUtil.getDescription(metricType),
        legend: SloMetricTypeUtil.getLegend(metricType),
        legendUnit: SloMetricTypeUtil.getUnit(metricType),
      });
    }
  });

  test("draws the target over the SLI's own panel, in the reference amber", () => {
    const queryConfigs: Array<MetricQueryConfigData> = allSloQueryConfigs();

    const target: MetricQueryConfigData = configFor(
      queryConfigs,
      SloMetricType.TargetPercent,
    );

    expect(target.overlayWithPreviousQuery).toBe(true);
    expect(target.color).toBe(SLO_TARGET_SERIES_COLOR);
    expect(SLO_TARGET_SERIES_COLOR).toBe("#f59e0b");

    for (const queryConfig of queryConfigs) {
      if (queryConfig !== target) {
        expect(queryConfig.overlayWithPreviousQuery).toBeUndefined();
      }
    }
  });

  test("a target that does not follow the SLI gets its own panel instead of landing on an unrelated chart", () => {
    const queryConfigs: Array<MetricQueryConfigData> =
      buildSloMetricQueryConfigs({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        metrics: [SloMetricType.BurnRate, SloMetricType.TargetPercent],
      });

    expect(queryConfigs[1]!.overlayWithPreviousQuery).toBeUndefined();

    const alone: Array<MetricQueryConfigData> = buildSloMetricQueryConfigs({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
      metrics: [SloMetricType.TargetPercent],
    });

    expect(alone[0]!.overlayWithPreviousQuery).toBeUndefined();
  });

  test("labels the Status axis with states rather than 0 / 1 / 2", () => {
    const queryConfigs: Array<MetricQueryConfigData> = allSloQueryConfigs();

    const status: MetricQueryConfigData = configFor(
      queryConfigs,
      SloMetricType.Status,
    );

    expect(status.yAxisValueFormatter).toBeDefined();
    expect(status.yAxisValueFormatter!(0)).toBe("Healthy");
    expect(status.yAxisValueFormatter!(1)).toBe("At Risk");
    expect(status.yAxisValueFormatter!(2)).toBe("Budget Exhausted");

    for (const queryConfig of queryConfigs) {
      if (queryConfig !== status) {
        expect(queryConfig.yAxisValueFormatter).toBeUndefined();
      }
    }
  });

  test("gives every query a stable, unique id", () => {
    const first: Array<string | undefined> = allSloQueryConfigs().map(
      (queryConfig: MetricQueryConfigData): string | undefined => {
        return queryConfig.id;
      },
    );
    const second: Array<string | undefined> = allSloQueryConfigs().map(
      (queryConfig: MetricQueryConfigData): string | undefined => {
        return queryConfig.id;
      },
    );

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  test("builds nothing for an empty card", () => {
    expect(
      buildSloMetricQueryConfigs({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        metrics: [],
      }),
    ).toEqual([]);
  });
});

describe.each([
  [
    "incident",
    buildSloIncidentMetricQueryConfigs,
    IncidentMetricTypeUtil.getAllIncidentMetricTypes() as Array<string>,
    (metricType: string): string => {
      return IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
        metricType as IncidentMetricType,
      );
    },
    (metricType: string): string => {
      return IncidentMetricTypeUtil.getTitleByIncidentMetricType(
        metricType as IncidentMetricType,
      );
    },
  ],
  [
    "alert",
    buildSloAlertMetricQueryConfigs,
    AlertMetricTypeUtil.getAllAlertMetricTypes() as Array<string>,
    (metricType: string): string => {
      return AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(
        metricType as AlertMetricType,
      );
    },
    (metricType: string): string => {
      return AlertMetricTypeUtil.getTitleByAlertMetricType(
        metricType as AlertMetricType,
      );
    },
  ],
])(
  "the %s metric queries",
  (
    _kind: string,
    build: (data: {
      sloId: ObjectID;
      projectId: string;
    }) => Array<MetricQueryConfigData>,
    metricTypes: Array<string>,
    aggregationOf: (metricType: string) => string,
    titleOf: (metricType: string) => string,
  ) => {
    const queryConfigs: Array<MetricQueryConfigData> = build({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });

    test("query the same series a monitor's tab does, one per metric type", () => {
      expect(
        queryConfigs.map((queryConfig: MetricQueryConfigData): string => {
          return queryConfig.metricQueryData.filterData.metricName as string;
        }),
      ).toEqual(metricTypes);
    });

    test("match this SLO with a substring Search on serviceLevelObjectiveIds, the key the services stamp", () => {
      for (const queryConfig of queryConfigs) {
        const attributes: Attributes = attributesOf(queryConfig);

        expect(Object.keys(attributes).sort()).toEqual(
          [SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE, "projectId"].sort(),
        );
        expect(
          attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE],
        ).toBeInstanceOf(Search);
        expect(
          (
            attributes[
              SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE
            ] as Search<string>
          ).value,
        ).toBe(SLO_ID.toString());
        expect(attributes["projectId"]).toBe(PROJECT_ID);
        // A burn-rate incident or alert has no monitor to match on.
        expect(attributes["monitorIds"]).toBeUndefined();
        expect(attributes["monitorId"]).toBeUndefined();
      }
    });

    test("chart as bars, ungrouped, with each metric's own aggregation", () => {
      for (const queryConfig of queryConfigs) {
        const metricType: string = queryConfig.metricQueryData.filterData
          .metricName as string;

        expect(queryConfig.chartType).toBe(MetricChartType.BAR);
        expect(queryConfig.metricQueryData.groupBy).toBeUndefined();
        expect(filterDataOf(queryConfig)["aggegationType"]).toBe(
          aggregationOf(metricType),
        );
        expect(queryConfig.metricAliasData?.title).toBe(titleOf(metricType));
      }
    });

    test('describe the series for this SLO, never "for this monitor"', () => {
      for (const queryConfig of queryConfigs) {
        const description: string =
          queryConfig.metricAliasData?.description || "";

        expect(description).toContain("this SLO");
        expect(description.toLowerCase()).not.toContain("monitor");
      }
    });

    test("give every query a unique id", () => {
      const ids: Array<string | undefined> = queryConfigs.map(
        (queryConfig: MetricQueryConfigData): string | undefined => {
          return queryConfig.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
    });
  },
);

describe("SLO wording for incident and alert series", () => {
  test("a metric type the tab does not chart by default still gets SLO wording", () => {
    expect(
      getSloIncidentMetricDescription(IncidentMetricType.TimeInState),
    ).toBe("Time in State for incidents affecting this SLO.");
  });

  test.each(Object.values(AlertMetricType))(
    "%s is described for this SLO",
    (metricType: AlertMetricType) => {
      expect(getSloAlertMetricDescription(metricType)).toContain("this SLO");
    },
  );

  test("the cards say burn-rate incidents and alerts are included without any setup", () => {
    expect(SLO_INCIDENT_METRICS_CARD.title).toBe("Incident Metrics");
    expect(SLO_INCIDENT_METRICS_CARD.description).toContain("burn rate rules");
    expect(SLO_ALERT_METRICS_CARD.title).toBe("Alert Metrics");
    expect(SLO_ALERT_METRICS_CARD.description).toContain("burn rate rules");
  });
});
