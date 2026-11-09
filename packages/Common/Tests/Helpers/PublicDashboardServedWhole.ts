import PublicDashboardViewConfig from "../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { isDashboardComponentType } from "../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../Types/JSON";
import StoredDashboardViewConfig from "../../Utils/Dashboard/StoredDashboardViewConfig";

/*
 * What /view-config served before issue #6338, for the suites that hold
 * what it serves now to it: the same widgets, ids and places as
 * PublicDashboardViewConfig.sanitize, but each widget of a type a board
 * draws with its settings whole, and every variable whole, as the toolbar
 * reads it - every setting a widget was stored with, and every field of a
 * variable, a Query variable's query among them.
 *
 * Now every widget is served only the settings its type is served, and
 * every variable only the fields its type is served
 * (Types/Dashboard/PublicDashboardServedSettings). The page, and the
 * public routes that read what it draws, must answer exactly as they did
 * from this.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */
export function servedWhole(stored: unknown): DashboardViewConfig | null {
  if (!stored) {
    return null;
  }

  const storedConfig: JSONObject = StoredDashboardViewConfig.unwrap(stored);
  const components: Array<JSONObject> = [];

  for (const entry of StoredDashboardViewConfig.getComponentEntries(
    storedConfig,
  )) {
    if (
      !StoredDashboardViewConfig.isWidgetEntry(entry) ||
      PublicDashboardViewConfig.isDataSourceComponent(
        entry as unknown as DashboardBaseComponent,
      )
    ) {
      continue;
    }

    const served: JSONObject =
      PublicDashboardViewConfig.getServedComponent(entry);
    const settings: unknown =
      StoredDashboardViewConfig.withArgumentsRead(entry)["arguments"];

    if (
      isDashboardComponentType(served["componentType"]) &&
      PublicDashboardViewConfig.isSettingsObject(settings)
    ) {
      served["arguments"] = settings as JSONObject;
    }

    components.push(served);
  }

  return {
    ...StoredDashboardViewConfig.readBoardSettings(storedConfig),
    _type: ObjectType.DashboardViewConfig,
    components: components as unknown as Array<DashboardBaseComponent>,
  };
}

// What the page and the routes drew from it: served whole, read as the page reads it.
export function drawnFromWhole(stored: unknown): DashboardViewConfig {
  return StoredDashboardViewConfig.read(servedWhole(stored));
}
