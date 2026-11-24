import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import DataSourceQueryConfig from "../../Types/DataSource/DataSourceQueryConfig";
import { ProjectMetricsDataSourceUtil } from "../../Types/DataSource/ProjectMetricsDataSource";

/*
 * THE QUERIES OF A DATA SOURCE WIDGET, AS EVERY BOARD READS THEM.
 *
 * A Data Source Chart holds a list of queries (`queries`); a Value, a
 * Gauge and a Table hold one (`query`). A query is "set up" once it names
 * a source and has query text - every widget is seeded with a blank query
 * card, so its presence proves nothing - and a widget runs only the ones
 * that are, in their stored order.
 *
 * A public dashboard (issue #10226) draws a Data Source widget only when
 * every query of it that is set up reads this project's own metrics
 * (ProjectMetricsDataSource) - an outside system's credentials are never
 * reached from an anonymous page - and serves each of those queries
 * without its text (toPublicDataSourceQuery): the page names a query by
 * its widget and its place among the widget's set-up queries, and the
 * server reads the text it runs from what is stored. So the widget, the
 * page and the public route read "which queries, in which order" from
 * this one place.
 *
 * Settings arrive from JSON anyone can write (the API, Terraform, a
 * script), so nothing here trusts a field's type.
 */

/*
 * A query as a public dashboard serves it: which source it reads (always
 * this project's metrics), the id the editor gave it and the legend its
 * series are named by. Never its text.
 */
export interface PublicDataSourceQuery {
  id?: string | undefined;
  dataSourceId: string;
  legend?: string | undefined;
}

// The setting a widget type keeps its queries under.
export enum DataSourceWidgetQueriesSetting {
  // The chart's list.
  Queries = "queries",
  // The value's, the gauge's and the table's one.
  Query = "query",
}

const isNonBlankString: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const isObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export default class DataSourceWidgetQueries {
  // The setting a widget type keeps its queries under; null for any other type.
  public static getQueriesSetting(
    componentType: unknown,
  ): DataSourceWidgetQueriesSetting | null {
    switch (componentType) {
      case DashboardComponentType.DataSourceChart:
        return DataSourceWidgetQueriesSetting.Queries;
      case DashboardComponentType.DataSourceValue:
      case DashboardComponentType.DataSourceGauge:
      case DashboardComponentType.DataSourceTable:
        return DataSourceWidgetQueriesSetting.Query;
      default:
        return null;
    }
  }

  /*
   * Whether a stored query is set up: a source and query text, both text
   * with something in it. A row written by an older build, or by hand,
   * can hold a number, an object or null in either field.
   */
  public static isConfigured(query: unknown): query is DataSourceQueryConfig {
    return (
      isObject(query) &&
      isNonBlankString(query["dataSourceId"]) &&
      isNonBlankString(query["query"])
    );
  }

  // The set-up queries of a list, in order; none for anything but a list.
  public static getConfigured(queries: unknown): Array<DataSourceQueryConfig> {
    if (!Array.isArray(queries)) {
      return [];
    }

    return queries.filter((query: unknown): query is DataSourceQueryConfig => {
      return DataSourceWidgetQueries.isConfigured(query);
    });
  }

  /*
   * A widget's set-up queries, in order: its chart's list, or its one
   * query. None for a type that is not a Data Source widget.
   */
  public static getConfiguredOfWidget(
    componentType: unknown,
    settings: unknown,
  ): Array<DataSourceQueryConfig> {
    const setting: DataSourceWidgetQueriesSetting | null =
      DataSourceWidgetQueries.getQueriesSetting(componentType);

    if (!setting || !isObject(settings)) {
      return [];
    }

    const stored: unknown = Object.prototype.hasOwnProperty.call(
      settings,
      setting,
    )
      ? settings[setting]
      : undefined;

    if (setting === DataSourceWidgetQueriesSetting.Queries) {
      return DataSourceWidgetQueries.getConfigured(stored);
    }

    return DataSourceWidgetQueries.isConfigured(stored) ? [stored] : [];
  }

  /*
   * Whether a widget reads only this project's metrics: it has a query set
   * up, and every query it has set up reads them. What a public dashboard
   * draws of the Data Source widgets (issue #10226); any other one is left
   * out of it whole.
   */
  public static readsOnlyProjectMetrics(
    componentType: unknown,
    settings: unknown,
  ): boolean {
    const queries: Array<DataSourceQueryConfig> =
      DataSourceWidgetQueries.getConfiguredOfWidget(componentType, settings);

    return (
      queries.length > 0 &&
      queries.every((query: DataSourceQueryConfig): boolean => {
        return ProjectMetricsDataSourceUtil.isProjectMetrics(
          query.dataSourceId,
        );
      })
    );
  }

  /*
   * A query as a public dashboard serves it: its source, its id and its
   * legend, each only when it is text. Never its text.
   */
  public static toPublicDataSourceQuery(
    query: DataSourceQueryConfig,
  ): PublicDataSourceQuery {
    return {
      ...(typeof query.id === "string" ? { id: query.id } : {}),
      dataSourceId: query.dataSourceId,
      ...(typeof query.legend === "string" ? { legend: query.legend } : {}),
    };
  }

  /*
   * A widget's stored queries setting as a public dashboard serves it: the
   * chart's set-up queries, each without its text, or the one query's -
   * none when it has none set up. Only ever asked of a widget that reads
   * only this project's metrics (readsOnlyProjectMetrics).
   */
  public static toServedSetting(
    setting: DataSourceWidgetQueriesSetting,
    stored: unknown,
  ): Array<PublicDataSourceQuery> | PublicDataSourceQuery | undefined {
    if (setting === DataSourceWidgetQueriesSetting.Queries) {
      return DataSourceWidgetQueries.getConfigured(stored).map(
        (query: DataSourceQueryConfig): PublicDataSourceQuery => {
          return DataSourceWidgetQueries.toPublicDataSourceQuery(query);
        },
      );
    }

    return DataSourceWidgetQueries.isConfigured(stored)
      ? DataSourceWidgetQueries.toPublicDataSourceQuery(stored)
      : undefined;
  }

  /*
   * Whether a query the public page holds is one a public dashboard
   * served: one of this project's metrics, served without its text (a
   * query card left blank is none - the server serves no such card). The
   * public page's widgets run these through the public route, by place.
   */
  public static isServedPublicQuery(query: unknown): boolean {
    if (
      !isObject(query) ||
      !ProjectMetricsDataSourceUtil.isProjectMetrics(query["dataSourceId"])
    ) {
      return false;
    }

    const text: unknown = Object.prototype.hasOwnProperty.call(query, "query")
      ? query["query"]
      : undefined;

    return text === undefined || isNonBlankString(text);
  }

  /*
   * The queries a public page's widget runs, in order: those of the list
   * (or the one query) the dashboard served - the place of each is what
   * the public route names it by.
   */
  public static getServedPublicQueries(
    queries: unknown,
  ): Array<PublicDataSourceQuery> {
    const list: Array<unknown> = Array.isArray(queries)
      ? queries
      : queries === undefined || queries === null
        ? []
        : [queries];

    return list.filter((query: unknown): query is PublicDataSourceQuery => {
      return DataSourceWidgetQueries.isServedPublicQuery(query);
    });
  }
}
