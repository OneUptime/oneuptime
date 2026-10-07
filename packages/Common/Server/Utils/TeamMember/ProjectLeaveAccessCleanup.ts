import ObjectID from "../../../Types/ObjectID";
import McpOAuthGrantService from "../../Services/McpOAuthGrantService";
import UserProjectSsoConsentService from "../../Services/UserProjectSsoConsentService";
import logger, { LogAttributes } from "../Logger";
import ProjectLeaveRows, {
  FormerMemberCleanupResult,
  PersonalTable,
  ProjectLeaveRemovalResult,
  ProjectUserRow,
  personalTable,
} from "./ProjectLeaveRows";

/*
 * What a person holds that lets them, or something acting for them, into a
 * project on their own - and that goes when they leave it (no accepted
 * membership left in any of its teams):
 *
 *   - the MCP clients they connected to the project (McpOAuthGrant). Every
 *     authorization code, access token and refresh token issued under a
 *     grant goes with it (the foreign key cascades), so the client is
 *     disconnected, exactly as if they had pressed Disconnect;
 *   - their consent to the project's single sign-on (UserProjectSsoConsent).
 *     On the hosted service a project's SSO signs an account in, and SCIM
 *     adds it to the project's teams as a member, only once the account's
 *     owner agreed from their mailbox. That agreement was to be in the
 *     project; once they have left it, the project asks again.
 *
 * Both are also refused at the moment they are used while the person is not
 * a member (McpOAuthGrantAccess, UserProjectSsoConsentService.hasConsent):
 * removing them here keeps the tables from holding standing access for
 * people who are gone, and joining again starts from nothing.
 *
 * Other per-project access is handled where it lives: the permission set
 * every request is authorized with is rebuilt on leave
 * (TeamMemberService.refreshTokens), chat account links go
 * (removeWorkspaceAccountLinksIfUserLeftProject), and the personal calendar
 * feed is turned off and refused to a non-member when it is fetched
 * (OnCallCalendarAPI).
 *
 * Deletes go through each service as root, so the audit trail records an
 * MCP client's removal. Unconditional - callers decide whether the person
 * really left (TeamMemberService.removeProjectAccessIfUserLeftProject and the
 * RemoveProjectAccessOfFormerMembers data migration).
 */
export default class ProjectLeaveAccessCleanup {
  /*
   * Every per-project table of a person's own access to the project, in the
   * order it is removed.
   */
  public static getPersonalAccessTables(): Array<PersonalTable> {
    return [
      personalTable(McpOAuthGrantService),
      personalTable(UserProjectSsoConsentService),
    ];
  }

  public static async removeProjectAccess(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveRemovalResult> {
    const result: ProjectLeaveRemovalResult =
      await ProjectLeaveRows.removeRowsOf({
        projectId: data.projectId,
        userId: data.userId,
        tables: this.getPersonalAccessTables(),
      });

    logger.debug(
      `Access cleanup for a user leaving the project: ${JSON.stringify(result)}`,
      {
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
      } as LogAttributes,
    );

    return result;
  }

  /*
   * For the RemoveProjectAccessOfFormerMembers data migration: the same
   * removal for everybody who left before it ran - only for pairs with no
   * accepted membership of the project, re-checked just before each removal
   * (ProjectLeaveRows.walkFormerMembers).
   */
  public static async removeProjectAccessOfFormerMembers(): Promise<FormerMemberCleanupResult> {
    return await ProjectLeaveRows.walkFormerMembers({
      pairs: await this.getFormerMemberPairs(),
      remove: (data: {
        projectId: ObjectID;
        userId: ObjectID;
      }): Promise<ProjectLeaveRemovalResult> => {
        return this.removeProjectAccess(data);
      },
    });
  }

  /*
   * The (project, person) pairs, in key order, that hold a row in an access
   * table but no accepted membership of the project.
   */
  public static async getFormerMemberPairs(): Promise<Array<ProjectUserRow>> {
    return await ProjectLeaveRows.getFormerMemberPairsIn(
      this.getPersonalAccessTables(),
    );
  }
}
