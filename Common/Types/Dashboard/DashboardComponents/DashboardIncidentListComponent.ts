import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardIncidentListComponent extends BaseComponent {
  componentType: DashboardComponentType.IncidentList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    stateFilter?: string | undefined;
    severityIds?: Array<string> | undefined;
    stateIds?: Array<string> | undefined;
    monitorIds?: Array<string> | undefined;
    labelIds?: Array<string> | undefined;
  };
}
