import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardLogChartComponent extends BaseComponent {
  componentType: DashboardComponentType.LogChart;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    serviceIds?: Array<string> | undefined;
    severityFilters?: Array<string> | undefined;
    bodyContains?: string | undefined;
    /*
     * Exact attribute matches in the log-search syntax used by Log Stream,
     * for example: @service.name:checkout @deployment.environment:production.
     */
    attributeFilterQuery?: string | undefined;
  };
}
