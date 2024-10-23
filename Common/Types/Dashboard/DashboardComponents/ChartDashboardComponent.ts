import ObjectID from "../../ObjectID";
import ChartType from "../Chart/ChartType";
import BaseComponent from "./DashboardBaseComponent";

export default interface ChartDashboardComponent extends BaseComponent {
  type: "chart";
  componentId: ObjectID;
  chartType: ChartType;
}
