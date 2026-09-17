import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardLogStreamComponent extends BaseComponent {
  componentType: DashboardComponentType.LogStream;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    severityFilter?: string | undefined;
    bodyContains?: string | undefined;
    attributeFilterQuery?: string | undefined;
    maxRows?: number | undefined;
  };
}
