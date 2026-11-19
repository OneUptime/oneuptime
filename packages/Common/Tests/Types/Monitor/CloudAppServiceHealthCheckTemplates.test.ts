import { describe, expect, test } from "@jest/globals";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import {
  AZURE_FIVE_MINUTE_CURSOR,
  AzureReadGroup,
  getAzureReadGroups,
} from "../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { isAzureFiveMinuteKeyMetric } from "../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  APP_SERVICE_HEALTH_CHECK_KEY,
  AZURE_FIVE_MINUTE_READING_PERIOD_SECONDS,
  CLOUD_HEALTH_CHECK_CRITICAL_PERCENT,
  CloudHealthSeverity,
  CloudResourceReadings,
  getCloudHealthSeverity,
} from "../../../Types/Cloud/CloudResourceHealth";
import { CLOUD_CONNECTION_READ_INTERVALS } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import Dictionary from "../../../Types/Dictionary";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CLOUD_ALERT_MONITORING_INTERVAL,
  CLOUD_ALERT_SHELL_NAMES,
  CLOUD_ALERT_WINDOWS,
  CLOUD_FIVE_MINUTE_METRIC_WINDOW,
  CloudAlertTemplate,
  CloudAlertTemplateArgs,
  getAllCloudAlertTemplates,
  getAppServiceHealthCheckCommand,
  getCloudAlertTemplate,
  getCloudAlertTemplatesFor,
  isCloudFiveMinuteMetricTemplate,
} from "../../../Types/Monitor/CloudAlertTemplates";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";

/*
 * #9981: RECOMMENDED MONITORS FOR AN APP SERVICE APP'S HEALTH CHECK.
 *
 * HealthCheckStatus is the share of an app's instances whose health check
 * passes; its health rule (#9740) reads it Degraded under 100 and
 * Unhealthy under 50. Azure Monitor keeps it at five minutes, and a
 * connection reads it every 15, its newest point 9 to 14 minutes old: a
 * 15-minute window - every other Azure template's - held nothing of it for
 * part of every quarter hour. Its monitors read 30 minutes, are offered
 * only to an app that reports it (one with a Health check path), and their
 * incident's first command, in Azure Cloud Shell, names the instance that
 * fails.
 */

const FAILING_ID: string = "cloud-azure-appservice-health-check-failing";
const MOST_FAILING_ID: string =
  "cloud-azure-appservice-health-check-most-failing";
const IDS: Array<string> = [FAILING_ID, MOST_FAILING_ID];
const APP: string = "Microsoft.Web/sites";
const APP_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-shop/providers/Microsoft.Web/sites/shop-web";
const APP_ATTRIBUTES: Dictionary<string> = {
  "azuremonitor.resource_id": APP_ID,
};
const NOW: Date = new Date(Date.UTC(2026, 10, 19, 12, 30, 30));
const MINUTE_MS: number = 60 * 1000;

function template(id: string): CloudAlertTemplate {
  const found: CloudAlertTemplate | undefined = getCloudAlertTemplate(id);

  expect(found).toBeDefined();

  return found!;
}

function reading(value: number): {
  value: number;
  time: string;
  metric: string;
} {
  return {
    value,
    time: new Date(NOW.getTime() - 12 * MINUTE_MS).toISOString(),
    metric: "azure_healthcheckstatus_average",
  };
}

function argsFor(): CloudAlertTemplateArgs {
  return {
    cloudResourceId: "00000000-0000-4000-8000-0000000000a1",
    telemetryAttributes: { ...APP_ATTRIBUTES },
    readings: { [APP_SERVICE_HEALTH_CHECK_KEY]: reading(100) },
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "shop-web",
  };
}

function idsFor(readings: CloudResourceReadings): Array<string> {
  return getCloudAlertTemplatesFor({
    provider: "azure",
    resourceType: APP,
    telemetryAttributes: APP_ATTRIBUTES,
    readings,
    isReadByConnection: true,
  })
    .map((found: CloudAlertTemplate): string => {
      return found.id;
    })
    .filter((id: string): boolean => {
      return IDS.includes(id);
    });
}

function viewConfigOf(step: MonitorStep): MetricsViewConfig {
  return step.data!.metricMonitor!.metricViewConfig;
}

function instancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray;
}

