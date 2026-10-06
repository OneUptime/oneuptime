import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../Types/Database/Permissions/BillingPermission";
import ModelPermission from "../Types/Database/Permissions/Index";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import DatabaseService from "../Services/DatabaseService";
import { ExpressRequest } from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";

/*
 * Who may send a test.
 *
 * A "Send Test" makes OneUptime send something now, outside the records that
 * would normally make it send: a post into a Slack or Microsoft Teams channel
 * or chat, a notification rule's message, a workspace summary, an email
 * through a project's own SMTP server, an SMS or a call through its own
 * Twilio account, a status page's email report. So a test asks what making
 * OneUptime send the same thing for real asks, and every test route asks it
 * here, in this order:
 *
 *  1. a signed-in member of the project, as a person: a test is sent by
 *     someone and logged as theirs, so a project API key does not send one;
 *  2. a credential that may make changes: one issued for reading only (an
 *     MCP client connected read-only) never sends anything;
 *  3. the plan the feature is sold on. A project below it may still read
 *     what it has left (to find, switch off and delete it - see
 *     Types/Billing/PlanGatedTable), so no read stands in for the plan: it is
 *     asked here, without that allowance (checkFeatureIsOnPlan);
 *  4. permission to create what is tested, team blocks counted - whoever
 *     could create one could make OneUptime send through it anyway, and
 *     nobody else (CommonAPI.assertCanCreateTable). A setting of a record (a
 *     status page's email report) is switched on, not created: its test asks
 *     what switching it on asks of that record, plan included;
 *  5. the record tested, when there is one, read with the caller's own
 *     permissions, in the one project they are a member of - never a
 *     multi-tenant read. One of another project and one that does not exist
 *     are answered alike, so a test route tells nobody which ids exist.
 *
 * Only then does the route read what it needs as OneUptime (the secrets a
 * send needs included) and send. Tests/Server/API/TestSendRoutesAskTheRule
 * keeps every test route on this helper.
 */

/*
 * What a refused test send says to someone who may not send one: the same
 * words for every test route, a channel's own Send Test included.
 */
export const TEST_NOTIFICATION_PERMISSION_MESSAGE: string =
  "You do not have permission to send test notifications in this project.";

// Who is sending the test, once the rule has let them.
export interface TestSendCaller {
  // The caller's own permissions, for their one project.
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  // The person sending the test.
  userId: ObjectID;
}

// Who is sending a test to themselves, once the rule has let them.
export interface TestSendToSelfCaller {
  props: DatabaseCommonInteractionProps;
  // The person sending the test, and receiving it.
  userId: ObjectID;
}

// A saved record a test sends through: a rule, a summary, a config.
export interface TestedRecord<TBaseModel extends DatabaseBaseModel> {
  service: DatabaseService<TBaseModel>;
  id: ObjectID;
}

