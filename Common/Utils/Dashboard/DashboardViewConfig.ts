import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";

export default class DashboardViewConfigUtil {
  public static createDefaultDashboardViewConfig(): DashboardViewConfig {
    return {
      _type: "DashboardViewConfig",
      components: [],
    };
  }
}
