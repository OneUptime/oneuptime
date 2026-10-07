import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import UserType from "../../../Types/UserType";
import UserService from "../../Services/UserService";
import CallerPermission from "../Permission/CallerPermission";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceOAuthState, {
  WorkspaceOAuthStateRecord,
} from "./WorkspaceOAuthState";

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
 * rather than a cache (WorkspaceActionAuthorization), their permissions read
 * the way every check reads them (CallerPermission: a block row never grants,
 * a block with no labels takes its permission away), and a server admin let
 * through wherever the start let one through.
 */
export default class WorkspaceOAuthCallbackAccess {
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

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: data.record.userId,
        projectId: data.record.projectId,
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(data.errorMessage);
      }

      throw err;
    }

    /*
     * A server admin passes the starts' permission checks as a signed-in
     * request does (CommonAPI), so the callback reads whether they still are
     * one.
     */
    const user: User | null = await UserService.findOneById({
      id: data.record.userId,
      select: {
        isMasterAdmin: true,
      },
      props: {
        isRoot: true,
      },
    });

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
   * still a member of it, which is all the start asked.
   */
  @CaptureSpan()
  public static async assertStartedByIsMember(data: {
    record: WorkspaceOAuthStateRecord;
  }): Promise<void> {
    await WorkspaceOAuthCallbackAccess.getStartedByProps({
      record: data.record,
      errorMessage: WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    });
  }

  /*
   * For a flow that binds a workspace or a tenant to the project - installing
   * the Slack app, Microsoft Teams admin consent: the person the state names
   * still holds one of WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS in
   * its project, team blocks counted, as the start asked
   * (CommonAPI.assertPermittedInProject).
   */
  @CaptureSpan()
  public static async assertStartedByMayManageConnection(data: {
    record: WorkspaceOAuthStateRecord;
    errorMessage: string;
  }): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await WorkspaceOAuthCallbackAccess.getStartedByProps(data);

    if (props.isMasterAdmin) {
      return;
    }

    if (
      !CallerPermission.holdsAnyOf(
        props,
        WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
      )
    ) {
      throw new NotAuthorizedException(data.errorMessage);
    }
  }
}
