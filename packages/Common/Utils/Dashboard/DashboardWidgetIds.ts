import { JSONObject, ObjectType } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * The ids a dashboard widget's settings name, read as the ids they are, by
 * every board and by the public dashboard's routes alike (issue #6328).
 *
 * The editor saves an id as text. The API, Terraform, a workflow or a script
 * can store one as an ObjectID's JSON, `{"_type": "ObjectID", "value":
 * "<id>"}` (#4571): StoredDashboardViewConfig.read revives that into an
 * ObjectID - and leaves it as that JSON in a widget it draws from its stored
 * JSON because something else in it cannot be revived. Read as text, an SLO
 * widget trimmed an ObjectID and fell into its error boundary, and an
 * incident or alert list compared one with text and filtered out every
 * state. So every id setting is read here, as the id it names: `read` hands
 * every board, the editor and the public routes the ids as text, and the
 * code that reads a widget's ids itself - the SLO widget's source, the label
 * filter, the public policies - reads them with the same function.
 */

/*
 * The settings that hold a list of ids, in every widget type that has one.
 * DashboardWidgetIds.test.ts holds this to the widget types: an id
 * setting a widget type adds is listed here, or that test fails.
 */
export const DASHBOARD_WIDGET_ID_LIST_SETTINGS: ReadonlyArray<string> = [
  "severityIds",
  "stateIds",
  "monitorIds",
  "labelIds",
  "monitorStatusIds",
  "networkSiteTypeIds",
  "kubernetesClusterIds",
  "dockerHostIds",
  "dockerSwarmClusterIds",
  "podmanHostIds",
  "proxmoxClusterIds",
  "vmwareVCenterIds",
  "cephClusterIds",
  "storageArrayIds",
];

// The settings that hold one id: of an SLO, or of a dashboard variable.
export const DASHBOARD_WIDGET_ID_SETTINGS: ReadonlyArray<string> = [
  "serviceLevelObjectiveId",
  "serviceLevelObjectiveVariableId",
  "labelVariableId",
];

export default class DashboardWidgetIds {
  /*
   * The id a stored value names: text as it is (untrimmed), an ObjectID's
   * id, or the id an ObjectID's JSON holds. Null for anything else - a
   * number, a list, a date, another typed value, an object - which names no
   * id.
   */
  public static readId(value: unknown): string | null {
    if (typeof value === "string") {
      return value;
    }

    if (value instanceof ObjectID) {
      return value.toString();
    }

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as JSONObject)["_type"] === ObjectType.ObjectID &&
      typeof (value as JSONObject)["value"] === "string"
    ) {
      return (value as JSONObject)["value"] as string;
    }

    return null;
  }

  /*
   * Whether an id setting names no id at all: left out, null, or text with
   * nothing but spaces in it (in any of the forms readId reads). A value
   * that names no id but is there - a number, a list - is not absent: a
   * reader decides what it means.
   */
  public static isAbsent(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    const id: string | null = DashboardWidgetIds.readId(value);

    return id !== null && id.trim().length === 0;
  }

  /*
   * A list of ids, each read as the id it names. Whatever names no id - an
   * item of the list, or a value that is no list at all - is kept as it is,
   * so a widget whose setting holds one is answered, or refused, exactly as
   * before.
   */
  public static readIdList(value: unknown): Array<string> | undefined {
    if (!Array.isArray(value)) {
      return value as Array<string> | undefined;
    }

    return value.map((item: unknown): string => {
      const id: string | null = DashboardWidgetIds.readId(item);

      return (id === null ? item : id) as string;
    });
  }

  /*
   * A widget's settings with every id setting read as text: a list of ids
   * item by item, and one id as the id it names; anything that names no id
   * is kept as it is. A copy when an id was read; the same object when
   * there was nothing to read, so settings already in text are untouched.
   */
  public static withIdsRead(settings: JSONObject): JSONObject {
    const read: JSONObject = { ...settings };
    let isChanged: boolean = false;

    for (const key of DASHBOARD_WIDGET_ID_LIST_SETTINGS) {
      const stored: unknown = settings[key];

      if (!Array.isArray(stored)) {
        continue;
      }

      const ids: Array<string> = DashboardWidgetIds.readIdList(stored)!;

      if (
        ids.some((id: string, index: number): boolean => {
          return id !== stored[index];
        })
      ) {
        read[key] = ids;
        isChanged = true;
      }
    }

    for (const key of DASHBOARD_WIDGET_ID_SETTINGS) {
      const stored: unknown = settings[key];
      const id: string | null = DashboardWidgetIds.readId(stored);

      if (id !== null && id !== stored) {
        read[key] = id;
        isChanged = true;
      }
    }

    return isChanged ? read : settings;
  }
}
