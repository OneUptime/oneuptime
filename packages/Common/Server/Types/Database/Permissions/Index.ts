import QueryDeepPartialEntity from "../../../../Types/Database/PartialEntity";
import Query from "../Query";
import Select from "../Select";
import CreatePermission, {
  ReadableParentIdsFinder,
  RecordIdsFinder,
} from "./CreatePermission";
import CreateScopePermission, {
  LabelNamesFinder,
  RecordLabelsFinder,
} from "./CreateScopePermission";
import DeletePermission from "./DeletePermission";
import ReadPermission, { CheckReadPermissionType } from "./ReadPermission";
import RelationListPermission from "./RelationListPermission";
import TablePermission from "./TablePermission";
import UpdatePermission from "./UpdatePermission";
import UpdateScopePermission from "./UpdateScopePermission";
import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Dictionary from "../../../../Types/Dictionary";
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
    /*
     * Reads the record as root, with its labels and its project (the
     * tenant column): a record read without its project is answered as
     * missing to a caller whose blocks or grants are weighed on it
     * (AccessControlPermission.checkRecordByModel).
     */
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    /*
     * Whether a query finds a record of the table, run as root: lets the
     * check weigh the label rule on a record with no labels of its own,
     * through the records it names (AccessControlPermission).
     */
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
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
    // See checkDeletePermissionByModel.
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
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

  /*
   * A record read through another one is created only under a parent its
   * creator may read (CreatePermission.checkParentPermission). Asked by
   * DatabaseService before the create hooks run, and again after them
   * (`checkedParentIds`, what the first ask returned), which looks a parent
   * up only when a hook named other parents and decides a create that names
   * none. Returns the parent ids the create names.
   */
  @CaptureSpan()
  public static async checkCreateParentPermission<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
    // Reads the parents as the caller. See ReadableParentIdsFinder.
    findReadableParentIds: ReadableParentIdsFinder;
    // Reads them as OneUptime, in the project. See RecordIdsFinder.
    findParentIdsInProject: RecordIdsFinder;
    // Whether the write's service holds its references to its project.
    referencesCheckedInProject: boolean;
    checkedParentIds?: Array<string> | undefined;
  }): Promise<Array<string>> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    try {
      return await CreatePermission.checkParentPermission(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
    }
  }

  /*
   * An update that moves a record read through another one to a parent it
   * does not have goes only to a parent its caller may read
   * (UpdatePermission.checkParentPermission). Asked by DatabaseService
   * before the update hooks run, with the parents each record it writes has
   * now, and again after them (`checkedParentIds`) should a hook name
   * others. Returns the parent ids the update names.
   */
  @CaptureSpan()
  public static async checkUpdateParentPermission<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    data: unknown;
    props: DatabaseCommonInteractionProps;
    heldParentIds: Array<Array<string>>;
    findReadableParentIds: ReadableParentIdsFinder;
    findParentIdsInProject: RecordIdsFinder;
    referencesCheckedInProject: boolean;
    checkedParentIds?: Array<string> | undefined;
  }): Promise<Array<string>> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    try {
      return await UpdatePermission.checkParentPermission(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
    }
  }

  /*
   * The records a create or an update names - an incident's monitors, a
   * maintenance event's status pages, an alert's monitor - are records its
   * caller may read (RelationListPermission.checkNamedLists). Asked by
   * DatabaseService before the hooks run, on what the caller sent, and again
   * after them on the records a hook named besides (a template's monitors);
   * for an update, with what each record it writes lists or names already,
   * which is not asked about again.
   */
  @CaptureSpan()
  public static async checkNamedListsPermission(data: {
    modelType: { new (): BaseModel };
    data: unknown;
    props: DatabaseCommonInteractionProps;
    heldIdsByColumn?: Dictionary<Array<Array<string>>> | undefined;
    findReadableIds: RecordIdsFinder;
    findIdsInProject: RecordIdsFinder;
    findSharedIds?: RecordIdsFinder | undefined;
    referencesCheckedInProject: boolean;
    namedIds?: Dictionary<Array<string>> | undefined;
  }): Promise<void> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    try {
      return await RelationListPermission.checkNamedLists(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
    }
  }

  /*
   * A create makes only a record the caller's create permission reaches: one
   * limited to labels, a record carrying one of them; one limited to owned
   * records, a record the caller will own; a block with labels, no record
   * carrying them (CreateScopePermission.checkCreateScope). Asked by
   * DatabaseService once the create hooks have run, on the record as it
   * will be saved.
   */
  @CaptureSpan()
  public static async checkCreateScopePermission<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
    findRecordLabels: RecordLabelsFinder;
    findLabelNames: LabelNamesFinder;
    ownedParentIds?: Array<string> | undefined;
  }): Promise<void> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    try {
      return await CreateScopePermission.checkCreateScope(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
    }
  }

  /*
   * A change leaves a record within the caller's permission to update it: one
   * limited to labels, a record still carrying one of them; a block with
   * labels, no record given one of them (UpdateScopePermission
   * .checkUpdateScope). Asked by DatabaseService of an update that writes the
   * labels a record carries, on the rows it writes, before the update hooks
   * run and again after them should a hook change the labels.
   */
  @CaptureSpan()
  public static async checkUpdateScopePermission<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    data: unknown;
    rows: Array<BaseModel>;
    props: DatabaseCommonInteractionProps;
    findRecordLabels: RecordLabelsFinder;
    findLabelNames: LabelNamesFinder;
  }): Promise<void> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    try {
      return await UpdateScopePermission.checkUpdateScope(data);
    } catch (error) {
      throw ModelPermission.toAnonymousRefusal(error, data.props);
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
