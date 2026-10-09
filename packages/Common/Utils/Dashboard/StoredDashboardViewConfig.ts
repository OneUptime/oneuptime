import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableOption,
  DashboardVariableType,
} from "../../Types/Dashboard/DashboardVariable";
import DefaultDashboardSize from "../../Types/Dashboard/DashboardSize";
import { JSONObject, JSONValue, ObjectType } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";

/*
 * Reads a dashboard's stored config, in whatever shape it was stored, into
 * the shape the dashboard draws (issue #4571).
 *
 * The config is a JSON column. The dashboard editor always writes it whole
 * and well formed, but the API, Terraform, workflows and scripts can write
 * anything, and older versions wrote less:
 *
 * - The envelope the API reference documented,
 *   `{"_type": "DashboardViewConfig", "value": {"components": [...]}}`. The
 *   server stores it as sent, so the widgets sit under `value` and the
 *   dashboard read `components` off nothing: "Cannot read properties of
 *   undefined (reading 'length')", and the page never opened. Widgets in
 *   the `{"_type": "DashboardComponent", "value": {...}}` envelope the same
 *   reference documented for one widget are read as the widget inside.
 * - JSON text instead of an object (a config, or a widget, encoded twice).
 * - No widget list at all (`{}`), or a list that is not a list.
 * - Widgets without an id, two widgets with the same id, widgets without
 *   `arguments` (saved before November 2024, or written by hand), sizes
 *   written as text or missing.
 * - Widget types this version does not draw: removed (HostMetricChart),
 *   newer, or misspelt. Those are KEPT, so the dashboard can say which
 *   widget it cannot show and the user can remove it - and so a widget a
 *   newer version wrote survives a save made here.
 * - Variables and an auto-refresh interval that are not what the toolbar
 *   reads.
 *
 * Every reader of a stored config starts here: the dashboard and the public
 * dashboard when they load one, Add to Dashboard before it appends a chart,
 * the server's create default and every public dashboard route. The server
 * keeps storing what it is sent - Terraform reads a write back and compares
 * it with what it sent, so rewriting the value would fail `terraform apply`
 * for configs that now open fine - and the readers agree on what it says.
 *
 * Nothing here throws, and nothing mutates what it was handed.
 */

/*
 * A widget stored without a size gets the size most widgets are added at
 * (the catalog's charts, values, gauges and lists are 6 x 4), so it - or
 * the note saying it cannot be shown - is readable rather than one cell.
 */
export const FALLBACK_WIDGET_WIDTH_IN_DASHBOARD_UNITS: number = 6;
export const FALLBACK_WIDGET_HEIGHT_IN_DASHBOARD_UNITS: number = 4;

/*
 * How many layers of JSON text or envelope are read through before giving
 * up. Real configs need one or two; the bound keeps a hostile value from
 * looping.
 */
const MAX_UNWRAP_STEPS: number = 4;

const INDEX_KEY: RegExp = /^\d+$/;

type ReadValueFunction = (value: unknown) => unknown;

function isPlainObject(value: unknown): value is JSONObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

// JSON text is read as what it says; anything else is left as it is.
const readJSONText: ReadValueFunction = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const text: string = value.trim();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

/*
 * A UUID that names the n-th widget (or variable) stored without an id of
 * its own. Derived, not random, so every reader of the same stored config
 * arrives at the same ids: the public dashboard draws a widget under the id
 * the server's public routes then look it up by. UUID-shaped because those
 * routes refuse any other componentId.
 */
function getDerivedId(namespace: string, sequence: number): string {
  return `00000000-0000-4000-${namespace}-${sequence
    .toString(16)
    .padStart(12, "0")}`;
}

const COMPONENT_ID_NAMESPACE: string = "8000";
const VARIABLE_ID_NAMESPACE: string = "9000";

/*
 * Gives every value in `ids` a usable id: the first holder of an id keeps
 * it, and a missing id or one taken by an earlier entry gets a derived one
 * that no entry holds.
 */
function assignIds(data: {
  ids: Array<string | null>;
  namespace: string;
}): Array<string> {
  const held: Set<string> = new Set<string>();

  for (const id of data.ids) {
    if (id) {
      held.add(id);
    }
  }

  const claimed: Set<string> = new Set<string>();
  let sequence: number = 0;

  return data.ids.map((id: string | null): string => {
    if (id && !claimed.has(id)) {
      claimed.add(id);
      return id;
    }

    let derived: string = "";

    do {
      sequence++;
      derived = getDerivedId(data.namespace, sequence);
    } while (held.has(derived) || claimed.has(derived));

    claimed.add(derived);

    return derived;
  });
}

