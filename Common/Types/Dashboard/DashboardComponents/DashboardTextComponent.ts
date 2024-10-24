import ObjectID from "../../ObjectID";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardTextComponent extends BaseComponent {
  _type: "DashboardTextComponent";
  componentId: ObjectID;
  text: string;
}
