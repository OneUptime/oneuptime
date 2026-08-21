import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardSecurityEventsListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.SecurityEventsList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    severityFilters?: Array<string> | undefined;
    classNameFilters?: Array<string> | undefined;
    messageContains?: string | undefined;
    limit?: number | undefined;
  };
}