function isAutoRefreshInterval(value: unknown): value is AutoRefreshInterval {
  return (
    typeof value === "string" &&
    (Object.values(AutoRefreshInterval) as Array<string>).includes(value)
  );
}

export default class StoredDashboardViewConfig {
  /*
   * The object the widgets are on, wherever the config was stored: the
   * value itself, the object its JSON text says, or the `value` of the
   * `{_type: "DashboardViewConfig", value}` envelope. A bare list is read
   * as the widget list. Anything else reads as an empty object. A config
   * that is already an object comes back as the SAME object.
   */
  public static unwrap(value: unknown): JSONObject {
    let current: unknown = value;

    for (let step: number = 0; step <= MAX_UNWRAP_STEPS; step++) {
      if (typeof current === "string") {
        current = readJSONText(current);
        continue;
      }

      if (Array.isArray(current)) {
        return { components: current as Array<JSONValue> };
      }

      if (!isPlainObject(current)) {
        return {};
      }

      if (StoredDashboardViewConfig.isEnvelope(current)) {
        current = current["value"];
        continue;
      }

      return current;
    }

    return {};
  }

  /*
   * The stored widget list - junk entries included, in order, each widget
   * as stored. `components` is normally a list; a list written as JSON text,
   * as an object keyed "0", "1", ... (what an older serializer made of
   * nested lists), or a single widget object is read as the list it means.
   * A widget written as JSON text, or inside the
   * `{"_type": "DashboardComponent", "value": {...}}` envelope the API
   * reference documented, is read as the widget it holds - by every reader
   * alike, so the public dashboard's Data Source strip sees the same widget
   * the dashboard draws.
   */
  public static getComponentEntries(config: JSONObject): Array<unknown> {
    return StoredDashboardViewConfig.getComponentList(config).map(
      (entry: unknown): unknown => {
        return StoredDashboardViewConfig.unwrapComponentEntry(entry);
      },
    );
  }

  // Whether a stored widget entry is something a widget can be read from.
  public static isWidgetEntry(entry: unknown): entry is JSONObject {
    return isPlainObject(entry);
  }

  /*
   * The id a stored componentId names: an ObjectID, a string, a number, or
   * the `{_type: "ObjectID", value}` JSON an ObjectID is stored as.
   */
  public static getComponentIdString(componentId: unknown): string | null {
    if (componentId instanceof ObjectID) {
      return componentId.toString().trim() || null;
    }

    if (typeof componentId === "string") {
      return componentId.trim() || null;
    }

    if (typeof componentId === "number" && Number.isFinite(componentId)) {
      return String(componentId);
    }

    if (isPlainObject(componentId)) {
      const type: unknown = componentId["_type"];
      const value: unknown = componentId["value"];

      if (
        (type === undefined || type === ObjectType.ObjectID) &&
        typeof value === "string" &&
        value.trim()
      ) {
        return value.trim();
      }
    }

    return null;
  }

  /*
   * The id each stored entry is drawn under, in order (null for entries no
   * widget is read from). Shared by the dashboard and the server's public
   * routes so both name every widget alike.
   */
  public static getComponentIds(entries: Array<unknown>): Array<string | null> {
    const widgetIndexes: Array<number> = [];
    const ownIds: Array<string | null> = [];

    entries.forEach((entry: unknown, index: number) => {
      if (StoredDashboardViewConfig.isWidgetEntry(entry)) {
        widgetIndexes.push(index);
        ownIds.push(
          StoredDashboardViewConfig.getComponentIdString(entry["componentId"]),
        );
      }
    });

    const assigned: Array<string> = assignIds({
      ids: ownIds,
      namespace: COMPONENT_ID_NAMESPACE,
    });

    const ids: Array<string | null> = entries.map((): null => {
      return null;
    });

    widgetIndexes.forEach((entryIndex: number, widgetIndex: number) => {
      ids[entryIndex] = assigned[widgetIndex] || null;
    });

    return ids;
  }

  /*
   * The stored entries with every widget holding the id it is drawn under.
   * A widget that already has its own unique id comes back as the same
   * object; one without (or with a taken one) as a copy carrying its new id.
   * Entries no widget is read from come back as they are.
   */
  public static withComponentIds(entries: Array<unknown>): Array<unknown> {
    const ids: Array<string | null> =
      StoredDashboardViewConfig.getComponentIds(entries);

    return entries.map((entry: unknown, index: number): unknown => {
      const id: string | null = ids[index] || null;

      if (!id || !StoredDashboardViewConfig.isWidgetEntry(entry)) {
        return entry;
      }

      if (
        StoredDashboardViewConfig.getComponentIdString(entry["componentId"]) ===
        id
      ) {
        return entry;
      }

      return { ...entry, componentId: new ObjectID(id) };
    });
  }