describe("the templates", () => {
  test("an instance failing its health check, a warning; fewer than half passing, critical", () => {
    expect(
      IDS.map((id: string) => {
        const found: CloudAlertTemplate = template(id);

        return [
          found.name,
          found.severity,
          found.category,
          found.measure,
          found.threshold,
          found.thresholdLabel,
          found.resourceTypes,
          found.requiresReading,
        ];
      }),
    ).toEqual([
      [
        "Health Check Failing",
        "Warning",
        "Availability",
        "breakage",
        100,
        "under 100%",
        [APP],
        true,
      ],
      [
        "Most Instances Unhealthy",
        "Critical",
        "Availability",
        "breakage",
        50,
        "under 50%",
        [APP],
        true,
      ],
    ]);
  });

  test("their lines are the health rule's: the app reads Degraded or Unhealthy when they fire", () => {
    expect(template(MOST_FAILING_ID).threshold).toBe(
      CLOUD_HEALTH_CHECK_CRITICAL_PERCENT,
    );

    const judge: (value: number) => CloudHealthSeverity | null = (
      value: number,
    ): CloudHealthSeverity | null => {
      return getCloudHealthSeverity({
        provider: "azure",
        type: APP,
        readings: { [APP_SERVICE_HEALTH_CHECK_KEY]: reading(value) },
      });
    };

    expect(judge(99.9)).toBe(CloudHealthSeverity.Warning);
    expect(judge(49.9)).toBe(CloudHealthSeverity.Critical);
    expect(judge(100)).toBe(null);
  });

  test("each reads 30 minutes, every five: the window a five-minute metric fills", () => {
    expect(CLOUD_FIVE_MINUTE_METRIC_WINDOW).toBe(RollingTime.Past30Minutes);
    expect(CLOUD_ALERT_WINDOWS[CloudProvider.Azure]).toBe(
      RollingTime.Past15Minutes,
    );

    for (const id of IDS) {
      const found: CloudAlertTemplate = template(id);

      expect(found.provider).toBe(CloudProvider.Azure);
      expect(found.monitorType).toBe(MonitorType.Metrics);
      expect(isCloudFiveMinuteMetricTemplate(found)).toBe(true);
      expect(found.rollingTime).toBe(RollingTime.Past30Minutes);
      expect(found.monitoringInterval).toBe(CLOUD_ALERT_MONITORING_INTERVAL);
      expect(found.isBetterStreamed).toBe(false);
      expect(found.summary.length).toBeLessThanOrEqual(90);
      expect(found.description).toContain("30 minutes");
      expect(found.description).toContain("Health check path");
    }
  });

  test("only templates over a five-minute metric read 30 minutes on Azure; every other Azure one reads 15", () => {
    for (const found of getAllCloudAlertTemplates()) {
      if (found.provider !== CloudProvider.Azure) {
        expect(isCloudFiveMinuteMetricTemplate(found)).toBe(false);
        continue;
      }

      const readsFiveMinutes: boolean = found.queries.every((query) => {
        return found.resourceTypes.every((type: string): boolean => {
          return isAzureFiveMinuteKeyMetric(type, query.metric.metricName);
        });
      });

      expect([found.id, found.rollingTime]).toEqual([
        found.id,
        readsFiveMinutes
          ? RollingTime.Past30Minutes
          : RollingTime.Past15Minutes,
      ]);
    }
  });

  /*
   * The read itself, as the Azure connection decides it. Read every 15
   * minutes or more often - every 5 by default - every evaluation of the
   * monitor (every five minutes) finds a point in its 30 minutes, where 15
   * found none at some of them, and every point a read brings after the
   * first (which brings an hour of history) is judged. Read every 30 or 60
   * minutes, a window can be empty between two reads - the monitor's state
   * then stays as it is, as a metric monitor ignores a window with no data
   * - and a read's oldest points may be past the window by the time they
   * come; still, every read's newest point is judged.
   */
  test.each(CLOUD_CONNECTION_READ_INTERVALS)(
    "read every %i minutes, what each read brings is judged, and every evaluation finds a point at 15 minutes or more often",
    (intervalInMinutes: number) => {
      const start: number = Date.parse("2026-11-19T08:02:30.000Z");
      const runEnd: number = start + 6 * 60 * MINUTE_MS;
      const cursors: Record<string, string> = {};
      const points: Array<number> = [];
      // Each read's points, after the first's, while the run can still judge them.
      const batches: Array<Array<number>> = [];
      const judged: Set<number> = new Set<number>();
      let emptyAt15: number = 0;
      let emptyAt30: number = 0;

      for (let at: number = start; at < runEnd; at += MINUTE_MS) {
        // The connection reads at its interval.
        if ((at - start) % (intervalInMinutes * MINUTE_MS) === 0) {
          const group: AzureReadGroup = getAzureReadGroups({
            cursors,
            now: new Date(at),
          }).get(AZURE_FIVE_MINUTE_CURSOR)!;

          if (group.window) {
            const batch: Array<number> = [];

            for (
              let point: number = group.window.start.getTime();
              point < group.window.end.getTime();
              point += AZURE_FIVE_MINUTE_READING_PERIOD_SECONDS * 1000
            ) {
              batch.push(point);
            }

            if (points.length > 0 && at < runEnd - 30 * MINUTE_MS) {
              batches.push(batch);
            }

            points.push(...batch);
            cursors[group.cursorKey] = group.window.end.toISOString();
          }
        }

        // The monitor is evaluated every five minutes, once the first call is in.
        if (points.length === 0 || (at - start) % (5 * MINUTE_MS) !== 0) {
          continue;
        }

        const inWindow: (windowMinutes: number) => Array<number> = (
          windowMinutes: number,
        ): Array<number> => {
          return points.filter((point: number): boolean => {
            return point >= at - windowMinutes * MINUTE_MS && point <= at;
          });
        };

        for (const point of inWindow(30)) {
          judged.add(point);
        }

        emptyAt15 += inWindow(15).length > 0 ? 0 : 1;
        emptyAt30 += inWindow(30).length > 0 ? 0 : 1;
      }

      expect(batches.length).toBeGreaterThan(3);

      for (const batch of batches) {
        expect(judged.has(Math.max(...batch))).toBe(true);

        if (intervalInMinutes <= 15) {
          expect(
            batch.filter((point: number): boolean => {
              return !judged.has(point);
            }),
          ).toEqual([]);
        }
      }

      if (intervalInMinutes <= 15) {
        expect(emptyAt30).toBe(0);
        expect(emptyAt15).toBeGreaterThan(0);
      }
    },
  );
});

