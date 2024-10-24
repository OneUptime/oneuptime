import ObjectID from "../../ObjectID";

export default interface DashboardBaseComponent {
  _type: string;
  componentId: ObjectID;
  topInDashboardUnits: number;
  leftInDashboardUnits: number;
  widthInDashboardUnits: number;
  heightInDashboardUnits: number;
}
