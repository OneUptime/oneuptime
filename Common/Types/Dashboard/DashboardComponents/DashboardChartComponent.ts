import ObjectID from "../../ObjectID";
import ChartType from "../Chart/ChartType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardChartComponent extends BaseComponent {
  _type: "DashboardChartComponent";
  componentId: ObjectID;
  chartType: ChartType;
}
