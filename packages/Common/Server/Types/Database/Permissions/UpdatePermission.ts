import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import AccessControlUtil from "./AccessControlPermission";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import ColumnPermissions from "./ColumnPermission";
import EditionPermissions from "./EditionPermission";
import TablePermission from "./TablePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import QueryDeepPartialEntity from "../../../../Types/Database/PartialEntity";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class UpdatePermission {
  /*
   * `updateData`, when the caller has it, is what the update writes: below
   * the table's update plan an update that only switches the record off
   * still passes the plan check (BillingPermission). Without it, it does
   * not.
   */
  @CaptureSpan()
  public static async checkUpdatePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    updateData?: unknown;
  }): Promise<void> {
    await AccessControlUtil.checkAccessControlBlockPermissionByModel<TBaseModel>(
      { ...data, type: DatabaseRequestType.Update },
    );

    await AccessControlUtil.checkAccessControlPermissionByModel<TBaseModel>({
      ...data,
      type: DatabaseRequestType.Update,
    });
  }

  /*
   * The rows an update may change, as a query: the caller's query narrowed
   * exactly as checkUpdatePermissions narrows it (the project, the user, the
   * labels and the owned scope), and refused for the same table-level
   * reasons. What the update writes is left out: the edition and column
   * checks need the data a service's hooks have not finished with yet, and
   * checkUpdatePermissions asks them once they have. So this refuses nothing
   * that check would let through.
   *
   * `updateData`, when the caller already has it, is what the update
   * writes: the plan check needs it to let an update that only switches
   * records off through below the table's update plan (BillingPermission).
   * Without it, an update below the plan is refused here.
   */
  @CaptureSpan()
  public static async getUpdatableQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    updateData?: unknown,
  ): Promise<Query<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      updateData,
    );

    const checkBasePermission: CheckPermissionBaseInterface<TBaseModel> =
      await BasePermission.checkPermissions(
        modelType,
        query,
        null,
        props,
        DatabaseRequestType.Update,
        updateData,
      );

    return checkBasePermission.query;
  }

  @CaptureSpan()
  public static async checkUpdatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    data: QueryDeepPartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    /*
     * The edition check for updates runs here, the one permission entry
     * point that sees what the update writes: an update that only tightens
     * security (rotating a SCIM token) needs no license, anything else does
     * (see EditionPermission). TablePermission leaves updates to this method
     * for that reason.
     *
     * Master admins skip every table-level check below, but not the edition
     * check: changing enterprise configuration (a master admin can edit any
     * project's SCIM configuration and team compliance settings) needs the
     * license for them too. Everyone else gets it right after the
     * table-level check.
     */
    if (props.isMasterAdmin && !props.isRoot) {
      EditionPermissions.checkEditionPermissions(
        modelType,
        props,
        DatabaseRequestType.Update,
        data,
      );
      EditionPermissions.checkEnterpriseColumnPermissions(
        modelType,
        props,
        DatabaseRequestType.Update,
        data,
      );
    }

    if (props.isRoot || props.isMasterAdmin) {
      // If system is making this query then let the query run!
      return query;
    }

    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      data,
    );

    EditionPermissions.checkEditionPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      data,
    );

    EditionPermissions.checkEnterpriseColumnPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      data,
    );

    const checkBasePermission: CheckPermissionBaseInterface<TBaseModel> =
      await BasePermission.checkPermissions(
        modelType,
        query,
        null,
        props,
        DatabaseRequestType.Update,
        data,
      );

    query = checkBasePermission.query;

    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      data as any,
      props,
      DatabaseRequestType.Update,
    );

    return query;
  }
}
