import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import Select from "../Select";
import AccessControlPermission from "./AccessControlPermission";
import OwnedScopePermission from "./OwnedScopePermission";
import OwnerOnlyColumnPermission from "./OwnerOnlyColumnPermission";
import PermissionUtil from "./PermissionsUtil";
import PublicPermission from "./PublicPermission";
import QueryPermission from "./QueryPermission";
import ReadPermission, { RecordOperation } from "./ReadPermission";
import SelectPermission from "./SelectPermission";
import TablePermission from "./TablePermission";
import TenantPermission from "./TenantPermission";
import UserPermissions from "./UserPermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { And, Equal, FindOperator } from "typeorm";

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
   * query is already scoped to: one rule for every operation, so a record a
   * caller may not read is no easier to change or delete. Asked by every
   * read and update (checkPermissions) and every delete
   * (DeletePermission.checkDeletePermission), and in a request across
   * projects for each project with that project's own rows
   * (TenantPermission):
   *
   *   - a grant limited to labels: a labelled model's records carrying one
   *     of them (AccessControlPermission.addAccessControlIdsToQuery);
   *   - a grant limited to owned records: the records the caller or their
   *     teams own, or whose parent they own (OwnedScopePermission);
   *   - the record a model is read through (@CanAccessIfCanReadOn): one the
   *     caller may read, and on an update one they may update
   *     (addParentAccessToQuery);
   *   - the label rule on the records a label-less model's rows name, and a
   *     block with labels on any model (ReadPermission.addLabelRulesToQuery);
   *   - before all of them, a block with no labels on one of the
   *     operation's permissions, which takes the whole table away
   *     (TablePermission.checkTableLevelBlockPermissions) - on an update or
   *     a delete by query as on a read.
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

    query = ReadPermission.addLabelRulesToQuery(
      modelType,
      query,
      props,
      type as RecordOperation,
    );

    query = await AccessControlPermission.addAccessControlIdsToQuery(
      modelType,
      query,
      select,
      props,
      type,
    );

    /*
     * Apply the `Owned` permission scope filter (see
     * Internal/Docs/PermissionsSimplification.md). When the user's
     * applicable permission rows are exclusively Owned-scoped, this
     * restricts the query to resources where the user is in *OwnerUser
     * or any of their teams is in *OwnerTeam.
     */
    query = await OwnedScopePermission.addOwnedScopeToQuery(
      modelType,
      query,
      props,
      type,
    );

    return BasePermission.addParentAccessToQuery(modelType, query, props, type);
  }

  /*
   * A model read through another record (@CanAccessIfCanReadOn - a note
   * through its incident) keeps to the records whose parent the caller may
   * read: when the caller's read grants on the parent's table are limited to
   * labels, only the records whose parent carries one of them - on a read,
   * an update and a delete alike, so a note is never easier to change or
   * delete than to read.
   *
   * An update also keeps to the parents the caller may update, as it always
   * has: when their update grants on the parent's table are limited to
   * labels, the parent carries one of those too (a custom domain is changed
   * only on a status page or dashboard the caller may edit). A delete weighs
   * no delete grant of the parent: deleting a note is the note's own
   * permission.
   */
  private static addParentAccessToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Query<TBaseModel> {
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

    const readLabelIds: Array<ObjectID> =
      AccessControlPermission.getAccessControlIdsForQuery(
        parentModelType,
        {},
        {
          _id: true,
        },
        props,
        DatabaseRequestType.Read,
      );

    const updateLabelIds: Array<ObjectID> =
      type === DatabaseRequestType.Update
        ? AccessControlPermission.getAccessControlIdsForQuery(
            parentModelType,
            {},
            {
              _id: true,
            },
            props,
            DatabaseRequestType.Update,
          )
        : [];

    if (readLabelIds.length === 0 && updateLabelIds.length === 0) {
      return query;
    }

    const parentAccessControlColumn: string =
      new parentModelType().getAccessControlColumn() as string;

    const accessControlQuery: JSONObject = {
      [parentAccessControlColumn]:
        updateLabelIds.length > 0 ? updateLabelIds : readLabelIds,
    };

    /*
     * Both limited: the parent carries one of the update labels and one of
     * the read labels - the read labels as a condition on the parent's id,
     * unless every update label is a read label too (one role limited to
     * the same labels for both), which says it already.
     */
    let parentIdCondition: FindOperator<unknown> | null = null;

    const readLabels: Set<string> = new Set<string>(
      readLabelIds.map((labelId: ObjectID): string => {
        return labelId.toString();
      }),
    );

    const updateLabelsAreReadLabels: boolean = updateLabelIds.every(
      (labelId: ObjectID): boolean => {
        return readLabels.has(labelId.toString());
      },
    );

    if (
      updateLabelIds.length > 0 &&
      readLabelIds.length > 0 &&
      !updateLabelsAreReadLabels
    ) {
      const labelJoin: ReturnType<
        typeof QueryUtil.getManyToManyRelationMetadata
      > = QueryUtil.getManyToManyRelationMetadata(
        parentModelType,
        parentAccessControlColumn,
      );

      if (!labelJoin) {
        throw new BadDataException(
          "Cannot apply read label restrictions without access-control relation metadata.",
        );
      }

      parentIdCondition = QueryHelper.anyOfEntitiesInManyToMany({
        values: readLabelIds,
        ...labelJoin,
      }) as FindOperator<unknown>;
    }

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

    let relationFilter: JSONObject;

    if (
      typeof existingRelationFilter === "string" ||
      existingRelationFilter instanceof ObjectID
    ) {
      relationFilter = {
        _id: existingRelationFilter.toString(),
        ...accessControlQuery,
      };
    } else if (
      existingRelationFilter &&
      typeof existingRelationFilter === "object" &&
      !Array.isArray(existingRelationFilter) &&
      existingRelationFilter.constructor === Object
    ) {
      relationFilter = {
        ...(existingRelationFilter as JSONObject),
        ...accessControlQuery,
      };
    } else {
      relationFilter = accessControlQuery;
    }

    // The read labels on the parent's id, beside any id filter already there.
    if (parentIdCondition) {
      relationFilter["_id"] = BasePermission.withIdCondition(
        relationFilter["_id"],
        parentIdCondition,
      ) as any;
    }

    (query as any)[model.canAccessIfCanReadOn as string] = relationFilter;

    return query;
  }

  // An id filter, and `condition` on the same id, together.
  private static withIdCondition(
    existing: unknown,
    condition: FindOperator<unknown>,
  ): FindOperator<unknown> {
    if (existing === undefined || existing === null) {
      return condition;
    }

    if (existing instanceof FindOperator) {
      return And(existing as FindOperator<unknown>, condition);
    }

    return And(Equal(String(existing)) as FindOperator<unknown>, condition);
  }
}
