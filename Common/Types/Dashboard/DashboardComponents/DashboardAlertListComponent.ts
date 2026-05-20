import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardAlertListComponent extends BaseComponent {
  componentType: DashboardComponentType.AlertList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    stateFilter?: string | undefined;
    severityIds?: Array<string> | undefined;
    stateIds?: Array<string> | undefined;
    monitorIds?: Array<string> | undefined;
    labelIds?: Array<string> | undefined;
  };
}
