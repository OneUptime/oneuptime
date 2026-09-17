import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import DashboardChartType from "../Chart/ChartType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardLogChartComponent extends BaseComponent {
  componentType: DashboardComponentType.LogChart;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    chartType?: DashboardChartType | undefined;
    severityFilters?: Array<string> | undefined;
    bodyContains?: string | undefined;
    /*
     * Exact attribute matches stored by the structured key/value editor.
     */
    attributeFilters?: Record<string, string | number | boolean> | undefined;
    /*
     * Legacy log-search syntax retained as a read-only fallback for widgets
     * saved before the structured attribute editor was introduced.
     */
    attributeFilterQuery?: string | undefined;
  };
}
