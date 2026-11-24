import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import RelationReadersUtil from "../../../Types/Database/RelationReadersUtil";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import HeldPermissionsUtil, {
  ALWAYS_SELECTABLE_COLUMNS,
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import Permission from "../../../Types/Permission";

/*
 * WHO READS A COLUMN THROUGH A RELATION THAT THE COLUMN'S OWN READ KEEPS IT
 * FROM (#10281), worked out from the models' metadata the way the server
 * checks a read:
 *
 *   - who reads the relation: who may read the model that names the record
 *     (TablePermission: its read permissions or its operational-resource
 *     wildcard), and the record it is read through when it has one
 *     (@CanAccessIfCanReadOn, unless its parent read is optional:
 *     BasePermission.isHeldToParentRead), and the relation column itself
 *     (ColumnPermission);
 *   - who may read the related column itself: its own read permissions, or
 *     its table's for a column with none (RelationReadersUtil
 *     .canReadRelatedColumn, which the server asks).
 *
 * A reader is one role on top of what every member of a project holds
 * (EVERY_MEMBER), or a member with no role at all ("(any member)"). A column
 * the server holds to its own read through a relation
 * (RelationReaders.ColumnReaders), or that no relation reads, is never
 * wider: the server asks its own read. A label every reader of the relation
 * reads (canReadOnRelationQuery alone) is wider for each reader of the
 * relation its own read does not let in - which is what made every Viewer a
 * reader of every data store's sensitivity through the data assets in it.
 */

// What every member of a project holds, whatever their teams give them.
export const EVERY_MEMBER: ReadonlyArray<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.UnAuthorizedSsoUser,
  Permission.ProjectUser,
];

// A member with no role but what membership gives.
export const ANY_MEMBER: string = "(any member)";

type ModelType = { new (): BaseModel };

export interface WiderRelationRead {
  // The model that names the record: "DataAsset".
  model: string;
  // The relation it names it by: "dataStore".
  relation: string;
  // The record's model: "DataStore".
  relatedModel: string;
  // The record's column read through the relation: "sensitivity".
  column: string;
  // The readers of the relation the column's own read does not let in.
  readers: Array<string>;
}

function heldBy(permission: Permission | null): HeldPermissions {
  return HeldPermissionsUtil.fromPermissions(
    permission ? [...EVERY_MEMBER, permission] : [...EVERY_MEMBER],
  );
}

function readsTable(model: BaseModel, held: HeldPermissions): boolean {
  return HeldPermissionsUtil.isGrantedAny(
    held,
    model.readRecordPermissions || [],
    {
      wildcard: HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: "read",
      }),
    },
  );
}

// Whether `held` reads `relation` of `model`, as the server's read checks it.
export function readsRelation(
  model: BaseModel,
  relation: string,
  held: HeldPermissions,
): boolean {
  if (!readsTable(model, held)) {
    return false;
  }

  if (model.canAccessIfCanReadOn && !model.isParentReadOptional) {
    const parentType: ModelType | undefined = model.getTableColumnMetadata(
      model.canAccessIfCanReadOn,
    )?.modelType as ModelType | undefined;

    if (parentType && !readsTable(new parentType(), held)) {
      return false;
    }
  }

  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(relation);

  if (!access) {
    return false;
  }

  return HeldPermissionsUtil.holdsColumnPermission(held, {
    isOperationalResource: model.isOperationalResource,
    operation: "read",
    tablePermissions: model.readRecordPermissions || [],
    columnPermissions: access.read || [],
  });
}

/*
 * Every reader of `relation` of `model`: ANY_MEMBER alone when membership
 * reads it - every role reads it then, and reads no less of the related
 * record than membership does - else each role that does.
 */
export function getRelationReaders(
  model: BaseModel,
  relation: string,
): Array<{ name: string; held: HeldPermissions }> {
  const readers: Array<{ name: string; held: HeldPermissions }> = [];

  if (readsRelation(model, relation, heldBy(null))) {
    return [{ name: ANY_MEMBER, held: heldBy(null) }];
  }

  const candidates: Set<Permission> = new Set<Permission>([
    ...(model.readRecordPermissions || []),
    ...(model.getColumnAccessControlFor(relation)?.read || []),
    Permission.ReadAllOperationalResources,
  ]);

  for (const permission of candidates) {
    if (EVERY_MEMBER.includes(permission)) {
      continue;
    }

    if (readsRelation(model, relation, heldBy(permission))) {
      readers.push({ name: permission, held: heldBy(permission) });
    }
  }

  return readers;
}

/*
 * Every relation read of a label (a column every reader of the relation
 * reads) by readers the column's own read does not let in, on `modelTypes`.
 * The ids and times every select may name are read by the related record's
 * own read, and are never wider.
 */
export function findWiderRelationReads(
  modelTypes: ReadonlyArray<ModelType>,
): Array<WiderRelationRead> {
  const wider: Array<WiderRelationRead> = [];

  for (const modelType of modelTypes) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const relation of Object.keys(columns)) {
      const metadata: TableColumnMetadata = columns[relation]!;

      if (
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray) ||
        !metadata.modelType
      ) {
        continue;
      }

      const relatedModel: BaseModel = new metadata.modelType();
      const relatedColumns: Dictionary<TableColumnMetadata> =
        getTableColumns(relatedModel);
      const readers: Array<{ name: string; held: HeldPermissions }> =
        getRelationReaders(model, relation);

      for (const column of Object.keys(relatedColumns)) {
        if (
          ALWAYS_SELECTABLE_COLUMNS.includes(column) ||
          !RelationReadersUtil.isReadByEveryReaderOfTheRelation(
            relatedColumns[column],
          )
        ) {
          continue;
        }

        const kept: Array<string> = readers
          .filter((reader: { name: string; held: HeldPermissions }) => {
            return !RelationReadersUtil.canReadRelatedColumn({
              relatedModel: relatedModel,
              column: column,
              held: reader.held,
            });
          })
          .map((reader: { name: string; held: HeldPermissions }): string => {
            return reader.name;
          });

        if (kept.length > 0) {
          wider.push({
            model: model.tableName || modelType.name,
            relation: relation,
            relatedModel: relatedModel.tableName || metadata.modelType.name,
            column: column,
            readers: kept,
          });
        }
      }
    }
  }

  return wider;
}