  /*
   * The config the dashboard draws. Always a DashboardViewConfig with a
   * widget list; every widget has a unique ObjectID, a type (kept as stored,
   * known or not), numeric position and size, and an `arguments` object.
   * Keys this version does not know are kept.
   */
  public static read(value: unknown): DashboardViewConfig {
    const stored: JSONObject = StoredDashboardViewConfig.unwrap(value);

    const entries: Array<unknown> =
      StoredDashboardViewConfig.getComponentEntries(stored);
    const ids: Array<string | null> =
      StoredDashboardViewConfig.getComponentIds(entries);

    const components: Array<DashboardBaseComponent> = [];

    entries.forEach((entry: unknown, index: number) => {
      const id: string | null = ids[index] || null;

      if (id && StoredDashboardViewConfig.isWidgetEntry(entry)) {
        components.push(StoredDashboardViewConfig.readComponent(entry, id));
      }
    });

    const config: DashboardViewConfig = {
      ...(stored as unknown as DashboardViewConfig),
      _type: ObjectType.DashboardViewConfig,
      components: components,
      heightInDashboardUnits: StoredDashboardViewConfig.readBoardHeight(
        stored["heightInDashboardUnits"],
      ),
    };

    const refreshInterval: unknown = stored["refreshInterval"];

    if (isAutoRefreshInterval(refreshInterval)) {
      config.refreshInterval = refreshInterval;
    } else {
      delete config.refreshInterval;
    }

    const variables: Array<DashboardVariable> | undefined =
      StoredDashboardViewConfig.readVariables(stored["variables"]);

    if (variables) {
      config.variables = variables;
    } else {
      delete config.variables;
    }

    return config;
  }

  /*
   * `{"_type": "DashboardViewConfig", "value": ...}` - the envelope the API
   * reference documented - or the same without its _type. Never a config
   * that has its own widget list.
   */
  private static isEnvelope(config: JSONObject): boolean {
    if (Array.isArray(config["components"])) {
      return false;
    }

    const type: unknown = config["_type"];

    if (type !== undefined && type !== ObjectType.DashboardViewConfig) {
      return false;
    }

    const inner: unknown = config["value"];

    return (
      typeof inner === "string" || Array.isArray(inner) || isPlainObject(inner)
    );
  }

  private static getComponentList(config: JSONObject): Array<unknown> {
    const components: unknown = readJSONText(config["components"]);

    if (Array.isArray(components)) {
      return components;
    }

    if (!isPlainObject(components)) {
      return [];
    }

    const keys: Array<string> = Object.keys(components);

    if (
      keys.length > 0 &&
      keys.every((key: string): boolean => {
        return INDEX_KEY.test(key);
      })
    ) {
      return keys
        .sort((a: string, b: string): number => {
          return Number(a) - Number(b);
        })
        .map((key: string): unknown => {
          return components[key];
        });
    }

    if ("componentType" in components) {
      return [components];
    }

    return [];
  }

  /*
   * One stored widget entry as the widget it holds: JSON text read, and the
   * `{"_type": "DashboardComponent", "value": {...}}` envelope opened. Every
   * other entry - a widget, or junk - comes back as it is.
   */
  private static unwrapComponentEntry(entry: unknown): unknown {
    let current: unknown = entry;

    for (let step: number = 0; step <= MAX_UNWRAP_STEPS; step++) {
      if (typeof current === "string") {
        const parsed: unknown = readJSONText(current);

        if (!isPlainObject(parsed)) {
          // Text that is not a widget stays the junk it was.
          return entry;
        }

        current = parsed;
        continue;
      }

      if (!isPlainObject(current)) {
        return current;
      }

      const type: unknown = current["_type"];
      const inner: unknown = readJSONText(current["value"]);

      if (
        current["componentType"] === undefined &&
        (type === undefined || type === ObjectType.DashboardComponent) &&
        isPlainObject(inner)
      ) {
        current = inner;
        continue;
      }

      return current;
    }

    return current;
  }

  private static readBoardHeight(value: unknown): number {
    const height: number | null = readFiniteNumber(value);

    if (height === null || height <= 0) {
      return DefaultDashboardSize.heightInDashboardUnits;
    }

    return height;
  }

