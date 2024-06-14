import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import BaseModel from "Common/Models/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";

export default class TenantPermission {
  public static async addTenantScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    const tenantColumn: string | null = model.getTenantColumn();

    if (props.isMultiTenantRequest && !model.canQueryMultiTenant()) {
      throw new BadDataException(
        `isMultiTenantRequest not allowed on ${model.singularName}`,
      );
    }

    // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
    if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
      (query as any)[tenantColumn] = props.tenantId;
    }
    // if model allows user query without tenant, and user column is present, and userId is present, then add userId to query.
    else if (
      model.isUserQueryWithoutTenantAllowed() &&
      model.getUserColumn() &&
      props.userId
    ) {
      (query as any)[model.getUserColumn() as string] = props.userId;
    } else if (
      tenantColumn &&
      !props.tenantId &&
      props.userGlobalAccessPermission
    ) {
      // for each of these projectIds,
      // check if they have valid permissions for these projects
      // and if they do, include them in the query.

      const queries: Array<Query<TBaseModel>> = [];

      let projectIDs: Array<ObjectID> = [];

      if (
        props.userGlobalAccessPermission &&
        props.userGlobalAccessPermission.projectIds
      ) {
        projectIDs = props.userGlobalAccessPermission?.projectIds;
      }

      let lastException: Error | null = null;

      for (const projectId of projectIDs) {
        if (!props.userId) {
          continue;
        }

        try {
          const checkBasePermissions: CheckPermissionBaseInterface<TBaseModel> =
            await BasePermission.checkPermissions(
              modelType,
              query,
              select,
              {
                ...props,
                isMultiTenantRequest: false,
                tenantId: projectId,
                userTenantAccessPermission: props.userTenantAccessPermission,
              },
              type,
            );

          queries.push({
            ...checkBasePermissions.query,
          });
        } catch (e) {
          // do nothing here. Ignore.
          lastException = e as Error;
        }
      }

      if (queries.length === 0) {
        throw new NotAuthorizedException(
          lastException?.message ||
            "Does not have permission to read " + model.singularName,
        );
      }

      return queries as any;
    }

    return query;
  }
}
