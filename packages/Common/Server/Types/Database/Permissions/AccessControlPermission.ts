import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import TablePermission from "./TablePermission";
import ReadPermission, { RecordOperation } from "./ReadPermission";
import AccessControlModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/AccessControlModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ArrayUtil from "../../../../Utils/Array";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { FindWhereProperty } from "../../../../Types/BaseDatabase/Query";
import OwnedScopePermission from "./OwnedScopePermission";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import Dictionary from "../../../../Types/Dictionary";

/*
 * Built once per invocation and threaded through the per-column loop; never
 * cached on props or module scope (the multi-tenant path re-enters with
 * different per-tenant props and must rebuild fresh).
 */
type AccessControlPermissionContext = {
  nonAccessControlPermissions: Array<Permission>;
  accessControlPermissions: Array<UserPermission>;
  // The allow rows scoped to Owned, of roles that can be scoped.
  ownedPermissions: Array<UserPermission>;
  // What the caller holds, for the wildcards the grants count.
  held: HeldPermissions;
};

/*
 * WHAT GRANTS LIMITED TO LABELS REACH - BESIDE GRANTS SCOPED TO OWNED. A
 * caller's access is the union of their grants: a team's grant limited to
 * some labels reaches the records carrying one of them, and another team's
 * grant of the same permission scoped to Owned reaches the records the
 * caller or that team owns. So when both grant an operation, its records
 * are the records carrying one of `labelIds` and the records the caller or
 * one of `ownedTeamIds` owns, in one condition (addGrantToQuery) - read as
 * the labels alone, an incident another team owns and that carries none of
 * them could not be changed, though a grant reaches it.
 *
 * `labelIds` empty: the grants are not limited to labels - they reach the
 * whole project, or only owned records (OwnedScopePermission), and
 * `ownedTeamIds` is null. `ownedTeamIds` null: no grant scoped to Owned
 * stands beside the labels.
 */
export interface LabelGrant {
  labelIds: Array<ObjectID>;
  ownedTeamIds: Array<ObjectID> | null;
}

export default class AccessControlPermission {
  @CaptureSpan()
  public static async checkAccessControlBlockPermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    type: DatabaseRequestType;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { modelType, props, type } = data;

    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    TablePermission.checkTableLevelBlockPermissions(modelType, props, type);

    /*
     * The block rows with labels that weigh this operation: on one of the
     * model's own permissions for it, or on its wildcard while the wildcard
     * is what grants (ReadPermission.getLabelledBlockRows) - the rows the
     * record rule leaves records out by.
     */
    const blockPermissionsBelongToThisModel: Array<UserPermission> =
      ReadPermission.getLabelledBlockRows(
        modelType,
        props,
        type as RecordOperation,
      );

    if (blockPermissionsBelongToThisModel.length === 0) {
      return;
    }

    /*
     * A record with no labels of its own is weighed here only where the
     * caller can look it up under the rule (isRecordFound); otherwise the
     * query the operation runs with applies the rule
     * (BasePermission.addRecordScopeToQuery), and nothing need be read.
     */
    if (!new modelType().getAccessControlColumn() && !data.isRecordFound) {
      return;
    }

