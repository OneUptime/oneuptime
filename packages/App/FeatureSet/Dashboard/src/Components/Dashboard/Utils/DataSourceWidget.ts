import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import DataSourceWidgetQueries from "Common/Utils/DataSource/DataSourceWidgetQueries";

/*
 * The Data Source widgets' rows and queries, read the one way the widgets,
 * the public dashboard's sanitizer and its PromQL route read them
 * (Common/Utils/DataSource, issue #10226).
 */
export {
  capDataSourceTableRows,
  sortDataSourceTableRows,
} from "Common/Utils/DataSource/DataSourceTableRows";
export type { DataSourceTableRow } from "Common/Utils/DataSource/DataSourceTableRows";

/*
 * Shared "has the user actually finished configuring this?" test for the
 * external Data Source widgets. A widget is seeded with a blank query card
 * so the editor opens on something, so presence of the object proves
 * nothing — both a source and query text have to be there before the widget
 * is worth firing a request for.
 *
 * Both fields are typed `string`, but they are read back out of the
 * dashboard's JSONB column, so a row written by an older build or edited by
 * hand really can hand us a number, an object, or null. This runs during
 * render of every Data Source widget — calling .trim() on whatever arrived
 * would take the whole dashboard down over one malformed widget.
 */
export function isDataSourceQueryConfigured(
  queryConfig: DataSourceQueryConfig | undefined,
): boolean {
  return DataSourceWidgetQueries.isConfigured(queryConfig);
}

/*
 * The configured subset of a chart widget's query list, in order. Chart
 * widgets hold several queries and any of them can be half-filled while the
 * user is still typing, so the renderer runs the ones that are ready and
 * ignores the rest rather than erroring the whole widget.
 */
export function getConfiguredDataSourceQueries(
  queryConfigs: Array<DataSourceQueryConfig> | undefined,
): Array<DataSourceQueryConfig> {
  return DataSourceWidgetQueries.getConfigured(queryConfigs);
}
