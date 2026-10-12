import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType, {
  isDataSourceComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";
import { JSONObject } from "../../../Types/JSON";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";

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
 *
 * The widgets are found where the dashboard finds them
 * (StoredDashboardViewConfig): a config stored as the API reference's
 * `{_type: "DashboardViewConfig", value: {...}}` envelope or as JSON text
 * has its widgets one level down, and reading only a top-level `components`
 * missed them - the whole stored value, Data Source queries included, went
 * to the anonymous viewer as it was (issue #4571). What is served is the
 * config itself, with its widget list; each widget in it is passed through
 * untouched.
 */
export default class PublicDashboardViewConfig {
  public static sanitize(
    dashboardViewConfig: DashboardViewConfig | null | undefined,
  ): DashboardViewConfig | null {
    if (!dashboardViewConfig) {
      return null;
    }

    const storedConfig: JSONObject =
      StoredDashboardViewConfig.unwrap(dashboardViewConfig);

    const components: Array<unknown> =
      StoredDashboardViewConfig.getComponentEntries(storedConfig);

    return {
      ...(storedConfig as unknown as DashboardViewConfig),
      components: components.filter((component: unknown) => {
        return !PublicDashboardViewConfig.isDataSourceComponent(
          component as DashboardBaseComponent,
        );
      }) as Array<DashboardBaseComponent>,
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
