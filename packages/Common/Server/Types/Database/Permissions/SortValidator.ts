import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "./ColumnPermission";
import OwnedScopePermission from "./OwnedScopePermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { isOwnerOnlyColumn } from "../../../../Types/Database/AccessControl/OwnerOnlyColumn";
import { ListOrderSettings } from "../../../../Types/Database/ListOrderColumn";
import {
  TableColumnMetadata,
  getTableColumn,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * A LIST'S SORT, CHECKED AGAINST ITS MODEL BEFORE THE DATABASE SEES IT
 * (#8141).
 *
 * A read hands its sort to TypeORM as the find's order
 * (SelectQueryBuilder.buildOrder). TypeORM orders by a column, and through
 * a relation by the related record's own fields -
 * { incidentSeverity: { order: "ASC" } }. Anything else it either could not
 * read at all - it threw EntityPropertyNotFoundError, which carries no code,
 * so the API answered 500 and logged a server fault - or read some other way
 * than it was written:
 *
 *   - { nope: "ASC" }: no such field. TypeORM threw.
 *   - { incidentSeverity: "DESC" }: a relation given a direction. TypeORM
 *     walked the string's characters and threw for the field "0".
 *   - { labels: { name: "ASC" } }: a relation of many records. Each record
 *     holds a list of labels, and a list has no one value to put a list in
 *     order by.
 *   - { title: "descending" }, { title: "Desc" }: TypeORM reads every
 *     direction but DESC, desc and -1 as ascending, so these sorted the list
 *     the other way from what they said. { title: null } threw a TypeError.
 *
 * Each is refused here as bad data (400), with what to send instead. Every
 * sort TypeORM reads as written passes untouched, and every sort the product
 * sends is one: a field with "ASC" or "DESC" (TypeORM's "asc", "desc", 1 and
 * -1 too), or with { direction, nulls }; a relation of one record with an
 * object of its own fields, to any depth; a field with no order at all
 * (undefined), which TypeORM leaves out.
 *
 * The rules are TypeORM's, read from OneUptime's column metadata, which says
 * the same as TypeORM's own about every field of every model - which is a
 * column, which a relation of one record and which of many. SortValidator
 * .test.ts holds the two together for every model, holds this check to
 * TypeORM's own builder, and holds every sort the product sends to passing.
 *
 * A relation given only a direction is refused rather than read the way a
 * dashboard column reads it (ModelTable/ColumnSort: a severity by its place
 * in the project's list, a monitor by its name). Which field a column sorts
 * by follows from what that column shows; an API request shows nothing, so
 * the server would be guessing a field for the caller, and the same "ASC"
 * would sort a severity the other way from { incidentSeverity: { order:
 * "ASC" } }. The refusal says which field to send instead.
 *
 * A refusal names the fields the caller may sort by, and only those they
 * may read: the columns their permissions let them read (ColumnPermission,
 * as a select is held to), never a secret or a column kept to its owners.
 * Through a relation, the related fields any reader of the relation may
 * read (canReadOnRelationQuery).
 *
 * Who may sort by what is not decided here: a field the caller cannot read
 * sorts as it did before this check, and the columns kept to their owners
 * are refused by OwnedScopePermission.checkSortOnColumnsKeptToOwners.
 */

// The directions TypeORM reads as written.
const SORT_DIRECTIONS: ReadonlyArray<unknown> = [
  SortOrder.Ascending,
  SortOrder.Descending,
  "asc",
  "desc",
  1,
  -1,
];

// Where records with no value go, in any case: TypeORM lower-cases it.
const NULLS_PLACES: ReadonlyArray<string> = ["first", "last"];

// All a field's { direction, nulls } may hold.
const ORDER_OBJECT_KEYS: ReadonlyArray<string> = ["direction", "nulls"];

/*
 * Columns every sort may name but no refusal offers: a list holds no deleted
 * record, and a version counts writes.
 */
const LEFT_OUT_OF_SUGGESTIONS: ReadonlyArray<string> = ["deletedAt", "version"];

// The fields a related record is called by, after the one its model declares.
const NAME_FIELDS: ReadonlyArray<string> = ["name", "title"];

// How much of a value the caller sent a refusal quotes back.
const MAX_QUOTED_LENGTH: number = 60;

// One level of the sort: the fields of `model`, reached through `path`.
interface SortLevel {
  // The model whose list is read, and the type it was made from.
  listModel: BaseModel;
  listModelType: DatabaseBaseModelType;
  // The model these fields are of.
  model: BaseModel;
  // The relations walked from the list's model to reach it.
  path: Array<string>;
  props: DatabaseCommonInteractionProps;
}

// The field of a related record a refusal suggests sorting by, and why.
interface SuggestedField {
  field: string;
  order: SortOrder;
  // What it sorts the list by: "its name, A to Z".
  sortsBy: string;
}

export default class SortValidator {
  /*
   * Refuses, as bad data, a sort the database could not order a list of
   * `modelType` by as written (see the top of this file). `props` is who
   * asked, before any hook stood in for them: the refusal names the fields
   * they may read.
   */
  public static checkSort(data: {
    modelType: DatabaseBaseModelType;
    sort: unknown;
    props: DatabaseCommonInteractionProps;
  }): void {
    /*
     * No sort asked for - nothing, or nothing with a field in it - and the
     * list is read in its own order (DatabaseService.getReadSort).
     */
    if (
      data.sort === undefined ||
      data.sort === null ||
      Object.keys(data.sort as Record<string, unknown>).length === 0
    ) {
      return;
    }

    const model: BaseModel = new data.modelType();

    if (!SortValidator.isPlainObject(data.sort)) {
      throw new BadDataException(
        `The sort of a list of ${SortValidator.getPluralName(model)} is not an object of fields. Name each field to sort by and its direction, as in { "createdAt": "DESC" }.`,
      );
    }

    SortValidator.checkLevel(
      {
        listModel: model,
        listModelType: data.modelType,
        model: model,
        path: [],
        props: data.props,
      },
      data.sort as Dictionary<unknown>,
    );
  }

  /*
   * Whether TypeORM reads a field's order as written: a direction, or
   * { direction, nulls } holding nothing else.
   */
  public static isFieldOrder(value: unknown): boolean {
    if (SortValidator.isDirection(value)) {
      return true;
    }

    if (!SortValidator.isPlainObject(value)) {
      return false;
    }

    const order: Dictionary<unknown> = value as Dictionary<unknown>;

    const holdsOnlyOrder: boolean = Object.keys(order).every(
      (key: string): boolean => {
        return ORDER_OBJECT_KEYS.includes(key);
      },
    );

    const direction: unknown = order["direction"];
    const nulls: unknown = order["nulls"];

    return (
      holdsOnlyOrder &&
      (direction === undefined ||
        direction === null ||
        SortValidator.isDirection(direction)) &&
      (nulls === undefined ||
        nulls === null ||
        (typeof nulls === "string" &&
          NULLS_PLACES.includes(nulls.toLowerCase())))
    );
  }

  // A direction TypeORM reads as written: "ASC" or "DESC", "asc", "desc", 1, -1.
  public static isDirection(value: unknown): boolean {
    return SORT_DIRECTIONS.includes(value);
  }

  private static checkLevel(
    level: SortLevel,
    fields: Dictionary<unknown>,
  ): void {
    for (const field of Object.keys(fields)) {
      const value: unknown = fields[field];

      // No order for this field: TypeORM leaves it out of the sort.
      if (value === undefined) {
        continue;
      }

      const column: TableColumnMetadata | undefined = getTableColumn(
        level.model,
        field,
      ) as TableColumnMetadata | undefined;

      if (!column) {
        throw SortValidator.getNoSuchFieldRefusal(level, field);
      }

      if (column.type === TableColumnType.EntityArray) {
        throw SortValidator.getListOfRecordsRefusal(level, field, column);
      }

      if (column.type === TableColumnType.Entity) {
        /*
         * A relation whose model is not known is left to TypeORM: every
         * relation of every model has one (SortValidator.test.ts).
         */
        if (!column.modelType) {
          continue;
        }

        const relatedModel: BaseModel = new column.modelType();

        if (!SortValidator.isPlainObject(value)) {
          throw SortValidator.getRelationWithoutFieldRefusal(
            level,
            field,
            relatedModel,
            value,
          );
        }

        SortValidator.checkLevel(
          {
            ...level,
            model: relatedModel,
            path: [...level.path, field],
          },
          value as Dictionary<unknown>,
        );

        continue;
      }

      if (!SortValidator.isFieldOrder(value)) {
        throw SortValidator.getFieldOrderRefusal(level, field, value);
      }
    }
  }

  // A field the model does not have.
  private static getNoSuchFieldRefusal(
    level: SortLevel,
    field: string,
  ): BadDataException {
    const listName: string = SortValidator.getPluralName(level.listModel);

    if (level.path.length > 0) {
      return new BadDataException(
        `${SortValidator.getPluralName(level.model)} have no field ${SortValidator.quote(field)} to sort ${listName} by, through ${SortValidator.quote(level.path.join("."))}. Sort by one of these fields of ${SortValidator.getSingularName(level.model)}: ${SortValidator.getRelatedFieldsToSortBy(level.model).join(", ")}.`,
      );
    }

    const sortable: { columns: Array<string>; relations: Array<string> } =
      SortValidator.getColumnsToSortBy(level);

    let message: string = `${listName} have no field ${SortValidator.quote(field)} to sort by. Sort by one of these fields: ${sortable.columns.join(", ")}.`;

    const relation: string | undefined = sortable.relations[0];
    const relatedModelType: { new (): BaseModel } | undefined = relation
      ? (getTableColumn(level.model, relation) as TableColumnMetadata).modelType
      : undefined;

    if (relation && relatedModelType) {
      const suggested: SuggestedField = SortValidator.getSuggestedField(
        new relatedModelType(),
      );

      message += ` Or sort by a field of a related record (${sortable.relations.join(", ")}), as in ${SortValidator.getExample([relation, suggested.field], suggested.order)}.`;
    }

    return new BadDataException(message);
  }

  // A relation of many records: a list has no one value to sort by.
  private static getListOfRecordsRefusal(
    level: SortLevel,
    field: string,
    column: TableColumnMetadata,
  ): BadDataException {
    const relatedName: string = column.modelType
      ? SortValidator.getPluralName(new column.modelType())
      : "records";

    return new BadDataException(
      `${SortValidator.getPluralName(level.listModel)} cannot be sorted by ${SortValidator.quote([...level.path, field].join("."))}: it holds a list of ${relatedName} for each ${SortValidator.getSingularName(level.model)}, and a list of records cannot order a list, as it has no one value to sort by. Sort by a field that holds one value, as in { "createdAt": "DESC" }.`,
    );
  }

  // A relation of one record, given something other than its fields.
  private static getRelationWithoutFieldRefusal(
    level: SortLevel,
    field: string,
    relatedModel: BaseModel,
    value: unknown,
  ): BadDataException {
    const path: Array<string> = [...level.path, field];
    const suggested: SuggestedField =
      SortValidator.getSuggestedField(relatedModel);

    return new BadDataException(
      `${SortValidator.getPluralName(level.listModel)} cannot be sorted by ${SortValidator.quote(path.join("."))} with ${SortValidator.describe(value)}: it is a related record (${SortValidator.getSingularName(relatedModel)}), and a related record sorts the list by one of its own fields. Send ${SortValidator.getExample([...path, suggested.field], suggested.order)} to sort by ${suggested.sortsBy}, or name another of its fields: ${SortValidator.getRelatedFieldsToSortBy(relatedModel).join(", ")}.`,
    );
  }

  // A field of a record given an order TypeORM would not read as written.
  private static getFieldOrderRefusal(
    level: SortLevel,
    field: string,
    value: unknown,
  ): BadDataException {
    const path: string = SortValidator.quote([...level.path, field].join("."));

    let message: string = `${SortValidator.getPluralName(level.listModel)} cannot be sorted by ${path} with ${SortValidator.describe(value)}. Sort it "ASC" or "DESC", or { "direction": "DESC", "nulls": "LAST" } to say where records with no value go.`;

    // The shape of an order through a relation, given to a field that is none.
    if (
      SortValidator.isPlainObject(value) &&
      Object.keys(value as Dictionary<unknown>).some((key: string): boolean => {
        return !ORDER_OBJECT_KEYS.includes(key);
      })
    ) {
      message += ` ${path} holds a value of its own, not a related record, so it has no fields to sort by.`;
    }

    return new BadDataException(message);
  }

  /*
   * The columns of the list's own model a refusal offers to sort by, and
   * its relations of one record: those the caller may read, as a select is
   * held to (ColumnPermission) - every one to root and a master admin, who
   * pass every check. Never a secret, a column kept to its owners or one
   * read only by its own user.
   */
  private static getColumnsToSortBy(level: SortLevel): {
    columns: Array<string>;
    relations: Array<string>;
  } {
    const isPrivileged: boolean = Boolean(
      level.props.isRoot || level.props.isMasterAdmin,
    );

    const readable: Array<string> = isPrivileged
      ? []
      : ColumnPermissions.getModelColumnsByPermissions(
          level.listModelType,
          ColumnPermissions.getColumnCheckRows(level.props),
          DatabaseRequestType.Read,
        ).columns;

    const alwaysReadable: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    const keptToOwners: Array<string> =
      OwnedScopePermission.getColumnsKeptToOwners(
        level.listModelType,
        level.props,
      );

    const allColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      level.listModel,
    );

    const columns: Array<string> = [];
    const relations: Array<string> = [];

    for (const key of Object.keys(allColumns)) {
      const column: TableColumnMetadata = allColumns[key]!;

      if (
        LEFT_OUT_OF_SUGGESTIONS.includes(key) ||
        column.type === TableColumnType.EntityArray ||
        SortValidator.isSecret(column) ||
        keptToOwners.includes(key)
      ) {
        continue;
      }

      if (
        !isPrivileged &&
        ((!alwaysReadable.includes(key) && !readable.includes(key)) ||
          isOwnerOnlyColumn(level.listModel, key))
      ) {
        continue;
      }

      if (column.type === TableColumnType.Entity) {
        relations.push(key);
      } else {
        columns.push(key);
      }
    }

    return { columns, relations };
  }

  /*
   * The fields of a related record a refusal offers to sort by: those any
   * reader of the relation may read (canReadOnRelationQuery, and the ids and
   * times every select may name), never a secret or one read only by its
   * own user.
   */
  private static getRelatedFieldsToSortBy(
    relatedModel: BaseModel,
  ): Array<string> {
    const allColumns: Dictionary<TableColumnMetadata> =
      getTableColumns(relatedModel);
    const alwaysReadable: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    return Object.keys(allColumns).filter((key: string): boolean => {
      const column: TableColumnMetadata = allColumns[key]!;

      if (
        LEFT_OUT_OF_SUGGESTIONS.includes(key) ||
        column.type === TableColumnType.Entity ||
        column.type === TableColumnType.EntityArray ||
        SortValidator.isSecret(column) ||
        isOwnerOnlyColumn(relatedModel, key)
      ) {
        return false;
      }

      return (
        alwaysReadable.includes(key) || Boolean(column.canReadOnRelationQuery)
      );
    });
  }

  /*
   * The field of a related record a refusal suggests: its place in its
   * list, for a record of a list people put in order (a severity, a state,
   * a status); else the field it is called by; else when it was created.
   */
  private static getSuggestedField(relatedModel: BaseModel): SuggestedField {
    const fields: Array<string> =
      SortValidator.getRelatedFieldsToSortBy(relatedModel);

    const listOrder: ListOrderSettings | null = relatedModel.getListOrder();

    if (listOrder && fields.includes(listOrder.column)) {
      return {
        field: listOrder.column,
        order: listOrder.sortOrder,
        sortsBy: "its place in its list, top first",
      };
    }

    for (const field of [
      relatedModel.getDisplayNameColumn(),
      relatedModel.getSlugifyColumn(),
      ...NAME_FIELDS,
    ]) {
      if (field && fields.includes(field)) {
        return {
          field: field,
          order: SortOrder.Ascending,
          sortsBy: "its name, A to Z",
        };
      }
    }

    return {
      field: "createdAt",
      order: SortOrder.Ascending,
      sortsBy: "when it was created, oldest first",
    };
  }

  /*
   * A sort that orders by `path` - the relations walked, then the field -
   * written as a request writes it: { "incidentSeverity": { "order": "ASC" } }.
   */
  private static getExample(path: Array<string>, order: SortOrder): string {
    let example: string = JSON.stringify(order);

    for (const key of [...path].reverse()) {
      example = `{ ${JSON.stringify(key)}: ${example} }`;
    }

    return example;
  }

  // A hashed, encrypted or secret value orders nothing a person reads.
  private static isSecret(column: TableColumnMetadata): boolean {
    return Boolean(column.hashed || column.encrypted || column.secret);
  }

  private static isPlainObject(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }

  /*
   * A value the caller sent, as a refusal quotes it back - here and in a
   * telemetry list's (StatementGenerator.toSortStatement).
   */
  public static describe(value: unknown): string {
    if (typeof value === "string") {
      return SortValidator.quote(value);
    }

    if (Array.isArray(value)) {
      return "a list";
    }

    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value);
    }

    if (SortValidator.isPlainObject(value)) {
      try {
        const written: string = JSON.stringify(value);

        if (written.length <= MAX_QUOTED_LENGTH) {
          return written;
        }
      } catch {
        // A value JSON cannot write (a bigint): named by what it is instead.
      }
    }

    return typeof value === "object" ? "an object" : typeof value;
  }

  // Text the caller sent, quoted, and cut short when it runs long.
  public static quote(text: string): string {
    return JSON.stringify(
      text.length > MAX_QUOTED_LENGTH
        ? `${text.substring(0, MAX_QUOTED_LENGTH)}...`
        : text,
    );
  }

  private static getPluralName(model: BaseModel): string {
    return model.pluralName || model.tableName || "Records";
  }

  private static getSingularName(model: BaseModel): string {
    return model.singularName || model.tableName || "Record";
  }
}