describe("offered only to an app that reports its health check", () => {
  test("an app without a Health check path reports nothing, and is offered neither", () => {
    expect(idsFor({})).toEqual([]);
    expect(idsFor({ requests: reading(1200) })).toEqual([]);
  });

  test("an app with one is offered both", () => {
    expect(idsFor({ [APP_SERVICE_HEALTH_CHECK_KEY]: reading(100) })).toEqual(
      IDS,
    );
  });

  test("an account's Recommendations count them as the others: by the same offering", () => {
    const offered: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.CloudResource,
        {
          cloudProvider: "azure",
          cloudResourceType: APP,
          cloudTelemetryAttributes: APP_ATTRIBUTES,
          cloudReadings: { [APP_SERVICE_HEALTH_CHECK_KEY]: reading(100) },
          cloudReadByConnection: true,
          cloudResourceName: "shop-web",
        },
      );

    expect(
      offered
        .map((recommendation: MonitorRecommendation): string => {
          return recommendation.recommendationId;
        })
        .filter((id: string): boolean => {
          return id.includes("health-check");
        }),
    ).toEqual(
      IDS.map((id: string): string => {
        return expect.stringContaining(id) as unknown as string;
      }),
    );
  });
});

describe("the monitor each builds", () => {
  test("reads the stored name its reading says, its worst of each minute, of the app alone", () => {
    for (const id of IDS) {
      const step: MonitorStep = template(id).getMonitorStep(argsFor());
      const [query] = viewConfigOf(step)
        .queryConfigs as Array<MetricQueryConfigData>;

      expect(query!.metricQueryData.filterData).toEqual({
        metricName: "azure_healthcheckstatus_average",
        attributes: APP_ATTRIBUTES,
        aggegationType: AggregationType.Min,
        aggregateBy: {},
      });
      expect(query!.metricAliasData?.legendUnit).toBe("%");
      expect(step.data!.metricMonitor!.rollingTime).toBe(
        RollingTime.Past30Minutes,
      );
    }
  });

  test("fires on its first reading under the line, and clears once a whole window has none", () => {
    for (const id of IDS) {
      const step: MonitorStep = template(id).getMonitorStep(argsFor());
      const [unhealthy, healthy] = instancesOf(step);
      const fires: CriteriaFilter = unhealthy!.data!.filters[0]!;

      expect(fires.filterType).toBe(FilterType.LessThan);
      expect(fires.value).toBe(template(id).threshold);
      expect(fires.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AnyValue,
      );
      expect(healthy!.data!.filters[0]!.filterType).toBe(
        FilterType.GreaterThanOrEqualTo,
      );
      expect(
        healthy!.data!.filters[0]!.metricMonitorOptions?.metricAggregationType,
      ).toBe(EvaluateOverTimeType.AllValues);
    }
  });

  async function breaches(id: string, values: Array<number>): Promise<boolean> {
    const step: MonitorStep = template(id).getMonitorStep(argsFor());
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      template(id).rollingTime,
      NOW,
    );
    const data: AggregatedResult["data"] = values.map(
      (value: number, index: number) => {
        // Five minutes a point, the newest 12 minutes old.
        return {
          timestamp: new Date(
            NOW.getTime() - (12 + 5 * (values.length - 1 - index)) * MINUTE_MS,
          ),
          value,
        };
      },
    );
    const response: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: viewConfigOf(step),
      metricResult: [],
      seriesBreakdown: [
        { fingerprint: "", labels: {}, aggregatedResults: [{ data }] },
      ],
      startAndEndDate: window,
    };
    const [unhealthy] = instancesOf(step);
    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries({
        dataToProcess: response,
        criteriaFilter: JSON.parse(
          JSON.stringify(unhealthy!.data!.filters[0]!),
        ) as CriteriaFilter,
        monitorStep: step,
      });

    return evaluations.some((evaluation: MetricSeriesEvaluationResult) => {
      return evaluation.rootCause !== null;
    });
  }

  test("one instance out of four fails: the warning fires, the critical does not", async () => {
    expect(await breaches(FAILING_ID, [100, 100, 75])).toBe(true);
    expect(await breaches(MOST_FAILING_ID, [100, 100, 75])).toBe(false);
  });

  test("three out of four fail: both fire", async () => {
    expect(await breaches(FAILING_ID, [100, 25])).toBe(true);
    expect(await breaches(MOST_FAILING_ID, [100, 25])).toBe(true);
  });

  test("every instance passes: neither fires", async () => {
    expect(await breaches(FAILING_ID, [100, 100, 100])).toBe(false);
    expect(await breaches(MOST_FAILING_ID, [100, 100, 100])).toBe(false);
  });
});

