import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";

export default class DashboardBaseComponentUtil {
  public static getDefaultComponent(): DashboardBaseComponent {
    throw new NotImplementedException();
  }

  public static getComponentConfigArguments(): Array<ComponentArgument> { 
    return [];
  }
}