  private static readComponent(
    entry: JSONObject,
    id: string,
  ): DashboardBaseComponent {
    /*
     * Each widget is deserialized on its own (ObjectIDs, dates, query
     * operators), so one that cannot be leaves the others alone - it is
     * then drawn from its stored JSON, and its own error boundary decides.
     */
    let source: JSONObject = entry;

    try {
      const deserialized: unknown = JSONFunctions.deserializeValue(
        entry as JSONValue,
      );

      if (isPlainObject(deserialized)) {
        source = deserialized;
      }
    } catch {
      source = entry;
    }

    const componentArguments: unknown = readJSONText(source["arguments"]);
    const componentType: unknown = source["componentType"];

    return {
      ...(source as unknown as DashboardBaseComponent),
      _type: ObjectType.DashboardComponent,
      componentId: new ObjectID(id),
      componentType: (typeof componentType === "string"
        ? componentType
        : "") as DashboardComponentType,
      topInDashboardUnits: readFiniteNumber(source["topInDashboardUnits"]) ?? 0,
      leftInDashboardUnits:
        readFiniteNumber(source["leftInDashboardUnits"]) ?? 0,
      widthInDashboardUnits:
        readFiniteNumber(source["widthInDashboardUnits"]) ??
        FALLBACK_WIDGET_WIDTH_IN_DASHBOARD_UNITS,
      heightInDashboardUnits:
        readFiniteNumber(source["heightInDashboardUnits"]) ??
        FALLBACK_WIDGET_HEIGHT_IN_DASHBOARD_UNITS,
      minWidthInDashboardUnits:
        readFiniteNumber(source["minWidthInDashboardUnits"]) ?? 1,
      minHeightInDashboardUnits:
        readFiniteNumber(source["minHeightInDashboardUnits"]) ?? 1,
      arguments: isPlainObject(componentArguments) ? componentArguments : {},
    };
  }

  private static readVariables(
    value: unknown,
  ): Array<DashboardVariable> | undefined {
    const list: unknown = readJSONText(value);

    if (!Array.isArray(list)) {
      return undefined;
    }

    const entries: Array<JSONObject> = list.filter(
      (entry: unknown): entry is JSONObject => {
        return isPlainObject(entry);
      },
    );

    const ids: Array<string> = assignIds({
      ids: entries.map((entry: JSONObject): string | null => {
        return readText(entry["id"])?.trim() || null;
      }),
      namespace: VARIABLE_ID_NAMESPACE,
    });

    return entries.map((entry: JSONObject, index: number) => {
      return StoredDashboardViewConfig.readVariable(entry, ids[index]!);
    });
  }

  /*
   * A variable with the fields the toolbar dereferences in the types it
   * reads them as: text where it splits or prints, lists where it maps.
   */
  private static readVariable(
    entry: JSONObject,
    id: string,
  ): DashboardVariable {
    const variable: DashboardVariable = {
      ...(entry as unknown as DashboardVariable),
      id: id,
      name: readText(entry["name"]) ?? "",
    };

    const type: unknown = entry["type"];

    if (typeof type === "string") {
      variable.type = type as DashboardVariableType;
    } else {
      delete (variable as Partial<DashboardVariable>).type;
    }

    const textFields: Array<
      | "label"
      | "query"
      | "attributeKey"
      | "selectedValue"
      | "defaultValue"
      | "customListValues"
    > = [
      "label",
      "query",
      "attributeKey",
      "selectedValue",
      "defaultValue",
      "customListValues",
    ];

    for (const field of textFields) {
      const text: string | undefined = readText(entry[field]);

      if (text === undefined) {
        delete variable[field];
      } else {
        variable[field] = text;
      }
    }

    // A custom list written as a list rather than comma-separated text.
    const customListValues: unknown = entry["customListValues"];

    if (Array.isArray(customListValues)) {
      variable.customListValues = customListValues
        .map((item: unknown): string | undefined => {
          return readText(item);
        })
        .filter((item: string | undefined): item is string => {
          return item !== undefined;
        })
        .join(",");
    }

    const labelOptions: unknown = entry["labelOptions"];

    if (Array.isArray(labelOptions)) {
      variable.labelOptions = labelOptions
        .filter((option: unknown): option is JSONObject => {
          return (
            isPlainObject(option) && readText(option["value"]) !== undefined
          );
        })
        .map((option: JSONObject): DashboardVariableOption => {
          const optionValue: string = readText(option["value"])!;

          return {
            label: readText(option["label"]) ?? optionValue,
            value: optionValue,
          };
        });
    } else {
      delete variable.labelOptions;
    }

    const selectedValues: unknown = entry["selectedValues"];

    if (Array.isArray(selectedValues)) {
      variable.selectedValues = selectedValues
        .map((item: unknown): string | undefined => {
          return readText(item);
        })
        .filter((item: string | undefined): item is string => {
          return item !== undefined;
        });
    } else {
      delete variable.selectedValues;
    }

    const isMultiSelect: unknown = entry["isMultiSelect"];

    if (typeof isMultiSelect === "boolean") {
      variable.isMultiSelect = isMultiSelect;
    } else if (isMultiSelect === "true" || isMultiSelect === "false") {
      variable.isMultiSelect = isMultiSelect === "true";
    } else {
      delete variable.isMultiSelect;
    }

    return variable;
  }
}
