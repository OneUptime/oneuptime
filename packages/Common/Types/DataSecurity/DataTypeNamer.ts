import { isCustomDataTypeId } from "./CustomDataTypeId";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
  getBuiltInDataType,
} from "./DataTypeCatalog";

/*
 * WHAT A DATA TYPE IS CALLED, WHEREVER THE SERVER NAMES ONE (#10363).
 *
 * Stores, issues and findings carry data type ids: a built-in type's
 * ("credit-card-number", DataTypeCatalog), or "custom:" and the id of one
 * the project defined (Data Security > Settings > Data Types,
 * CustomDataTypeId). An id is never a name: the record of processing an
 * auditor reads, what OneUptime AI is told about an issue, what Ask AI
 * answers and the evidence a check writes say what the data is.
 *
 *   - A built-in type: the catalog's name.
 *   - A project's own type: its name, as the project calls it now.
 *   - One whose name was not read - the reader may not read the project's
 *     data types: "Custom data type", as the Dashboard names it for them.
 *   - One that is gone: "A deleted data type".
 *
 * A finding keeps the name its type had when it was found
 * (DataStoreFinding.dataTypeName). As on the Dashboard
 * (Components/DataSecurity/IssueDataTypes), it stands in when nothing else
 * knows the type - and only when it is a name, never an id.
 *
 * The project's types are read once for a request and handed in
 * (Server/Utils/DataSecurity/ProjectDataTypeNames), so naming reads nothing.
 */

// A project's own data type that is gone: deleted since it was found.
export const DELETED_DATA_TYPE_NAME: string = "A deleted data type";

// A project's own data type whose name was not read for the reader.
export const UNREAD_CUSTOM_DATA_TYPE_NAME: string = "Custom data type";

/*
 * The project's own types' names by their id ("custom:<row id>"): a map, or
 * the record a check is handed (DataStoreCheckInput.dataTypeNames).
 */
export type CustomDataTypeNames =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>;

interface OwnName {
  // One of the project's types as they were read.
  isKnown: boolean;
  // Its name, when it has one.
  name?: string | undefined;
}

export default class DataTypeNamer {
  // Null when the project's own types were not read.
  private readonly customNames: CustomDataTypeNames | null;

  public constructor(customNames: CustomDataTypeNames | null | undefined) {
    this.customNames = customNames || null;
  }

  // Built-in types by name; a project's own read as "Custom data type".
  public static withoutCustomTypes(): DataTypeNamer {
    return new DataTypeNamer(null);
  }

  // Whether the project's own types were read, so a missing one is gone.
  public hasCustomTypes(): boolean {
    return this.customNames !== null;
  }

  public nameOf(dataTypeId: string, keptName?: string | null): string {
    const builtIn: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

    if (builtIn) {
      return builtIn.name;
    }

    const kept: string = DataTypeNamer.readKeptName(dataTypeId, keptName);

    if (!isCustomDataTypeId(dataTypeId)) {
      // A type the catalog does not know (any more): its id reads as words.
      return kept || dataTypeId;
    }

    const own: OwnName = this.getOwnName(dataTypeId);

    if (own.name) {
      return own.name;
    }

    if (kept) {
      return kept;
    }

    // Gone only when the project's types were read and it is not one of them.
    return this.customNames && !own.isKnown
      ? DELETED_DATA_TYPE_NAME
      : UNREAD_CUSTOM_DATA_TYPE_NAME;
  }

  // The names of `dataTypeIds`, each once, in their order.
  public namesOf(
    dataTypeIds: ReadonlyArray<string> | null | undefined,
  ): Array<string> {
    const names: Array<string> = [];

    for (const dataTypeId of dataTypeIds || []) {
      const name: string = this.nameOf(dataTypeId);

      if (!names.includes(name)) {
        names.push(name);
      }
    }

    return names;
  }

  /*
   * The ids of the type a person or OneUptime AI named: a built-in type by
   * its id or its name in any case; a project's own by its id, or by its
   * name in any case - every type of that name. Text that names none comes
   * back as it is, which no store holds.
   */
  public findIds(text: string): Array<string> {
    const value: string = text.trim();
    const wanted: string = value.toLowerCase();

    if (!value) {
      return [];
    }

    const builtIn: DataTypeInfo | undefined = DATA_TYPE_CATALOG.find(
      (info: DataTypeInfo): boolean => {
        return info.id === wanted || info.name.toLowerCase() === wanted;
      },
    );

    if (builtIn) {
      return [builtIn.id];
    }

    if (isCustomDataTypeId(value)) {
      return [value];
    }

    const own: Array<string> = [];

    for (const [dataTypeId, name] of this.getOwnNames()) {
      if (typeof name === "string" && name.trim().toLowerCase() === wanted) {
        own.push(dataTypeId);
      }
    }

    return own.length > 0 ? own : [value];
  }

  // A project's own type as it was read: whether it is one, and its name.
  private getOwnName(dataTypeId: string): OwnName {
    const names: CustomDataTypeNames | null = this.customNames;

    if (!names) {
      return { isKnown: false };
    }

    const isKnown: boolean =
      names instanceof Map
        ? names.has(dataTypeId)
        : Object.prototype.hasOwnProperty.call(names, dataTypeId);
    const name: unknown = !isKnown
      ? undefined
      : names instanceof Map
        ? names.get(dataTypeId)
        : (names as Readonly<Record<string, string>>)[dataTypeId];

    return {
      isKnown,
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
    };
  }

  private getOwnNames(): Array<[string, string]> {
    const names: CustomDataTypeNames | null = this.customNames;

    if (!names) {
      return [];
    }

    return names instanceof Map
      ? Array.from(names.entries())
      : Object.entries(names as Readonly<Record<string, string>>);
  }

  /*
   * The name a finding kept, when it is one: never an id - a finding of a
   * type that was gone when it was written keeps its id as its name.
   */
  private static readKeptName(
    dataTypeId: string,
    keptName: string | null | undefined,
  ): string {
    const name: string = (keptName || "").trim();

    if (!name || name === dataTypeId || isCustomDataTypeId(name)) {
      return "";
    }

    return name;
  }
}
