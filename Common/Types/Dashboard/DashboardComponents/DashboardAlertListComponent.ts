import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardAlertListComponent extends BaseComponent {
  componentType: DashboardComponentType.AlertList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    stateFilter?: string | undefined;
  };
}
