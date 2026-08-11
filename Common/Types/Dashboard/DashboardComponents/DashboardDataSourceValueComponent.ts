import DataSourceQueryConfig from "../../DataSource/DataSourceQueryConfig";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";
import { DashboardValueTrendDirection } from "./DashboardValueComponent";

/*
 * How the points a Data Source query returns over the dashboard's time
 * window collapse into the single number the widget shows. The metric
 * Value widget takes this from the metric query's "Aggregate by" picker;
 * an external query has no such picker, so it is a widget argument here.
 */
export enum DataSourceValueReduce {
  Last = "Last",
  First = "First",
  Avg = "Avg",
  Sum = "Sum",
  Min = "Min",
  Max = "Max",
}

/*
 * Single big-number stat driven by an EXTERNAL Data Source query. The
 * OneUptime-metrics equivalent is DashboardValueComponent; the two share a
 * renderer but not a configuration surface.
 *
 * Not available on public dashboards.
 */
export default interface DashboardDataSourceValueComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DataSourceValue;
  componentId: ObjectID;
  arguments: {
    query?: DataSourceQueryConfig | undefined;
    title: string;
    /*
     * How the returned points reduce to one number. Absent ⇒ Last, which
     * is what "the current value of this query" means for the overwhelming
     * majority of external queries (a Prometheus instant-style rate, a SQL
     * count per bucket).
     */
    reduce?: DataSourceValueReduce | undefined;
    /*
     * Unit suffix rendered after the number. External queries carry no
     * OneUptime MetricType, so there is nothing to derive a unit from —
     * the user names it. Known units also scale the value the same way
     * metric units do ("Bytes" ⇒ 1.5 MB, "ms" ⇒ 2.4 sec, "%" ⇒ 99.9%).
     * Empty/undefined ⇒ the raw number with no suffix.
     */
    unit?: string | undefined;
    warningThreshold?: number | undefined;
    criticalThreshold?: number | undefined;
    trendDirection?: DashboardValueTrendDirection | undefined;
  };
}
