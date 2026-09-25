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
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetricGroupKeys,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
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
 *
 * The monitor must evaluate the number the chart shows. A catalog gauge is
 * charted series by series — each series folded with the picked
 * aggregation, the series then combined as the catalog says — while an
 * ungrouped monitor query folds every series and every sample into ONE
 * number. That fold is the chart's number only when it IS the combine: the
 * worst series ("max") is the Max of everything, the lowest ("min") the Min
 * of everything, an average of ratios ("avg") the Average of everything. A
 * total across series ("sum": backends per database, members of a replica
 * set) cannot be folded at all — an Average divides it by the series, a Sum
 * multiplies it by the samples per bucket — so such a monitor is grouped
 * exactly like the chart and alerts on each series, and the modal says so
 * (getDatabaseMetricMonitorSeed).
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

/*
 * How the monitor reads the metric: the query's aggregation, the attribute
 * keys it alerts per (empty: one series, "this database"), and — when that
 * is not exactly what the chart shows — one sentence saying what the
 * monitor measures instead.
 */
export interface DatabaseMetricMonitorSeed {
  aggregationType: AggregationType;
  groupByAttributeKeys: Array<string>;
  note: string | null;
}

function aggregationLabel(aggregationType: AggregationType): string {
  return aggregationType === AggregationType.Avg
    ? "Average"
    : String(aggregationType);
}

/**
 * The monitor query that evaluates what the chart shows for this metric
 * with this aggregation picked (see the header). Anything outside the
 * catalog is charted as one pooled series, so the monitor keeps the picked
 * aggregation, ungrouped.
 */
export function getDatabaseMetricMonitorSeed(data: {
  spec: Pick<DatabaseMetricChartSpec, "definition">;
  aggregationType: AggregationType;
}): DatabaseMetricMonitorSeed {
  const definition: DatabaseServerMetricDefinition | null =
    data.spec.definition;
  const picked: AggregationType = data.aggregationType;

  if (!definition || definition.kind !== "gauge") {
    return { aggregationType: picked, groupByAttributeKeys: [], note: null };
  }

  switch (definition.seriesCombine) {
    case "max":
    case "min": {
      const fold: AggregationType =
        definition.seriesCombine === "max"
          ? AggregationType.Max
          : AggregationType.Min;
      return {
        aggregationType: fold,
        groupByAttributeKeys: [],
        note:
          fold === picked
            ? null
            : `The chart shows the ${
                definition.seriesCombine === "max" ? "highest" : "lowest"
              } of this metric's series. A monitor folds every series and sample into one number, so this one takes their ${fold} instead of each series' ${aggregationLabel(
                picked,
              )}.`,
      };
    }
    case "avg":
      return { aggregationType: picked, groupByAttributeKeys: [], note: null };
    default: {
      const seriesKeys: ReadonlyArray<string> = definition.seriesKeys || [];
      return {
        aggregationType: picked,
        groupByAttributeKeys: getDatabaseServerMetricGroupKeys(definition),
        note:
          seriesKeys.length > 0
            ? `The chart adds its series up (one per ${seriesKeys.join(
                " / ",
              )} and reporting instance). A monitor cannot add series together, so this one alerts on each series separately: set a threshold for one series, not for the total.`
            : "The chart adds its series up (one per reporting instance). A monitor cannot add series together, so this one alerts on each instance separately — the chart's own number when one agent reports this database.",
      };
    }
  }
}

/**
 * The metric-explorer view a database metric monitor starts from: one query
 * ("a") on the metric, filtered by the database's id plus the catalog
 * entry's own pins (so a pinned tile, `mysql.threads{kind=running}`, gets a
 * monitor on what it charts), read as getDatabaseMetricMonitorSeed says for
 * the chart's aggregation, over the chart's window.
 */
export function buildDatabaseMetricMonitorViewData(data: {
  spec: Pick<DatabaseMetricChartSpec, "metricName" | "title" | "definition">;
  databaseServerId: ObjectID | string;
  aggregationType: AggregationType;
  startAndEndDate?: InBetween<Date> | null | undefined;
  rangeToken?: string | undefined;
}): MetricViewData {
  const title: string = data.spec.title || data.spec.metricName;
  const seed: DatabaseMetricMonitorSeed = getDatabaseMetricMonitorSeed({
    spec: data.spec,
    aggregationType: data.aggregationType,
  });
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
            aggegationType: seed.aggregationType,
            aggregateBy: {},
          },
          ...(seed.groupByAttributeKeys.length > 0
            ? { groupByAttributeKeys: seed.groupByAttributeKeys }
            : {}),
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: data.startAndEndDate || null,
    rangeToken: data.rangeToken,
  };
}

/*
 * The query parameter carrying the new monitor's description, which Monitor
 * Create reads (MONITOR_DESCRIPTION_QUERY_PARAM in Pages/Monitor/Create.tsx).
 * Without it the page words it "Created from the Metric Explorer view for …",
 * which is not where a database's monitor came from.
 */
export const DATABASE_METRIC_MONITOR_DESCRIPTION_PARAM: string =
  "monitorDescription";

/** "Created from database Checkout primary." — or "" without a name. */
export function getDatabaseMetricMonitorDescription(
  databaseName: string | null | undefined,
): string {
  const name: string = (databaseName || "").trim();
  return name ? `Created from database ${name}.` : "";
}

/**
 * Monitor Create, pre-seeded with the database metric monitor — the route
 * with the metric explorer's query params (metricQueries, the window) and,
 * when the database's name is known, the monitor's description.
 */
export function buildDatabaseMetricMonitorRoute(
  viewData: MetricViewData,
  options?: { databaseName?: string | null | undefined },
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );
  const params: Dictionary<string> = {
    ...MetricExplorerUrl.buildQueryParamsFromMetricViewData(viewData),
  };
  const description: string = getDatabaseMetricMonitorDescription(
    options?.databaseName,
  );
  if (description) {
    params[DATABASE_METRIC_MONITOR_DESCRIPTION_PARAM] = description;
  }
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
