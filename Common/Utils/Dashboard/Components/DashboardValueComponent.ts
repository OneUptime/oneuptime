import DashboardValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

export default class DashboardValueComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardValueComponent {
    return {
      _type: ObjectType.DashboardValueComponent,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 1,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
    };
  }
}
