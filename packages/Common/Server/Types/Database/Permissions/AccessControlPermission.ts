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
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
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
};

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

    const blockPermissionWithLabels: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ).filter((permission: UserPermission) => {
        return permission.labelIds && permission.labelIds.length > 0;
      });

    if (blockPermissionWithLabels.length === 0) {
      return;
    }

    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);

    const blockPermissionsBelongToThisModel: Array<UserPermission> =
      blockPermissionWithLabels.filter((blockPermission: UserPermission) => {
        let isModelPermission: boolean = false;

        for (const permission of modelPermissions) {
          if (permission.toString() === blockPermission.permission.toString()) {
            isModelPermission = true;
            break;
          }
        }

        return isModelPermission;
      });

    if (blockPermissionsBelongToThisModel.length === 0) {
      return;
    }

    // now check if the user has any of these labels in the block list, for this we need to fetch the model first.
    const fetchedModel: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!fetchedModel) {
      throw new BadDataException(`${modelType.name} not found.`);
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
         * The rule weighs every one of these block rows at once: each of
         * their permissions is named, since any of them may be the one.
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
          } because ${blockedPermissions.join(", ")} ${
            blockedPermissions.length === 1 ? "is" : "are"
          } in your team's permission block list.`,
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
      const accessControlIdsWhichUserHasAccessTo: Array<ObjectID> =
        this.getAccessControlIdsForModel(modelType, props, type);

      if (accessControlIdsWhichUserHasAccessTo.length === 0) {
        return; // The user has access to all resources, if no labels are specified.
      }

      const fetchedModel: TBaseModel | null =
        await this.fetchRecordInCallerProject(data);

      if (!fetchedModel) {
        throw new BadDataException(`${model.singularName} not found.`);
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
     * .addLabelGrantToQuery), as only a labelled record carrying one may.
     */
    if (
      !data.isRecordFound ||
      ReadPermission.getGrantedLabelIds(
        modelType,
        props,
        type as RecordOperation,
      ).length === 0
    ) {
      return;
    }

    const fetchedRecord: TBaseModel | null =
      await this.fetchRecordInCallerProject(data);

    if (!fetchedRecord) {
      throw new BadDataException(`${model.singularName} not found.`);
    }

    if (
      !(await this.isRecordKeptByLabelRule({
        record: fetchedRecord,
        isRecordFound: data.isRecordFound,
        narrow: (query: Query<TBaseModel>): Query<TBaseModel> => {
          return ReadPermission.addLabelGrantToQuery(
            modelType,
            query,
            props,
            type as RecordOperation,
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
   * Both checks of one record by model - the team's blocks, then the grants
   * limited to labels - on one read of the record, for an update or a
   * delete by id (UpdatePermission, DeletePermission).
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

    await this.checkAccessControlBlockPermissionByModel<TBaseModel>(checked);
    await this.checkAccessControlPermissionByModel<TBaseModel>(checked);
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

  @CaptureSpan()
  public static async addAccessControlIdsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    // if the model has access control column, then add the access control labels to the query.
    if (model.getAccessControlColumn()) {
      const accessControlIds: Array<ObjectID> =
        this.getAccessControlIdsForQuery(modelType, query, select, props, type);

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
             * The caller's filter is dropped, but access never widens.
             */
            (query as any)[accessControlColumn] = accessControlIds;
          }
        }
      }
    }

    return query;
  }

  @CaptureSpan()
  public static getAccessControlIdsForModel(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
    context?: AccessControlPermissionContext,
  ): Array<ObjectID> {
    context = context ?? this.buildPermissionContext(props);

    let labelIds: Array<ObjectID> = [];

    // check model level permissions.

    const modelLevelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);

    const modelLevelLabelIds: Array<ObjectID> =
      this.getAccessControlIdsByPermissions(modelLevelPermissions, context);

    labelIds = [...labelIds, ...modelLevelLabelIds];

    // get distinct labelIds
    const distinctLabelIds: Array<ObjectID> =
      ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);

    return distinctLabelIds;
  }

  @CaptureSpan()
  public static getAccessControlIdsForQuery<TBaseModel extends BaseModel>(
    modelType: DatabaseBaseModelType,
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<ObjectID> {
    const model: BaseModel = new modelType();

    let labelIds: Array<ObjectID> = [];

    let columnsToCheckPermissionFor: Array<string> = Object.keys(query);

    if (select) {
      columnsToCheckPermissionFor = [
        ...columnsToCheckPermissionFor,
        ...Object.keys(select),
      ];
    }

    // Build the permission context once — not per column.
    const context: AccessControlPermissionContext =
      this.buildPermissionContext(props);

    labelIds = this.getAccessControlIdsForModel(
      modelType,
      props,
      type,
      context,
    );

    const columnAccessControlDictionary: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of columnsToCheckPermissionFor) {
      const accessControl: ColumnAccessControl | null =
        columnAccessControlDictionary[column] || null;

      if (!accessControl) {
        continue;
      }

      if (type === DatabaseRequestType.Read && accessControl.read) {
        const columnReadLabelIds: Array<ObjectID> =
          this.getAccessControlIdsByPermissions(accessControl.read, context);

        labelIds = [...labelIds, ...columnReadLabelIds];
      }

      if (type === DatabaseRequestType.Create && accessControl.create) {
        const columnCreateLabelIds: Array<ObjectID> =
          this.getAccessControlIdsByPermissions(accessControl.create, context);

        labelIds = [...labelIds, ...columnCreateLabelIds];
      }

      if (type === DatabaseRequestType.Update && accessControl.update) {
        const columnUpdateLabelIds: Array<ObjectID> =
          this.getAccessControlIdsByPermissions(accessControl.update, context);

        labelIds = [...labelIds, ...columnUpdateLabelIds];
      }
    }

    // get distinct labelIds
    const distinctLabelIds: Array<ObjectID> =
      ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);
    return distinctLabelIds;
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
    };
  }

  private static getAccessControlIdsByPermissions(
    permissions: Array<Permission>,
    context: AccessControlPermissionContext,
  ): Array<ObjectID> {
    let labelIds: Array<ObjectID> = [];

    if (
      PermissionHelper.doesPermissionsIntersect(
        permissions,
        context.nonAccessControlPermissions,
      )
    ) {
      return []; // if this is intersecting, then return empty array. We dont need to check for access control.
    }

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

    return labelIds;
  }
}
