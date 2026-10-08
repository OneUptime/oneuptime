import {
  IsBillingEnabled,
  getAllEnvVars,
} from "../../../../Server/EnvironmentConfig";
import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { isPlanGatedColumnDefault } from "../../../../Types/Billing/PlanGatedColumnDefault";
import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import Columns from "../../../../Types/Database/Columns";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";

import Permission, { UserPermission } from "../../../../Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import TablePermission from "./TablePermission";

import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import logger from "../../../Utils/Logger";
import CallerPlan from "../../../Utils/Billing/CallerPlan";
import PlanGates from "./PlanGates";
import ColumnWriteRefusedException from "./ColumnWriteRefusedException";

export default class ColumnPermissions {
  @CaptureSpan()
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

  /*
   * The caller's permission rows as a column check reads them - the rows the
   * table check weighs (DatabaseCommonInteractionPropsUtil
   * .getPermissionRows), so a column follows the rule a table does.
   */
  public static getColumnCheckRows(
    props: DatabaseCommonInteractionProps,
  ): Array<UserPermission> {
    return DatabaseCommonInteractionPropsUtil.getPermissionRows(props);
  }

  /*
   * The columns `userPermissions` (a caller's permission rows) may read,
   * create or update, by the rule every permission check follows
   * (HeldPermissionsUtil.holdsColumnPermission): an allow row for one of the
   * column's permissions, and no block with no labels on any of them. On an
   * operational resource, a column that lets in everyone its table does for
   * the operation accepts the table's *AllOperationalResources wildcard
   * too, as the table check does; a column narrower than its table on
   * purpose keeps exactly its own list.
   */
  @CaptureSpan()
  public static getModelColumnsByPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    userPermissions: Array<UserPermission>,
    requestType: DatabaseRequestType,
  ): Columns {
    const model: BaseModel = new modelType();
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const columns: Array<string> = [];

    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: userPermissions,
    });

    const tablePermissions: Array<Permission> =
      requestType === DatabaseRequestType.Delete
        ? []
        : TablePermission.getTablePermission(
            modelType as DatabaseBaseModelType,
            requestType,
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
        HeldPermissionsUtil.holdsColumnPermission(held, {
          isOperationalResource: model.isOperationalResource,
          operation: requestType,
          tablePermissions: tablePermissions,
          columnPermissions: columnPermissions,
        })
      ) {
        columns.push(key);
      }
    }

    return new Columns(columns);
  }

  @CaptureSpan()
  public static checkDataColumnPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
    requestType: DatabaseRequestType,
  ): void {
    const model: BaseModel = new modelType();

    const permissionColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      ColumnPermissions.getColumnCheckRows(props),
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

        if (
          requestType === DatabaseRequestType.Create &&
          tableColumnMetadata.computed
        ) {
          continue; // computed columns are not allowed to be updated.
        }

        throw new ColumnWriteRefusedException({
          requestType: requestType,
          columnName: key,
          modelName: model.singularName,
        });
      }

      if (
        IsBillingEnabled &&
        model.getColumnBillingAccessControl(key) &&
        // No plan holds OneUptime itself or a server admin (CallerPlan).
        !CallerPlan.isHeldToNoPlan(props)
      ) {
        /*
         * A paid feature can always be switched off: a create or update that
         * puts a plan-gated column back to its default - the feature off,
         * what every plan's records start with - needs no plan (see
         * PlanGatedColumnDefault). Anything else written to it still does.
         */
        if (
          (requestType === DatabaseRequestType.Create ||
            requestType === DatabaseRequestType.Update) &&
          isPlanGatedColumnDefault(tableColumnMetadata, (data as any)[key])
        ) {
          continue;
        }

        const requiredPlan: PlanType | undefined = PlanGates.getColumnPlan(
          model.getColumnBillingAccessControl(key),
          requestType,
        );

        if (!requiredPlan) {
          continue;
        }

        /*
         * No plan on props that act in a project is never "any plan": the
         * write is refused (CallerPlan), unless every plan includes the
         * column. OneUptime itself and server admins need no plan.
         */
        if (!props.currentPlan) {
          if (!PlanGates.isMetByEveryPlan(requiredPlan)) {
            CallerPlan.assertPlanKnown(props);
          }

          continue;
        }

        if (
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
            requiredPlan,
            props.currentPlan,
            getAllEnvVars(),
          )
        ) {
          logger.debug(
            `${requestType} on ${key} column of ${model.singularName} needs the ${requiredPlan} plan.`,
          );

          throw new PaymentRequiredException(
            "Please upgrade your plan to " +
              requiredPlan +
              " to access this feature",
          );
        }
      }
    }
  }
}
