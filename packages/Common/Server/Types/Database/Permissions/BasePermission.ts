import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import Select from "../Select";
import AccessControlPermission, { LabelGrant } from "./AccessControlPermission";
import OwnedScopePermission from "./OwnedScopePermission";
import OwnerOnlyColumnPermission from "./OwnerOnlyColumnPermission";
import PermissionUtil from "./PermissionsUtil";
import PrivateRecordPermission from "./PrivateRecordPermission";
import PublicPermission from "./PublicPermission";
import QueryPermission from "./QueryPermission";
import ReadPermission, { RecordOperation } from "./ReadPermission";
import SelectPermission from "./SelectPermission";
import TablePermission from "./TablePermission";
import TenantPermission from "./TenantPermission";
import UserPermissions from "./UserPermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../../Types/JSON";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import Permission, { PermissionHelper } from "../../../../Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import ArrayUtil from "../../../../Utils/Array";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";

export interface CheckPermissionBaseInterface<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
}

export default class BasePermission {
  /*
   * `updateData` is what an update writes, handed on to the table-level
   * plan check: below a table's update plan only an update that switches
   * records off passes, and only the data shows that (BillingPermission).
   */
  @CaptureSpan()
  public static async checkPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    updateData?: unknown,
  ): Promise<CheckPermissionBaseInterface<TBaseModel>> {
    /*
     * Permission checks add predicates and QueryUtil serializes values in
     * place. Callers such as BaseAPI intentionally reuse the original query
     * for list and count, so work on a fresh top-level object.
     */
    query = { ...query };

    if (props.isRoot || props.isMasterAdmin) {
      query = await PermissionUtil.addTenantScopeToQueryAsRoot(
        modelType,
        query,
        props,
      );
    }

    if (!props.isRoot && !props.isMasterAdmin) {
      //check if the user is logged in.
      PublicPermission.checkIfUserIsLoggedIn(modelType, props, type);

      // add tenant scope.
      query = await TenantPermission.addTenantScopeToQuery(
        modelType,
        query,
        select,
        props,
        type,
        updateData,
      );

      // add user scope if any
      query = await UserPermissions.addUserScopeToQuery(
        modelType,
        query,
        props,
      );

      /*
       * Only TenantPermission's per-project recursion returns an array of
       * queries whose permissions have already been checked. The incoming
       * query is copied into an ordinary object above, so a caller cannot
       * supply this array. A multi-tenant request scoped to the current user
       * (such as pending team invitations) still needs every check below.
       */
      if (!Array.isArray(query)) {
        // check model level permissions.
        TablePermission.checkTableLevelPermissions(
          modelType,
          props,
          type,
          updateData,
        );

        // check query permissions.
        QueryPermission.checkQueryPermission(modelType, query, props);

        // The records of the table this operation may reach. See the helper.
        query = await BasePermission.addRecordScopeToQuery(
          modelType,
          query,
          select,
          props,
          type,
        );

        if (select) {
          // check query permission.
          SelectPermission.checkSelectPermission(modelType, select, props);

          /*
           * Both of the calls below are handed the query as it stands AFTER
           * tenant and user scoping, which is the only moment it means
           * anything. Before that scoping a plain member's query is still bare
           * `{}` and would look unscoped; after serializeQuery (further down)
           * the ownership predicate has been rewritten into a Raw operator and
           * can no longer be compared to the caller's id. Here, and only here,
           * the query says plainly which rows this request may touch.
           */
          OwnerOnlyColumnPermission.checkSelectPermission(
            modelType,
            query,
            select,
            props,
          );

          QueryPermission.checkRelationQueryPermission(
            modelType,
            query,
            select,
            props,
          );
        }
      }
    }

    query = QueryUtil.serializeQuery(modelType, query);

    return { query };
  }

  /*
   * THE RECORDS A READ, AN UPDATE OR A DELETE REACHES, in the project the
   * query is already scoped to: one rule for every operation. Asked by every
   * read and update (checkPermissions) and every delete
   * (DeletePermission.checkDeletePermission), and in a request across
   * projects for each project with that project's own rows
   * (TenantPermission):
   *
   *   - a grant limited to labels: a labelled model's records carrying one
   *     of them (AccessControlPermission.addLabelIdsToQuery);
   *   - a grant limited to owned records: the records the caller or their
   *     teams own, or whose parent they own (OwnedScopePermission);
   *   - grants of both, one team's limited to labels and another's scoped
   *     to Owned: the records either reaches - carrying one of the labels,
   *     or owned by the caller or the Owned grant's team - in one condition
   *     (AccessControlPermission.addGrantToQuery). A caller's access is the
   *     union of their teams' grants: read as the labels alone, it denied
   *     what the Owned grant gave;
   *   - on an update and a delete, a private incident, alert or episode,
   *     and the parts of one, only where the caller owns it or a team
   *     granting the operation does (PrivateRecordPermission);
   *   - the record a model is read through (@CanAccessIfCanReadOn): one the
   *     caller may read, and on an update one they may update - by the
   *     labels and the owners the caller's grants on it are limited to
   *     (addParentAccessToQuery);
   *   - the label rule on the records a label-less model's rows name, and a
   *     block with labels on any model (ReadPermission.addLabelRulesToQuery);
   *   - before all of them, a block with no labels on one of the
   *     operation's permissions, which takes the whole table away
   *     (TablePermission.checkTableLevelBlockPermissions) - on an update or
   *     a delete by query as on a read.
   *
   * A WRITE NEEDS A READ: an update or a delete reaches only the records
   * the caller may also read. Its records are narrowed by the read's grants
   * and blocks as well as by its own - a record the caller may not read is
   * not one they may change or delete - and a caller who may read none of
   * the table's records changes and deletes none of them
   * (TablePermission.checkTableLevelReadForWrite).
   *
   * Root and master admin callers are left alone, as is a create.
   */
  @CaptureSpan()
  public static async addRecordScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    if (
      props.isRoot ||
      props.isMasterAdmin ||
      type === DatabaseRequestType.Create
    ) {
      return query;
    }

    TablePermission.checkTableLevelBlockPermissions(modelType, props, type);

    // The operations whose grants and blocks narrow this one.
    const operations: Array<RecordOperation> =
      ReadPermission.getNarrowingOperations(type as RecordOperation);

    if (type !== DatabaseRequestType.Read) {
      TablePermission.checkTableLevelReadForWrite(modelType, props, type);

      query = TenantPermission.addCurrentUserReadScopeToQuery(
        modelType,
        query,
        props,
        type,
      );
    }

    /*
     * A label-less model's rows, through the records they name: each
     * operation's grants limited to labels - with the records the caller
     * owns, when grants scoped to Owned stand beside them (LabelGrant) - a
     * condition of their own.
     */
    if (!new modelType().getAccessControlColumn()) {
      for (const grant of AccessControlPermission.getGrantsToNarrowBy(
        operations.map((operation: RecordOperation): LabelGrant => {
          return AccessControlPermission.getLabelGrantForModel(
            modelType,
            props,
            operation,
          );
        }),
      )) {
        query = await AccessControlPermission.addGrantToQuery(
          modelType,
          query,
          grant,
          props,
        );
      }
    }

    // The labels every operation's blocks take away, in one condition.
    const blockedLabelIds: Array<ObjectID> =
      ArrayUtil.removeDuplicatesFromObjectIDArray(
        operations.flatMap((operation: RecordOperation): Array<ObjectID> => {
          return ReadPermission.getBlockedLabelIds(modelType, props, operation);
        }),
      );

    query = ReadPermission.addBlockedLabelsToQuery(
      modelType,
      query,
      blockedLabelIds,
    );

    /*
     * A labelled model's own labels: each operation's grants, and each
     * column it names or selects that its caller may read only on some
     * labels, a condition of its own (AccessControlPermission
     * .getLabelGrantsForQuery) - a column read on fewer records than the
     * table narrows the read, never widens it. Grants scoped to Owned beside
     * those limited to labels reach the records the caller owns as well.
     */
    if (new modelType().getAccessControlColumn()) {
      const grantsByOperation: Array<LabelGrant> = operations.flatMap(
        (operation: RecordOperation): Array<LabelGrant> => {
          return AccessControlPermission.getLabelGrantsForQuery(
            modelType,
            query,
            operation === type ? select : null,
            props,
            operation,
          );
        },
      );

      for (const grant of AccessControlPermission.getGrantsToNarrowBy(
        grantsByOperation,
      )) {
        query = await AccessControlPermission.addGrantToQuery(
          modelType,
          query,
          grant,
          props,
        );
      }
    }

    /*
     * Apply the `Owned` permission scope filter (see
     * Internal/Docs/PermissionsSimplification.md). When the user's
     * applicable permission rows for an operation are exclusively
     * Owned-scoped, this restricts the query to resources where the user is
     * in *OwnerUser or the team of one of those rows is in *OwnerTeam - each
     * team's grant reaching what that team owns. Different teams may grant a
     * write and its read, so each operation narrows by its own teams: a
     * record one team may change and no team of the caller's may read is
     * not changed. Operations granted by the same teams narrow once.
     */
    const ownedTeamLists: Array<Array<ObjectID>> =
      OwnedScopePermission.getTeamListsToNarrowBy([
        ...operations
          .filter((operation: RecordOperation): boolean => {
            return OwnedScopePermission.isLimitedToOwnedRecords(
              modelType,
              props,
              operation,
            );
          })
          .map((operation: RecordOperation): Array<ObjectID> => {
            return OwnedScopePermission.getOwningTeamIds(
              modelType,
              props,
              operation,
            );
          }),
        /*
         * A read filtered by a column the caller reads only on the records
         * they or their teams own (a Runner's key, of a kind every reader of
         * it reads): it reaches only those - a match says what the column
         * holds. OwnedScopePermission.getColumnsKeptToOwners.
         */
        ...(type === DatabaseRequestType.Read
          ? OwnedScopePermission.getTeamListsOfColumnsKeptToOwnersNamed(
              modelType,
              query,
              props,
            )
          : []),
      ]);

    for (const teamIds of ownedTeamLists) {
      query = await OwnedScopePermission.addOwnedRecordsToQuery(
        modelType,
        query,
        props,
        teamIds,
      );
    }

    /*
     * A private incident, alert or episode, and every part of one (its
     * notes, owners, state timeline, roles), is changed and deleted only
     * through the teams that own it: each team's permission reaches the
     * private records that team owns, and a person's the ones they own
     * themselves - never the private records only another of their teams
     * owns, which let them see it (PrivateRecordPermission). Reads are left
     * to the privacy filters.
     */
    query = PrivateRecordPermission.addPrivateRecordScopeToQuery(
      modelType,
      query,
      props,
      type,
    );

    return await BasePermission.addParentAccessToQuery(
      modelType,
      query,
      props,
      type,
      blockedLabelIds,
      ownedTeamLists,
    );
  }

  /*
   * A model read through another record (@CanAccessIfCanReadOn - a note
   * through its incident) keeps to the records whose parent the caller may
   * read, on a read, an update and a delete alike:
   *
   *   - a caller who may read none of the parent's records - who holds none
   *     of its read permissions, or whose block with no labels takes one of
   *     them away - reaches none of the records read through them, and is
   *     refused (isHeldToParentRead). A model whose shipped readers do not
   *     read the parent (isParentReadOptional: an incident's links to
   *     alerts, telemetry rules of a service, a person's notification log)
   *     is read by its own rule when the caller holds none of them; a block
   *     still refuses;
   *   - when the caller's read grants on the parent's table are limited to
   *     labels, only the records whose parent carries one of them - a parent
   *     with no labels of its own (a security case) carries those of the
   *     records it names, and the records it keeps by its own label rule are
   *     the ones read through (ReadPermission.getParentLabelsCondition);
   *   - when they are limited to owned records, only the records whose
   *     parent the caller or one of their teams owns
   *     (addParentOwnedScopeToQuery);
   *   - when some are limited to labels and the others scoped to Owned,
   *     the records whose parent carries one of the labels or is one the
   *     caller or those grants' teams own: one condition (addParentGrantToQuery);
   *   - when a block with labels takes some of the parents away, only the
   *     records whose parent carries none of them.
   *
   * An update also keeps to the parents the caller may update, as it always
   * has: when their update grants on the parent's table are limited to
   * labels, the parent carries one of those too (a custom domain is changed
   * only on a status page or dashboard the caller may edit), and when they
   * are limited to owned records, the parent is one they own. A delete
   * weighs no delete grant of the parent: deleting a note is the note's own
   * permission.
   *
   * A read narrows the relation itself (`incident: { labels }`), as it
   * always has. A write narrows by conditions on the record's own id
   * (ReadPermission.addParentLabelsToQuery): the caller's own filters stay
   * exactly as sent, and a record readable through one parent and editable
   * through another (an announcement on two status pages) is reached.
   */
  private static async addParentAccessToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    // The labels the rows' own blocks take away already.
    blockedLabelIds: Array<ObjectID>,
    /*
     * The teams whose owned records the rows are narrowed to already, one
     * list per condition (none: not narrowed to owned records).
     */
    ownedTeamLists: Array<Array<ObjectID>>,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    if (!model.canAccessIfCanReadOn) {
      return query;
    }

    const tableColumnMetadata: TableColumnMetadata =
      model.getTableColumnMetadata(model.canAccessIfCanReadOn);

    if (
      !tableColumnMetadata ||
      !tableColumnMetadata.modelType ||
      (tableColumnMetadata.type !== TableColumnType.Entity &&
        tableColumnMetadata.type !== TableColumnType.EntityArray)
    ) {
      return query;
    }

    const parentModelType: { new (): BaseModel } =
      tableColumnMetadata.modelType;

    // Refuses a caller who may read none of the parents. See the helper.
    BasePermission.isHeldToParentRead(modelType, parentModelType, props, type);

    query = await BasePermission.addParentOwnedScopeToQuery({
      modelType: modelType,
      parentModelType: parentModelType,
      relation: model.canAccessIfCanReadOn,
      relationColumn: tableColumnMetadata,
      query: query,
      props: props,
      type: type,
      ownedTeamLists: ownedTeamLists,
    });

    /*
     * The parents a block with labels takes away, and what is read through
     * them. A label-less model's own blocks leave out the rows of parents
     * carrying their labels already (ReadPermission.addBlockedLabelsToQuery),
     * so only the other labels are asked again - when the parent carries
     * labels of its own. A parent that does not (a security case) is no
     * labelled record those blocks follow: every label is asked of it.
     */
    const blockedOnRows: Set<string> = new Set<string>(
      model.getAccessControlColumn() ||
      !new parentModelType().getAccessControlColumn()
        ? []
        : blockedLabelIds.map((labelId: ObjectID): string => {
            return labelId.toString();
          }),
    );

    /*
     * An update keeps to the parents the caller may update: a block with
     * labels on updating the parent takes the parents carrying them away
     * too, as the parent's update grants limited to labels narrow it below
     * (a block on editing the Production status pages keeps their domains
     * as they are).
     */
    const parentBlockedLabelIds: Array<ObjectID> =
      ArrayUtil.removeDuplicatesFromObjectIDArray([
        ...ReadPermission.getBlockedLabelIds(
          parentModelType,
          props,
          DatabaseRequestType.Read,
        ),
        ...(type === DatabaseRequestType.Update
          ? ReadPermission.getBlockedLabelIds(
              parentModelType,
              props,
              DatabaseRequestType.Update,
            )
          : []),
      ]);

    query = ReadPermission.addParentBlockedLabelsToQuery(
      modelType,
      query,
      parentBlockedLabelIds.filter((labelId: ObjectID): boolean => {
        return !blockedOnRows.has(labelId.toString());
      }),
    );

    /*
     * The parent's read grants and, on an update, its update grants: each a
     * condition of its own (LabelGrant) - an update limited to labels that
     * are all read labels as well needs no second condition
     * (AccessControlPermission.getGrantsToNarrowBy).
     */
    const grants: Array<LabelGrant> =
      AccessControlPermission.getGrantsToNarrowBy([
        ...(type === DatabaseRequestType.Update
          ? [
              AccessControlPermission.getLabelGrantForModel(
                parentModelType,
                props,
                DatabaseRequestType.Update,
              ),
            ]
          : []),
        AccessControlPermission.getLabelGrantForModel(
          parentModelType,
          props,
          DatabaseRequestType.Read,
        ),
      ]);

    const parentAccessControlColumn: string | null =
      new parentModelType().getAccessControlColumn();

    for (const grant of grants) {
      /*
       * A read through a parent that carries labels, by its labels alone:
       * the relation itself is narrowed, as it always has been.
       */
      if (
        type === DatabaseRequestType.Read &&
        parentAccessControlColumn &&
        !grant.ownedTeamIds
      ) {
        query = BasePermission.addParentRelationLabelsToQuery(
          model,
          query,
          parentAccessControlColumn,
          grant.labelIds,
        );

        continue;
      }

      /*
       * A write, a parent that carries no labels for the relation to name,
       * or grants scoped to Owned beside the labels: a condition on the
       * record's own id.
       */
      query = await BasePermission.addParentGrantToQuery({
        modelType: modelType,
        parentModelType: parentModelType,
        relation: model.canAccessIfCanReadOn,
        relationColumn: tableColumnMetadata,
        query: query,
        grant: grant,
        props: props,
      });
    }

    return query;
  }

  /*
   * Narrows a read through a parent that carries labels (an incident's
   * notes) by the relation itself: the parents carrying one of `labelIds`.
   */
  private static addParentRelationLabelsToQuery<TBaseModel extends BaseModel>(
    model: BaseModel,
    query: Query<TBaseModel>,
    parentAccessControlColumn: string,
    labelIds: Array<ObjectID>,
  ): Query<TBaseModel> {
    const accessControlQuery: JSONObject = {
      [parentAccessControlColumn]: labelIds,
    };

    /*
     * Preserve any caller-supplied filter on the relation key instead of
     * overwriting it. Plain relation objects are merged (the access-control
     * predicate wins on a key collision — fail closed, access never
     * widens); a scalar id filter is folded in as the relation's _id.
     * Anything else falls back to the access-control query alone.
     */
    const existingRelationFilter: unknown = (query as any)[
      model.canAccessIfCanReadOn as string
    ];

    if (
      typeof existingRelationFilter === "string" ||
      existingRelationFilter instanceof ObjectID
    ) {
      (query as any)[model.canAccessIfCanReadOn as string] = {
        _id: existingRelationFilter.toString(),
        ...accessControlQuery,
      };
    } else if (
      existingRelationFilter &&
      typeof existingRelationFilter === "object" &&
      !Array.isArray(existingRelationFilter) &&
      existingRelationFilter.constructor === Object
    ) {
      (query as any)[model.canAccessIfCanReadOn as string] = {
        ...(existingRelationFilter as JSONObject),
        ...accessControlQuery,
      };
    } else {
      (query as any)[model.canAccessIfCanReadOn as string] = accessControlQuery;
    }

    return query;
  }

  /*
   * Keeps the records whose parent a grant on the parent's table reaches
   * (LabelGrant), by a condition on the record's own id: the parent carries
   * one of the grant's labels (ReadPermission.getParentLabelsCondition) or -
   * beside grants scoped to Owned - is one the caller or those grants' teams
   * own (OwnedScopePermission.getOwnedParentsCondition). The caller's own
   * filters stay exactly as sent.
   */
  private static async addParentGrantToQuery<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    parentModelType: { new (): BaseModel };
    relation: string;
    relationColumn: TableColumnMetadata;
    query: Query<TBaseModel>;
    grant: LabelGrant;
    props: DatabaseCommonInteractionProps;
  }): Promise<Query<TBaseModel>> {
    if (!data.grant.ownedTeamIds) {
      return ReadPermission.addParentLabelsToQuery(
        data.modelType,
        data.query,
        data.grant.labelIds,
      );
    }

    const conditions: Array<{
      columnName?: string | undefined;
      condition: FindWhereProperty<any>;
    }> = [];

    const labelCondition: FindWhereProperty<any> | null =
      ReadPermission.getParentLabelsCondition(
        data.modelType,
        data.grant.labelIds,
      );

    if (labelCondition) {
      conditions.push({ condition: labelCondition });
    }

    const owned: {
      columnName: string | null;
      condition: FindWhereProperty<any>;
    } | null = await OwnedScopePermission.getOwnedParentsCondition({
      modelType: data.modelType,
      props: data.props,
      parentModelType: data.parentModelType,
      relation: data.relation,
      relationColumn: data.relationColumn,
      teamIds: data.grant.ownedTeamIds,
    });

    if (owned) {
      conditions.push({
        columnName: owned.columnName || undefined,
        condition: owned.condition,
      });
    }

    const idQuery: Query<TBaseModel> = QueryUtil.serializeQuery(
      data.modelType,
      {
        _id: data.query._id,
      } as Query<TBaseModel>,
    );

    (data.query as any)._id = combineWithPrivacyClause(
      ReadPermission.getSupportedFilter(idQuery._id),
      QueryHelper.anyOfConditions(conditions),
    );

    return data.query;
  }

  /*
   * The owners half of a parent's read rule: when every grant the caller
   * holds to read the parent - or, on an update, to update it - is limited
   * to the records they or their teams own (OwnedScopePermission
   * .isLimitedToOwnedRecords), the rows keep to the parents they own: an
   * incident's notes to the notes of their incidents, whatever their
   * permission on notes reaches. Each grant reaches the parents its own
   * team owns (OwnedScopePermission.getOwningTeamIds): the parents the read
   * reaches and, on an update, the ones the update reaches. A caller who
   * holds no grant on the parent at all (a model whose parent read is
   * optional) is not narrowed by it.
   *
   * Rows the caller's own grants already keep to the same owned parents -
   * their model takes its owners from exactly this parent (@OwnedThrough on
   * the same key, or an owner table's resource) and they are narrowed to
   * the parents of teams that are all among the parent grant's teams - are
   * not looked up twice.
   */
  private static async addParentOwnedScopeToQuery<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    parentModelType: { new (): BaseModel };
    relation: string;
    relationColumn: TableColumnMetadata;
    query: Query<TBaseModel>;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    ownedTeamLists: Array<Array<ObjectID>>;
  }): Promise<Query<TBaseModel>> {
    const parentOperations: Array<DatabaseRequestType> =
      data.type === DatabaseRequestType.Update
        ? [DatabaseRequestType.Read, DatabaseRequestType.Update]
        : [DatabaseRequestType.Read];

    const parentTeamLists: Array<Array<ObjectID>> =
      OwnedScopePermission.getTeamListsToNarrowBy(
        parentOperations
          .filter((operation: DatabaseRequestType): boolean => {
            return OwnedScopePermission.isLimitedToOwnedRecords(
              data.parentModelType,
              data.props,
              operation,
            );
          })
          .map((operation: DatabaseRequestType): Array<ObjectID> => {
            return OwnedScopePermission.getOwningTeamIds(
              data.parentModelType,
              data.props,
              operation,
            );
          }),
      );

    const isOwnedThroughParent: boolean = BasePermission.isOwnedThroughParent(
      data.modelType,
      data.parentModelType,
      data.relationColumn,
    );

    let query: Query<TBaseModel> = data.query;

    for (const parentTeamIds of parentTeamLists) {
      const isNarrowedAlready: boolean =
        isOwnedThroughParent &&
        data.ownedTeamLists.some((teamIds: Array<ObjectID>): boolean => {
          return OwnedScopePermission.isTeamListWithin(teamIds, parentTeamIds);
        });

      if (isNarrowedAlready) {
        continue;
      }

      query = await OwnedScopePermission.addOwnedParentsToQuery({
        modelType: data.modelType,
        query: query,
        props: data.props,
        parentModelType: data.parentModelType,
        relation: data.relation,
        relationColumn: data.relationColumn,
        teamIds: parentTeamIds,
      });
    }

    return query;
  }

  /*
   * Whether a model's rows take their owners from exactly the record they
   * are read through (@OwnedThrough on the same key, or an owner table's
   * resource - OwnedScopePermission.getOwnedThrough - that parent alone, no
   * rows kept for the project as a whole): its own Owned scope then keeps
   * them to the parents the caller owns.
   */
  private static isOwnedThroughParent(
    modelType: { new (): BaseModel },
    parentModelType: { new (): BaseModel },
    relationColumn: TableColumnMetadata,
  ): boolean {
    const ownedThrough: BaseModel["ownedThrough"] =
      OwnedScopePermission.getOwnedThrough(modelType);

    return Boolean(
      ownedThrough &&
        relationColumn.type === TableColumnType.Entity &&
        ownedThrough.fkColumn === relationColumn.manyToOneRelationColumn &&
        ownedThrough.parentModels.length === 1 &&
        ownedThrough.parentModels[0] === parentModelType &&
        !ownedThrough.includeProjectScope &&
        !ownedThrough.includeUnattributed,
    );
  }

  /*
   * Whether a caller is held to reading the records `modelType`'s rows are
   * read through, refusing one who may read none of them: one of the
   * parent's read permissions taken away by a block with no labels - as
   * reading the parent's own table is refused - or none of them held (nor
   * the parent's read wildcard). A permission on the rows alone (Read
   * Incident Internal Note, with no permission on incidents) reaches none
   * of them. True for a caller who holds one: the parent's read rule then
   * holds them to the parents it reaches, on a read, an update and a delete
   * (addParentAccessToQuery) and on a create (CreatePermission
   * .checkParentPermission).
   *
   * A model whose shipped readers do not read the parent
   * (CanAccessIfCanReadOn's isParentReadOptional - an incident's links to
   * alerts, read by alert responders) is read by its own read rule when the
   * caller holds no permission to read the parent: false. A block still
   * refuses.
   */
  public static isHeldToParentRead(
    modelType: { new (): BaseModel },
    parentModelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): boolean {
    const parentReadPermissions: Array<Permission> =
      TablePermission.getTablePermission(
        parentModelType,
        DatabaseRequestType.Read,
      );

    const held: HeldPermissions = TablePermission.getHeldPermissions(props);
    const model: BaseModel = new modelType();
    const parent: BaseModel = new parentModelType();

    const blocked: Permission | undefined = parentReadPermissions.find(
      (permission: Permission): boolean => {
        return HeldPermissionsUtil.isBlockedFromAny(held, [permission]);
      },
    );

    if (blocked) {
      throw new NotAuthorizedException(
        `You are not authorized to ${type} ${model.singularName}. It is read through its ${parent.singularName}, and ${blocked} is in your team's permission block list.`,
      );
    }

    if (
      HeldPermissionsUtil.isGrantedAny(held, parentReadPermissions, {
        wildcard: TablePermission.getModelWildcard(
          parentModelType,
          DatabaseRequestType.Read,
        ),
      })
    ) {
      return true;
    }

    if (model.isParentReadOptional) {
      return false;
    }

    throw new NotAuthorizedException(
      `You do not have permissions to ${type} ${model.singularName}. It is read through its ${
        parent.singularName
      }, and you need one of these permissions to read ${
        parent.pluralName
      }: ${PermissionHelper.getPermissionTitles(parentReadPermissions).join(
        ", ",
      )}`,
    );
  }
}
