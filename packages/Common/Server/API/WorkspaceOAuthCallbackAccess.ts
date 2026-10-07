import User from "../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ServerException from "../../Types/Exception/ServerException";
import UserType from "../../Types/UserType";
import UserService from "../Services/UserService";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState, {
  WorkspaceOAuthStateRecord,
} from "../Utils/Workspace/WorkspaceOAuthState";
import CommonAPI from "./CommonAPI";

/*
 * What a connect callback asks before it writes.
 *
 * A Slack, Microsoft Teams or GitHub App connection is started on a OneUptime
 * page by a signed-in member, who is checked there, and finished minutes later
 * by a redirect back from Slack, Microsoft or GitHub. That redirect carries no
 * session, only the one-use state the start recorded (WorkspaceOAuthState),
 * and the state says who started the flow and in which project - not that
 * they may still finish it. In the meantime they may have left the project,
 * lost the role that let them start, or been put on a team that blocks it.
 * What the callback then writes - a project's workspace or tenant, a person's
 * chat identity, a project's repositories - it writes as OneUptime.
 *
 * So every connect callback asks the start's question again, of the person the
 * state names, as they are now: their membership read from the database
 * rather than a cache (WorkspaceActionAuthorization), and their permissions
 * asked by the start's own rule (CommonAPI: a block row never grants, a block
 * with no labels takes its permission away, a server admin is let through
 * where the start lets one through). Tests/Server/API/ConnectCallbacksAskAgain
 * keeps every connect callback on it.
 */
export default class WorkspaceOAuthCallbackAccess {
  /*
   * What a callback answers when its question was not answered yes: a refusal
   * as it is, with its own sentence and status; anything else - a read that
   * failed - logged here and answered with a plain sentence, never with its
   * raw message.
   */
  public static readonly COULD_NOT_CHECK_MESSAGE: string =
    "OneUptime could not finish connecting. Please try again.";

  public static answerFor(error: unknown): Exception {
    if (error instanceof Exception) {
      return error;
    }

    logger.error(error);

    return new ServerException(
      WorkspaceOAuthCallbackAccess.COULD_NOT_CHECK_MESSAGE,
    );
  }

  /*
   * The props of the person `record` names, in its project, as they are now -
   * what a callback asks its permission question of. Refuses with
   * `errorMessage` when they are no longer a member of that project.
   */
  @CaptureSpan()
  public static async getStartedByProps(data: {
    record: WorkspaceOAuthStateRecord;
    errorMessage: string;
  }): Promise<DatabaseCommonInteractionProps> {
    let props: DatabaseCommonInteractionProps;
    let user: User | null;

    try {
      /*
       * A server admin passes the starts' permission checks as a signed-in
       * request does (CommonAPI), so the callback reads whether they still
       * are one - alongside their membership, which it does not depend on.
       */
      [props, user] = await Promise.all([
        WorkspaceActionAuthorization.getProjectMemberProps({
          userId: data.record.userId,
          projectId: data.record.projectId,
        }),
        UserService.findOneById({
          id: data.record.userId,
          select: {
            isMasterAdmin: true,
          },
          props: {
            isRoot: true,
          },
        }),
      ]);
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(data.errorMessage);
      }

      throw err;
    }

    const isMasterAdmin: boolean = user?.isMasterAdmin === true;

    return {
      ...props,
      userType: isMasterAdmin ? UserType.MasterAdmin : UserType.User,
      isMasterAdmin: isMasterAdmin,
      isMultiTenantRequest: false,
    };
  }

  /*
   * For a flow that links the person's own Slack or Microsoft account in the
   * project - "sign in with Slack", "sign in with Microsoft Teams": they are
   * still a member of it, which is all the start asked. Refuses with
   * WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE.
   */
  @CaptureSpan()
  public static async assertStartedByIsMember(data: {
    record: WorkspaceOAuthStateRecord;
  }): Promise<void> {
    await WorkspaceActionAuthorization.getProjectMemberProps({
      userId: data.record.userId,
      projectId: data.record.projectId,
    });
  }

  /*
   * For a flow that binds a workspace or a tenant to the project - installing
   * the Slack app, Microsoft Teams admin consent: the person the state names
   * still holds one of WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS in
   * its project, asked exactly as the start asks it
   * (CommonAPI.assertPermittedInProject).
   */
  @CaptureSpan()
  public static async assertStartedByMayManageConnection(data: {
    record: WorkspaceOAuthStateRecord;
    errorMessage: string;
  }): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await WorkspaceOAuthCallbackAccess.getStartedByProps(data);

    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
      errorMessage: data.errorMessage,
    });
  }
}
