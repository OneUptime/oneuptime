import { ObjectType } from "../JSON";
import DashboardBaseComponent from "./DashboardComponents/DashboardBaseComponent";

export default interface DashboardViewConfig {
  _type: ObjectType.DashboardViewConfig;
  components: Array<DashboardBaseComponent>;
  heightInDashboardUnits: number;
  widthInDashboardUnits: number;
}
