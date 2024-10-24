import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../Types/JSON";
import DashboardSize from "../../Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";

export default class DashboardViewConfigUtil {
  public static createDefaultDashboardViewConfig(): DashboardViewConfig {
    return {
      _type: ObjectType.DashboardViewConfig,
      components: [],
      widthInDashboardUnits: DashboardSize.widthInDashboardUnits,
      heightInDashboardUnits: DashboardSize.heightInDashboardUnits,
    };
  }

  public static addComponentToDashboard(data: {
    component: DashboardBaseComponent;
    dashboardViewConfig: DashboardViewConfig;
  }): DashboardViewConfig {
    const heightOfComponent: number = data.component.heightInDashboardUnits;

    // find the last row that has enough space to fit the component. If there is no such row, create a new row or rows to fit the component.
    const allComponentsFromDashboard: Array<DashboardBaseComponent> =
      data.dashboardViewConfig.components;

    let componentTopPosition: number = 0;
    let componentLeftPosition: number = 0;

    // find the last row that has the component.

    let lastRowThatHasComponent: number = 0;

    for (const dashboardComponent of allComponentsFromDashboard) {
      if (dashboardComponent.topInDashboardUnits < componentTopPosition) {
        lastRowThatHasComponent = componentTopPosition;
      }
    }

    componentTopPosition = lastRowThatHasComponent + 1;

    // check height of the component. If it is bigger than the last row that has the component, create more rows and udate the height of dashboardViewConfig.

    if (
      componentTopPosition + heightOfComponent >
      data.dashboardViewConfig.heightInDashboardUnits
    ) {
      data.dashboardViewConfig.heightInDashboardUnits =
        componentTopPosition + heightOfComponent;
    }

    // left position of the component is always 0.
    componentLeftPosition = 0;

    const newComponent: DashboardBaseComponent = {
      ...data.component,
      topInDashboardUnits: componentTopPosition,
      leftInDashboardUnits: componentLeftPosition,
    };

    // Add the new component to the dashboard configuration
    data.dashboardViewConfig.components.push(newComponent);

    return { ...data.dashboardViewConfig };
  }
}
