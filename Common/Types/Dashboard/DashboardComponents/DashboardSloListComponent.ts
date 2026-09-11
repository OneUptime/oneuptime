import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardSloListComponent extends BaseComponent {
  componentType: DashboardComponentType.SloList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    sloStatuses?: Array<string> | undefined;
    monitorIds?: Array<string> | undefined;
    labelIds?: Array<string> | undefined;
    labelVariableId?: string | undefined;
  };
}
