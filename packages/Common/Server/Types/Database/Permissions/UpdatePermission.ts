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
  @CaptureSpan()
  public static async checkUpdatePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    await AccessControlUtil.checkAccessControlBlockPermissionByModel<TBaseModel>(
      { ...data, type: DatabaseRequestType.Update },
    );

    await AccessControlUtil.checkAccessControlPermissionByModel<TBaseModel>({
      ...data,
      type: DatabaseRequestType.Update,
    });
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
     * security (disabling an identity provider, rotating a SCIM token) needs
     * no license, anything else does (see EditionPermission). TablePermission
     * leaves updates to this method for that reason.
     *
     * Master admins skip every table-level check below, but not the edition
     * check: changing enterprise configuration (global SSO/OIDC providers are
     * only ever edited by master admins) needs the license for them too.
     * Everyone else gets it right after the table-level check.
     */
    if (props.isMasterAdmin && !props.isRoot) {
      EditionPermissions.checkEditionPermissions(
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
    );

    EditionPermissions.checkEditionPermissions(
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
