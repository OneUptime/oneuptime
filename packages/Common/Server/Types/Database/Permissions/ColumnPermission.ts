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
import ServerOwned from "../../../../Types/Database/ServerOwned";
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
import ServerSetColumns from "../../../Utils/Database/ServerSetColumns";
import PlanGates from "./PlanGates";
import ColumnWriteRefusedException from "./ColumnWriteRefusedException";
import ComputedColumnsReplacedOnCreate from "./ComputedColumnsReplacedOnCreate";

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
   * A column's own list for a write - who may give a new record a value in
   * it (create), or change it (update) - as a refusal of the write names
   * them (ColumnRefusalMessage). Empty for a column only OneUptime writes.
   */
  public static getColumnWriteList(
    model: BaseModel,
    column: string,
    requestType: DatabaseRequestType,
  ): Array<Permission> {
    const accessControl: ColumnAccessControl | null =
      model.getColumnAccessControlFor(column);

    if (requestType === DatabaseRequestType.Update) {
      return accessControl?.update || [];
    }

    return accessControl?.create || [];
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

  /*
   * The server-set columns of `model` that `data` holds a value in - the
   * columns marked computed, which OneUptime fills in - as a create's column
   * check weighs them: not the columns it never asks about (the excluded
   * columns, a slug), nor one whose default is forced on every create
   * (forceGetDefaultValueOnCreate), which takes no value from anyone.
   */
  public static getComputedColumnsWithValue(
    model: BaseModel,
    data: BaseModel,
  ): Array<string> {
    const excludedColumnNames: Array<string> = this.getExcludedColumnNames();
    const columns: Array<string> = [];

    for (const column of model.getTableColumns().columns) {
      if ((data as unknown as Dictionary<unknown>)[column] === undefined) {
        continue;
      }

      if (excludedColumnNames.includes(column)) {
        continue;
      }

      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (
        !metadata?.computed ||
        metadata.type === TableColumnType.Slug ||
        metadata.forceGetDefaultValueOnCreate
      ) {
        continue;
      }

      columns.push(column);
    }

    return columns;
  }

  /*
   * A SERVER-SET COLUMN IS OURS TO FILL IN ON A CREATE: ASKED OF WHAT THE
   * CALLER SENT, BEFORE ANY HOOK RUNS (DatabaseService
   * .checkCreateBeforeHooks).
   *
   * A column marked computed is one OneUptime fills in: a number, a token, a
   * salt, whether a record's owners were told. A value a create gives one is
   * held to the column's create list, as every other column's is, and never
   * reaches the record unless the caller is on it. It is asked here, while
   * the record is still what the caller sent: the record the check after the
   * hooks reads holds what the hooks, the defaults and the hashing wrote too
   * - a salt, an incident's number - which are OneUptime's
   * (checkDataColumnPermissions, columnsSetByServer).
   *
   * A value the caller may not create is:
   *
   *   - dropped, when the caller may read the column: a record read and sent
   *     back whole - a copy, a record a workflow step passes on, a client that
   *     posts back what it got - carries every column its reader may read, so
   *     the create goes on as if the value had not been sent, and the
   *     column's service fills it in;
   *   - refused with the column's name, as an update is
   *     (ColumnWriteRefusedException), when the caller may not even read it -
   *     a salt, a token, a verification code's expiry: no record they could
   *     read carries it, so the value is one they made up - before a hook
   *     acts on the write.
   *
   * Two kinds of value pass as they are. One OneUptime's own code put there
   * for the person it writes as is marked on the record (ServerSetColumns).
   * And a column whose own declaration has always said that a value a
   * create sends is replaced (ComputedColumnsReplacedOnCreate) has the value
   * dropped whoever sends it.
   *
   * OneUptime itself and a server admin are not asked, as no column check
   * asks them. Returns the server-set columns the caller gave a value and
   * may create: the ones the check after the hooks holds to their lists.
   */
  @CaptureSpan()
  public static checkComputedColumnsSentOnCreate<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): Array<string> {
    if (props.isRoot || props.isMasterAdmin) {
      return [];
    }

    const model: BaseModel = new modelType();
    const columnsWithValue: Array<string> = this.getComputedColumnsWithValue(
      model,
      data,
    );

    if (columnsWithValue.length === 0) {
      return [];
    }

    const rows: Array<UserPermission> =
      ColumnPermissions.getColumnCheckRows(props);

    const permissionColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      rows,
      DatabaseRequestType.Create,
    );

    // The columns the caller may read, read once and only when it is asked.
    let readableColumns: Columns | null = null;

    const sentByCaller: Array<string> = [];

    for (const column of columnsWithValue) {
      // OneUptime's own code filled it in for the person it writes as.
      if (ServerSetColumns.isMarked(data, column)) {
        continue;
      }

      if (permissionColumns.columns.includes(column)) {
        sentByCaller.push(column);
        continue;
      }

      if (!readableColumns) {
        readableColumns = this.getModelColumnsByPermissions(
          modelType,
          rows,
          DatabaseRequestType.Read,
        );
      }

      if (
        ComputedColumnsReplacedOnCreate.isReplaced(model.tableName, column) ||
        readableColumns.columns.includes(column)
      ) {
        // Cleared, not deleted: `data` is the caller's model instance.
        (data as unknown as Dictionary<unknown>)[column] = undefined;
        continue;
      }

      throw new ColumnWriteRefusedException({
        requestType: DatabaseRequestType.Create,
        columnName: column,
        modelName: model.singularName,
        // Who may, for the refusal to say so - or that nobody may.
        permissions: ColumnPermissions.getColumnWriteList(
          model,
          column,
          DatabaseRequestType.Create,
        ),
      });
    }

    return sentByCaller;
  }

  /*
   * The columns a write's caller may not write are refused, each with its
   * name. On a create, a server-set column (computed) the caller may not
   * create passes only when OneUptime set it: one of `columnsSetByServer` -
   * the columns the create's own steps wrote, its hooks, the defaults and the
   * hashing (DatabaseService hands them over) - or one its own code marked on
   * this record for the person it writes as (ServerSetColumns). A value the
   * caller sent there was dropped or refused before the hooks ran
   * (checkComputedColumnsSentOnCreate); called without a list, as on a record
   * the caller built, every such value is the caller's and is refused here.
   */
  @CaptureSpan()
  public static checkDataColumnPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
    requestType: DatabaseRequestType,
    columnsSetByServer: Array<string> = [],
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

        // A server-set column holding OneUptime's value. See above.
        if (
          requestType === DatabaseRequestType.Create &&
          tableColumnMetadata.computed &&
          (columnsSetByServer.includes(key) ||
            ServerSetColumns.isMarked(data, key))
        ) {
          continue;
        }

        /*
         * A column only OneUptime writes, holding the value OneUptime's own
         * code filled in for the person it writes as (ServerSetColumns): the
         * serial number a network controller reported for a device it adds,
         * a device a person links to a Meraki appliance. Its lists need not
         * name the person: no person writes it (ColumnsOnlyOneUptimeWrites
         * takes every value they send out of the write, #10053).
         */
        if (
          tableColumnMetadata.serverOwned === ServerOwned.Always &&
          ServerSetColumns.isMarked(data, key)
        ) {
          continue;
        }

        throw new ColumnWriteRefusedException({
          requestType: requestType,
          columnName: key,
          modelName: model.singularName,
          // Who may, for the refusal to say so - or that nobody may.
          permissions: ColumnPermissions.getColumnWriteList(
            model,
            key,
            requestType,
          ),
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
