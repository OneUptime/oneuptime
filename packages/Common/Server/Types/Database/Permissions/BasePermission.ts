import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
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
import ObjectID from "../../../../Types/ObjectID";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

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
   * an update and a delete alike.
   *
   * An update also keeps to the parents the caller may update, as it always
   * has: when their update grants on the parent's table are limited to
   * labels, the parent carries one of those too (a custom domain is changed
   * only on a status page or dashboard the caller may edit). A delete weighs
   * no delete grant of the parent: deleting a note is the note's own
   * permission.
   *
   * A read narrows the relation itself (`incident: { labels }`), as it
   * always has. A write narrows by conditions on the record's own id
   * (ReadPermission.addParentLabelsToQuery): the caller's own filters stay
   * exactly as sent, and a record readable through one parent and editable
   * through another (an announcement on two status pages) is reached.
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

    const parentAccessControlColumn: string | null =
      new parentModelType().getAccessControlColumn();

    /*
     * A write, or a parent that carries no labels for the relation to name:
     * conditions on the record's own id, one per list of labels. An update
     * limited to labels that are all read labels as well needs no second
     * condition.
     */
    if (type !== DatabaseRequestType.Read || !parentAccessControlColumn) {
      const labelLists: Array<Array<ObjectID>> = [];

      if (updateLabelIds.length > 0) {
        labelLists.push(updateLabelIds);
      }

      if (
        readLabelIds.length > 0 &&
        !(
          updateLabelIds.length > 0 &&
          BasePermission.isWithin(updateLabelIds, readLabelIds)
        )
      ) {
        labelLists.push(readLabelIds);
      }

      for (const labelIds of labelLists) {
        query = ReadPermission.addParentLabelsToQuery(
          modelType,
          query,
          labelIds,
        );
      }

      return query;
    }

    if (readLabelIds.length === 0) {
      return query;
    }

    const accessControlQuery: JSONObject = {
      [parentAccessControlColumn]: readLabelIds,
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

  // Whether every label of `labelIds` is one of `within`.
  private static isWithin(
    labelIds: Array<ObjectID>,
    within: Array<ObjectID>,
  ): boolean {
    const withinIds: Set<string> = new Set<string>(
      within.map((labelId: ObjectID): string => {
        return labelId.toString();
      }),
    );

    return labelIds.every((labelId: ObjectID): boolean => {
      return withinIds.has(labelId.toString());
    });
  }
}
