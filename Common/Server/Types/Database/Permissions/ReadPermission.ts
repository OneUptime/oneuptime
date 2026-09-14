import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import RelationSelect from "../RelationSelect";
import Select from "../Select";
import SelectUtil from "../SelectUtil";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import TablePermission from "./TablePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Permission, { UserPermission } from "../../../../Types/Permission";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import { FindOperator } from "typeorm";

export interface CheckReadPermissionType<TBaseModel extends BaseModel>
  extends CheckPermissionBaseInterface<TBaseModel> {
  select: Select<TBaseModel> | null;
  relationSelect: RelationSelect<TBaseModel> | null;
}

export default class ReadPermission {
  @CaptureSpan()
  public static async checkReadPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckReadPermissionType<TBaseModel>> {
    // Block and base permission checks both add predicates to the query.
    query = { ...query };

    // check block permission first.
    await this.checkReadBlockPermission(modelType, query, props);

    const baseFunctionReturn: CheckPermissionBaseInterface<TBaseModel> =
      await BasePermission.checkPermissions(
        modelType,
        query,
        select,
        props,
        DatabaseRequestType.Read,
      );

    // upate query
    query = baseFunctionReturn.query;

    let relationSelect: RelationSelect<TBaseModel> = {};

    if (select) {
      const result: {
        select: Select<TBaseModel>;
        relationSelect: RelationSelect<TBaseModel>;
      } = SelectUtil.sanitizeSelect(modelType, select);
      select = result.select;
      relationSelect = result.relationSelect;
    }

    return { query, select, relationSelect };
  }

  @CaptureSpan()
  public static async checkReadBlockPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckPermissionBaseInterface<TBaseModel>> {
    // If system is making this query then let the query run!
    if (props.isRoot || props.isMasterAdmin) {
      return { query };
    }

    TablePermission.checkTableLevelBlockPermissions(
      modelType,
      props,
      DatabaseRequestType.Read,
    );

    const blockPermissionWithLabels: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ).filter((permission: UserPermission) => {
        return permission.labelIds && permission.labelIds.length > 0;
      });

    if (blockPermissionWithLabels.length === 0) {
      return { query };
    }

    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, DatabaseRequestType.Read);

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
      return { query };
    }

    let labelIds: Array<ObjectID> = [];

    for (const blockPermissionBelongToThisModel of blockPermissionsBelongToThisModel) {
      if (blockPermissionBelongToThisModel.labelIds) {
        labelIds = [...labelIds, ...blockPermissionBelongToThisModel.labelIds];
      }
    }

    const model: TBaseModel = new modelType();
    const accessControlColumn: string | null = model.getAccessControlColumn();
    const manyToManyMeta: ReturnType<
      typeof QueryUtil.getManyToManyRelationMetadata
    > = accessControlColumn
      ? QueryUtil.getManyToManyRelationMetadata(modelType, accessControlColumn)
      : null;

    if (!manyToManyMeta) {
      throw new BadDataException(
        "Cannot apply read label restrictions without access-control relation metadata.",
      );
    }

    const idQuery: Query<TBaseModel> = QueryUtil.serializeQuery(modelType, {
      _id: query._id,
    } as Query<TBaseModel>);
    const existingIdFilter: unknown = idQuery._id;
    if (
      existingIdFilter !== undefined &&
      typeof existingIdFilter !== "string" &&
      !(existingIdFilter instanceof FindOperator)
    ) {
      throw new BadDataException(
        "Cannot combine read label restrictions with an unsupported ID filter.",
      );
    }

    /*
     * Keep the caller's label selection intact. Blocking labels is a separate
     * condition on the owner: it must have none of the blocked label links.
     * Applying that condition to _id also lets grouped dashboard label filters
     * and existing record selectors reach QueryUtil without being replaced.
     * Serialize the ID condition first because QueryUtil does not descend into
     * the database AND operator to convert application query operators later.
     */
    (query as any)._id = combineWithPrivacyClause(
      existingIdFilter,
      QueryHelper.noneEntitiesInManyToMany({
        values: labelIds,
        ...manyToManyMeta,
      }),
    );

    return { query };
  }
}
