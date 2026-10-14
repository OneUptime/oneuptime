import QueryHelper from "./QueryHelper";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { FindOperator } from "typeorm";

/*
 * ---------------------------------------------------------------------------
 * Filtering a uuid column
 * ---------------------------------------------------------------------------
 *
 * Every TableColumnType.ObjectID column - `_id` and every key naming another
 * record, such as Incident.currentIncidentStateId - is a Postgres `uuid`
 * (UUIDColumnFilter.test.ts holds every model to that). Postgres reads a value
 * compared with one as a uuid, and refuses the whole statement when it is not
 * one:
 *
 *   ERROR: invalid input syntax for type uuid: "[object Object]"   (22P02)
 *
 * PostgresErrorTranslator does not translate that, so a filter the API could
 * have refused as a 400 came back as a 500, and Postgres logged it every time.
 * Two shapes did it:
 *
 *   - An object. `{"currentIncidentStateId": {...}}` in a list request, of a
 *     shape the JSON deserializer does not know, reached TypeORM as it was;
 *     the column's transformer (ObjectID.toDatabase) made text of it with
 *     toString(), and Postgres was asked for the uuid "[object Object]" -
 *     once a minute, from a client polling a project's incidents.
 *   - Text that is not an id. A workflow reference that did not resolve is
 *     left in the step's query as written, and Postgres was asked for the
 *     uuid "{{local.components.monitor-find-one-1.returnValues.model._id}}".
 *
 * So before a query reaches TypeORM, every id it compares a uuid column with
 * is made text Postgres reads as a uuid (QueryUtil.serializeQuery calls
 * normalizeFilter for every column of the query):
 *
 *   - an ObjectID that arrived serialized, `{"_type": "ObjectID", "value":
 *     "<uuid>"}`, as a plain object - nested in an operator, or from a caller
 *     that never deserialized it - is the text it holds;
 *   - anything else that is not an id is refused with a BadDataException
 *     naming the column, and nothing is sent to Postgres.
 *
 * An id is text Postgres's uuid input accepts (isUUIDText), not only the
 * canonical form, so no filter Postgres answered before is refused now. Text
 * matches (Search, StartsWith, Wildcard, ...) compare the id cast to text and
 * are left alone, as are null checks and operators QueryHelper built.
 */

/*
 * The longest text Postgres reads as a uuid: 32 hex digits, a hyphen after
 * each group of four but the last, in braces.
 */
const MAX_UUID_TEXT_LENGTH: number = 32 + 7 + 2;

/*
 * Postgres's uuid input (uuid.c, string_to_uuid): 32 hex digits in any case,
 * with an optional hyphen after each group of four but the last. Braces
 * around it are taken off before this is asked. Every quantifier is bounded,
 * and the length is checked first, so a value of any length is answered at
 * once.
 */
const UUID_TEXT_REGEX: RegExp = /^(?:[0-9a-f]{4}-?){7}[0-9a-f]{4}$/i;

// How much of a refused value its error message repeats.
const MAX_DESCRIBED_VALUE_LENGTH: number = 80;

// A serialized ObjectID wrapped in another goes this many deep at most.
const MAX_SERIALIZED_OBJECT_ID_DEPTH: number = 8;

export const EXAMPLE_UUID: string = "550e8400-e29b-41d4-a716-446655440000";

export default class UUIDColumnFilter {
  // True for text Postgres reads as a uuid.
  public static isUUIDText(value: string): boolean {
    if (typeof value !== "string" || value.length > MAX_UUID_TEXT_LENGTH) {
      return false;
    }

    const unbraced: string =
      value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;

    return UUID_TEXT_REGEX.test(unbraced);
  }

  /*
   * The filter on the column `columnName`, with every id it compares a uuid
   * column with as text Postgres reads as a uuid. A filter on a column that
   * is neither a uuid nor a relation is handed back as it is.
   */
  public static normalizeFilter(data: {
    columnName: string;
    column: TableColumnMetadata;
    value: unknown;
  }): unknown {
    if (data.column.type === TableColumnType.ObjectID) {
      return this.normalizeIdColumnFilter(data.columnName, data.value);
    }

    if (
      data.column.type === TableColumnType.Entity ||
      data.column.type === TableColumnType.EntityArray
    ) {
      return this.normalizeRelationFilter(
        data.columnName,
        data.column,
        data.value,
      );
    }

    return data.value;
  }

