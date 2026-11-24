import RelationReaders from "./RelationReaders";
import { TableColumnMetadata } from "./TableColumn";
import TableColumnType from "./TableColumnType";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../BaseDatabase/Select";
import HeldPermissionsUtil, {
  ALWAYS_SELECTABLE_COLUMNS,
  HeldPermissions,
} from "../HeldPermissions";
import { JSONObject } from "../JSON";
import Permission from "../Permission";

// What decides who reads a column through a relation (RelationReaders).
type RelationReadMetadata = Pick<
  TableColumnMetadata,
  "canReadOnRelationQuery" | "relationReaders"
>;

/*
 * WHO MAY READ A COLUMN THROUGH A RELATION: the one rule, for the server's
 * checks of a select, a filter and an order through a relation
 * (QueryPermission, SortValidator), for the dashboard's reads
 * (PermissionGate.canReadThroughRelation) and for the guards that hold the
 * models to it (RelationReadsNoWiderThanTheColumn,
 * RelationSelectColumnsWiring). See RelationReaders.
 */
export default class RelationReadersUtil {
  /*
   * Every reader of the relation reads the column through it, and its own
   * read is not asked: a label on the joined row. A column a relation does
   * not read at all is not one.
   */
  public static isReadByEveryReaderOfTheRelation(
    metadata: RelationReadMetadata | undefined | null,
  ): boolean {
    return (
      Boolean(metadata?.canReadOnRelationQuery) &&
      metadata?.relationReaders !== RelationReaders.ColumnReaders
    );
  }

  /*
   * A relation reads the column, for those who may read it on the related
   * record itself and nobody else (RelationReaders.ColumnReaders).
   */
  public static isHeldToItsOwnRead(
    metadata: RelationReadMetadata | undefined | null,
  ): boolean {
    return (
      Boolean(metadata?.canReadOnRelationQuery) &&
      metadata?.relationReaders === RelationReaders.ColumnReaders
    );
  }

  /*
   * Whether `held` may read one column of a record reached by a relation,
   * by the rule every permission check follows (HeldPermissionsUtil): one
   * of the column's read permissions held, no block with no labels on any
   * of them, and the related table's operational-resource wildcard for a
   * column that lets in everyone its table does. A column without its own
   * access control is read with its table's permissions. `notCounted` are
   * permissions that let nobody read it this way: on a person's own
   * records, CurrentUser, which every signed-in person holds and which
   * means the record's own person - whom a relation never shows the reader
   * to be (PendingInviteeProfiles.getPermissionsNotCountedThroughRelation).
   */
  public static canReadRelatedColumn(data: {
    relatedModel: BaseModel;
    column: string;
    held: HeldPermissions;
    notCounted?: ReadonlyArray<Permission> | undefined;
  }): boolean {
    const counted: (permissions: Array<Permission>) => Array<Permission> = (
      permissions: Array<Permission>,
    ): Array<Permission> => {
      return permissions.filter((permission: Permission): boolean => {
        return !(data.notCounted || []).includes(permission);
      });
    };

    const tablePermissions: Array<Permission> = counted(
      data.relatedModel.getReadPermissions() || [],
    );

    if (!data.relatedModel.getColumnAccessControlFor(data.column)) {
      return HeldPermissionsUtil.holdsAnyOf(data.held, tablePermissions, {
        wildcard: HeldPermissionsUtil.getModelWildcard({
          isOperationalResource: data.relatedModel.isOperationalResource,
          operation: "read",
        }),
      });
    }

    const columnPermissions: Array<Permission> = counted(
      data.relatedModel.getColumnAccessControlFor(data.column)!.read || [],
    );

    return HeldPermissionsUtil.holdsAnyOf(data.held, columnPermissions, {
      wildcard: HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: data.relatedModel.isOperationalResource,
        operation: "read",
        tablePermissions: tablePermissions,
        columnPermissions: columnPermissions,
      }),
    });
  }

  /*
   * The select a reader sends through relations: every column of a related
   * record held to its own read (isHeldToItsOwnRead) that `mayRead` says
   * the reader may not read, left out - so the server answers the rest,
   * rather than refusing the whole read for one of them. A new select:
   * the one handed in, often a constant a page shares, is never changed. A
   * relation whose columns are all left out keeps its id, so the page still
   * knows which record it names. Everything else is left as it was, a
   * column no relation reads included: that is the server's to refuse, and
   * RelationSelectColumnsWiring's to catch.
   */
  public static getSelectReadableThroughRelations<
    TBaseModel extends BaseModel,
  >(data: {
    model: BaseModel;
    select: Select<TBaseModel>;
    mayRead: (relatedModel: BaseModel, column: string) => boolean;
  }): Select<TBaseModel> {
    const readable: JSONObject = {};

    for (const [key, value] of Object.entries(data.select as JSONObject)) {
      const relatedModel: BaseModel | null =
        value && typeof value === "object" && !Array.isArray(value)
          ? RelationReadersUtil.getRelatedModel(data.model, key)
          : null;

      if (!relatedModel) {
        readable[key] = value;
        continue;
      }

      const relationSelect: JSONObject = {};
      let leftOut: boolean = false;

      for (const [column, columnValue] of Object.entries(value as JSONObject)) {
        const metadata: TableColumnMetadata | undefined =
          relatedModel.getTableColumnMetadata(column);

        if (
          RelationReadersUtil.isHeldToItsOwnRead(metadata) &&
          !data.mayRead(relatedModel, column)
        ) {
          leftOut = true;
          continue;
        }

        relationSelect[column] = columnValue;
      }

      if (leftOut && Object.keys(relationSelect).length === 0) {
        relationSelect["_id"] = true;
      }

      readable[key] = relationSelect;
    }

    return readable as Select<TBaseModel>;
  }

  // The related model of a relation column, or null for any other column.
  public static getRelatedModel(
    model: BaseModel,
    column: string,
  ): BaseModel | null {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (
      !metadata ||
      !metadata.modelType ||
      (metadata.type !== TableColumnType.Entity &&
        metadata.type !== TableColumnType.EntityArray)
    ) {
      return null;
    }

    return new metadata.modelType();
  }

  /*
   * Whether a select through a relation may name the column for `held`, as
   * the server's check of it decides (QueryPermission
   * .checkRelationQueryPermission): a label every reader of the relation
   * reads; a column held to its own read, or one of the ids and times
   * every select may name, when `held` may read it on the related record;
   * nothing else.
   */
  public static mayReadThroughRelation(data: {
    relatedModel: BaseModel;
    column: string;
    held: HeldPermissions;
    notCounted?: ReadonlyArray<Permission> | undefined;
  }): boolean {
    const metadata: TableColumnMetadata | undefined =
      data.relatedModel.getTableColumnMetadata(data.column);

    if (!metadata) {
      return false;
    }

    if (RelationReadersUtil.isReadByEveryReaderOfTheRelation(metadata)) {
      return true;
    }

    if (
      RelationReadersUtil.isHeldToItsOwnRead(metadata) ||
      ALWAYS_SELECTABLE_COLUMNS.includes(data.column)
    ) {
      return RelationReadersUtil.canReadRelatedColumn(data);
    }

    return false;
  }
}
