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
import { FindWhereProperty } from "../../../../Types/BaseDatabase/Query";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import FilterGroups from "../../../../Types/BaseDatabase/FilterGroups";
import OwnedScopePermission from "./OwnedScopePermission";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import LabelAccess, {
  LabelGrant,
  LabelRefusal,
  LabelRuleRows,
  LabelVerdict,
} from "../../../../Types/LabelAccess/LabelAccess";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import CallerPlan from "../../../Utils/Billing/CallerPlan";
import Dictionary from "../../../../Types/Dictionary";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import RelationReadersUtil from "../../../../Types/Database/RelationReadersUtil";

/*
 * Built once per invocation and threaded through the per-column loop; never
 * cached on props or module scope (the multi-tenant path re-enters with
 * different per-tenant props and must rebuild fresh).
 */
type AccessControlPermissionContext = {
  // The caller's rows as the label rule reads them (LabelAccess.readRows).
  labelRows: LabelRuleRows;
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
 *
 * Worked out by the rule the Dashboard locks by too (Types/LabelAccess
 * /LabelAccess, #11259).
 */
export type { LabelGrant };

/*
 * A column a caller reads on fewer of a labelled model's records than they
 * read the model itself (AccessControlPermission.getColumnsKeptToLabels),
 * and the grant that says on which.
 */
export interface ColumnKeptToLabels {
  column: string;
  grant: LabelGrant;
}

/*
 * The columns of the records a relation reaches that a read selects
 * through it and the caller reads there on some labels only
 * (AccessControlPermission.getRelatedColumnsKeptToLabels, #11438).
 */
export interface RelatedColumnsKeptToLabels {
  // The relation the read selects them through: "probe".
  relation: string;
  relatedModelType: { new (): BaseModel };
  kept: Array<ColumnKeptToLabels>;
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

    /*
     * The first block whose labels the record carries takes the operation
     * away on it (LabelAccess.getBlockOnRecord): the rule the Dashboard
     * locks the record's changes by too.
     */
    const blockOnRecord: UserPermission | null = LabelAccess.getBlockOnRecord(
      this.getRecordLabelIds(fetchedModel),
      blockPermissionsBelongToThisModel,
    );

    if (blockOnRecord) {
      throw new NotAuthorizedException(
        `You are not authorized to ${type.toLowerCase()} this ${
          fetchedModel.singularName
        } because ${
          blockOnRecord.permission
        } is in your team's permission block list.`,
      );
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

      /*
       * The record carries one of the labels the grant is limited to, or it
       * is refused (LabelAccess.carriesAny): the rule the Dashboard locks
       * the record's changes by too.
       */
      if (
        LabelAccess.carriesAny(
          this.getRecordLabelIds(fetchedModel),
          accessControlIdsWhichUserHasAccessTo,
        )
      ) {
        return;
      }

      const modelAccessControl: Array<AccessControlModel> =
        (fetchedModel.getColumnValue(
          modelAccessControlColumnName,
        ) as Array<AccessControlModel>) || [];

      const modelAccessControlNames: Array<string> = [];

      for (const accessControl of modelAccessControl) {
        if (!accessControl.id) {
          continue;
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
        errorString = `You do not have permission to ${type.toLowerCase()} ${
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

    /*
     * A record with labels of its own: weighed by them, with no lookup, by
     * the rule the Dashboard locks the record's changes by
     * (LabelAccess.weighLabelledRecord). The grants scoped to Owned beside
     * the labels are left to the query the operation runs with: the labels
     * here are the ones that decide alone (getLabelsNarrowingAlone).
     */
    if (model.getAccessControlColumn()) {
      const verdict: LabelVerdict = LabelAccess.weighLabelledRecord({
        recordLabelIds: this.getRecordLabelIds(record),
        read: {
          grant: { labelIds: readGrants, ownedTeamIds: null },
          blockedLabelIds: readBlocks,
          blockRows: [],
        },
        operation:
          type === DatabaseRequestType.Read
            ? undefined
            : {
                grant: {
                  labelIds: grantedLabelIds[operation] || [],
                  ownedTeamIds: null,
                },
                blockedLabelIds: blockedLabelIds[operation] || [],
                blockRows: [],
              },
      });

      if (verdict.refusal === LabelRefusal.NotReadable) {
        throw new NotFoundException(`${model.singularName} not found.`);
      }

      if (verdict.isAllowed) {
        return true;
      }

      // The operation's own checks say why, from the same labels read already.
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
   *
   * THE CONDITION IS ON THE RECORD'S OWN ID (getCarriesLabelsCondition), as
   * a block with labels is (ReadPermission.addBlockedLabelsToQuery) and as
   * labels beside grants scoped to Owned are (addGrantToQuery): the records
   * the label join table links to one of the labels, the label not deleted
   * - the very records a filter through the labels relation matched. It
   * used to be that filter, `labels: [permitted ids]`: a to-many join in
   * the WHERE, which can decide which records match, so a page of a
   * label-limited reader's list could not take its ids from the table
   * alone (PagedFind) and was paged by TypeORM's SELECT DISTINCT over every
   * matching record times its labels times every relation the list selects,
   * on every live refresh; its count, by a DISTINCT over the same join. With
   * the condition on the id, the read joins its labels only to select them,
   * and pages and counts as an unrestricted reader's does.
   *
   * The filter also trimmed the labels a read returned: TypeORM joins a
   * relation the read selects and filters through once, so each record came
   * back with only the permitted labels it carries. A record is now read
   * with every label it carries, as for any other reader - every member of
   * a project may read its labels (ProjectUser) - and a form that saves the
   * labels it read keeps the others on the record.
   *
   * The caller's own filter on the labels stays as sent, beside it: a
   * record with labels {X, Y} matches "label X" for a reader limited to Y.
   *
   * Without the join table's names (no database: a test of the permission
   * checks alone) the relation itself narrows the read, as it used to.
   */
  public static addLabelIdsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    accessControlIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    const accessControlColumn: string | null =
      new modelType().getAccessControlColumn();

    if (!accessControlColumn || accessControlIds.length === 0) {
      return query;
    }

    const carriesLabels: FindWhereProperty<any> | null =
      AccessControlPermission.getCarriesLabelsCondition(
        modelType,
        accessControlIds,
      );

    if (carriesLabels) {
      /*
       * The id's own filter serialized first, as the block rule does: what
       * QueryUtil turns into an operator (an ObjectID, Includes, NotEqual)
       * is not turned once it is inside And().
       */
      const idQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
        _id: query._id,
      } as Query<TBaseModel>);

      (query as any)._id = combineWithPrivacyClause(
        ReadPermission.getSupportedFilter(idQuery._id),
        carriesLabels,
      );

      return query;
    }

    const existingFilter: unknown = (query as any)[accessControlColumn];

    if (existingFilter === undefined || existingFilter === null) {
      (query as any)[accessControlColumn] = accessControlIds;
      return query;
    }

    /*
     * The caller filters on the labels too, and without the join table the
     * two cannot both be asked: fail closed to the permitted set. The
     * caller's filter is dropped, but access never widens: a list already
     * there (another grant's labels, asked first) keeps only the labels on
     * both.
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

    return query;
  }

  /*
   * THE RECORDS OF A LABELLED MODEL CARRYING ONE OF `labelIds`, as a
   * condition on the record's id: linked to one of them through the
   * model's label join table, the label there and not deleted - the
   * records a filter through the labels relation itself matches, since
   * that join leaves deleted labels out (QueryUtil.getLinkedToAnyCondition).
   * One uncorrelated subquery, so it reads the same in a SELECT, an UPDATE
   * and a DELETE, and joins nothing into the read. Null for a model that
   * carries no labels, or when the join table cannot be followed (no
   * database).
   */
  public static getCarriesLabelsCondition(
    modelType: { new (): BaseModel },
    labelIds: Array<ObjectID>,
  ): FindWhereProperty<any> | null {
    const accessControlColumn: string | null =
      new modelType().getAccessControlColumn();

    if (!accessControlColumn) {
      return null;
    }

    return QueryUtil.getLinkedToAnyCondition(
      modelType,
      accessControlColumn,
      labelIds,
    ) as FindWhereProperty<any> | null;
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

    /*
     * The columns the query compares - a free-text search's fields and a
     * filter group's columns among them: a match on a column read only on
     * some labels says what it holds on the others, as a filter by its name
     * does (#11259).
     */
    let columns: Array<string> =
      AccessControlPermission.getColumnsNamedByQuery(query);

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
   * THE COLUMNS A CALLER READS ON FEWER OF A LABELLED MODEL'S RECORDS THAN
   * THE MODEL ITSELF (#11259), of those `select` names: a column only those
   * who may change the model read - a monitor's secret keys, a runner's key,
   * a network device's SNMP credentials - for a caller whose grant to read
   * it is limited to labels, and whose read of the model reaches further. A
   * Viewer over the whole project who is a Project Member on the monitors
   * labelled Payments reads every monitor, and the keys only of the
   * Payments monitors.
   *
   * Selected, such a column used to narrow the whole read to its labels
   * (getLabelGrantsForQuery): the Dashboard asks for the keys of every
   * monitor it opens, so the reader could open none of the monitors outside
   * Payments, and a list that selects a runner's key showed only the
   * labelled runners - holding the Project Member role took away what the
   * Viewer role let them read. A read by DatabaseService now reads every
   * record its own grants reach and leaves such a column out of the records
   * the column's grant does not reach (withholdColumnsKeptToLabels), as a
   * column kept to its owners is left out of the records the caller does
   * not own (OwnedScopePermission.withholdColumnsKeptToOwners).
   *
   * What the column holds is never read through another way: a filter on
   * it still reaches only the records it is read on (the query's columns
   * narrow as before), and an order by it is refused
   * (checkSortOnColumnsKeptToLabels) - a match or an order is read one guess
   * at a time.
   *
   * None for root and a master admin, a model that carries no labels, and a
   * read across projects, whose rows are of several projects, each weighed
   * by its own project's grants: getColumnsKeptToLabelsByProject works such
   * a read out a project at a time (#11438).
   */
  public static getColumnsKeptToLabels<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    select: Select<TBaseModel> | null | undefined,
    props: DatabaseCommonInteractionProps,
  ): Array<ColumnKeptToLabels> {
    if (
      !select ||
      props.isRoot ||
      props.isMasterAdmin ||
      !props.tenantId ||
      props.isMultiTenantRequest ||
      !new modelType().getAccessControlColumn()
    ) {
      return [];
    }

    const selected: Array<string> = Object.keys(select).filter(
      (column: string): boolean => {
        // A relation's columns are its own model's to weigh.
        return (select as Dictionary<unknown>)[column] === true;
      },
    );

    if (selected.length === 0) {
      return [];
    }

    const context: AccessControlPermissionContext =
      this.buildPermissionContext(props);

    const readGrant: LabelGrant = this.getLabelGrantForModel(
      modelType,
      props,
      DatabaseRequestType.Read,
      context,
    );

    const columnAccessControl: Dictionary<ColumnAccessControl> =
      new modelType().getColumnAccessControlForAllColumns();

    const kept: Array<ColumnKeptToLabels> = [];

    for (const column of selected) {
      const readPermissions: Array<Permission> | undefined =
        columnAccessControl[column]?.read;

      if (!readPermissions || readPermissions.length === 0) {
        continue;
      }

      const grant: LabelGrant = this.getGrantByPermissions(
        modelType,
        DatabaseRequestType.Read,
        this.getColumnGrantingPermissions(
          modelType,
          DatabaseRequestType.Read,
          readPermissions,
          context.held,
        ),
        context,
      );

      // Read wherever the model is, or on no record the read does not keep to already.
      if (
        grant.labelIds.length === 0 ||
        (readGrant.labelIds.length > 0 &&
          AccessControlPermission.isGrantWithin(readGrant, grant))
      ) {
        continue;
      }

      kept.push({ column: column, grant: grant });
    }

    return kept;
  }

  /*
   * THE COLUMNS KEPT TO LABELS OF A READ ACROSS PROJECTS (#11438), by
   * project: getColumnsKeptToLabels with each of the caller's projects' own
   * rows (CallerPlan.inProjectWithoutPlan), as TenantPermission narrows each
   * project's query with them. Such a read no longer narrows a project's
   * records by a column read there on some labels only: it reads every
   * record each project's grants reach, and leaves the column out of the
   * rows of that project its grant there does not reach
   * (withholdColumnsKeptToLabelsByProject). Projects that keep no column
   * are left out. Empty for anything but a read across projects of a
   * labelled model by a person or a key.
   */
  public static getColumnsKeptToLabelsByProject<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    select: Select<TBaseModel> | null | undefined,
    props: DatabaseCommonInteractionProps,
  ): Map<string, Array<ColumnKeptToLabels>> {
    const byProject: Map<string, Array<ColumnKeptToLabels>> = new Map<
      string,
      Array<ColumnKeptToLabels>
    >();

    if (
      !select ||
      props.isRoot ||
      props.isMasterAdmin ||
      !props.isMultiTenantRequest ||
      !new modelType().getAccessControlColumn()
    ) {
      return byProject;
    }

    for (const projectId of props.userGlobalAccessPermission?.projectIds ||
      []) {
      const kept: Array<ColumnKeptToLabels> =
        AccessControlPermission.getColumnsKeptToLabels(
          modelType,
          select,
          CallerPlan.inProjectWithoutPlan(props, projectId),
        );

      if (kept.length > 0) {
        byProject.set(LabelAccess.readId(projectId), kept);
      }
    }

    return byProject;
  }

  /*
   * withholdColumnsKeptToLabels for a read across projects (#11438): each
   * row's columns kept to labels in its own project left out where that
   * project's grant does not reach the row, a project at a time. A row read
   * without its project - which cannot be told whose grants weigh it - is
   * left without every column kept in any project: never more than the
   * caller may read.
   */
  public static async withholdColumnsKeptToLabelsByProject<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    rows: Array<TBaseModel>;
    keptByProject: ReadonlyMap<string, ReadonlyArray<ColumnKeptToLabels>>;
    props: DatabaseCommonInteractionProps;
    // The ids, in lower case, of the rows a query finds.
    findIds: (query: Query<TBaseModel>) => Promise<Array<string>>;
  }): Promise<Array<TBaseModel>> {
    if (data.rows.length === 0 || data.keptByProject.size === 0) {
      return data.rows;
    }

    const tenantColumn: string | null = new data.modelType().getTenantColumn();

    const everyKept: Set<string> = new Set<string>();

    for (const kept of data.keptByProject.values()) {
      for (const column of kept) {
        everyKept.add(column.column);
      }
    }

    const rowsByProject: Map<string, Array<TBaseModel>> = new Map<
      string,
      Array<TBaseModel>
    >();

    for (const row of data.rows) {
      const projectId: string = tenantColumn
        ? LabelAccess.readId(
            (row as unknown as Dictionary<unknown>)[tenantColumn],
          )
        : "";

      if (!projectId) {
        for (const column of everyKept) {
          (row as unknown as Dictionary<unknown>)[column] = undefined;
        }

        continue;
      }

      const projectRows: Array<TBaseModel> = rowsByProject.get(projectId) || [];
      projectRows.push(row);
      rowsByProject.set(projectId, projectRows);
    }

    for (const [projectId, projectRows] of rowsByProject.entries()) {
      const kept: ReadonlyArray<ColumnKeptToLabels> | undefined =
        data.keptByProject.get(projectId);

      if (!kept || kept.length === 0) {
        continue;
      }

      await AccessControlPermission.withholdColumnsKeptToLabels({
        modelType: data.modelType,
        rows: projectRows,
        kept: kept,
        props: CallerPlan.inProjectWithoutPlan(
          data.props,
          new ObjectID(projectId),
        ),
        findIds: data.findIds,
      });
    }

    return data.rows;
  }

  /*
   * THE COLUMNS OF RELATED RECORDS A READ SELECTS THROUGH A RELATION THAT
   * THE CALLER READS ON SOME LABELS ONLY (#11438): a column held to its own
   * read through a relation (RelationReaders.ColumnReaders - a probe's SNMP
   * trap report, read through the network device that names the probe) of
   * a model that carries labels, for a caller whose grant to read it there
   * is limited to labels. The select's check weighs such a column by
   * whether its read is held at all (QueryPermission
   * .checkRelationQueryPermission), so it was read on every related record,
   * those outside the grant's labels too. Now it is left out of the related
   * records the grant does not reach (withholdRelatedColumnsKeptToLabels),
   * as a column of the model's own is (withholdColumnsKeptToLabels).
   *
   * A column every reader of the relation reads (canReadOnRelationQuery
   * alone - a probe's name, the label a joined row is shown by) is the
   * relation's, and an id or a time the related record's read: neither is
   * weighed here. None for root and a master admin, and for a read across
   * projects, whose related records are weighed by each project's grants
   * (getRelatedColumnsKeptToLabelsByProject).
   */
  public static getRelatedColumnsKeptToLabels<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    select: Select<TBaseModel> | null | undefined,
    props: DatabaseCommonInteractionProps,
  ): Array<RelatedColumnsKeptToLabels> {
    if (
      !select ||
      props.isRoot ||
      props.isMasterAdmin ||
      !props.tenantId ||
      props.isMultiTenantRequest
    ) {
      return [];
    }

    const model: BaseModel = new modelType();
    const relations: Array<RelatedColumnsKeptToLabels> = [];
    let context: AccessControlPermissionContext | null = null;

    for (const [relation, value] of Object.entries(
      select as Dictionary<unknown>,
    )) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }

      const metadata: { type?: TableColumnType; modelType?: unknown } =
        model.getTableColumnMetadata(relation) || {};

      if (
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray) ||
        typeof metadata.modelType !== "function"
      ) {
        continue;
      }

      const relatedModelType: { new (): BaseModel } = metadata.modelType as {
        new (): BaseModel;
      };
      const relatedModel: BaseModel = new relatedModelType();

      if (!relatedModel.getAccessControlColumn()) {
        continue;
      }

      const columnAccessControl: Dictionary<ColumnAccessControl> =
        relatedModel.getColumnAccessControlForAllColumns();

      const kept: Array<ColumnKeptToLabels> = [];

      for (const [column, isSelected] of Object.entries(
        value as Dictionary<unknown>,
      )) {
        if (
          isSelected !== true ||
          !RelationReadersUtil.isHeldToItsOwnRead(
            relatedModel.getTableColumnMetadata(column),
          )
        ) {
          continue;
        }

        const readPermissions: Array<Permission> =
          columnAccessControl[column]?.read || [];

        if (readPermissions.length === 0) {
          continue;
        }

        context = context ?? this.buildPermissionContext(props);

        const grant: LabelGrant = this.getGrantByPermissions(
          relatedModelType,
          DatabaseRequestType.Read,
          this.getColumnGrantingPermissions(
            relatedModelType,
            DatabaseRequestType.Read,
            readPermissions,
            context.held,
          ),
          context,
        );

        if (grant.labelIds.length === 0) {
          continue;
        }

        kept.push({ column: column, grant: grant });
      }

      if (kept.length > 0) {
        relations.push({
          relation: relation,
          relatedModelType: relatedModelType,
          kept: kept,
        });
      }
    }

    return relations;
  }

  /*
   * getRelatedColumnsKeptToLabels for a read across projects (#11438), by
   * project, as getColumnsKeptToLabelsByProject works out a model's own.
   */
  public static getRelatedColumnsKeptToLabelsByProject<
    TBaseModel extends BaseModel,
  >(
    modelType: { new (): TBaseModel },
    select: Select<TBaseModel> | null | undefined,
    props: DatabaseCommonInteractionProps,
  ): Map<string, Array<RelatedColumnsKeptToLabels>> {
    const byProject: Map<string, Array<RelatedColumnsKeptToLabels>> = new Map<
      string,
      Array<RelatedColumnsKeptToLabels>
    >();

    if (
      !select ||
      props.isRoot ||
      props.isMasterAdmin ||
      !props.isMultiTenantRequest
    ) {
      return byProject;
    }

    for (const projectId of props.userGlobalAccessPermission?.projectIds ||
      []) {
      const kept: Array<RelatedColumnsKeptToLabels> =
        AccessControlPermission.getRelatedColumnsKeptToLabels(
          modelType,
          select,
          CallerPlan.inProjectWithoutPlan(props, projectId),
        );

      if (kept.length > 0) {
        byProject.set(LabelAccess.readId(projectId), kept);
      }
    }

    return byProject;
  }

  /*
   * LEAVES THE RELATED COLUMNS KEPT TO LABELS (getRelatedColumnsKeptToLabels)
   * OUT OF THE RELATED RECORDS THEIR GRANTS DO NOT REACH, on the rows a read
   * hands back: which related records a grant reaches is asked of the
   * database by the condition a read of their own table would be narrowed
   * by (addGrantToQuery), once per grant, in one lookup of their ids
   * (`findRelatedIds`, a read as OneUptime). A related record read without
   * its id is left without the columns too. For a read across projects,
   * each row's related records are weighed by its own project's grants
   * (`keptByProject`); a row read without its project, by none - left
   * without every such column.
   */
  public static async withholdRelatedColumnsKeptToLabels<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    rows: Array<TBaseModel>;
    // One project's read.
    kept?: ReadonlyArray<RelatedColumnsKeptToLabels> | undefined;
    // A read across projects, by project.
    keptByProject?:
      | ReadonlyMap<string, ReadonlyArray<RelatedColumnsKeptToLabels>>
      | undefined;
    props: DatabaseCommonInteractionProps;
    findRelatedIds: (
      relatedModelType: { new (): BaseModel },
      query: Query<BaseModel>,
    ) => Promise<Array<string>>;
  }): Promise<Array<TBaseModel>> {
    if (data.rows.length === 0) {
      return data.rows;
    }

    if (data.kept && data.kept.length > 0) {
      await AccessControlPermission.withholdRelatedColumnsOfRows({
        rows: data.rows,
        kept: data.kept,
        props: data.props,
        findRelatedIds: data.findRelatedIds,
      });
    }

    if (!data.keptByProject || data.keptByProject.size === 0) {
      return data.rows;
    }

    const tenantColumn: string | null = new data.modelType().getTenantColumn();
    const rowsByProject: Map<string, Array<TBaseModel>> = new Map<
      string,
      Array<TBaseModel>
    >();

    for (const row of data.rows) {
      const projectId: string = tenantColumn
        ? LabelAccess.readId(
            (row as unknown as Dictionary<unknown>)[tenantColumn],
          )
        : "";

      if (!projectId) {
        for (const kept of data.keptByProject.values()) {
          AccessControlPermission.withholdRelatedColumnsOfRow({
            row: row,
            kept: kept,
            isReached: (): boolean => {
              return false;
            },
          });
        }

        continue;
      }

      const projectRows: Array<TBaseModel> = rowsByProject.get(projectId) || [];
      projectRows.push(row);
      rowsByProject.set(projectId, projectRows);
    }

    for (const [projectId, projectRows] of rowsByProject.entries()) {
      const kept: ReadonlyArray<RelatedColumnsKeptToLabels> | undefined =
        data.keptByProject.get(projectId);

      if (!kept || kept.length === 0) {
        continue;
      }

      await AccessControlPermission.withholdRelatedColumnsOfRows({
        rows: projectRows,
        kept: kept,
        props: CallerPlan.inProjectWithoutPlan(
          data.props,
          new ObjectID(projectId),
        ),
        findRelatedIds: data.findRelatedIds,
      });
    }

    return data.rows;
  }

  // The related records each row of `rows` names through `relation`.
  private static getRelatedRecords(
    row: unknown,
    relation: string,
  ): Array<Dictionary<unknown>> {
    const value: unknown = (row as Dictionary<unknown>)[relation];
    const values: Array<unknown> = Array.isArray(value) ? value : [value];

    return values.filter((related: unknown): related is Dictionary<unknown> => {
      return Boolean(related) && typeof related === "object";
    });
  }

  private static async withholdRelatedColumnsOfRows<
    TBaseModel extends BaseModel,
  >(data: {
    rows: Array<TBaseModel>;
    kept: ReadonlyArray<RelatedColumnsKeptToLabels>;
    props: DatabaseCommonInteractionProps;
    findRelatedIds: (
      relatedModelType: { new (): BaseModel },
      query: Query<BaseModel>,
    ) => Promise<Array<string>>;
  }): Promise<void> {
    for (const relation of data.kept) {
      const relatedIds: Array<string> = [];

      for (const row of data.rows) {
        for (const related of AccessControlPermission.getRelatedRecords(
          row,
          relation.relation,
        )) {
          const id: string = LabelAccess.readId(
            related["_id"] || related["id"],
          );

          if (id && !relatedIds.includes(id)) {
            relatedIds.push(id);
          }
        }
      }

      // Each grant's related records looked up once.
      const reachedByGrant: Map<string, Set<string>> = new Map<
        string,
        Set<string>
      >();

      for (const kept of relation.kept) {
        const key: string = AccessControlPermission.getGrantKey(kept.grant);

        if (reachedByGrant.has(key)) {
          continue;
        }

        let reached: Set<string> = new Set<string>();

        if (relatedIds.length > 0) {
          const query: Query<BaseModel> = await this.addGrantToQuery(
            relation.relatedModelType,
            { _id: QueryHelper.any(relatedIds) } as Query<BaseModel>,
            kept.grant,
            data.props,
          );

          reached = new Set<string>(
            (await data.findRelatedIds(relation.relatedModelType, query)).map(
              (id: string): string => {
                return LabelAccess.readId(id);
              },
            ),
          );
        }

        reachedByGrant.set(key, reached);
      }

      for (const row of data.rows) {
        AccessControlPermission.withholdRelatedColumnsOfRow({
          row: row,
          kept: [relation],
          isReached: (column: ColumnKeptToLabels, relatedId: string) => {
            return Boolean(
              relatedId &&
                reachedByGrant
                  .get(AccessControlPermission.getGrantKey(column.grant))
                  ?.has(relatedId),
            );
          },
        });
      }
    }
  }

  // One row's related records, without each kept column the grant does not reach.
  private static withholdRelatedColumnsOfRow(data: {
    row: unknown;
    kept: ReadonlyArray<RelatedColumnsKeptToLabels>;
    isReached: (column: ColumnKeptToLabels, relatedId: string) => boolean;
  }): void {
    for (const relation of data.kept) {
      for (const related of AccessControlPermission.getRelatedRecords(
        data.row,
        relation.relation,
      )) {
        const relatedId: string = LabelAccess.readId(
          related["_id"] || related["id"],
        );

        for (const column of relation.kept) {
          if (!data.isReached(column, relatedId)) {
            related[column.column] = undefined;
          }
        }
      }
    }
  }

  /*
   * The select a read's record rule narrows by (BasePermission
   * .addRecordScopeToQuery) when `withheldColumns` are left out of the
   * records their grants do not reach rather than narrowing it
   * (getColumnsKeptToLabels): the select without them - but for a column
   * the query filters on too, which narrows the read whatever the select
   * says. The select handed in is never changed.
   */
  public static getSelectNarrowingRead<TBaseModel extends BaseModel>(
    select: Select<TBaseModel> | null,
    query: Query<TBaseModel>,
    withheldColumns: ReadonlyArray<string> | undefined,
  ): Select<TBaseModel> | null {
    if (!select || !withheldColumns || withheldColumns.length === 0) {
      return select;
    }

    const filtered: Set<string> = new Set<string>(
      AccessControlPermission.getColumnsNamedByQuery(query),
    );

    const narrowing: Dictionary<unknown> = {};

    for (const [column, value] of Object.entries(
      select as Dictionary<unknown>,
    )) {
      if (withheldColumns.includes(column) && !filtered.has(column)) {
        continue;
      }

      narrowing[column] = value;
    }

    return narrowing as Select<TBaseModel>;
  }

  /*
   * The columns a query compares: its own keys, the fields a free-text
   * search reads, and the columns each group of a filter compares - as a
   * column kept to its owners is looked for in a filter
   * (OwnedScopePermission.getTeamListsOfColumnsKeptToOwnersNamed).
   */
  private static getColumnsNamedByQuery<TBaseModel extends BaseModel>(
    query: Query<TBaseModel>,
  ): Array<string> {
    const named: Set<string> = new Set<string>();

    for (const key of Object.keys(query || {})) {
      const value: unknown = (query as Dictionary<unknown>)[key];

      if (value instanceof MultiSearch) {
        for (const field of value.fields || []) {
          named.add(field);
        }

        continue;
      }

      if (value instanceof FilterGroups) {
        for (const column of value.columns) {
          named.add(column);
        }

        continue;
      }

      named.add(key);
    }

    return Array.from(named);
  }

  /*
   * LEAVES THE COLUMNS KEPT TO LABELS (getColumnsKeptToLabels) OUT OF THE
   * ROWS A READ HANDS BACK THAT THEIR GRANTS DO NOT REACH: the rest of each
   * record is read as its own grants allow. Which rows a grant reaches is
   * asked of the database by the very condition that narrowed such a read
   * before (addGrantToQuery) - the rows carrying one of its labels, or that
   * the caller or the teams of grants scoped to Owned beside them own - in
   * one lookup of the rows' ids per grant (`findIds`, a read as OneUptime).
   * A row read without its id is left without them too.
   */
  public static async withholdColumnsKeptToLabels<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    rows: Array<TBaseModel>;
    kept: ReadonlyArray<ColumnKeptToLabels>;
    props: DatabaseCommonInteractionProps;
    // The ids, in lower case, of the rows a query finds.
    findIds: (query: Query<TBaseModel>) => Promise<Array<string>>;
  }): Promise<Array<TBaseModel>> {
    if (data.rows.length === 0 || data.kept.length === 0) {
      return data.rows;
    }

    const rowIds: Array<string> = [];

    for (const row of data.rows) {
      const id: string = LabelAccess.readId(row._id || row.id);

      if (id && !rowIds.includes(id)) {
        rowIds.push(id);
      }
    }

    // Each grant's rows looked up once, whatever number of columns it keeps.
    const groups: Map<string, { grant: LabelGrant; columns: Array<string> }> =
      new Map<string, { grant: LabelGrant; columns: Array<string> }>();

    for (const kept of data.kept) {
      const key: string = AccessControlPermission.getGrantKey(kept.grant);
      const group: { grant: LabelGrant; columns: Array<string> } = groups.get(
        key,
      ) || { grant: kept.grant, columns: [] };

      group.columns.push(kept.column);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      let reached: Set<string> = new Set<string>();

      if (rowIds.length > 0) {
        const query: Query<TBaseModel> = await this.addGrantToQuery(
          data.modelType,
          { _id: QueryHelper.any(rowIds) } as Query<TBaseModel>,
          group.grant,
          data.props,
        );

        reached = new Set<string>(
          (await data.findIds(query)).map((id: string): string => {
            return LabelAccess.readId(id);
          }),
        );
      }

      for (const row of data.rows) {
        if (reached.has(LabelAccess.readId(row._id || row.id))) {
          continue;
        }

        for (const column of group.columns) {
          (row as unknown as Dictionary<unknown>)[column] = undefined;
        }
      }
    }

    return data.rows;
  }

  // One key for a grant, whatever the order or case of its ids.
  private static getGrantKey(grant: LabelGrant): string {
    const ids: (values: ReadonlyArray<ObjectID>) => string = (
      values: ReadonlyArray<ObjectID>,
    ): string => {
      return values
        .map((value: ObjectID): string => {
          return LabelAccess.readId(value);
        })
        .sort()
        .join(",");
    };

    return `${ids(grant.labelIds)}|${
      grant.ownedTeamIds ? ids(grant.ownedTeamIds) : "-"
    }`;
  }

  /*
   * Refuses an order by a column the caller reads on fewer records than the
   * model (getColumnsKeptToLabels): where the other records fall in it says
   * what they hold, one guess at a time - as an order by a column kept to its
   * owners is refused (OwnedScopePermission.checkSortOnColumnsKeptToOwners).
   * A read across projects leaves such a column out of the rows of each
   * project its grant there does not reach, as one project's read does
   * (#11438), and is refused the same order when one of its projects keeps
   * the column so (getColumnsKeptToLabelsByProject).
   */
  public static checkSortOnColumnsKeptToLabels<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    sort: unknown,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (!sort || typeof sort !== "object") {
      return;
    }

    const model: BaseModel = new modelType();
    const ordered: Dictionary<boolean> = {};

    for (const [column, order] of Object.entries(sort as Dictionary<unknown>)) {
      // An order through a relation is by the related record's columns.
      if (
        order === undefined ||
        order === null ||
        model.getTableColumnMetadata(column)?.modelType
      ) {
        continue;
      }

      ordered[column] = true;
    }

    const kept: Array<ColumnKeptToLabels> = props.isMultiTenantRequest
      ? Array.from(
          AccessControlPermission.getColumnsKeptToLabelsByProject(
            modelType,
            ordered as Select<TBaseModel>,
            props,
          ).values(),
        ).flat()
      : AccessControlPermission.getColumnsKeptToLabels(
          modelType,
          ordered as Select<TBaseModel>,
          props,
        );

    if (kept.length === 0) {
      return;
    }

    const column: string = kept[0]!.column;
    const title: string = model.getTableColumnMetadata(column)?.title || column;

    throw new NotAuthorizedException(
      `Your access lets you read the ${title} only of the ${model.pluralName} carrying some labels, so you cannot sort ${model.pluralName} by it.`,
    );
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
    return {
      /*
       * The allow rows the grants are read from (LabelAccess.readRows) -
       * the caller's global permissions among them, as rows with no labels.
       * A grant weighs no block: the blocks narrow in a step of their own
       * (ReadPermission.getLabelledBlockRows).
       */
      labelRows: LabelAccess.readRows(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          props,
          PermissionType.Allow,
        ),
      ),
      // What the table check holds the caller to, read the same way.
      held: TablePermission.getHeldPermissions(props),
    };
  }

  /*
   * What the allow rows of `permissions` reach of a model's records, for
   * `type` (see LabelGrant), by the shared rule (LabelAccess.getGrant):
   * nothing to narrow when one of them reaches the whole project, or when
   * none is limited to labels; otherwise the labels of the rows limited to
   * them and, when rows scoped to Owned stand beside them, those rows'
   * teams - or nothing to narrow, when the Owned scope narrows nothing here
   * (OwnedScopePermission.narrowsRecords): such a row reaches every record,
   * as it does on its own.
   */
  private static getGrantByPermissions(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
    permissions: Array<Permission>,
    context: AccessControlPermissionContext,
  ): LabelGrant {
    return LabelAccess.getGrant({
      rows: context.labelRows,
      permissions: permissions,
      ownedScopeNarrows: (): boolean => {
        return OwnedScopePermission.narrowsRecords(modelType, type);
      },
    });
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

  /*
   * Whether every record `grant` reaches is one `within` reaches, by the
   * rule the Dashboard tells a column kept to labels by too
   * (LabelAccess.isGrantWithin, #11437).
   */
  public static isGrantWithin(grant: LabelGrant, within: LabelGrant): boolean {
    return LabelAccess.isGrantWithin(grant, within);
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
      // The records carrying one of the labels, as addLabelIdsToQuery keeps them.
      labelCondition = AccessControlPermission.getCarriesLabelsCondition(
        modelType,
        grant.labelIds,
      );

      // A model whose labels cannot be followed is misconfigured: refused.
      if (!labelCondition) {
        throw new BadDataException(
          "Cannot apply read label restrictions without access-control relation metadata.",
        );
      }
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
