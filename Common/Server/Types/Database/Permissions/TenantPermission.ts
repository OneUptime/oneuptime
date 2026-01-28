import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class TenantPermission {
  @CaptureSpan()
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
      /*
       * for each of these projectIds,
       * check if they have valid permissions for these projects
       * and if they do, include them in the query.
       */

      const queries: Array<Query<TBaseModel>> = [];

      let projectIDs: Array<ObjectID> = [];

      if (
        props.userGlobalAccessPermission &&
        props.userGlobalAccessPermission.projectIds
      ) {
        projectIDs = props.userGlobalAccessPermission?.projectIds;
      }

      /*
       * Check if the query already has a filter on the tenant column (e.g., projectId filter)
       * If so, only iterate through projects that match both the filter AND user's permissions
       */
      const existingTenantFilter: unknown = (query as any)[tenantColumn];
      if (existingTenantFilter && existingTenantFilter instanceof Includes) {
        const filterValues: Array<string> = (
          existingTenantFilter as Includes
        ).values.map((v: string | ObjectID | number) => {
          return v.toString();
        });
        // Filter projectIDs to only include those that are in the filter
        projectIDs = projectIDs.filter((pid: ObjectID) => {
          return filterValues.includes(pid.toString());
        });
        // Remove the tenant filter from query since we're handling it via projectIDs iteration
        delete (query as any)[tenantColumn];
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
