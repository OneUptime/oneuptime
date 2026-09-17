import QueryDeepPartialEntity from "../../../../Types/Database/PartialEntity";
import Query from "../Query";
import Select from "../Select";
import CreatePermission from "./CreatePermission";
import DeletePermission from "./DeletePermission";
import ReadPermission, { CheckReadPermissionType } from "./ReadPermission";
import UpdatePermission from "./UpdatePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class ModelPermission {
  @CaptureSpan()
  public static async checkDeletePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    return DeletePermission.checkDeletePermissionByModel(data);
  }

  @CaptureSpan()
  public static async checkUpdatePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    return UpdatePermission.checkUpdatePermissionByModel(data);
  }

  @CaptureSpan()
  public static async checkDeleteQueryPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    return DeletePermission.checkDeletePermission(modelType, query, props);
  }

  @CaptureSpan()
  public static async checkUpdateQueryPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    data: QueryDeepPartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    return UpdatePermission.checkUpdatePermissions(
      modelType,
      query,
      data,
      props,
    );
  }

  @CaptureSpan()
  public static checkCreatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    return CreatePermission.checkCreatePermissions(modelType, data, props);
  }

  @CaptureSpan()
  public static async checkReadQueryPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckReadPermissionType<TBaseModel>> {
    return ReadPermission.checkReadPermission(modelType, query, select, props);
  }
}
