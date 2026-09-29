import DataSourceQueryConfig from "../../DataSource/DataSourceQueryConfig";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";
import { DataSourceValueReduce } from "./DashboardDataSourceValueComponent";

/*
 * Radial gauge driven by an EXTERNAL Data Source query. The
 * OneUptime-metrics equivalent is DashboardGaugeComponent.
 *
 * Not available on public dashboards.
 */
export default interface DashboardDataSourceGaugeComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DataSourceGauge;
  componentId: ObjectID;
  arguments: {
    query?: DataSourceQueryConfig | undefined;
    gaugeTitle?: string | undefined;
    // See DashboardDataSourceValueComponent — same reduction, same default.
    reduce?: DataSourceValueReduce | undefined;
    /*
     * Unit suffix for the centre value and the min/max footer. External
     * queries carry no MetricType to derive one from.
     */
    unit?: string | undefined;
    minValue?: number | undefined;
    maxValue?: number | undefined;
    warningThreshold?: number | undefined;
    criticalThreshold?: number | undefined;
  };
}
