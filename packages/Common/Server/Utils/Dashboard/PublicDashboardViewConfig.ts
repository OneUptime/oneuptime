import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType, {
  isDashboardComponentType,
  isDataSourceComponentType,
  isMetricComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable from "../../../Types/Dashboard/DashboardVariable";
import {
  getPublicDashboardVariable,
  getPublicDashboardWidgetSettings,
} from "../../../Types/Dashboard/PublicDashboardServedSettings";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import StoredDashboardViewConfig, {
  StoredBoardSettings,
} from "../../../Utils/Dashboard/StoredDashboardViewConfig";

/*
 * The dashboard config served to ANONYMOUS public-dashboard visitors: what
 * /view-config sends the public page, and /overview sends agents.
 *
 * The external Data Source widgets never render on a public dashboard -
 * the anonymous API deliberately exposes no /data-source/query surface, so
 * the client never sees them. But a Data Source widget's stored config is
 * the query itself: raw SQL naming internal tables and columns, a PromQL
 * expression naming internal jobs and instances, plus the id of the
 * connected Data Source. None of that is something an unauthenticated
 * viewer should be able to read out of a page that cannot even display it.
 *
 * So what is served is BUILT from what the public page draws, never
 * filtered out of what is stored (issue #6327). The stored config is read
 * as every board reads it (StoredDashboardViewConfig) - in the API
 * reference's envelope, as JSON text, with its widget list or a widget as
 * text or in the DashboardComponent envelope - and each widget found is
 * judged by the type every board draws it as:
 *
 *   a Data Source widget         left out, whole
 *   a widget of a type the page  served with its place on the board, its
 *   draws                        type and the settings (`arguments`) the
 *                                page draws it with, as the board reads
 *                                each of them - nothing of a key its type
 *                                does not have (issue #6338)
 *   a widget of a type the page  served with its place, its type and its
 *   cannot draw (a log chart, a  title, which the page draws above the
 *   trace chart or table, a      note saying it is not available on
 *   security events widget)      public dashboards - not the search text,
 *                                filters and grouping it reads its data
 *                                with (issue #6338)
 *   any other widget             served with its place and its type only:
 *                                the page draws "This widget could not be
 *                                shown" there and needs nothing more. A
 *                                type this version does not draw, no type
 *                                at all, and a widget stored inside more
 *                                layers of envelope or JSON text than a
 *                                board reads through are all of this kind,
 *                                so whatever is still wrapped inside one
 *                                never leaves the server
 *
 * with the board's own settings as the board reads them: its height, its
 * default time range and auto-refresh, and its variables, each with the
 * fields its toolbar draws it with - never a legacy Query variable's
 * query. Which settings each widget type is served, and which fields each
 * type of variable, is decided in one place, shared with the page
 * (Types/Dashboard/PublicDashboardServedSettings). Nothing else in the
 * stored value is served - not an entry no widget is read from (text, a
 * number, a list), not a key of the config, of a widget, of its settings
 * or of a variable that no board reads, and not anything a reader could
 * not read.
 *
 * Each widget is served with a type, so no board takes it for an envelope
 * and reads it further: the page draws exactly the widgets judged here, at
 * any depth they were stored in. Before, the sanitizer passed each widget
 * on as it found it, and a Data Source widget stored in six or more layers
 * of envelope - or in text no reader opened - reached the visitor whole.
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

    const entries: Array<unknown> =
      StoredDashboardViewConfig.getComponentEntries(storedConfig);

    const components: Array<JSONObject> = [];

    for (const entry of entries) {
      if (
        StoredDashboardViewConfig.isWidgetEntry(entry) &&
        !PublicDashboardViewConfig.isDataSourceComponent(
          entry as unknown as DashboardBaseComponent,
        )
      ) {
        components.push(PublicDashboardViewConfig.getServedComponent(entry));
      }
    }

    const board: StoredBoardSettings =
      StoredDashboardViewConfig.readBoardSettings(storedConfig);

    return {
      ...board,
      ...(board.variables
        ? {
            variables: board.variables.map(
              (variable: DashboardVariable): DashboardVariable => {
                return PublicDashboardViewConfig.getServedVariable(variable);
              },
            ),
          }
        : {}),
      _type: ObjectType.DashboardViewConfig,
      components: components as unknown as Array<DashboardBaseComponent>,
    };
  }

  /*
   * One variable as it is served: the fields its toolbar draws its picker
   * with, and the widgets and the public routes filter by - its id, name,
   * label, type and pick, plus what its type lists: a custom list's
   * values, a Telemetry Attribute variable's key, a project label
   * variable's labels (PublicDashboardServedSettings). A legacy Query
   * variable's query is never among them: the toolbar never runs it.
   *
   * Read again by any board, it is the same variable: a variable as the
   * toolbar reads it (StoredDashboardViewConfig.readBoardSettings) keeps
   * its id and the types of its fields when it is read again, so the
   * public routes read exactly the variables the page draws.
   */
  public static getServedVariable(
    variable: DashboardVariable,
  ): DashboardVariable {
    return getPublicDashboardVariable(variable);
  }

  /*
   * One widget as it is served: what the public page draws of it, each
   * field as every board reads it - the id it is stored under (text), the
   * type it is drawn as, its place on the board, and, for a type this
   * version draws, the settings its type is served, each as stored (from
   * the object its JSON text says, when the arguments were written as
   * text): what the page draws it with, and nothing else - not a key its
   * type does not have, and not a log chart's search text or a trace
   * table's filters, which a public dashboard never draws (issue #6338,
   * PublicDashboardServedSettings). A type no board draws keeps no
   * settings: it is drawn as "This widget could not be shown", from its
   * place alone.
   *
   * Read again by any board, it is the same widget: the same type and
   * place, the same settings to deserialize, and the same id - a widget
   * stored without a usable one still gets the id derived for its place in
   * the list, as the routes that read the drawn config derive it too.
   */
  public static getServedComponent(entry: JSONObject): JSONObject {
    const componentType: string =
      StoredDashboardViewConfig.getComponentType(entry);
    const componentId: string | null =
      StoredDashboardViewConfig.getComponentIdString(entry["componentId"]);

    const served: JSONObject = {
      _type: ObjectType.DashboardComponent,
      ...(componentId ? { componentId: componentId } : {}),
      componentType: componentType,
      ...StoredDashboardViewConfig.getComponentLayout(entry),
    };

    if (!isDashboardComponentType(componentType)) {
      return served;
    }

    const settings: unknown =
      StoredDashboardViewConfig.withArgumentsRead(entry)["arguments"];

    if (PublicDashboardViewConfig.isSettingsObject(settings)) {
      served["arguments"] = getPublicDashboardWidgetSettings(
        componentType,
        settings,
      ) as JSONObject;
    }

    return served;
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
   * Whether a stored widget entry is a Data Source widget: judged by the
   * type every board draws it as (StoredDashboardViewConfig
   * .getComponentType), matched exactly. " DataSourceChart " and
   * "datasourcechart" are no type any board draws, so they are served as
   * widgets that could not be shown, without their settings. Tolerant of
   * malformed stored config: componentType arrives from JSONB, so a row
   * written by an older or hand-edited client can carry anything.
   */
  public static isDataSourceComponent(
    component: DashboardBaseComponent | null | undefined,
  ): boolean {
    if (!component || typeof component !== "object") {
      return false;
    }

    return isDataSourceComponentType(
      StoredDashboardViewConfig.getComponentType(
        component as unknown as JSONObject,
      ) as DashboardComponentType,
    );
  }
}
