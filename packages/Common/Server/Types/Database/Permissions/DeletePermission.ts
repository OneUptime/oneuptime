import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import AccessControlUtil from "./AccessControlPermission";
import BasePermission from "./BasePermission";
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
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    // The team's blocks, then the grants limited to labels, on one read.
    await AccessControlUtil.checkRecordByModel<TBaseModel>({
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
    query = { ...query };

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

      /*
       * The records a delete reaches, by the rule a read and an update
       * follow: label grants, owned records, the record a model is read
       * through, and the label rule with the team's blocks
       * (BasePermission.addRecordScopeToQuery). A request across projects
       * comes back from the tenant scope as one query per project, each
       * already narrowed with that project's own rows.
       */
      if (!Array.isArray(query)) {
        query = await BasePermission.addRecordScopeToQuery(
          modelType,
          query,
          null,
          props,
          DatabaseRequestType.Delete,
        );
      }
    }

    return query;
  }
}
