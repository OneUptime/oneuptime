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
  };
}
