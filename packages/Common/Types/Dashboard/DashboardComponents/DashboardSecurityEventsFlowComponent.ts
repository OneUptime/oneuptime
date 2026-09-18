import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardSecurityEventsFlowComponent
  extends BaseComponent {
  componentType: DashboardComponentType.SecurityEventsFlow;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    severityFilters?: Array<string> | undefined;
    /*
     * The Sankey is computed client-side from individual events, so the
     * fetch is capped. Defaults to 500, hard-capped at 1000.
     */
    maxEvents?: number | undefined;
  };
}
