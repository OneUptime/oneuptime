import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardMonitorListComponent extends BaseComponent {
  componentType: DashboardComponentType.MonitorList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    statusFilter?: string | undefined;
    monitorStatusIds?: Array<string> | undefined;
    monitorTypes?: Array<string> | undefined;
    labelIds?: Array<string> | undefined;
  };
}
