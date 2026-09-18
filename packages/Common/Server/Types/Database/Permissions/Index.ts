import QueryDeepPartialEntity from "../../../../Types/Database/PartialEntity";
import Query from "../Query";
import Select from "../Select";
import CreatePermission from "./CreatePermission";
import DeletePermission from "./DeletePermission";
import ReadPermission, { CheckReadPermissionType } from "./ReadPermission";
import UpdatePermission from "./UpdatePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class ModelPermission {
  /*
   * A refusal of a caller with no credentials at all is a 401.
   *
   * The login check near the top of every permission check passes an
   * anonymous caller straight through on models that are readable (or
   * creatable) by Public - Probe, AIAgent, LlmProvider and friends - and the
   * column, select and query checks that follow then refuse it with 422
   * NotAuthorizedException. For the dashboard that caller is a signed-in user
   * whose access-token cookie expired, and only a 401 makes the browser client
   * refresh the session and replay the request. Callers with credentials keep
   * the 422 they always got; the message is kept either way.
   */
  private static toAnonymousRefusal(
    error: unknown,
    props: DatabaseCommonInteractionProps,
  ): unknown {
    if (
      error instanceof NotAuthorizedException &&
      !props.isRoot &&
      !props.isMasterAdmin &&
      DatabaseCommonInteractionPropsUtil.isAnonymous(props)
    ) {
      return new NotAuthenticatedException(error.message);
    }

    return error;
  }

  @CaptureSpan()
  public static async checkDeletePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      return await DeletePermission.checkDeletePermissionByModel(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
    }
  }

  @CaptureSpan()
  public static async checkUpdatePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      return await UpdatePermission.checkUpdatePermissionByModel(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
    }
  }

  @CaptureSpan()
  public static async checkDeleteQueryPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    try {
      return await DeletePermission.checkDeletePermission(
        modelType,
        query,
        props,
      );
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, props);
    }
  }

  @CaptureSpan()
  public static async checkUpdateQueryPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    data: QueryDeepPartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    try {
      return await UpdatePermission.checkUpdatePermissions(
        modelType,
        query,
        data,
        props,
      );
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, props);
    }
  }

  @CaptureSpan()
  public static checkCreatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      return CreatePermission.checkCreatePermissions(modelType, data, props);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, props);
    }
  }

  @CaptureSpan()
  public static async checkReadQueryPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckReadPermissionType<TBaseModel>> {
    try {
      return await ReadPermission.checkReadPermission(
        modelType,
        query,
        select,
        props,
      );
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, props);
    }
  }
}
