import GenericObject from "../../GenericObject";
import { ObjectType } from "../../JSON";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";

export default interface DashboardBaseComponent {
  _type: ObjectType.DashboardComponent;
  componentId: ObjectID;
  componentType: DashboardComponentType;
  topInDashboardUnits: number;
  leftInDashboardUnits: number;
  widthInDashboardUnits: number;
  heightInDashboardUnits: number;
  minWidthInDashboardUnits: number;
  minHeightInDashboardUnits: number;
  arguments?: GenericObject | undefined;
}
