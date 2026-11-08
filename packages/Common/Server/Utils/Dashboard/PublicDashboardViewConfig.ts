import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType, {
  isDataSourceComponentType,
  isMetricComponentType,
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
   * The config a public dashboard's page draws: the one /view-config serves
   * (sanitize), read as the page reads it (StoredDashboardViewConfig.read).
   * Every widget is found in every shape it can be stored in - as JSON
   * text, in the DashboardComponent envelope (its value an object or
   * text), in a widget list written as text, with its arguments written as
   * text - and comes deserialized, with an id and an `arguments` object;
   * a Data Source widget, an entry no widget is read from and text that
   * says no widget are not among them (issue #6297).
   *
   * The public routes that serve what the page draws read this, so they
   * answer exactly what the page can ask for. Between the two lies only
   * the wire - serialized, sent as JSON, parsed - which changes nothing
   * the page reads. The one key it may keep or drop is `__proto__`, which
   * JSON.parse keeps as an ordinary key: the page reads its widgets'
   * settings by name and never reads a value from it, so nothing read here
   * may either.
   */
  public static getDrawnConfig(
    dashboardViewConfig: unknown,
  ): DashboardViewConfig {
    return StoredDashboardViewConfig.read(
      PublicDashboardViewConfig.sanitize(
        dashboardViewConfig as DashboardViewConfig | null | undefined,
      ),
    );
  }

  /*
   * The settings (`arguments`) of each widget of a drawn config that charts
   * metrics (MetricComponentTypes, matched exactly), in order: where the
   * chart, value, gauge and table widgets read every query they make, and
   * so the only settings whose reads the public metric routes answer.
   * Every other widget the page draws - text, a list, one of a type this
   * version does not draw - asks those routes for nothing.
   */
  public static getMetricWidgetSettings(
    drawnConfig: DashboardViewConfig,
  ): Array<JSONObject> {
    return drawnConfig.components
      .filter((component: DashboardBaseComponent): boolean => {
        return isMetricComponentType(component.componentType);
      })
      .map((component: DashboardBaseComponent): JSONObject => {
        // Always an object: the drawn config gives every widget one.
        return (component.arguments || {}) as JSONObject;
      });
  }

  /*
   * Calls `visit` with every object in the settings of drawn widgets, at
   * any depth, as the page reads them - the one walk every public metric
   * allowlist makes, so all of them read the same places (issue #6297):
   *
   * - lists and plain objects are walked into;
   * - a deserialized value - an ObjectID, a query operator, a date - is a
   *   value the page reads whole, never settings of its own, so it is not
   *   walked into (its fields are its own: an Includes keeps its values in
   *   `_values`);
   * - a `__proto__` key holds nothing the page reads (getDrawnConfig).
   */
  public static forEachSettingsObject(
    value: unknown,
    visit: (settings: Record<string, unknown>) => void,
  ): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        PublicDashboardViewConfig.forEachSettingsObject(item, visit);
      }

      return;
    }

    if (!PublicDashboardViewConfig.isSettingsObject(value)) {
      return;
    }

    visit(value);

    for (const key of PublicDashboardViewConfig.getSettingsKeys(value)) {
      PublicDashboardViewConfig.forEachSettingsObject(value[key], visit);
    }
  }

  /*
   * Whether a value is settings the page reads by name: a plain object, as
   * JSON and the deserializer make them - not a list, and not a
   * deserialized value (an ObjectID, a query operator, a date).
   */
  public static isSettingsObject(
    value: unknown,
  ): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }

  // The keys of settings the page reads: each own key but `__proto__`.
  public static getSettingsKeys(
    settings: Record<string, unknown>,
  ): Array<string> {
    return Object.keys(settings).filter((key: string): boolean => {
      return key !== "__proto__";
    });
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
