import DataSourceQueryConfig from "../../DataSource/DataSourceQueryConfig";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * Tabular rows straight from an EXTERNAL Data Source query. Columns come
 * from the query result, not from widget config — the connector normalizes
 * every source into DataSourceTableResult. The OneUptime-metrics
 * equivalent (columns, formulas, group-by) is DashboardTableComponent.
 *
 * Not available on public dashboards.
 */
export default interface DashboardDataSourceTableComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DataSourceTable;
  componentId: ObjectID;
  arguments: {
    query?: DataSourceQueryConfig | undefined;
    tableTitle?: string | undefined;
    tableDescription?: string | undefined;
    /*
     * Client-side cap on rendered rows, applied after sorting so "top 10 by
     * this column" works. The connector's own row cap still applies first —
     * this only trims what the widget draws. Absent ⇒ render every row the
     * query returned.
     */
    maxRows?: number | undefined;
  };
}
