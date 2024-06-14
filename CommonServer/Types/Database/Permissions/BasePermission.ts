import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryUtil from "../QueryUtil";
import Select from "../Select";
import AccessControlPermission from "./AccessControlPermission";
import PermissionUtil from "./PermissionsUtil";
import PublicPermission from "./PublicPermission";
import QueryPermission from "./QueryPermission";
import SelectPermission from "./SelectPermission";
import TablePermission from "./TablePermission";
import TenantPermission from "./TenantPermission";
import UserPermissions from "./UserPermission";
import BaseModel from "Common/Models/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import ObjectID from "Common/Types/ObjectID";

export interface CheckPermissionBaseInterface<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
}

export default class BasePermission {
  public static async checkPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<CheckPermissionBaseInterface<TBaseModel>> {
    const model: BaseModel = new modelType();

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
      );

      // add user scope if any
      query = await UserPermissions.addUserScopeToQuery(
        modelType,
        query,
        props,
      );

      if (!props.isMultiTenantRequest) {
        // We will check for this permission in recursive function.

        // check model level permissions.
        TablePermission.checkTableLevelPermissions(modelType, props, type);

        // We will check for this permission in recursive function.
        // check query permissions.
        QueryPermission.checkQueryPermission(modelType, query, props);

        query = await AccessControlPermission.addAccessControlIdsToQuery(
          modelType,
          query,
          select,
          props,
          type,
        );

        /// Implement Related Permissions.
        if (model.canAccessIfCanReadOn) {
          const tableColumnMetadata: TableColumnMetadata =
            model.getTableColumnMetadata(model.canAccessIfCanReadOn);

          if (
            tableColumnMetadata &&
            tableColumnMetadata.modelType &&
            (tableColumnMetadata.type === TableColumnType.Entity ||
              tableColumnMetadata.type === TableColumnType.EntityArray)
          ) {
            const accessControlIds: Array<ObjectID> =
              AccessControlPermission.getAccessControlIdsForQuery(
                tableColumnMetadata.modelType,
                {},
                {
                  _id: true,
                },
                props,
                type,
              );

            if (accessControlIds.length > 0) {
              const tableColumnMetadataModel: BaseModel =
                new tableColumnMetadata.modelType();

              (query as any)[model.canAccessIfCanReadOn as string] = {
                [tableColumnMetadataModel.getAccessControlColumn() as string]:
                  accessControlIds,
              };
            }
          }
        }

        if (select) {
          // check query permission.
          SelectPermission.checkSelectPermission(modelType, select, props);
          QueryPermission.checkRelationQueryPermission(
            modelType,
            select,
            props,
          );
        }
      }
    }

    query = QueryUtil.serializeQuery(modelType, query);

    return { query };
  }
}
