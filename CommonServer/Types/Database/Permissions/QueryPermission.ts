import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import ColumnPermissions from "./ColumnPermission";
import BaseModel, { BaseModelType } from "Common/Models/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Columns from "Common/Types/Database/Columns";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "Common/Types/Permission";
import Typeof from "Common/Types/Typeof";

export default class QueryPermission {
  public static checkRelationQueryPermission<TBaseModel extends BaseModel>(
    modelType: BaseModelType,
    select: Select<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();
    const userPermissions: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).map((i: UserPermission) => {
        return i.permission;
      });

    const excludedColumnNames: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    for (const key in select) {
      if (typeof (select as JSONObject)[key] === Typeof.Object) {
        const tableColumnMetadata: TableColumnMetadata =
          model.getTableColumnMetadata(key);

        if (!tableColumnMetadata.modelType) {
          throw new BadDataException(
            "Select not supported on " +
              key +
              " of " +
              model.singularName +
              " because this column modelType is not found.",
          );
        }

        const relatedModel: BaseModel = new tableColumnMetadata.modelType();

        if (
          tableColumnMetadata.type === TableColumnType.Entity ||
          tableColumnMetadata.type === TableColumnType.EntityArray
        ) {
          for (const innerKey in (select as any)[key]) {
            // check for permissions.
            if (typeof (select as any)[key][innerKey] === Typeof.Object) {
              throw new BadDataException(
                "You cannot query deep relations. Querying deep relations is not supported.",
              );
            }

            const getRelatedTableColumnMetadata: TableColumnMetadata =
              relatedModel.getTableColumnMetadata(innerKey);

            if (!getRelatedTableColumnMetadata) {
              throw new BadDataException(
                `Column ${innerKey} not found on ${relatedModel.singularName}`,
              );
            }

            if (
              !getRelatedTableColumnMetadata.canReadOnRelationQuery &&
              !excludedColumnNames.includes(innerKey)
            ) {
              throw new BadDataException(
                `Column ${innerKey} on ${relatedModel.singularName} does not support read on relation query.`,
              );
            }

            if (getRelatedTableColumnMetadata.canReadOnRelationQuery) {
              continue;
            }

            // check if the user has permission to read this column
            if (userPermissions) {
              const hasPermission: boolean = relatedModel.hasReadPermissions(
                userPermissions,
                innerKey,
              );

              if (!hasPermission) {
                let readPermissions: Array<Permission> = [];
                if (relatedModel.getColumnAccessControlFor(innerKey)) {
                  readPermissions =
                    relatedModel.getColumnAccessControlFor(innerKey)!.read;
                }

                throw new NotAuthorizedException(
                  `You do not have permissions to read ${
                    relatedModel.singularName
                  } on ${
                    model.singularName
                  }. You need one of these permissions: ${PermissionHelper.getPermissionTitles(
                    readPermissions,
                  ).join(", ")}`,
                );
              }
            }
          }
        }
      }
    }
  }

  public static checkQueryPermission<TBaseModel extends BaseModel>(
    modelType: BaseModelType,
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();

    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const canReadOnTheseColumns: Columns =
      ColumnPermissions.getModelColumnsByPermissions(
        modelType,
        userPermissions || [],
        DatabaseRequestType.Read,
      );

    const tableColumns: Array<string> = model.getTableColumns().columns;

    const excludedColumnNames: Array<string> =
      ColumnPermissions.getExcludedColumnNames();

    // Now we need to check all columns.

    for (const key in query) {
      if (excludedColumnNames.includes(key)) {
        continue;
      }

      if (!canReadOnTheseColumns.columns.includes(key)) {
        if (!tableColumns.includes(key)) {
          throw new BadDataException(
            `Invalid column on ${model.singularName} - ${key}. Column does not exist.`,
          );
        }

        throw new NotAuthorizedException(
          `You do not have permissions to query on - ${key}. You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
            model.getColumnAccessControlFor(key)
              ? model.getColumnAccessControlFor(key)!.read
              : [],
          ).join(", ")}`,
        );
      }
    }
  }
}
