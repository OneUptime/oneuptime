import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardTraceListComponent extends BaseComponent {
  componentType: DashboardComponentType.TraceList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    statusFilter?: string | undefined;
    maxRows?: number | undefined;
  };
}
