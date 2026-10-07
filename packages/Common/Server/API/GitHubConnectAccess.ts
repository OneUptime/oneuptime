import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../Types/Database/Permissions/BillingPermission";
import CallerPlan from "../Utils/Billing/CallerPlan";
import { ExpressRequest } from "../Utils/Express";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { WorkspaceOAuthStateRecord } from "../Utils/Workspace/WorkspaceOAuthState";
import CommonAPI from "./CommonAPI";
import WorkspaceOAuthCallbackAccess from "./WorkspaceOAuthCallbackAccess";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";

/*
 * Who may connect a GitHub App installation to a project.
 *
 * Connecting binds the installation to the project and imports every
 * repository in it as the project's code repositories - both written by
 * OneUptime itself, not by the person connecting. So connecting asks what
 * adding those code repositories by hand would ask, in this order:
 *
 *  1. a signed-in member of the project, as a person: an installation is
 *     connected by someone, in their browser, so a project API key never
 *     connects one;
 *  2. a credential that may make changes (never one issued for reading only);
 *  3. the plan code repositories are sold on (Growth, on OneUptime Cloud);
 *  4. permission to create code repositories - the list the Code Repositories
 *     page's create asks - with team blocks counted: a block row never
 *     grants, and a block with no labels takes the permission away
 *     (CommonAPI.assertCanCreateTable).
 *
 * It is asked twice. When the connection starts, of the signed-in caller,
 * before a state is issued (assertMayStart). And again when GitHub sends the
 * browser back, of the person the one-use state names, as they are now
 * (assertMayFinish), before anything is written: the callback learns the
 * project and the person only from that state (WorkspaceOAuthState), never
 * from the redirect, and the state proves nothing about what they may still
 * do. Two differences, both deliberate. The credential (2) is asked at the
 * start only: the callback acts for the person, through their browser, and
 * carries no credential of its own. And the plan (3) is read at the start as
 * every request to the project reads it, and at the callback as everything
 * that acts for a stored person reads it (CallerPlan) - which holds no server
 * admin to a plan, as adding a code repository by hand holds none.
 * Tests/Server/API/GitHubConnectPermission pins both.
 */

/*
 * What a refused connection says to someone who may not connect one, whatever
 * the reason: not a member, no permission, a team's block, an API key.
 */
export const GITHUB_CONNECT_PERMISSION_MESSAGE: string =
  "You do not have permission to add code repositories to this project.";

/*
 * What the callback says when the state it was handed cannot be spent:
 * unknown, already used, expired, issued for another flow, or brought back by
 * a browser other than the one that started the connection.
 */
export const GITHUB_CONNECT_LINK_MESSAGE: string =
  "This GitHub connection link is invalid, has expired, or has already been used. Please connect GitHub again from Code Repositories in your OneUptime project.";

/*
 * What the callback says when something other than an answer stopped it once
 * the state was spent - a read or a write that failed. The error itself is
 * logged, never shown.
 */
export const GITHUB_CONNECT_FAILED_MESSAGE: string =
  "OneUptime could not finish connecting GitHub. Please connect GitHub again from Code Repositories in your OneUptime project.";

// Who is connecting, once the rule has let them.
export interface GitHubConnectCaller {
  projectId: ObjectID;
  userId: ObjectID;
}

export default class GitHubConnectAccess {
  /*
   * When the connection starts: the signed-in caller of `req`, in the project
   * the request names (its `tenantid` header, read by the session middleware,
   * which also holds the project's single sign-on requirement).
   */
  @CaptureSpan()
  public static async assertMayStart(
    req: ExpressRequest,
  ): Promise<GitHubConnectCaller> {
    const props: DatabaseCommonInteractionProps = {
      ...(await CommonAPI.getDatabaseCommonInteractionProps(req)),
      isMultiTenantRequest: false,
    };

    const projectId: ObjectID = GitHubConnectAccess.withOneMessage(() => {
      return CommonAPI.assertAuthenticatedProjectMember(props);
    });

    /*
     * A credential issued for reading only never connects one, whatever its
     * member may do or the project's plan - so it is refused before the plan
     * is asked, with the one sentence rather than an offer of a plan that
     * would not let it.
     */
    GitHubConnectAccess.withOneMessage(() => {
      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);
    });

    GitHubConnectAccess.assertMayConnect(props);

    return {
      projectId: projectId,
      userId: props.userId!,
    };
  }

  /*
   * When GitHub sends the browser back: the person the spent state names, in
   * its project, as they are now - still a member, read from the database,
   * still on the plan (CallerPlan, which refuses a plan it cannot read),
   * still holding the permission.
   */
  @CaptureSpan()
  public static async assertMayFinish(
    record: WorkspaceOAuthStateRecord,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await WorkspaceOAuthCallbackAccess.getStartedByProps({
        record: record,
        errorMessage: GITHUB_CONNECT_PERMISSION_MESSAGE,
      });

    GitHubConnectAccess.assertMayConnect(await CallerPlan.withPlan(props));
  }

  /*
   * Steps 3 and 4, of props that name the project: the plan, then the create
   * permission. A refusal of the plan says which plan it takes; every other
   * refusal says the one sentence.
   */
  private static assertMayConnect(props: DatabaseCommonInteractionProps): void {
    BillingPermissions.checkFeatureIsOnPlan(
      CodeRepository,
      props,
      DatabaseRequestType.Create,
    );

    GitHubConnectAccess.withOneMessage(() => {
      CommonAPI.assertCanCreateTable({
        modelType: CodeRepository,
        props: props,
        errorMessage: GITHUB_CONNECT_PERMISSION_MESSAGE,
      });
    });
  }

  /*
   * Runs a check and answers any authorization refusal it makes with the one
   * sentence, so nobody is told which of the reasons applied. A missing
   * session (401) and a plan refusal (402) pass through as they are.
   */
  private static withOneMessage<T>(check: () => T): T {
    try {
      return check();
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(GITHUB_CONNECT_PERMISSION_MESSAGE);
      }

      throw err;
    }
  }
}