describe("the first command an incident says", () => {
  test("the health check of each instance over the last hour, from Azure Cloud Shell", () => {
    expect(getAppServiceHealthCheckCommand(APP_ATTRIBUTES)).toBe(
      `az monitor metrics list --resource ${APP_ID} --metric HealthCheckStatus --aggregation Average --interval PT5M --filter "Instance eq '*'" --output table`,
    );
    expect(template(FAILING_ID).firstCommand!(APP_ATTRIBUTES)).toBe(
      getAppServiceHealthCheckCommand(APP_ATTRIBUTES),
    );
    expect(template(MOST_FAILING_ID).firstCommand!(APP_ATTRIBUTES)).toBe(
      getAppServiceHealthCheckCommand(APP_ATTRIBUTES),
    );
  });

  test("the incident ends with it, in Azure Cloud Shell", () => {
    expect(CLOUD_ALERT_SHELL_NAMES[CloudProvider.Azure]).toBe(
      "Azure Cloud Shell",
    );

    for (const id of IDS) {
      const step: MonitorStep = template(id).getMonitorStep(argsFor());
      const [unhealthy] = instancesOf(step);

      expect(unhealthy!.data!.incidents[0]!.description).toBe(
        `${template(id).incidentDescription} First, run this in Azure Cloud Shell: \`${getAppServiceHealthCheckCommand(APP_ATTRIBUTES)}\``,
      );
    }
  });

  test("an id that is no App Service app's says no command rather than a wrong one", () => {
    for (const attributes of [
      {},
      { "azuremonitor.resource_id": "" },
      { "azuremonitor.resource_id": "shop-web" },
      {
        "azuremonitor.resource_id":
          "/subscriptions/3f2b8c1e/resourceGroups/rg/providers/Microsoft.Web/serverfarms/plan",
      },
    ]) {
      expect(getAppServiceHealthCheckCommand(attributes)).toBe(null);
    }
  });

  test("an app whose name the shell would read otherwise is quoted", () => {
    const odd: string =
      "/subscriptions/3f2b8c1e/resourceGroups/rg (prod)/providers/Microsoft.Web/sites/shop's-web";

    expect(
      getAppServiceHealthCheckCommand({ "azuremonitor.resource_id": odd }),
    ).toContain(`--resource '${odd.split("'").join("'\\''")}' `);
  });
});
