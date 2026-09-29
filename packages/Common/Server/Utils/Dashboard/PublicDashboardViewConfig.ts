import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType, {
  isDataSourceComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";

/*
 * Sanitizer for the dashboard config served to ANONYMOUS public-dashboard
 * viewers.
 *
 * The external Data Source widgets never render on a public dashboard —
 * the anonymous API deliberately exposes no /data-source/query surface, so
 * the client draws a placeholder instead. But the widget's stored config
 * would still travel to the viewer inside dashboardViewConfig, and that
 * config is the query itself: raw SQL naming internal tables and columns,
 * a PromQL expression naming internal jobs and instances, plus the id of
 * the connected Data Source. None of that is something an unauthenticated
 * viewer should be able to read out of a page that cannot even display it.
 *
 * So the widgets are dropped outright rather than field-stripped: the
 * placeholder the client renders needs nothing from the config, and
 * dropping leaves no room for a later-added field to leak by omission.
 */
export default class PublicDashboardViewConfig {
  public static sanitize(
    dashboardViewConfig: DashboardViewConfig | null | undefined,
  ): DashboardViewConfig | null {
    if (!dashboardViewConfig) {
      return null;
    }

    const components: Array<DashboardBaseComponent> =
      dashboardViewConfig.components || [];

    return {
      ...dashboardViewConfig,
      components: components.filter((component: DashboardBaseComponent) => {
        return !PublicDashboardViewConfig.isDataSourceComponent(component);
      }),
    };
  }

  /*
   * Tolerant of malformed stored config: componentType is typed but arrives
   * from JSONB, so a row written by an older or hand-edited client can carry
   * anything. Anything that is not recognisably a Data Source widget is kept
   * — the sanitizer's job is to remove, not to validate.
   */
  public static isDataSourceComponent(
    component: DashboardBaseComponent | null | undefined,
  ): boolean {
    if (!component || typeof component !== "object") {
      return false;
    }

    const componentType: unknown = (component as { componentType?: unknown })
      .componentType;

    if (typeof componentType !== "string") {
      return false;
    }

    return isDataSourceComponentType(componentType as DashboardComponentType);
  }
}
