import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardTextComponent extends BaseComponent {
  componentType: DashboardComponentType.Text;
  componentId: ObjectID;
  arguments: {
    text: string;
    isBold: boolean;
    isItalic: boolean;
    isUnderline: boolean;
  }

}