    // now check if the user has any of these labels in the block list, for this we need to fetch the model first.
    const fetchedModel: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!fetchedModel) {
      throw new NotFoundException(`${new modelType().singularName} not found.`);
    }

    /*
     * A record with no labels of its own carries the labels of the records
     * it names: it is refused when the label rule leaves it out - a note of
     * an incident carrying a blocked label (ReadPermission
     * .addLabelBlockToQuery) - as a labelled record carrying one is below.
     */
    if (!fetchedModel.getAccessControlColumn()) {
      if (
        !(await this.isRecordKeptByLabelRule({
          record: fetchedModel,
          isRecordFound: data.isRecordFound,
          narrow: (query: Query<TBaseModel>): Query<TBaseModel> => {
            return ReadPermission.addLabelBlockToQuery(
              modelType,
              query,
              props,
              type as RecordOperation,
            );
          },
        }))
      ) {
        /*
         * The rule weighs every one of these block rows at once, so the
         * refusal names their permissions and says one of them holds for
         * this record, not which.
         */
        const blockedPermissions: Array<string> = Array.from(
          new Set<string>(
            blockPermissionsBelongToThisModel.map(
              (blockPermission: UserPermission): string => {
                return blockPermission.permission.toString();
              },
            ),
          ),
        );

        throw new NotAuthorizedException(
          `You are not authorized to ${type.toLowerCase()} this ${
            fetchedModel.singularName
          } because ${
            blockedPermissions.length === 1
              ? blockedPermissions[0]
              : `one of ${blockedPermissions.join(", ")}`
          } is in your team's permission block list.`,
        );
      }

      return;
    }

    for (const blockPermissionBelongToThisModel of blockPermissionsBelongToThisModel) {
      const blockPermissionLabelIds: Array<ObjectID> =
        blockPermissionBelongToThisModel.labelIds || [];

      const blockPermissionLabelIdAsString: Array<string> =
        blockPermissionLabelIds.map((id: ObjectID) => {
          return id.toString();
        });

      if (blockPermissionLabelIds.length === 0) {
        continue;
      }

      const model: TBaseModel = fetchedModel;

      const modelAccessControlColumnName: string | null =
        model.getAccessControlColumn();

      if (modelAccessControlColumnName) {
        const modelAccessControl: Array<AccessControlModel> =
          (model.getColumnValue(
            modelAccessControlColumnName,
          ) as Array<AccessControlModel>) || [];

        for (const accessControl of modelAccessControl) {
          if (!accessControl.id) {
            continue;
          }

          if (
            blockPermissionLabelIdAsString.includes(accessControl.id.toString())
          ) {
            throw new NotAuthorizedException(
              `You are not authorized to ${type.toLowerCase()} this ${
                model.singularName
              } because ${
                blockPermissionBelongToThisModel.permission
              } is in your team's permission block list.`,
            );
          }
        }
      }
    }
  }

  /*
   * `updateData` is what an update writes, when the caller has it, for the
   * plan check: an update that only switches the record off passes it below
   * the table's update plan (BillingPermission).
   */
  @CaptureSpan()
  public static async checkAccessControlPermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    updateData?: unknown;
  }): Promise<void> {
    const { modelType, props, type } = data;

    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    // Check if the user has permission to delete or update the object in this table.
    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      type,
      data.updateData,
    );

    // if the control is here, then the user has table level permissions.
    const model: TBaseModel = new modelType();
    const modelAccessControlColumnName: string | null =
      model.getAccessControlColumn();

    if (modelAccessControlColumnName) {
      /*
       * The labels alone: a record the caller's grants scoped to Owned
       * reach is weighed by the query the operation runs with
       * (getLabelsNarrowingAlone).
       */
      const accessControlIdsWhichUserHasAccessTo: Array<ObjectID> =
        this.getLabelsNarrowingAlone(modelType, props, type);

      if (accessControlIdsWhichUserHasAccessTo.length === 0) {
        return; // The user has access to all resources, if no labels are specified.
      }

      const fetchedModel: TBaseModel | null =
        await this.fetchRecordInCallerProject(data);

      if (!fetchedModel) {
        throw new NotFoundException(`${model.singularName} not found.`);
      }

      const accessControlIdsWhichUserHasAccessToAsStrings: Array<string> =
        accessControlIdsWhichUserHasAccessTo.map((id: ObjectID) => {
          return id.toString();
        }) || [];

      // Check if the object has any of these access control ids.  if not, then throw an error.
      const modelAccessControl: Array<AccessControlModel> =
        (fetchedModel.getColumnValue(
          modelAccessControlColumnName,
        ) as Array<AccessControlModel>) || [];

      const modelAccessControlNames: Array<string> = [];

      for (const accessControl of modelAccessControl) {
        if (!accessControl.id) {
          continue;
        }

        if (
          accessControlIdsWhichUserHasAccessToAsStrings.includes(
            accessControl.id.toString(),
          )
        ) {
          return;
        }

        const accessControlName: string = accessControl.getColumnValue(
          "name",
        ) as string;

        if (accessControlName) {
          modelAccessControlNames.push(accessControlName);
        }
      }

      let errorString: string = `You do not have permission to ${type.toLowerCase()} this ${
        model.singularName
      }.`;

      if (modelAccessControlNames.length > 0) {
        errorString += ` You need to have one of the following labels: ${modelAccessControlNames.join(
          ", ",
        )}.`;
      } else {
        errorString = ` You do not have permission to ${type.toLowerCase()} ${
          model.singularName
        } without any labels.`;
      }

      throw new NotAuthorizedException(errorString);
    }

    /*
     * A record with no labels of its own, under grants limited to labels:
     * only one whose named records carry them may be written (ReadPermission
     * .addGrantedLabelsToQuery), as only a labelled record carrying one may.
     */
    const grantedLabelIds: Array<ObjectID> = this.getLabelsNarrowingAlone(
      modelType,
      props,
      type,
    );

    if (!data.isRecordFound || grantedLabelIds.length === 0) {
      return;
    }

    const fetchedRecord: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!fetchedRecord) {
      throw new NotFoundException(`${model.singularName} not found.`);
    }

    if (
      !(await this.isRecordKeptByLabelRule({
        record: fetchedRecord,
        isRecordFound: data.isRecordFound,
        narrow: (query: Query<TBaseModel>): Query<TBaseModel> => {
          return ReadPermission.addGrantedLabelsToQuery(
            modelType,
            query,
            grantedLabelIds,
          );
        },
      }))
    ) {
      throw new NotAuthorizedException(
        `You do not have permission to ${type.toLowerCase()} this ${
          model.singularName
        }.`,
      );
    }
  }

  /*
   * Every check of one record by model, for an update or a delete by id
   * (UpdatePermission, DeletePermission), on one read of the record:
   *
   *   - the table: a block with no labels, the operation's grant, and - a
   *     write needs a read - a read grant
   *     (TablePermission.checkTableLevelReadForWrite);
   *   - THE RECORD IS ONE THE CALLER MAY READ, by the read's label grants
   *     and blocks. One they may not read - missing, of another project, or
   *     outside their read - is answered as missing (NotFoundException),
   *     its labels neither weighed nor named;
   *   - then the team's blocks and the grants limited to labels of the
   *     operation itself, which say why a record the caller may read is not
   *     one they may change or delete.
   *
   * A record with no labels of its own is weighed by lookups
   * (`isRecordFound`): one lookup under every rule at once, and the others
   * only when it is refused, to say why. The owners and the parent a record
   * is read through are weighed by the query the operation runs with
   * (BasePermission.addRecordScopeToQuery).
   *
   * `fetchModelWithAccessControlIds` reads the record as root with its
   * labels and its project (the tenant column): a record read without its
   * project is answered as missing to a caller the checks weigh it for
   * (fetchRecordInCallerProject), since whose record it is cannot be told.
   * DatabaseService.findWithAccessControlIds reads it so.
   */
  @CaptureSpan()
  public static async checkRecordByModel<TBaseModel extends BaseModel>(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    updateData?: unknown;
  }): Promise<void> {
    const checked: typeof data = {
      ...data,
      fetchModelWithAccessControlIds: this.fetchOnce(
        data.fetchModelWithAccessControlIds,
      ),
    };

    if (await this.isRecordKeptByEveryRule<TBaseModel>(checked)) {
      return;
    }

    await this.checkAccessControlBlockPermissionByModel<TBaseModel>(checked);
    await this.checkAccessControlPermissionByModel<TBaseModel>(checked);
  }

  /*
   * The table's checks and the record's read rule (checkRecordByModel):
   * throws when the caller may not do the operation on the table at all,
   * NotFoundException when the record is not one they may read. True when
   * the record is kept by every label rule of the read and the operation -
   * nothing else to look at - and false when the operation's own checks
   * are to weigh it, and say why it is refused.
   */
  private static async isRecordKeptByEveryRule<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    updateData?: unknown;
  }): Promise<boolean> {
    const { modelType, props, type } = data;

    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    TablePermission.checkTableLevelBlockPermissions(modelType, props, type);
    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      type,
      data.updateData,
    );

    const operation: RecordOperation = type as RecordOperation;

    if (type !== DatabaseRequestType.Read) {
      TablePermission.checkTableLevelReadForWrite(modelType, props, type);
    }

    const model: TBaseModel = new modelType();
    const operations: Array<RecordOperation> =
      ReadPermission.getNarrowingOperations(operation);

    const grantedLabelIds: Dictionary<Array<ObjectID>> = {};
    const blockedLabelIds: Dictionary<Array<ObjectID>> = {};

    for (const each of operations) {
      // The labels alone: what grants scoped to Owned reach, the query weighs.
      grantedLabelIds[each] = this.getLabelsNarrowingAlone(
        modelType,
        props,
        each,
      );
      blockedLabelIds[each] = ReadPermission.getBlockedLabelIds(
        modelType,
        props,
        each,
      );
    }

    const isNarrowed: boolean = operations.some(
      (each: RecordOperation): boolean => {
        return (
          (grantedLabelIds[each] || []).length > 0 ||
          (blockedLabelIds[each] || []).length > 0
        );
      },
    );

    // No label rule weighs this record: the query the operation runs with does the rest.
    if (!isNarrowed) {
      return true;
    }

    // Every rule of the read and the operation, on a label-less model's rows.
    const narrowByEveryRule: (query: Query<TBaseModel>) => Query<TBaseModel> = (
      query: Query<TBaseModel>,
    ): Query<TBaseModel> => {
      return this.addRecordLabelRulesToQuery(
        modelType,
        query,
        operations.map((each: RecordOperation): Array<ObjectID> => {
          return grantedLabelIds[each] || [];
        }),
        operations.flatMap((each: RecordOperation): Array<ObjectID> => {
          return blockedLabelIds[each] || [];
        }),
      );
    };

    if (!model.getAccessControlColumn()) {
      /*
       * A label-less record nobody can look up here, or one whose model
       * names no labelled record the rules could follow, is weighed by that
       * query too: nothing is read for it.
       */
      if (!data.isRecordFound) {
        return true;
      }

      const probeId: string = ObjectID.getZeroObjectID().toString();
      const probe: Query<TBaseModel> = narrowByEveryRule({
        _id: probeId,
      } as Query<TBaseModel>);

      if (
        Object.keys(probe).length === 1 &&
        (probe as Dictionary<unknown>)["_id"] === probeId
      ) {
        return true;
      }
    }

    const record: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!record) {
      throw new NotFoundException(`${model.singularName} not found.`);
    }

    const readGrants: Array<ObjectID> =
      grantedLabelIds[DatabaseRequestType.Read] || [];
    const readBlocks: Array<ObjectID> =
      blockedLabelIds[DatabaseRequestType.Read] || [];

    // A record with labels of its own: weighed by them, with no lookup.
    if (model.getAccessControlColumn()) {
      const recordLabelIds: Array<string> = this.getRecordLabelIds(record);

      const isReadable: boolean =
        (readGrants.length === 0 ||
          readGrants.some((labelId: ObjectID): boolean => {
            return recordLabelIds.includes(labelId.toString());
          })) &&
        !readBlocks.some((labelId: ObjectID): boolean => {
          return recordLabelIds.includes(labelId.toString());
        });

      if (!isReadable) {
        throw new NotFoundException(`${model.singularName} not found.`);
      }

      // The operation's own checks weigh the same labels, read already.
      return false;
    }

    // One lookup under every rule at once: the read's and the operation's.
    if (
      await this.isRecordKeptByLabelRule({
        record: record,
        isRecordFound: data.isRecordFound,
        narrow: narrowByEveryRule,
      })
    ) {
      return true;
    }

    // Refused: a record the caller may not read is answered as missing.
    if (
      !(await this.isRecordKeptByLabelRule({
        record: record,
        isRecordFound: data.isRecordFound,
        narrow: (query: Query<TBaseModel>): Query<TBaseModel> => {
          return this.addRecordLabelRulesToQuery(
            modelType,
            query,
            [readGrants],
            readBlocks,
          );
        },
      }))
    ) {
      throw new NotFoundException(`${model.singularName} not found.`);
    }

    // One they may read: the operation's own checks say why it is refused.
    return false;
  }

  /*
   * A label-less model's label rule over several operations' label lists:
   * each grant's labels a condition of its own, every block's labels in one.
   */
  private static addRecordLabelRulesToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    grantedLabelLists: Array<Array<ObjectID>>,
    blockedLabelIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    for (const labelIds of grantedLabelLists) {
      query = ReadPermission.addGrantedLabelsToQuery(
        modelType,
        query,
        labelIds,
      );
    }

    return ReadPermission.addBlockedLabelsToQuery(
      modelType,
      query,
      ArrayUtil.removeDuplicatesFromObjectIDArray(blockedLabelIds),
    );
  }

  // The ids of the labels a record read with its labels carries.
  private static getRecordLabelIds<TBaseModel extends BaseModel>(
    record: TBaseModel,
  ): Array<string> {
    const accessControlColumn: string | null = record.getAccessControlColumn();

    if (!accessControlColumn) {
      return [];
    }

    return (
      (record.getColumnValue(accessControlColumn) as
        | Array<AccessControlModel>
        | undefined) || []
    )
      .map((label: AccessControlModel): string => {
        return label.id ? label.id.toString() : "";
      })
      .filter((labelId: string): boolean => {
        return labelId.length > 0;
      });
  }

  // `fetch`, read once however often it is asked.
  private static fetchOnce<TBaseModel extends BaseModel>(
    fetch: () => Promise<TBaseModel | null>,
  ): () => Promise<TBaseModel | null> {
    let fetched: Promise<TBaseModel | null> | null = null;

    return (): Promise<TBaseModel | null> => {
      if (!fetched) {
        fetched = fetch();
      }

      return fetched;
    };
  }

  /*
   * The record a check by model is about, as `fetchModelWithAccessControlIds`
   * reads it - or null when it is not a record of the project the caller
   * acts in: such a record is answered as a missing one, and its labels are
   * never weighed or named in a refusal. The record is read with its
   * project (DatabaseService.findWithAccessControlIds reads it in the
   * caller's project already); one read without it is answered as missing
   * too, for its project cannot be told.
   */
  private static async fetchRecordInCallerProject<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    props: DatabaseCommonInteractionProps;
  }): Promise<TBaseModel | null> {
    const record: TBaseModel | null =
      await data.fetchModelWithAccessControlIds();

    if (!record || !data.props.tenantId || data.props.isMultiTenantRequest) {
      return record;
    }

    const tenantColumn: string | null = record.getTenantColumn();

    if (!tenantColumn) {
      return record;
    }

    const recordProjectId: unknown = (record as unknown as Dictionary<unknown>)[
      tenantColumn
    ];

    if (recordProjectId === undefined || recordProjectId === null) {
      return null;
    }

    return String(recordProjectId).toLowerCase() ===
      data.props.tenantId.toString().toLowerCase()
      ? record
      : null;
  }

  /*
   * Whether the label rule `narrow` adds to a query keeps `record`, a record
   * with no labels of its own that carries those of the records it names
   * (ReadPermission.addLabelBlockToQuery, addLabelGrantToQuery). When the
   * rule adds nothing to a query by the record's id - its model names no
   * labelled record - the record is kept without a lookup. A caller with no
   * `isRecordFound` leaves the rule to the query it runs the operation
   * with, which applies it (BasePermission.addRecordScopeToQuery).
   */
  private static async isRecordKeptByLabelRule<
    TBaseModel extends BaseModel,
  >(data: {
    record: TBaseModel;
    isRecordFound?:
      | ((query: Query<TBaseModel>) => Promise<boolean>)
      | undefined;
    narrow: (query: Query<TBaseModel>) => Query<TBaseModel>;
  }): Promise<boolean> {
    if (!data.isRecordFound || !data.record.id) {
      return true;
    }

    const recordId: string = data.record.id.toString();

    const narrowed: Query<TBaseModel> = data.narrow({
      _id: recordId,
    } as Query<TBaseModel>);

    if (
      Object.keys(narrowed).length === 1 &&
      (narrowed as Dictionary<unknown>)["_id"] === recordId
    ) {
      return true;
    }

    return await data.isRecordFound(narrowed);
  }

  /*
   * A labelled model's records narrowed by one operation's own grants
   * limited to labels. The record rule narrows a write by its read's grants
   * as well, and so asks the two halves itself
   * (BasePermission.addRecordScopeToQuery: getLabelGrantsForQuery per
   * operation, then addGrantToQuery).
   */
  @CaptureSpan()
  public static async addAccessControlIdsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    if (!new modelType().getAccessControlColumn()) {
      return query;
    }

    for (const grant of this.getLabelGrantsForQuery(
      modelType,
      query,
      select,
      props,
      type,
    )) {
      query = await this.addGrantToQuery(modelType, query, grant, props);
    }

    return query;
  }

  /*
   * Keeps, of a labelled model's records, those carrying one of
   * `accessControlIds` - the labels a grant is limited to
   * (addAccessControlIdsToQuery). Nothing for no labels, a grant over the
   * whole project, or for a model that carries no labels. Asked again with
   * another list, the records must carry one label of each.
   */
  public static addLabelIdsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    accessControlIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    const model: BaseModel = new modelType();

    // if the model has access control column, then add the access control labels to the query.
    if (model.getAccessControlColumn()) {
      if (accessControlIds.length > 0) {
        const accessControlColumn: string =
          model.getAccessControlColumn() as string;
        const existingFilter: unknown = (query as any)[accessControlColumn];

        if (existingFilter === undefined || existingFilter === null) {
          (query as any)[accessControlColumn] = accessControlIds;
        } else {
          /*
           * The caller already filters on the access-control column (e.g.
           * "show monitors with label X"). Overwriting that filter with the
           * permitted set would silently widen it to "any permitted label".
           * Both predicates must hold independently — a record with labels
           * {X, Y} (X requested, Y permitted) must match even when X itself
           * is not permitted — so keep the caller's filter on the relation
           * key and AND the permitted-set predicate onto _id as a join-table
           * subquery.
           */
          const manyToManyMeta: {
            joinTableName: string;
            ownerColumnName: string;
            relationColumnName: string;
          } | null = QueryUtil.getManyToManyRelationMetadata(
            modelType,
            accessControlColumn,
          );

          if (manyToManyMeta) {
            (query as any)._id = combineWithPrivacyClause(
              (query as any)._id,
              QueryHelper.anyOfEntitiesInManyToMany({
                values: accessControlIds,
                joinTableName: manyToManyMeta.joinTableName,
                ownerColumnName: manyToManyMeta.ownerColumnName,
                relationColumnName: manyToManyMeta.relationColumnName,
              }),
            );
          } else {
            /*
             * Join metadata unavailable — fail closed to the permitted set.
             * The caller's filter is dropped, but access never widens: a
             * list already there (another grant's labels, asked first) keeps
             * only the labels on both.
             */
            const permittedIds: Array<ObjectID> = Array.isArray(existingFilter)
              ? AccessControlPermission.getLabelsOnBoth(
                  existingFilter as Array<ObjectID>,
                  accessControlIds,
                )
              : accessControlIds;

            if (permittedIds.length > 0) {
              (query as any)[accessControlColumn] = permittedIds;
            } else {
              // No label on both: no record carries one of each.
              (query as any)._id = QueryHelper.equalTo(
                ObjectID.getZeroObjectID().toString(),
              );
            }
          }
        }
      }
    }

    return query;
  }

  // The labels of `labelIds` that are also in `within`.
  private static getLabelsOnBoth(
    labelIds: Array<ObjectID>,
    within: Array<ObjectID>,
  ): Array<ObjectID> {
    const withinIds: Set<string> = new Set<string>(
      within.map((labelId: ObjectID): string => {
        return labelId.toString();
      }),
    );

    return labelIds.filter((labelId: ObjectID): boolean => {
      return withinIds.has(labelId.toString());
    });
  }

  /*
   * What the caller's grants for an operation on a model reach of its
   * records (LabelGrant): nothing to narrow when one of them reaches the
   * whole project, or when none is limited to labels; otherwise the labels
   * those are limited to, and the teams of the grants scoped to Owned beside
   * them. The grants are the rows the table check counts
   * (TablePermission.getGrantingPermissions): the model's own permissions
   * for the operation and, on an operational resource, its
   * *AllOperationalResources wildcard - so a wildcard limited to labels
   * narrows the records to those labels, as one of the model's own
   * permissions limited to them does, and a wildcard over the whole
   * project reaches every record.
   */
  public static getLabelGrantForModel(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    context?: AccessControlPermissionContext,
  ): LabelGrant {
    context = context ?? this.buildPermissionContext(props);

    return this.getGrantByPermissions(
      modelType,
      type,
      TablePermission.getGrantingPermissions(
        modelType,
        type,
        props,
        context.held,
      ),
      context,
    );
  }

  /*
   * The labels the caller's grants for an operation on a model are limited
   * to (getLabelGrantForModel): none when they reach the whole project, or
   * when none is limited to labels. Grants scoped to Owned beside them reach
   * the records the caller or those grants' teams own as well: a check of
   * one record by its labels alone (checkRecordByModel) leaves those to the
   * query the operation runs with (getLabelsNarrowingAlone).
   */
  @CaptureSpan()
  public static getAccessControlIdsForModel(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    context?: AccessControlPermissionContext,
  ): Array<ObjectID> {
    return this.getLabelGrantForModel(modelType, props, type, context).labelIds;
  }

  /*
   * The labels a record must carry for the caller's grants of an operation
   * to reach it, decided by its labels alone: those of getLabelGrantForModel
   * when no grant scoped to Owned stands beside them, and none when one does
   * - the record may be reached as one the caller owns, which the query the
   * operation runs with weighs (BasePermission.addRecordScopeToQuery), as it
   * weighs a grant scoped to Owned on its own.
   */
  public static getLabelsNarrowingAlone(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<ObjectID> {
    if (props.isRoot || props.isMasterAdmin) {
      return [];
    }

    const grant: LabelGrant = this.getLabelGrantForModel(
      modelType,
      props,
      type,
    );

    return grant.ownedTeamIds ? [] : grant.labelIds;
  }

  /*
   * The permissions whose allow rows grant an operation on one column: the
   * column's own list for it and, for a column that lets in everyone its
   * table does, the table's wildcard (HeldPermissionsUtil.getColumnWildcard)
   * - as the column check counts them (ColumnPermission).
   */
  private static getColumnGrantingPermissions(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
    columnPermissions: Array<Permission>,
    held: HeldPermissions,
  ): Array<Permission> {
    return HeldPermissionsUtil.getGrantingPermissions(held, {
      modelPermissions: columnPermissions,
      wildcard: HeldPermissionsUtil.getColumnWildcard({
        isOperationalResource: new modelType().isOperationalResource,
        operation: type,
        tablePermissions: TablePermission.getTablePermission(modelType, type),
        columnPermissions: columnPermissions,
      }),
    });
  }

  /*
   * The permissions of each column the query names or selects that has a
   * list of its own for the operation, as the column check counts them
   * (getColumnGrantingPermissions).
   */
  private static getColumnGrantingPermissionLists<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    type: DatabaseRequestType,
    held: HeldPermissions,
  ): Array<Array<Permission>> {
    const model: BaseModel = new modelType();

    let columns: Array<string> = Object.keys(query);

    if (select) {
      columns = [...columns, ...Object.keys(select)];
    }

    const columnAccessControlDictionary: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const lists: Array<Array<Permission>> = [];

    for (const column of new Set<string>(columns)) {
      const accessControl: ColumnAccessControl | null =
        columnAccessControlDictionary[column] || null;

      if (!accessControl) {
        continue;
      }

      const columnPermissions: Array<Permission> | undefined =
        type === DatabaseRequestType.Read
          ? accessControl.read
          : type === DatabaseRequestType.Create
            ? accessControl.create
            : type === DatabaseRequestType.Update
              ? accessControl.update
              : undefined;

      if (!columnPermissions) {
        continue;
      }

      lists.push(
        this.getColumnGrantingPermissions(
          modelType,
          type,
          columnPermissions,
          held,
        ),
      );
    }

    return lists;
  }

  /*
   * THE GRANTS A LABELLED MODEL'S RECORDS ARE NARROWED BY, ONE CONDITION
   * EACH (LabelGrant): the operation's own grants, and, for each column the
   * query names or selects whose permissions are granted limited to labels,
   * those. A record must meet each condition (addGrantToQuery, asked once
   * per grant): a column the caller may read only on some records reaches no
   * other record. Read as one list - every label of every list
   * (getAccessControlIdsForQuery) - a column's grant widened the read
   * instead: a member who reads the monitors carrying one label, and may
   * change the ones carrying another, read the second label's monitors
   * whole by selecting a column only editors read. A grant that narrows
   * nothing is left out.
   */
  public static getLabelGrantsForQuery<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<LabelGrant> {
    const context: AccessControlPermissionContext =
      this.buildPermissionContext(props);

    return AccessControlPermission.getGrantsToNarrowBy([
      this.getLabelGrantForModel(modelType, props, type, context),
      ...this.getColumnGrantingPermissionLists(
        modelType,
        query,
        select,
        type,
        context.held,
      ).map((permissions: Array<Permission>): LabelGrant => {
        return this.getGrantByPermissions(
          modelType,
          type,
          permissions,
          context,
        );
      }),
    ]);
  }

  /*
   * Every label the grants of getLabelGrantsForQuery are limited to, as one
   * list: whether the caller's grants are limited to labels at all, not the
   * records they reach.
   */
  @CaptureSpan()
  public static getAccessControlIdsForQuery<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<ObjectID> {
    // Build the permission context once — not per column.
    const context: AccessControlPermissionContext =
      this.buildPermissionContext(props);

    const labelIds: Array<ObjectID> = [
      ...this.getLabelGrantForModel(modelType, props, type, context).labelIds,
      ...this.getColumnGrantingPermissionLists(
        modelType,
        query,
        select,
        type,
        context.held,
      ).flatMap((permissions: Array<Permission>): Array<ObjectID> => {
        return this.getGrantByPermissions(modelType, type, permissions, context)
          .labelIds;
      }),
    ];

    // get distinct labelIds
    return ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);
  }

  private static buildPermissionContext(
    props: DatabaseCommonInteractionProps,
  ): AccessControlPermissionContext {
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    return {
      nonAccessControlPermissions:
        PermissionHelper.getNonAccessControlPermissions(userPermissions),
      accessControlPermissions:
        PermissionHelper.getAccessControlPermissions(userPermissions),
      ownedPermissions: userPermissions.filter(
        (row: UserPermission): boolean => {
          return (
            row.scope === PermissionScope.Owned &&
            PermissionHelper.isScopeApplicable(row.permission)
          );
        },
      ),
      // What the table check holds the caller to, read the same way.
      held: TablePermission.getHeldPermissions(props),
    };
  }

  /*
   * What the allow rows of `permissions` reach of a model's records, for
   * `type` (see LabelGrant): nothing to narrow when one of them reaches the
   * whole project, or when none is limited to labels; otherwise the labels
   * of the rows limited to them and, when rows scoped to Owned stand beside
   * them, those rows' teams (OwnedScopePermission.getTeamIdsOfRows) - or
   * nothing to narrow, when the Owned scope narrows nothing here
   * (OwnedScopePermission.narrowsRecords): such a row reaches every record,
   * as it does on its own.
   */
  private static getGrantByPermissions(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
    permissions: Array<Permission>,
    context: AccessControlPermissionContext,
  ): LabelGrant {
    const reachesEverything: LabelGrant = { labelIds: [], ownedTeamIds: null };

    if (
      PermissionHelper.doesPermissionsIntersect(
        permissions,
        context.nonAccessControlPermissions,
      )
    ) {
      return reachesEverything; // if this is intersecting, then return empty array. We dont need to check for access control.
    }

    let labelIds: Array<ObjectID> = [];

    for (const permission of permissions) {
      for (const accessControlPermission of context.accessControlPermissions) {
        if (
          accessControlPermission.permission === permission &&
          accessControlPermission.labelIds.length > 0
        ) {
          labelIds = [...labelIds, ...accessControlPermission.labelIds];
        }
      }
    }

    // remove duplicates
    labelIds = ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);

    if (labelIds.length === 0) {
      return reachesEverything;
    }

    const ownedRows: Array<UserPermission> = context.ownedPermissions.filter(
      (row: UserPermission): boolean => {
        return permissions.includes(row.permission);
      },
    );

    if (ownedRows.length === 0) {
      return { labelIds: labelIds, ownedTeamIds: null };
    }

    if (!OwnedScopePermission.narrowsRecords(modelType, type)) {
      return reachesEverything;
    }

    return {
      labelIds: labelIds,
      ownedTeamIds: OwnedScopePermission.getTeamIdsOfRows(ownedRows),
    };
  }

  /*
   * Of grants to narrow a model's records by, each a condition of its own
   * (LabelGrant), the ones that add something: a grant whose records are
   * all among another's adds nothing to that other's condition - its labels
   * are all the other's, and what it owns (if anything) the other reaches
   * too - so only the narrower is kept; of two that reach the same records,
   * the first. Grants that narrow nothing are left out.
   */
  public static getGrantsToNarrowBy(
    grants: Array<LabelGrant>,
  ): Array<LabelGrant> {
    const narrowing: Array<LabelGrant> = grants.filter(
      (grant: LabelGrant): boolean => {
        return grant.labelIds.length > 0;
      },
    );

    return narrowing.filter((grant: LabelGrant, index: number): boolean => {
      return !narrowing.some(
        (other: LabelGrant, otherIndex: number): boolean => {
          if (
            otherIndex === index ||
            !AccessControlPermission.isGrantWithin(other, grant)
          ) {
            return false;
          }

          return (
            !AccessControlPermission.isGrantWithin(grant, other) ||
            otherIndex < index
          );
        },
      );
    });
  }

  // Whether every record `grant` reaches is one `within` reaches.
  public static isGrantWithin(grant: LabelGrant, within: LabelGrant): boolean {
    const withinLabels: Set<string> = new Set<string>(
      within.labelIds.map((labelId: ObjectID): string => {
        return labelId.toString().toLowerCase();
      }),
    );

    const labelsWithin: boolean = grant.labelIds.every(
      (labelId: ObjectID): boolean => {
        return withinLabels.has(labelId.toString().toLowerCase());
      },
    );

    if (!labelsWithin || grant.ownedTeamIds === null) {
      return labelsWithin;
    }

    return (
      within.ownedTeamIds !== null &&
      OwnedScopePermission.isTeamListWithin(
        grant.ownedTeamIds,
        within.ownedTeamIds,
      )
    );
  }

  /*
   * Narrows `query` to the records `grant` reaches (LabelGrant): the labels
   * alone as addLabelIdsToQuery (a model that carries labels) and
   * ReadPermission.addGrantedLabelsToQuery (one that does not) keep them,
   * or - beside grants scoped to Owned - the records carrying one of the
   * labels and the records the caller or the grant's teams own, in one
   * condition on the record's id (OwnedScopePermission
   * .getOwnedRecordsCondition). A label-less model whose rows name no
   * labelled record is about none of them: the labels reach every row, and
   * nothing is narrowed. The caller's own filters stay as sent.
   */
  public static async addGrantToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    grant: LabelGrant,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    if (grant.labelIds.length === 0) {
      return query;
    }

    const accessControlColumn: string | null =
      new modelType().getAccessControlColumn();

    if (!grant.ownedTeamIds) {
      return accessControlColumn
        ? AccessControlPermission.addLabelIdsToQuery(
            modelType,
            query,
            grant.labelIds,
          )
        : ReadPermission.addGrantedLabelsToQuery(
            modelType,
            query,
            grant.labelIds,
          );
    }

    let labelCondition: FindWhereProperty<any> | null = null;

    if (accessControlColumn) {
      const labelsMeta: ReturnType<
        typeof QueryUtil.getManyToManyRelationMetadata
      > = QueryUtil.getManyToManyRelationMetadata(
        modelType,
        accessControlColumn,
      );

      // A model whose labels cannot be followed is misconfigured: refused.
      if (!labelsMeta) {
        throw new BadDataException(
          "Cannot apply read label restrictions without access-control relation metadata.",
        );
      }

      labelCondition = QueryHelper.anyOfEntitiesInManyToMany({
        values: grant.labelIds,
        ...labelsMeta,
      });
    } else {
      labelCondition = ReadPermission.getGrantedLabelsCondition(
        modelType,
        grant.labelIds,
      );

      if (!labelCondition) {
        return query;
      }
    }

    const owned: {
      columnName: string | null;
      condition: FindWhereProperty<any>;
    } = await OwnedScopePermission.getOwnedRecordsCondition(
      modelType,
      props,
      grant.ownedTeamIds,
    );

    const idQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
      _id: query._id,
    } as Query<TBaseModel>);

    (query as any)._id = combineWithPrivacyClause(
      ReadPermission.getSupportedFilter(idQuery._id),
      QueryHelper.anyOfConditions([
        { condition: labelCondition },
        {
          columnName: owned.columnName || undefined,
          condition: owned.condition,
        },
      ]),
    );

    return query;
  }
}
