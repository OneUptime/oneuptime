import { ObjectType } from "../../JSON";
import ObjectID from "../../ObjectID";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardValueComponent extends BaseComponent {
  _type: ObjectType.DashboardValueComponent;
  componentId: ObjectID;
}
