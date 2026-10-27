import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import CreateScopeException from "./CreateScopeException";
import UpdateScopeException from "./UpdateScopeException";
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

/*
 * The labelled records a record that carries no labels of its own names,
 * by labelled model (CreateScopePermission.getLabelledRecordsNamed), and
 * whether it names any record at all.
 */
export interface LabelledRecordsNamed {
  namesARecord: boolean;
  ids: Map<DatabaseBaseModelType, Set<string>>;
}

/*
 * Why a create is not one its creator will own (getOwnedCreateRefusal): a
 * record whose creator becomes its owner, made by a caller who is no person
 * and so can own nothing; or a record under a parent - the resource an owner
 * row adds an owner to among them - that neither the caller nor the teams
 * of their permissions own.
 */
export enum OwnedCreateRefusal {
  NotAPerson = "NotAPerson",
  NotOwned = "NotOwned",
}

// What the caller's create (or update) permission on a model reaches.
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
  /*
   * Some create permissions are limited to labels (grantedLabelIds) and the
   * others to the records the caller owns: a record carrying none of the
   * labels is reached all the same when it is one the caller, or the teams
   * of those others (ownedTeamIds), own - the union of the caller's grants
   * (AccessControlPermission.LabelGrant).
   */
  isOwnedBesideLabels: boolean;
  /*
   * The teams of the permissions limited to owned records - every one
   * (isOwnedOnly), or the ones beside labels (isOwnedBesideLabels): each
   * reaches the records its own team owns, beside the caller's own
   * (OwnedScopePermission.getOwningTeamIds).
   */
  ownedTeamIds: Array<ObjectID>;
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
 *     the parent it names is one the caller or their teams own - and so is
 *     the resource an owner row adds an owner to: an owner row is owned
 *     through its resource (OwnedScopePermission.getOwnedThrough), so
 *     reading a resource does not let a member make themselves its owner.
 *     On any other model the Owned scope has nothing to narrow, as on a
 *     read;
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

      /*
       * One the labels do not reach is reached all the same as a record its
       * creator, or the teams of the permissions limited to owned records
       * beside them, own (getOwnedCreateRefusal).
       */
      const ownedRefusal: OwnedCreateRefusal | null =
        isAboutNoLabelledRecord || carriesGrantedLabel
          ? null
          : scope.isOwnedBesideLabels
            ? await CreateScopePermission.getOwnedCreateRefusal(
                data.modelType,
                data.data,
                data.props,
                data.ownedParentIds || [],
                scope.ownedTeamIds,
              )
            : OwnedCreateRefusal.NotOwned;

      if (ownedRefusal) {
        const names: Array<string> = await data.findLabelNames({
          labelIds: scope.grantedLabelIds,
          props: data.props,
        });

        throw new CreateScopeException(
          CreateScopePermission.getLabelsRefusal({
            modelType: data.modelType,
            labelNames: names,
            ownedRefusal: scope.isOwnedBesideLabels ? ownedRefusal : null,
          }),
        );
      }
    }

    if (scope.isOwnedOnly) {
      await CreateScopePermission.checkOwnedCreate(
        data.modelType,
        data.data,
        data.props,
        data.ownedParentIds || [],
        scope.ownedTeamIds,
      );
    }
  }

  /*
   * Why a create its permissions limited to labels do not reach is refused:
   * the labels it would need to carry and - beside permissions limited to
   * the records the caller owns (`ownedRefusal`) - why it is not one of
   * those either.
   */
  private static getLabelsRefusal(data: {
    modelType: DatabaseBaseModelType;
    labelNames: Array<string>;
    ownedRefusal: OwnedCreateRefusal | null;
  }): string {
    const model: BaseModel = new data.modelType();
    const labels: string = data.labelNames.join(", ");

    if (model.getAccessControlColumn()) {
      if (data.ownedRefusal === OwnedCreateRefusal.NotAPerson) {
        return `Your access lets you create ${model.pluralName} only with one of these labels: ${labels}, or as their owner, and only a person can own one. Add one of the labels and try again.`;
      }

      return `Your access lets you create ${model.pluralName} only with one of these labels: ${labels}. Add one of them and try again.`;
    }

    if (data.ownedRefusal === OwnedCreateRefusal.NotOwned) {
      return `Your access lets you create ${model.pluralName} only for records with one of these labels: ${labels}, or for the ${CreateScopePermission.getOwnedParentPluralName(data.modelType)} you or your teams own.`;
    }

    return `Your access lets you create ${model.pluralName} only for records with one of these labels: ${labels}.`;
  }

  /*
   * What the caller's permissions to create `modelType` reach: the rows
   * that grant the create, read as the record rule reads them - one that
   * reaches the whole project (HeldPermissionsUtil.isProjectWideRow, a
   * global permission among them) makes the create project-wide; otherwise
   * the rows limited to labels give the labels, and with none of those every
   * row is limited to owned records. Rows limited to labels beside rows
   * limited to owned records reach both, as a read does
   * (AccessControlPermission.LabelGrant): a record carrying one of the
   * labels, or one its creator or the Owned rows' teams own
   * (isOwnedBesideLabels). The blocks with labels on the model's create
   * permissions, or on its wildcard while the wildcard is what grants
   * (HeldPermissionsUtil.getLabelBlockingPermissions).
   */
  public static getCreateScope(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): CreateScope {
    return CreateScopePermission.getWriteScope(
      modelType,
      props,
      DatabaseRequestType.Create,
    );
  }

  /*
   * What the caller's permissions to create or to update `modelType` reach,
   * read the same way (see getCreateScope): an update that changes the
   * labels a record carries is held to its update permission's scope
   * (UpdateScopePermission) as a create is to its create permission's.
   */
  public static getWriteScope(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType.Create | DatabaseRequestType.Update,
  ): CreateScope {
    const held: HeldPermissions = TablePermission.getHeldPermissions(props);

    const granting: Array<Permission> = TablePermission.getGrantingPermissions(
      modelType,
      type,
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

    /*
     * A row over the whole project reaches every record, and so does a row
     * scoped to Owned where the scope narrows nothing of the record
     * (OwnedScopePermission.narrowsRecords: no owners of its own and no
     * parent it takes them from).
     */
    const ownedReachesEverything: boolean =
      !OwnedScopePermission.narrowsRecords(modelType, type);

    const isProjectWide: boolean = grantRows.some(
      (row: UserPermission): boolean => {
        return (
          HeldPermissionsUtil.isProjectWideRow(row) ||
          (ownedReachesEverything && row.scope === PermissionScope.Owned)
        );
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

    const ownedRows: Array<UserPermission> = isProjectWide
      ? []
      : grantRows.filter((row: UserPermission): boolean => {
          return row.scope === PermissionScope.Owned;
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
        modelPermissions: TablePermission.getTablePermission(modelType, type),
        wildcard: TablePermission.getModelWildcard(modelType, type),
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

    const isOwnedOnly: boolean =
      !isProjectWide && grantRows.length > 0 && labelRows.length === 0;

    const isOwnedBesideLabels: boolean =
      labelRows.length > 0 && ownedRows.length > 0;

    return {
      isProjectWide: isProjectWide,
      grantedLabelIds: grantedLabelIds,
      isOwnedOnly: isOwnedOnly,
      isOwnedBesideLabels: isOwnedBesideLabels,
      ownedTeamIds: isOwnedOnly
        ? OwnedScopePermission.getTeamIdsOfRows(grantRows)
        : isOwnedBesideLabels
          ? OwnedScopePermission.getTeamIdsOfRows(ownedRows)
          : [],
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

    const named: LabelledRecordsNamed =
      CreateScopePermission.getLabelledRecordsNamed(data.modelType, record);

    if (!named.namesARecord) {
      return null;
    }

    const labelIds: Set<string> = new Set<string>();

    // Each kind of record named, looked up at once.
    const labelsByKind: Array<Dictionary<Array<string>>> = await Promise.all(
      Array.from(named.ids.entries()).map(
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
   * The labelled records a record of a model that carries no labels of its
   * own names (ReadPermission.getLabelledReferences, and the parents it is
   * read through, through a list), by labelled model, every id lower-cased -
   * and whether it names a record at all. A malformed id names a record, but
   * none that could carry a label. See getRecordLabelIds.
   */
  public static getLabelledRecordsNamed(
    modelType: DatabaseBaseModelType,
    record: Record<string, unknown>,
  ): LabelledRecordsNamed {
    const model: BaseModel = new modelType();

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

    const references: LabelledReferences =
      ReadPermission.getLabelledReferences(modelType);

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
    const parentRelation: string | null =
      CreateScopePermission.getLabelledParentList(modelType);
    const parentColumn: TableColumnMetadata | undefined = parentRelation
      ? model.getTableColumnMetadata(parentRelation)
      : undefined;

    if (parentRelation && parentColumn?.modelType) {
      for (const parentId of resolveReferenceIds(record[parentRelation])) {
        name([parentColumn.modelType as DatabaseBaseModelType], parentId);
      }
    }

    return { namesARecord: namesARecord, ids: namedIds };
  }

  /*
   * The list of parents a model that carries no labels of its own is read
   * through (@CanAccessIfCanReadOn naming a list - an announcement's status
   * pages), when those parents carry labels: the record carries theirs. Null
   * for any other model.
   */
  public static getLabelledParentList(
    modelType: DatabaseBaseModelType,
  ): string | null {
    const model: BaseModel = new modelType();
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
      return parentRelation;
    }

    return null;
  }

  /*
   * See checkCreateScope: a create every permission of which is limited to
   * the records the caller owns. The parent it names is one the caller owns,
   * or one a team of those permissions owns (`teamIds`) - not one only
   * another team of theirs owns: a team that may only view what it owns
   * lends its incidents to no other team's grant to add notes or owners to.
   */
  private static async checkOwnedCreate<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
    ownedParentIds: Array<string>,
    teamIds: Array<ObjectID>,
  ): Promise<void> {
    const refusal: OwnedCreateRefusal | null =
      await CreateScopePermission.getOwnedCreateRefusal(
        modelType,
        data,
        props,
        ownedParentIds,
        teamIds,
      );

    if (!refusal) {
      return;
    }

    const model: BaseModel = new modelType();

    if (refusal === OwnedCreateRefusal.NotAPerson) {
      throw new CreateScopeException(
        `Your access lets you create only the ${model.pluralName} you own, and only a person can own one.`,
      );
    }

    const parentPluralName: string =
      CreateScopePermission.getOwnedParentPluralName(modelType);

    // An owner row: said as adding an owner, as the Owners tab adds one.
    if (OwnedScopePermission.isOwnerTable(modelType)) {
      throw new CreateScopeException(
        `Your access lets you add owners only to the ${parentPluralName} you or your teams own.`,
      );
    }

    throw new CreateScopeException(
      `Your access lets you create ${model.pluralName} only for the ${parentPluralName} you or your teams own.`,
    );
  }

  /*
   * Whether a create is one its creator will own - or why not
   * (OwnedCreateRefusal): on a model whose records have owners of their
   * own, the creator becomes one, so a person may create one; on a model
   * that takes its owners from a parent (an owner row's resource among
   * them), the parent it names is one the caller or one of `teamIds` owns,
   * or one of `ownedParentIds`. On any other model the Owned scope has
   * nothing to narrow: null.
   */
  private static async getOwnedCreateRefusal<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
    ownedParentIds: Array<string>,
    teamIds: Array<ObjectID>,
  ): Promise<OwnedCreateRefusal | null> {
    if (OwnedScopePermission.hasOwnerTables(modelType)) {
      return props.userId ? null : OwnedCreateRefusal.NotAPerson;
    }

    // The parent it takes its owners from, an owner row's resource among them.
    const ownedThrough: BaseModel["ownedThrough"] =
      OwnedScopePermission.getOwnedThrough(modelType);

    if (!ownedThrough) {
      return null;
    }

    const parentId: ObjectID | string | undefined = resolveReferenceId(
      (data as unknown as Record<string, unknown>)[ownedThrough.fkColumn],
    );

    return (await CreateScopePermission.isOwnedParent({
      modelType: modelType,
      parentId: parentId,
      props: props,
      ownedParentIds: ownedParentIds,
      teamIds: teamIds,
    }))
      ? null
      : OwnedCreateRefusal.NotOwned;
  }

  /*
   * AN UPDATE LIMITED TO OWNED RECORDS KEEPS A RECORD UNDER WHAT ITS EDITOR
   * OWNS. A record that takes its owners from a parent (@OwnedThrough, or an
   * owner table's resource: OwnedScopePermission.getOwnedThrough) is reached
   * by such an update only under a parent its editor, or the team of their
   * permission to update it, owns (OwnedScopePermission.getOwningTeamIds) -
   * and the update may name another parent only on the same terms, as a
   * create may (checkOwnedCreate): a rule of one team's service is not moved
   * to another team's service, or, where records of no parent stay out of
   * every owner's reach, out from under its parent. Where records of no
   * parent belong to the project (includeUnattributed), an update may leave
   * one with none, as a create may make one. An update that leaves the
   * parent as it is, and a caller whose permission to update reaches more
   * than what they own, are not asked. Root and master admin callers are
   * left alone.
   */
  @CaptureSpan()
  public static async checkOwnedUpdate<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    // What the update writes.
    data: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (
      data.props.isRoot ||
      data.props.isMasterAdmin ||
      !data.data ||
      typeof data.data !== "object"
    ) {
      return;
    }

    const ownedThrough: BaseModel["ownedThrough"] =
      OwnedScopePermission.getOwnedThrough(data.modelType);

    if (!ownedThrough) {
      return;
    }

    const record: Record<string, unknown> = data.data as Record<
      string,
      unknown
    >;
    const relation: string | null = CreateScopePermission.getRelationOfColumn(
      data.modelType,
      ownedThrough.fkColumn,
    );

    const writesParent: boolean =
      record[ownedThrough.fkColumn] !== undefined ||
      Boolean(relation && record[relation] !== undefined);

    if (
      !writesParent ||
      !OwnedScopePermission.isLimitedToOwnedRecords(
        data.modelType,
        data.props,
        DatabaseRequestType.Update,
      )
    ) {
      return;
    }

    const parentId: ObjectID | string | undefined =
      resolveReferenceId(record[ownedThrough.fkColumn]) ||
      (relation ? resolveReferenceId(record[relation]) : undefined);

    if (
      await CreateScopePermission.isOwnedParent({
        modelType: data.modelType,
        parentId: parentId,
        props: data.props,
        ownedParentIds: [],
        teamIds: OwnedScopePermission.getOwningTeamIds(
          data.modelType,
          data.props,
          DatabaseRequestType.Update,
        ),
      })
    ) {
      return;
    }

    const model: BaseModel = new data.modelType();

    throw new UpdateScopeException(
      `Your access lets you change ${model.pluralName} only to keep them under the ${CreateScopePermission.getOwnedParentPluralName(data.modelType)} you or your teams own.`,
    );
  }

  /*
   * Whether `parentId` - the parent a create or an update names for a model
   * that takes its owners from one - is a parent the caller may put a record
   * under on a grant limited to owned records: one the caller or one of
   * `teamIds` owns, or one of `ownedParentIds` (a parent they are to own
   * once the create it comes with is saved). No parent at all is let
   * through only where records of no parent belong to the project
   * (includeUnattributed).
   */
  public static async isOwnedParent(data: {
    modelType: { new (): BaseModel };
    parentId: ObjectID | string | undefined;
    props: DatabaseCommonInteractionProps;
    ownedParentIds: Array<string>;
    teamIds: Array<ObjectID>;
  }): Promise<boolean> {
    const ownedThrough: BaseModel["ownedThrough"] =
      OwnedScopePermission.getOwnedThrough(data.modelType);

    if (!ownedThrough) {
      return true;
    }

    if (!data.parentId || !data.parentId.toString().trim()) {
      return ownedThrough.includeUnattributed;
    }

    const parentId: string = normalizeReferenceId(data.parentId.toString());

    if (data.ownedParentIds.map(normalizeReferenceId).includes(parentId)) {
      return true;
    }

    const ownedIds: Array<ObjectID> = await OwnedScopePermission.getOwnedIds(
      data.modelType,
      data.props,
      data.teamIds,
    );

    return ownedIds.some((ownedId: ObjectID): boolean => {
      return normalizeReferenceId(ownedId.toString()) === parentId;
    });
  }

  // What a refusal calls the parents a model takes its owners from.
  public static getOwnedParentPluralName(modelType: {
    new (): BaseModel;
  }): string {
    const parentModelType: { new (): BaseModel } | undefined =
      OwnedScopePermission.getOwnedThrough(modelType)?.parentModels[0] as
        | { new (): BaseModel }
        | undefined;

    return (
      (parentModelType ? new parentModelType().pluralName : null) || "records"
    );
  }

  // The relation a key column names its record by, if the model has one.
  private static getRelationOfColumn(
    modelType: { new (): BaseModel },
    column: string,
  ): string | null {
    const model: BaseModel = new modelType();

    for (const name of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(name);

      if (
        metadata?.type === TableColumnType.Entity &&
        metadata.manyToOneRelationColumn === column
      ) {
        return name;
      }
    }

    return null;
  }

  // `the label "Production"`, `the labels "Production", "Staging"`.
  public static describeLabels(names: Array<string>): string {
    const quoted: Array<string> = names.map((labelName: string): string => {
      return `"${labelName}"`;
    });

    return quoted.length === 1
      ? `the label ${quoted[0]}`
      : `the labels ${quoted.join(", ")}`;
  }
}
