import {
  DatabaseMetricChartSpec,
  DatabaseQueryWindow,
  buildDatabaseMetricQuery,
} from "./DatabaseServerTelemetryQueries";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Route from "Common/Types/API/Route";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import { DATABASE_SERVER_ID_SCOPE_ATTRIBUTE } from "Common/Types/Monitor/DatabaseAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import MetricExplorerUrl from "Common/Utils/Metrics/MetricExplorerUrl";

/*
 * "Create monitor" from a database's in-place metric chart (the Metrics
 * tab's modal replaced the explorer, and with it the explorer's own
 * create-monitor action).
 *
 * The monitor is a plain Metrics monitor whose one query filters
 * `oneuptime.database.server.id = <this database>` — the stamp ingest puts
 * on every row of the database's own engine telemetry, and the filter the
 * curated alert templates use. That one filter scopes the monitor to this
 * database AND makes what it opens land on the database's Alerts /
 * Incidents tabs (MonitorStepResourceIdentity reads it). Monitor Create is
 * pre-seeded through the metric explorer's URL schema (MetricExplorerUrl),
 * exactly like the explorer's own button.
 *
 * Two metrics cannot become such a monitor, and the button says why instead
 * of producing a monitor that watches nothing:
 *
 *   - a cumulative counter charted as a per-second rate: the monitor path
 *     has no rate, so a threshold on the since-restart total fires once
 *     and never clears;
 *   - a metric that does not carry the database's id — `db.client.*` from
 *     the applications that call it, CPU / memory of the pods or
 *     containers it runs as. The Metrics tab lists them by entity key, but
 *     an id-scoped monitor would never see a point of them. Whether the
 *     metric carries the id is read from ONE point in the chart's window
 *     (fetchDatabaseMetricCarriesServerId).
 */

export const DATABASE_METRIC_MONITOR_RATE_BLOCKER: string =
  "A metrics monitor cannot compute a per-second rate. This metric is a cumulative counter, so a threshold on it would compare against its total since the server started: it would fire once and never clear.";

export const DATABASE_METRIC_MONITOR_NOT_LINKED_BLOCKER: string =
  "This metric does not carry this database's id: it comes from the applications that call the database or from the pods and containers it runs as, not from the database's own collector. A monitor scoped to this database would never see it — create one from the Metrics explorer instead.";

export const DATABASE_METRIC_MONITOR_VARIABLE: string = "a";

/**
 * Why this metric cannot become a monitor scoped to the database, or null
 * when it can. `carriesServerId` is null while unknown (still checking, or
 * the check failed): an unknown is not held against the metric.
 */
export function getDatabaseMetricMonitorBlocker(data: {
  spec: Pick<DatabaseMetricChartSpec, "isRate">;
  carriesServerId: boolean | null;
}): string | null {
  if (data.spec.isRate) {
    return DATABASE_METRIC_MONITOR_RATE_BLOCKER;
  }
  if (data.carriesServerId === false) {
    return DATABASE_METRIC_MONITOR_NOT_LINKED_BLOCKER;
  }
  return null;
}

function databaseServerIdText(
  id: ObjectID | string | null | undefined,
): string {
  return id ? id.toString().trim() : "";
}

/**
 * The metric-explorer view a database metric monitor starts from: one query
 * ("a") on the metric, filtered by the database's id plus the catalog
 * entry's own pins (so a pinned tile, `mysql.threads{kind=running}`, gets a
 * monitor on what it charts), with the chart's aggregation and window.
 */
export function buildDatabaseMetricMonitorViewData(data: {
  spec: Pick<DatabaseMetricChartSpec, "metricName" | "title" | "definition">;
  databaseServerId: ObjectID | string;
  aggregationType: AggregationType;
  startAndEndDate?: InBetween<Date> | null | undefined;
  rangeToken?: string | undefined;
}): MetricViewData {
  const title: string = data.spec.title || data.spec.metricName;
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: DATABASE_METRIC_MONITOR_VARIABLE,
          title: title,
          description: data.spec.definition?.description || title,
          legend: title,
          legendUnit: undefined,
        },
        metricQueryData: {
          filterData: {
            metricName: data.spec.metricName,
            attributes: {
              ...(data.spec.definition?.attributes || {}),
              [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: databaseServerIdText(
                data.databaseServerId,
              ),
            },
            aggegationType: data.aggregationType,
            aggregateBy: {},
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: data.startAndEndDate || null,
    rangeToken: data.rangeToken,
  };
}

/**
 * Monitor Create, pre-seeded with the database metric monitor — the route
 * with the metric explorer's query params (metricQueries, the window).
 */
export function buildDatabaseMetricMonitorRoute(
  viewData: MetricViewData,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );
  const params: Dictionary<string> =
    MetricExplorerUrl.buildQueryParamsFromMetricViewData(viewData);
  const query: string = Object.keys(params)
    .map((name: string): string => {
      return `${encodeURIComponent(name)}=${encodeURIComponent(
        params[name] as string,
      )}`;
    })
    .join("&");
  return new Route(query ? `${route.toString()}?${query}` : route.toString());
}

/**
 * Whether the metric, in the window and under the database's keys, has a
 * point stamped with the database's id — one row, nothing else read. Null
 * when it cannot be told (unscoped, no id, or the lookup failed).
 */
export async function fetchDatabaseMetricCarriesServerId(
  window: DatabaseQueryWindow & {
    metricName: string;
    databaseServerId: ObjectID | string | null | undefined;
  },
): Promise<boolean | null> {
  const id: string = databaseServerIdText(window.databaseServerId);
  if (!id) {
    return null;
  }
  const query: Record<string, unknown> | null = buildDatabaseMetricQuery({
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
    metricName: window.metricName,
    pins: { [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: id },
  });
  if (!query) {
    return null;
  }
  try {
    const result: ListResult<Metric> = await AnalyticsModelAPI.getList<Metric>({
      modelType: Metric,
      query: query,
      select: { time: true },
      sort: {},
      skip: 0,
      limit: 1,
    });
    return (result.data || []).length > 0;
  } catch {
    return null;
  }
}
