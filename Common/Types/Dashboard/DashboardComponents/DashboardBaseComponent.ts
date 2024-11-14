import { ObjectType } from "../../JSON";
import ObjectID from "../../ObjectID";

export default interface DashboardBaseComponent {
  _type: ObjectType;
  componentId: ObjectID;
  topInDashboardUnits: number;
  leftInDashboardUnits: number;
  widthInDashboardUnits: number;
  heightInDashboardUnits: number;
  minWidthInDashboardUnits: number;
  minHeightInDashboardUnits: number;
}
