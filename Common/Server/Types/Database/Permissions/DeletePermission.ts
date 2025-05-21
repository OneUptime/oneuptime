import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import AccessControlUtil from "./AccessControlPermission";
import PermissionUtil from "./PermissionsUtil";
import TablePermission from "./TablePermission";
import TenantPermission from "./TenantPermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class DeletePermission {
  @CaptureSpan()
  public static async checkDeletePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    // check block permission first
    await AccessControlUtil.checkAccessControlBlockPermissionByModel<TBaseModel>(
      { ...data, type: DatabaseRequestType.Delete },
    );

    await AccessControlUtil.checkAccessControlPermissionByModel<TBaseModel>({
      ...data,
      type: DatabaseRequestType.Delete,
    });
  }

  @CaptureSpan()
  public static async checkDeletePermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      query = await PermissionUtil.addTenantScopeToQueryAsRoot(
        modelType,
        query,
        props,
      );
    }

    if (!props.isRoot && !props.isMasterAdmin) {
      // Does the user have permission to delete the object in this table? If no, then throw an error.
      TablePermission.checkTableLevelPermissions(
        modelType,
        props,
        DatabaseRequestType.Delete,
      );

      // Add tenant scope to query.
      query = await TenantPermission.addTenantScopeToQuery(
        modelType,
        query,
        null,
        props,
        DatabaseRequestType.Delete,
      );

      // add access control ids to query
      query = await AccessControlUtil.addAccessControlIdsToQuery(
        modelType,
        query,
        null,
        props,
        DatabaseRequestType.Delete,
      );
    }

    return query;
  }
}
