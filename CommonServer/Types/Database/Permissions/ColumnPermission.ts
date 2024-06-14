import { IsBillingEnabled, getAllEnvVars } from "../../../EnvironmentConfig";
import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BaseModel from "Common/Models/BaseModel";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "Common/Types/BaseDatabase/ColumnBillingAccessControl";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import Columns from "Common/Types/Database/Columns";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "Common/Types/Permission";

export default class ColumnPermissions {
  public static getExcludedColumnNames(): string[] {
    const returnArr: Array<string> = [
      "_id",
      "createdAt",
      "deletedAt",
      "updatedAt",
      "version",
    ];

    return returnArr;
  }

  public static getModelColumnsByPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    userPermissions: Array<UserPermission>,
    requestType: DatabaseRequestType,
  ): Columns {
    const model: BaseModel = new modelType();
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const columns: Array<string> = [];

    const permissions: Array<Permission> = userPermissions.map(
      (item: UserPermission) => {
        return item.permission;
      },
    );

    for (const key in accessControl) {
      let columnPermissions: Array<Permission> = [];

      if (requestType === DatabaseRequestType.Read) {
        columnPermissions = accessControl[key]?.read || [];
      }

      if (requestType === DatabaseRequestType.Create) {
        columnPermissions = accessControl[key]?.create || [];
      }

      if (requestType === DatabaseRequestType.Update) {
        columnPermissions = accessControl[key]?.update || [];
      }

      if (requestType === DatabaseRequestType.Delete) {
        throw new BadDataException("Invalid request type delete");
      }

      if (
        columnPermissions &&
        PermissionHelper.doesPermissionsIntersect(
          permissions,
          columnPermissions,
        )
      ) {
        columns.push(key);
      }
    }

    return new Columns(columns);
  }

  public static checkDataColumnPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
    requestType: DatabaseRequestType,
  ): void {
    const model: BaseModel = new modelType();
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const permissionColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      userPermissions,
      requestType,
    );

    const excludedColumnNames: Array<string> = this.getExcludedColumnNames();

    const tableColumns: Array<string> = model.getTableColumns().columns;

    for (const key of Object.keys(data)) {
      if ((data as any)[key] === undefined) {
        continue;
      }

      if (excludedColumnNames.includes(key)) {
        continue;
      }

      if (!tableColumns.includes(key)) {
        continue;
      }

      const tableColumnMetadata: TableColumnMetadata =
        model.getTableColumnMetadata(key);

      if (!tableColumnMetadata) {
        throw new BadDataException(
          `No TableColumnMetadata found for ${key} column of ${model.singularName}`,
        );
      }

      if (tableColumnMetadata.type === TableColumnType.Slug) {
        continue;
      }

      if (
        !permissionColumns.columns.includes(key) &&
        tableColumns.includes(key)
      ) {
        if (
          requestType === DatabaseRequestType.Create &&
          tableColumnMetadata.forceGetDefaultValueOnCreate
        ) {
          continue; // this is a special case where we want to force the default value on create.
        }

        throw new BadDataException(
          `User is not allowed to ${requestType} on ${key} column of ${model.singularName}`,
        );
      }

      if (
        IsBillingEnabled &&
        props.currentPlan &&
        model.getColumnBillingAccessControl(key)
      ) {
        const billingAccessControl: ColumnBillingAccessControl =
          model.getColumnBillingAccessControl(key);

        if (
          requestType === DatabaseRequestType.Create &&
          billingAccessControl.create
        ) {
          if (
            !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
              billingAccessControl.create,
              props.currentPlan,
              getAllEnvVars(),
            )
          ) {
            throw new PaymentRequiredException(
              "Please upgrade your plan to " +
                billingAccessControl.create +
                " to access this feature",
            );
          }
        }

        if (
          requestType === DatabaseRequestType.Read &&
          billingAccessControl.read
        ) {
          if (
            !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
              billingAccessControl.read,
              props.currentPlan,
              getAllEnvVars(),
            )
          ) {
            throw new PaymentRequiredException(
              "Please upgrade your plan to " +
                billingAccessControl.read +
                " to access this feature",
            );
          }
        }

        if (
          requestType === DatabaseRequestType.Update &&
          billingAccessControl.update
        ) {
          if (
            !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
              billingAccessControl.update,
              props.currentPlan,
              getAllEnvVars(),
            )
          ) {
            throw new PaymentRequiredException(
              "Please upgrade your plan to " +
                billingAccessControl.update +
                " to access this feature",
            );
          }
        }
      }
    }
  }
}
