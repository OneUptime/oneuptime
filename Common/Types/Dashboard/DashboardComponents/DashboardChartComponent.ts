import { ObjectType } from "../../JSON";
import ObjectID from "../../ObjectID";
import ChartType from "../Chart/ChartType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardChartComponent extends BaseComponent {
  _type: ObjectType.DashboardChartComponent;
  componentId: ObjectID;
  chartType: ChartType;
}
