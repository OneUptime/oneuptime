import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import CreateScopeException from "./CreateScopeException";
import OwnedScopePermission from "./OwnedScopePermission";
import ReadPermission, {
  getLabelledModelTypes,
  LabelledReferences,
} from "./ReadPermission";
import TablePermission from "./TablePermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../Types/Dictionary";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import {
  normalizeReferenceId,
  resolveReferenceId,
  resolveReferenceIds,
} from "../../../Utils/Database/ProjectScopedReferenceRefusal";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * The labels each of `ids` - records of `modelType`, a model that carries
 * labels - carries, by record id, every id lower-cased, read by OneUptime in
 * the project the record is created in. A record not found there carries
 * none. DatabaseService hands it in.
 */
export type RecordLabelsFinder = (data: {
  modelType: DatabaseBaseModelType;
  ids: Array<string>;
  props: DatabaseCommonInteractionProps;
}) => Promise<Dictionary<Array<string>>>;

// The names of the labels `labelIds`, in the project the record is created in.
export type LabelNamesFinder = (data: {
  labelIds: Array<string>;
  props: DatabaseCommonInteractionProps;
}) => Promise<Array<string>>;

// What the caller's create permission on a model reaches.
export interface CreateScope {
  // A permission to create that reaches the whole project.
  isProjectWide: boolean;
  /*
   * The labels the create permissions are limited to, when none reaches the
   * whole project and some are limited to labels.
   */
  grantedLabelIds: Array<string>;
  // Every create permission is limited to the records the caller owns.
  isOwnedOnly: boolean;
  // The blocks with labels on the model's create permissions.
  labelledBlocks: Array<UserPermission>;
}

/*
 * A CREATE MAKES ONLY A RECORD THE CALLER'S CREATE PERMISSION REACHES.
 *
 * A permission is limited to some records - to the ones carrying some
 * labels, or to the ones the caller or their teams own - on a create as on a
 * read, an update and a delete: the record a create makes must be one the
 * permission that lets the caller create it would reach, by the same rule
 * the record rule reaches records by (BasePermission.addRecordScopeToQuery):
 *
 *   - when every permission that lets the caller create the record is
 *     limited to labels, the record carries at least one of them - a model
 *     that carries labels by its own labels, a model that does not by the
 *     labelled records it names (an incident's note by its incident, an
 *     announcement by its status pages; one that names no labelled record
 *     at all is about none of them, as a read takes it). One permission
 *     over the whole project lets every record through;
 *   - when every one of them is limited to owned records: on a model whose
 *     records have owners of their own, the creator becomes one of them as
 *     the create returns (DatabaseService.autoOwnerOnCreate), so a caller
 *     who is a person may create one - and nobody else, as nobody else can
 *     own it; on a model that takes its owners from a parent (@OwnedThrough),
 *     the parent it names is one the caller or their teams own. On any other
 *     model the Owned scope has nothing to narrow, as on a read;
 *   - a block with labels on one of the model's create permissions refuses
 *     a record carrying (or, without labels of its own, naming a record
 *     carrying) one of its labels.
 *
 * A refused create is a CreateScopeException, whose message names the
 * labels the permission allows. Root and master admin callers are left
 * alone. DatabaseService asks once the create hooks have run and the
 * create permissions are checked, on the record as it will be saved.
 */
export default class CreateScopePermission {
  @CaptureSpan()
  public static async checkCreateScope<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
    findRecordLabels: RecordLabelsFinder;
    findLabelNames: LabelNamesFinder;
    /*
     * Parents the caller is to own once the create they come with is saved:
     * a record they are creating, whose creator becomes its owner
     * (DatabaseService.autoOwnerOnCreate), asked about before it is.
     */
    ownedParentIds?: Array<string> | undefined;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const scope: CreateScope = CreateScopePermission.getCreateScope(
      data.modelType,
      data.props,
    );

    if (
      scope.grantedLabelIds.length === 0 &&
      scope.labelledBlocks.length === 0 &&
      !scope.isOwnedOnly
    ) {
      return;
    }

    const model: BaseModel = new data.modelType();

    // The labels the record carries, or the records it names carry.
    const recordLabelIds: Set<string> | null =
      scope.grantedLabelIds.length > 0 || scope.labelledBlocks.length > 0
        ? await CreateScopePermission.getRecordLabelIds({
            modelType: data.modelType,
            data: data.data,
            props: data.props,
            findRecordLabels: data.findRecordLabels,
          })
        : null;

    for (const block of scope.labelledBlocks) {
      const blockedLabelIds: Array<string> = (block.labelIds || [])
        .map((labelId: ObjectID): string => {
          return normalizeReferenceId(labelId.toString());
        })
        .filter((labelId: string): boolean => {
          return Boolean(recordLabelIds?.has(labelId));
        });

      if (blockedLabelIds.length > 0) {
        const names: Array<string> = await data.findLabelNames({
          labelIds: blockedLabelIds,
          props: data.props,
        });

        throw new CreateScopeException(
          `You are not authorized to create this ${model.singularName} because ${block.permission} is in your team's permission block list for ${CreateScopePermission.describeLabels(names)}.`,
        );
      }
    }

