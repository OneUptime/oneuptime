import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";

export default class DashboardChartComponentConfigUtil {
  public static createDefaultDashboardViewConfig(): DashboardChar {
    return {
      _type: ObjectType.DashboardChartComponent,
      components: [],
    };
  }

  public static addDefaultChartComponent(): DashboardViewConfig {

  }
}
