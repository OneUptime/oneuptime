import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";

export default class DashboardBaseComponentUtil {
  public static getDefaultComponent(): DashboardBaseComponent {
    throw new NotImplementedException();
  }
}
