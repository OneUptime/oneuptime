import DashboardTextComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

export default class DashboardTextComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTextComponent {
    return {
      _type: ObjectType.DashboardTextComponent,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 1,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      text: "Hello, World!",
      componentId: ObjectID.generate(),
      isBold: false,
      isItalic: false,
      isUnderline: false,
    };
  }
}
