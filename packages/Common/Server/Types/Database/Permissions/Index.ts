import QueryDeepPartialEntity from "../../../../Types/Database/PartialEntity";
import Query from "../Query";
import Select from "../Select";
import CreatePermission from "./CreatePermission";
import DeletePermission from "./DeletePermission";
import ReadPermission, { CheckReadPermissionType } from "./ReadPermission";
import TablePermission from "./TablePermission";
import UpdatePermission from "./UpdatePermission";
import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import CallerPlan from "../../../Utils/Billing/CallerPlan";

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
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    data = {
      ...data,
      props: await CallerPlan.withPlanFor({
        props: data.props,
        modelType: data.modelType,
        type: DatabaseRequestType.Delete,
      }),
    };

    try {
      return await DeletePermission.checkDeletePermissionByModel(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
    }
  }

  /*
   * `updateData` is what the update writes, when the caller has it: below
   * the table's update plan, an update that only switches the record off
   * still passes the plan check (BillingPermission).
   */
  @CaptureSpan()
  public static async checkUpdatePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    props: DatabaseCommonInteractionProps;
    updateData?: unknown;
  }): Promise<void> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    data = {
      ...data,
      props: await CallerPlan.withPlanFor({
        props: data.props,
        modelType: data.modelType,
        type: DatabaseRequestType.Update,
        data: data.updateData,
      }),
    };

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
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    props = await CallerPlan.withPlanFor({
      props: props,
      modelType: modelType,
      type: DatabaseRequestType.Delete,
    });

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

  /*
   * The part of a create, update or delete permission check that does not
   * depend on what is written or on which rows: may this caller write this
   * table at all, in the project the request is made in. The full checks
   * (checkCreatePermissions, checkUpdateQueryPermissions,
   * checkDeleteQueryPermission) ask the same question first, so this refuses
   * nothing they would let through. DatabaseService asks it before a
   * service's hooks run, so a hook never acts for a caller the write is
   * going to be refused for anyway.
   *
   * For an update, `updateData` is what the caller asked to write: below
   * the table's update plan, an update that only switches records off is
   * allowed (BillingPermission), and only the data shows that.
   */
  public static checkTableWritePermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    type:
      | DatabaseRequestType.Create
      | DatabaseRequestType.Update
      | DatabaseRequestType.Delete,
    updateData?: unknown,
  ): void {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    try {
      if (type === DatabaseRequestType.Create) {
        CreatePermission.checkCreateBlockPermissions(modelType, props);
      }

      TablePermission.checkTableLevelPermissions(
        modelType,
        props,
        type,
        updateData,
      );
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, props);
    }
  }

  /*
   * The rows an update may change, as a query - see
   * UpdatePermission.getUpdatableQuery. For a root or master admin caller the
   * query comes back as it is. `updateData` is what the update writes, when
   * the caller already has it (for the plan check, see BillingPermission).
   */
  @CaptureSpan()
  public static async getUpdatableQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    updateData?: unknown,
  ): Promise<Query<TBaseModel>> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    props = await CallerPlan.withPlanFor({
      props: props,
      modelType: modelType,
      type: DatabaseRequestType.Update,
      data: updateData,
    });

    try {
      return await UpdatePermission.getUpdatableQuery(
        modelType,
        query,
        props,
        updateData,
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
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    props = await CallerPlan.withPlanFor({
      props: props,
      modelType: modelType,
      type: DatabaseRequestType.Update,
      data: data,
    });

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
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

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
    props = await CallerPlan.withPlanFor({
      props: props,
      modelType: modelType,
      type: DatabaseRequestType.Read,
    });

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