    if (scope.grantedLabelIds.length > 0) {
      const isAboutNoLabelledRecord: boolean =
        !model.getAccessControlColumn() && recordLabelIds === null;

      const carriesGrantedLabel: boolean = scope.grantedLabelIds.some(
        (labelId: string): boolean => {
          return Boolean(recordLabelIds?.has(labelId));
        },
      );

      if (!isAboutNoLabelledRecord && !carriesGrantedLabel) {
        const names: Array<string> = await data.findLabelNames({
          labelIds: scope.grantedLabelIds,
          props: data.props,
        });

        throw new CreateScopeException(
          model.getAccessControlColumn()
            ? `Your access lets you create ${model.pluralName} only with one of these labels: ${names.join(", ")}. Add one of them and try again.`
            : `Your access lets you create ${model.pluralName} only for records with one of these labels: ${names.join(", ")}.`,
        );
      }
    }

    if (scope.isOwnedOnly) {
      await CreateScopePermission.checkOwnedCreate(
        data.modelType,
        data.data,
        data.props,
        data.ownedParentIds || [],
      );
    }
  }

  /*
   * What the caller's permissions to create `modelType` reach: the rows
   * that grant the create, read as the record rule reads them - one that
   * reaches the whole project (HeldPermissionsUtil.isProjectWideRow, a
   * global permission among them) makes the create project-wide; otherwise
   * the rows limited to labels give the labels, and with none of those every
   * row is limited to owned records. Rows limited to labels beside rows
   * limited to owned records read as the labels, as a read does: a row
   * limited to labels counts as the broader grant there
   * (OwnedScopePermission.isLimitedToOwnedRecords), and the read is narrowed
   * to its labels (AccessControlPermission), so a record owned but carrying
   * none of them would be one its creator could not read. The blocks with labels on the model's
   * create permissions, or on its wildcard while the wildcard is what
   * grants (HeldPermissionsUtil.getLabelBlockingPermissions).
   */
  public static getCreateScope(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): CreateScope {
    const held: HeldPermissions = TablePermission.getHeldPermissions(props);

    const granting: Array<Permission> = TablePermission.getGrantingPermissions(
      modelType,
      DatabaseRequestType.Create,
      props,
      held,
    );

    const grantRows: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).filter((row: UserPermission): boolean => {
        return granting.includes(row.permission);
      });

    const isProjectWide: boolean = grantRows.some(
      (row: UserPermission): boolean => {
        return HeldPermissionsUtil.isProjectWideRow(row);
      },
    );

    const labelRows: Array<UserPermission> = isProjectWide
      ? []
      : grantRows.filter((row: UserPermission): boolean => {
          return (
            row.scope !== PermissionScope.Owned &&
            HeldPermissionsUtil.hasLabels(row)
          );
        });

    const grantedLabelIds: Array<string> = Array.from(
      new Set<string>(
        labelRows.flatMap((row: UserPermission): Array<string> => {
          return (row.labelIds || []).map((labelId: ObjectID): string => {
            return normalizeReferenceId(labelId.toString());
          });
        }),
      ),
    );

    const blocking: Array<Permission> =
      HeldPermissionsUtil.getLabelBlockingPermissions(held, {
        modelPermissions: TablePermission.getTablePermission(
          modelType,
          DatabaseRequestType.Create,
        ),
        wildcard: TablePermission.getModelWildcard(
          modelType,
          DatabaseRequestType.Create,
        ),
      });

    const labelledBlocks: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ).filter((row: UserPermission): boolean => {
        return (
          HeldPermissionsUtil.hasLabels(row) &&
          blocking.includes(row.permission)
        );
      });

    return {
      isProjectWide: isProjectWide,
      grantedLabelIds: grantedLabelIds,
      isOwnedOnly:
        !isProjectWide && grantRows.length > 0 && labelRows.length === 0,
      labelledBlocks: labelledBlocks,
    };
  }

  /*
   * The labels the record carries, lower-cased: a model that carries labels
   * by the labels it is created with; a model that does not, by the labels
   * of the labelled records it names (ReadPermission.getLabelledReferences,
   * and the parents it is read through, through a list), looked up as
   * OneUptime - or null when it names no labelled record at all.
   */
  public static async getRecordLabelIds<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
    findRecordLabels: RecordLabelsFinder;
  }): Promise<Set<string> | null> {
    const model: BaseModel = new data.modelType();
    const record: Record<string, unknown> = data.data as unknown as Record<
      string,
      unknown
    >;
    const accessControlColumn: string | null = model.getAccessControlColumn();

    if (accessControlColumn) {
      return new Set<string>(
        resolveReferenceIds(record[accessControlColumn]).map(
          (labelId: ObjectID | string): string => {
            return normalizeReferenceId(labelId.toString());
          },
        ),
      );
    }

    // The ids each labelled model is named by.
    const namedIds: Map<DatabaseBaseModelType, Set<string>> = new Map();
    let namesARecord: boolean = false;

    const name: (
      modelTypes: Array<DatabaseBaseModelType>,
      value: unknown,
    ) => void = (
      modelTypes: Array<DatabaseBaseModelType>,
      value: unknown,
    ): void => {
      const id: ObjectID | string | undefined = resolveReferenceId(value);

      if (!id || !id.toString().trim()) {
        return;
      }

      namesARecord = true;

      // A malformed id names no record that could carry a label.
      if (!ObjectID.isValidUUID(id.toString().trim())) {
        return;
      }

      for (const modelType of modelTypes) {
        const ids: Set<string> = namedIds.get(modelType) || new Set<string>();
        ids.add(normalizeReferenceId(id.toString()));
        namedIds.set(modelType, ids);
      }
    };

    const references: LabelledReferences = ReadPermission.getLabelledReferences(
      data.modelType,
    );

    for (const reference of references.keys) {
      name(
        reference.modelTypes as Array<DatabaseBaseModelType>,
        record[reference.column],
      );
    }

    for (const column of references.anyKindColumns) {
      name(
        getLabelledModelTypes() as Array<DatabaseBaseModelType>,
        record[column],
      );
    }

    // The parents it is read through, through a list (an announcement's pages).
    const parentRelation: string | null = model.canAccessIfCanReadOn;
    const parentColumn: TableColumnMetadata | undefined = parentRelation
      ? model.getTableColumnMetadata(parentRelation)
      : undefined;

    if (
      parentRelation &&
      parentColumn?.type === TableColumnType.EntityArray &&
      parentColumn.modelType &&
      new parentColumn.modelType().getAccessControlColumn()
    ) {
      for (const parentId of resolveReferenceIds(record[parentRelation])) {
        name([parentColumn.modelType as DatabaseBaseModelType], parentId);
      }
    }

    if (!namesARecord) {
      return null;
    }

    const labelIds: Set<string> = new Set<string>();

    // Each kind of record named, looked up at once.
    const labelsByKind: Array<Dictionary<Array<string>>> = await Promise.all(
      Array.from(namedIds.entries()).map(
        ([modelType, ids]: [DatabaseBaseModelType, Set<string>]): Promise<
          Dictionary<Array<string>>
        > => {
          return data.findRecordLabels({
            modelType: modelType,
            ids: Array.from(ids),
            props: data.props,
          });
        },
      ),
    );

    for (const labelsByRecord of labelsByKind) {
      for (const recordLabelIds of Object.values(labelsByRecord)) {
        for (const labelId of recordLabelIds || []) {
          labelIds.add(normalizeReferenceId(labelId));
        }
      }
    }

    return labelIds;
  }

  /*
   * See checkCreateScope: a create every permission of which is limited to
   * the records the caller owns.
   */
  private static async checkOwnedCreate<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
    ownedParentIds: Array<string>,
  ): Promise<void> {
    const model: BaseModel = new modelType();

    if (OwnedScopePermission.hasOwnerTables(modelType)) {
      if (!props.userId) {
        throw new CreateScopeException(
          `Your access lets you create only the ${model.pluralName} you own, and only a person can own one.`,
        );
      }

      return;
    }

    const ownedThrough: BaseModel["ownedThrough"] = model.ownedThrough;

    if (!ownedThrough) {
      return;
    }

    const parentId: ObjectID | string | undefined = resolveReferenceId(
      (data as unknown as Record<string, unknown>)[ownedThrough.fkColumn],
    );

    if (!parentId || !parentId.toString().trim()) {
      if (ownedThrough.includeUnattributed) {
        return;
      }
    } else if (
      ownedParentIds
        .map(normalizeReferenceId)
        .includes(normalizeReferenceId(parentId.toString()))
    ) {
      return;
    } else {
      const ownedIds: Array<ObjectID> = await OwnedScopePermission.getOwnedIds(
        modelType,
        props,
      );

      if (
        ownedIds.some((ownedId: ObjectID): boolean => {
          return (
            normalizeReferenceId(ownedId.toString()) ===
            normalizeReferenceId(parentId.toString())
          );
        })
      ) {
        return;
      }
    }

    const parentModelType: { new (): BaseModel } | undefined = ownedThrough
      .parentModels[0] as { new (): BaseModel } | undefined;

    throw new CreateScopeException(
      `Your access lets you create ${model.pluralName} only for the ${
        parentModelType ? new parentModelType().pluralName : "records"
      } you or your teams own.`,
    );
  }

  // `the label "Production"`, `the labels "Production", "Staging"`.
  private static describeLabels(names: Array<string>): string {
    const quoted: Array<string> = names.map((labelName: string): string => {
      return `"${labelName}"`;
    });

    return quoted.length === 1
      ? `the label ${quoted[0]}`
      : `the labels ${quoted.join(", ")}`;
  }
}
