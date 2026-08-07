import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../Types/JSON";
import DashboardSize from "../../Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import GridLayoutUtil, { GridPosition, GridRect } from "./GridLayout";

export default class DashboardViewConfigUtil {
  public static createDefaultDashboardViewConfig(): DashboardViewConfig {
    return {
      _type: ObjectType.DashboardViewConfig,
      components: [],
      heightInDashboardUnits: DashboardSize.heightInDashboardUnits,
    };
  }

  /**
   * Place a new component at the first free spot (scanning top-to-bottom,
   * left-to-right) that fits it, falling back to a fresh row at the bottom.
   * Does not mutate the passed-in config.
   */
  public static addComponentToDashboard(data: {
    component: DashboardBaseComponent;
    dashboardViewConfig: DashboardViewConfig;
  }): DashboardViewConfig {
    const existingRects: Array<GridRect> =
      GridLayoutUtil.fromDashboardComponents(
        data.dashboardViewConfig.components,
      );

    const width: number = Math.min(
      Math.max(1, data.component.widthInDashboardUnits),
      GridLayoutUtil.DefaultColumns,
    );
    const height: number = Math.max(1, data.component.heightInDashboardUnits);

    const position: GridPosition = GridLayoutUtil.findFirstFit({
      rects: existingRects,
      width,
      height,
    });

    const newComponent: DashboardBaseComponent = {
      ...data.component,
      topInDashboardUnits: position.top,
      leftInDashboardUnits: position.left,
      widthInDashboardUnits: width,
      heightInDashboardUnits: height,
    };

    const components: Array<DashboardBaseComponent> = [
      ...data.dashboardViewConfig.components,
      newComponent,
    ];

    const requiredRows: number = GridLayoutUtil.requiredRows(
      GridLayoutUtil.fromDashboardComponents(components),
    );

    return {
      ...data.dashboardViewConfig,
      components,
      heightInDashboardUnits: Math.max(
        DashboardViewConfigUtil.getFiniteHeight(data.dashboardViewConfig),
        requiredRows,
      ),
    };
  }

  /**
   * Heal a config that older builds could corrupt: clamp every component
   * into the board and push overlapping components down so nothing
   * occupies the same cells. Returns the same config object when the
   * layout is already valid.
   */
  public static normalizeLayout(
    dashboardViewConfig: DashboardViewConfig,
  ): DashboardViewConfig {
    const rects: Array<GridRect> = GridLayoutUtil.fromDashboardComponents(
      dashboardViewConfig.components,
    );

    const normalized: Array<GridRect> = GridLayoutUtil.normalize(rects);

    if (GridLayoutUtil.areLayoutsEqual(rects, normalized)) {
      return dashboardViewConfig;
    }

    const components: Array<DashboardBaseComponent> =
      GridLayoutUtil.applyRectsToComponents(
        dashboardViewConfig.components,
        normalized,
      );

    return {
      ...dashboardViewConfig,
      components,
      heightInDashboardUnits: Math.max(
        DashboardViewConfigUtil.getFiniteHeight(dashboardViewConfig),
        GridLayoutUtil.requiredRows(normalized),
      ),
    };
  }

  /** A saved config can hold a missing/NaN height — never let it spread. */
  private static getFiniteHeight(config: DashboardViewConfig): number {
    const height: number = config.heightInDashboardUnits;
    if (typeof height !== "number" || !Number.isFinite(height)) {
      return 0;
    }
    return height;
  }
}