  // A filter on a uuid column itself: an id, a list of ids, or an operator.
  private static normalizeIdColumnFilter(
    columnName: string,
    value: unknown,
  ): unknown {
    if (value === undefined || value === null) {
      return value;
    }

    /*
     * An empty id has always matched no record: the column's transformer
     * writes it as NULL, and nothing equals NULL. It still matches none, and
     * `_id`, which has no transformer and failed in Postgres instead, now
     * agrees. An empty list matches nothing (TRUE = FALSE).
     */
    if (value === "") {
      return QueryHelper.any([]);
    }

    // Built by QueryHelper or TypeORM: server code, already in SQL's terms.
    if (value instanceof FindOperator) {
      return value;
    }

    if (typeof value === "string" || value instanceof ObjectID) {
      // Checked, and left for serializeQuery to compare the column with.
      this.getIdText(columnName, value);
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item: unknown): string => {
        return this.getIdText(columnName, item);
      });
    }

    if (value instanceof EqualTo) {
      return new EqualTo(this.getIdText(columnName, value.value));
    }

    if (value instanceof NotEqual) {
      return new NotEqual(this.getIdText(columnName, value.value));
    }

    if (value instanceof EqualToOrNull) {
      return new EqualToOrNull(this.getIdText(columnName, value.value));
    }

    if (value instanceof GreaterThan) {
      return new GreaterThan(this.getIdText(columnName, value.value));
    }

    if (value instanceof GreaterThanOrEqual) {
      return new GreaterThanOrEqual(this.getIdText(columnName, value.value));
    }

    if (value instanceof GreaterThanOrNull) {
      return new GreaterThanOrNull(this.getIdText(columnName, value.value));
    }

    if (value instanceof LessThan) {
      return new LessThan(this.getIdText(columnName, value.value));
    }

    if (value instanceof LessThanOrEqual) {
      return new LessThanOrEqual(this.getIdText(columnName, value.value));
    }

    if (value instanceof LessThanOrNull) {
      return new LessThanOrNull(this.getIdText(columnName, value.value));
    }

    if (value instanceof InBetween) {
      return new InBetween(
        this.getIdText(columnName, value.startValue),
        this.getIdText(columnName, value.endValue),
      );
    }

    if (value instanceof Includes) {
      return new Includes(this.getIdTexts(columnName, value.values));
    }

    if (value instanceof IncludesAll) {
      return new IncludesAll(this.getIdTexts(columnName, value.values));
    }

    if (value instanceof IncludesNone) {
      return new IncludesNone(this.getIdTexts(columnName, value.values));
    }

    /*
     * Text matches compare the id cast to text, and IsNull / NotNull compare
     * nothing: none of them asks Postgres to read a uuid.
     */
    if (value instanceof QueryOperator) {
      return value;
    }

    // A serialized ObjectID, or something that is no id at all.
    return this.getIdText(columnName, value);
  }

  /*
   * A filter on a relation: the ids of the records it names - written to
   * the relation's key, or compared with their `_id` - or a filter on those
   * records' own columns, whose uuid columns are held to the same rule.
   * Anything else is handed back as it is.
   */
  private static normalizeRelationFilter(
    columnName: string,
    column: TableColumnMetadata,
    value: unknown,
  ): unknown {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value instanceof FindOperator
    ) {
      return value;
    }

    if (typeof value === "string" || value instanceof ObjectID) {
      this.getIdText(columnName, value);
      return value;
    }

    if (this.isSerializedObjectID(value)) {
      return this.getIdText(columnName, value);
    }

    if (Array.isArray(value)) {
      return this.getRelatedIdTexts(columnName, value);
    }

    if (value instanceof Includes) {
      return new Includes(this.getRelatedIdTexts(columnName, value.values));
    }

    if (value instanceof IncludesAll) {
      return new IncludesAll(this.getRelatedIdTexts(columnName, value.values));
    }

    if (value instanceof IncludesNone) {
      return new IncludesNone(this.getRelatedIdTexts(columnName, value.values));
    }

    if (value instanceof IncludesAnyOfGroups) {
      return new IncludesAnyOfGroups(
        value.groups.map((group: Array<string>): Array<string> => {
          return this.getIdTexts(columnName, group);
        }),
      );
    }

    if (this.isPlainObject(value) && column.modelType) {
      const relatedModel: BaseModel = new column.modelType();
      const relatedFilter: JSONObject = { ...(value as JSONObject) };

      for (const relatedColumnName of Object.keys(relatedFilter)) {
        const relatedColumn: TableColumnMetadata | undefined =
          relatedModel.getTableColumnMetadata(relatedColumnName);

        if (relatedColumn?.type !== TableColumnType.ObjectID) {
          continue;
        }

        relatedFilter[relatedColumnName] = this.normalizeIdColumnFilter(
          `${columnName}.${relatedColumnName}`,
          relatedFilter[relatedColumnName],
        ) as JSONObject;
      }

      return relatedFilter;
    }

    return value;
  }

  private static getIdTexts(
    columnName: string,
    values: Array<unknown>,
  ): Array<string> {
    return values.map((item: unknown): string => {
      return this.getIdText(columnName, item);
    });
  }

  /*
   * The ids of related records, each given as its id or as the record
   * itself (`{"_id": "<uuid>"}`), which a list of a many-to-many relation
   * has always taken.
   */
  private static getRelatedIdTexts(
    columnName: string,
    values: Array<unknown>,
  ): Array<string> {
    return values.map((item: unknown): string => {
      if (
        item !== null &&
        typeof item === "object" &&
        !(item instanceof ObjectID) &&
        !this.isSerializedObjectID(item) &&
        (item as JSONObject)["_id"]
      ) {
        return this.getIdText(columnName, (item as JSONObject)["_id"]);
      }

      return this.getIdText(columnName, item);
    });
  }

  // `value` as the text of one id, or a BadDataException naming the column.
  private static getIdText(columnName: string, value: unknown): string {
    let id: unknown = value;

    for (
      let depth: number = 0;
      depth < MAX_SERIALIZED_OBJECT_ID_DEPTH && this.isSerializedObjectID(id);
      depth++
    ) {
      id = (id as JSONObject)["value"];
    }

    if (id instanceof ObjectID) {
      id = id.toString();
    }

    if (typeof id === "string" && this.isUUIDText(id)) {
      return id;
    }

    throw this.getInvalidIdException(columnName, value);
  }

  private static getInvalidIdException(
    columnName: string,
    value: unknown,
  ): BadDataException {
    const isObject: boolean =
      value !== null &&
      typeof value === "object" &&
      !(value instanceof ObjectID);

    return new BadDataException(
      `Invalid ID for "${columnName}" in the query: ${this.describeValue(
        value,
      )} is not an ID. An ID is a UUID such as "${EXAMPLE_UUID}"${
        isObject
          ? `, sent as that text or as {"_type": "ObjectID", "value": "${EXAMPLE_UUID}"}`
          : ""
      }.`,
    );
  }

  // A refused value as its error message shows it, cut short.
  private static describeValue(value: unknown): string {
    if (typeof value === "string") {
      return JSON.stringify(this.cut(value));
    }

    if (value instanceof ObjectID) {
      return `the ObjectID ${JSON.stringify(this.cut(value.toString()))}`;
    }

    if (value === null || typeof value !== "object") {
      return String(value);
    }

    if (!Array.isArray(value) && !this.isPlainObject(value)) {
      return `an instance of ${(value as object).constructor?.name || "a class"}`;
    }

    let text: string;

    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }

    return `${Array.isArray(value) ? "the list" : "the object"} ${this.cut(text)}`;
  }

  private static cut(text: string): string {
    return text.length > MAX_DESCRIBED_VALUE_LENGTH
      ? `${text.slice(0, MAX_DESCRIBED_VALUE_LENGTH)}…`
      : text;
  }

  private static isSerializedObjectID(value: unknown): boolean {
    return (
      this.isPlainObject(value) &&
      (value as JSONObject)["_type"] === ObjectType.ObjectID
    );
  }

  private static isPlainObject(value: unknown): boolean {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }
}