export default class TestSendAccess {
  /*
   * The rule for a test of something the project creates: a notification
   * rule, a summary, an SMTP or Twilio config - or a channel or chat, which
   * a notification rule posts to (`modelType` without a record).
   */
  public static async assertMaySendTest<
    TBaseModel extends DatabaseBaseModel,
  >(data: {
    req: ExpressRequest;
    // What the test sends through: its plan and create permission are asked.
    modelType: DatabaseBaseModelType;
    // The saved record tested, when there is one.
    record?: TestedRecord<TBaseModel> | undefined;
  }): Promise<TestSendCaller> {
    const caller: TestSendCaller = await TestSendAccess.getCaller(data.req);

    BillingPermissions.checkFeatureIsOnPlan(
      data.modelType,
      caller.props,
      DatabaseRequestType.Create,
    );

    CommonAPI.assertCanCreateTable({
      modelType: data.modelType,
      props: caller.props,
      errorMessage: TEST_NOTIFICATION_PERMISSION_MESSAGE,
    });

    if (data.record) {
      const tested: TBaseModel | null = await data.record.service.findOneById({
        id: data.record.id,
        select: {
          projectId: true,
        } as Select<TBaseModel>,
        props: caller.props,
      });

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: TestSendAccess.getProjectId(tested),
        projectId: caller.projectId,
      });
    }

    return caller;
  }

  /*
   * The rule for a test of a setting of a record - a status page's email
   * report, which is switched on rather than created: what writing
   * `switchOn` to that one record asks of the caller. That is the record's
   * edit permission - team blocks, labels and owned scope counted, as the
   * update itself counts them - and the column's own permission and plan
   * (ColumnPermission), on a credential that may make changes.
   */
  public static async assertMaySendTestOfSetting<
    TBaseModel extends DatabaseBaseModel,
  >(data: {
    req: ExpressRequest;
    record: TestedRecord<TBaseModel>;
    // The write that switches the setting on, e.g. { isReportEnabled: true }.
    switchOn: QueryDeepPartialEntity<TBaseModel>;
    // What a caller who may not change this record is told.
    errorMessage: string;
  }): Promise<TestSendCaller> {
    const caller: TestSendCaller = await TestSendAccess.getCaller(data.req);

    const service: DatabaseService<TBaseModel> = data.record.service;
    const model: TBaseModel = service.getModel();
    const modelType: { new (): TBaseModel } = service.modelType;

    // May the caller change this kind of record at all, before any read.
    CommonAPI.assertPermittedInProject({
      databaseProps: caller.props,
      allowedPermissions: model.getUpdatePermissions(),
      errorMessage: data.errorMessage,
    });

    /*
     * The record, with what its access control reads (its labels), from the
     * caller's own project only: one of another project and one that does
     * not exist are answered alike.
     */
    const select: Select<TBaseModel> = {
      _id: true,
      projectId: true,
    } as Select<TBaseModel>;

    const accessControlColumn: string | null = model.getAccessControlColumn();

    if (accessControlColumn) {
      (select as Record<string, unknown>)[accessControlColumn] = {
        _id: true,
      };
    }

    const tested: TBaseModel | null = await service.findOneById({
      id: data.record.id,
      select: select,
      props: {
        isRoot: true,
      },
    });

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: TestSendAccess.getProjectId(tested),
      projectId: caller.projectId,
    });

    // Its labels' team blocks and grants, as an update of it is checked.
    await ModelPermission.checkUpdatePermissionByModel({
      modelType: modelType,
      fetchModelWithAccessControlIds: async (): Promise<TBaseModel> => {
        return tested!;
      },
      props: caller.props,
      updateData: data.switchOn,
    });

    /*
     * The rows the caller may write `switchOn` to - narrowed by labels and
     * owned scope - and the column's own permission and plan.
     */
    const permittedQuery: Query<TBaseModel> =
      await ModelPermission.checkUpdateQueryPermissions(
        modelType,
        {
          _id: data.record.id,
          projectId: caller.projectId,
        } as Query<TBaseModel>,
        data.switchOn,
        caller.props,
      );

    const permitted: TBaseModel | null = await service.findOneBy({
      query: permittedQuery,
      select: {
        _id: true,
      } as Select<TBaseModel>,
      props: {
        isRoot: true,
      },
    });

    if (!permitted) {
      throw new NotAuthorizedException(data.errorMessage);
    }

    return caller;
  }

  /*
   * The rule for a test the caller sends to themselves - their own
   * notification method, their own verified inbox: a signed-in person, on a
   * credential that may make changes. Whose method it is, the route checks
   * against the record it reads.
   */
  public static async assertMaySendTestToSelf(
    req: ExpressRequest,
  ): Promise<TestSendToSelfCaller> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const userId: ObjectID = CommonAPI.assertAuthenticatedUser(props);

    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    return { props: props, userId: userId };
  }

  // The project a record read here belongs to.
  private static getProjectId(
    record: DatabaseBaseModel | null,
  ): ObjectID | undefined {
    if (!record) {
      return undefined;
    }

    return (
      (record as unknown as { projectId?: ObjectID | null }).projectId ||
      undefined
    );
  }

  /*
   * Steps 1 and 2: a signed-in member of the project the request names, as
   * a person, on a credential that may make changes - with their props read
   * for that one project.
   */
  public static async getCaller(req: ExpressRequest): Promise<TestSendCaller> {
    const props: DatabaseCommonInteractionProps = {
      ...(await CommonAPI.getDatabaseCommonInteractionProps(req)),
      isMultiTenantRequest: false,
    };

    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectMember(props);

    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    return {
      props: props,
      projectId: projectId,
      userId: props.userId!,
    };
  }
}
