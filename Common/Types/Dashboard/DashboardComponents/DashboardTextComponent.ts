import { ObjectType } from "../../JSON";
import ObjectID from "../../ObjectID";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardTextComponent extends BaseComponent {
  _type: ObjectType.DashboardTextComponent;
  componentId: ObjectID;
  arguments: {
    text: string;
    isBold: boolean;
    isItalic: boolean;
    isUnderline: boolean;
  }

}
