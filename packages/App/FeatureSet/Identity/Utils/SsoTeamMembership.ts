import OneUptimeDate from "Common/Types/Date";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import AuditLogService from "Common/Server/Services/AuditLogService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import OnBehalfOfProps from "Common/Server/Utils/AuditLog/OnBehalfOfProps";
import PeopleLimitRefusal from "Common/Server/Utils/TeamMember/PeopleLimitRefusal";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";

/*
 * ---------------------------------------------------------------------------
 * ADDING SOMEONE WHO SIGNS IN THROUGH SINGLE SIGN-ON TO A PROJECT'S TEAMS.
 *
 * The first time someone signs in to a project through one of its SAML or
 * OIDC providers - or through an instance-wide one attached to it - they
 * join the provider's teams, accepted, as OneUptime's own write: the
 * provider is doing what it was saved to do (Common/Server/Utils
 * /SsoProviderTeamGrant checked its teams when it was saved).
 *
 * They take a seat in the project like anyone invited, so a project with no
 * room for one more person - every seat of its plan taken, or the Free
 * plan's one person there already - refuses them (TeamMemberService's
 * limits on people, PeopleLimitRefusal). That refusal is answered NoRoom:
 * the first team refused them, so they are in none of the project's teams.
 * Anything else that goes wrong is thrown, as before.
 *
 * A project's own provider then tells them so, in words for the person
 * signing in (SSO_NO_ROOM_TITLE and SSO_NO_ROOM_MESSAGE; SSO_NO_ROOM_ERROR
 * on the mobile app's deep link) - the refusal's own words are for whoever
 * invites. An instance-wide provider leaves that project out and signs them
 * in to the rest, so one full project never locks anyone out of the others.
 *
 * Each team they join is in the project's audit log, on the team's Audit
 * Logs, as a Create entry by the person who signed in (issue #6285): the
 * create skips its hooks, and DatabaseService records no create that does,
 * so the join records its own entry once it is written. It is theirs - their
 * sign-in added them - and recorded whether or not the project stores system
 * events, like an invitation they accept; a team's members, and so what each
 * may do, are what its Audit Logs promise to show.
 * ---------------------------------------------------------------------------
 */

export enum SsoTeamMembershipOutcome {
  Added = "added",
  NoRoom = "no-room",
}

export const SSO_NO_ROOM_TITLE: string = "No room in this project.";

export const SSO_NO_ROOM_MESSAGE: string =
  "This project's plan has no room for another person, so you were not added to it. Ask an admin of the project to free a seat or change its plan, then sign in again.";

// The same, as the reason code on the mobile app's deep link.
export const SSO_NO_ROOM_ERROR: string = "sso_project_full";

export default class SsoTeamMembership {
  /*
   * Adds the person to each of `teams` in the project, accepted. NoRoom
   * when the project has no room for them - refused before any team took
   * them; Added once they are in every team.
   */
  public static async addToTeams(data: {
    projectId: ObjectID;
    userId: ObjectID;
    teams: Array<Team>;
  }): Promise<SsoTeamMembershipOutcome> {
    let teamsJoined: number = 0;

    try {
      for (const team of data.teams) {
        const teamMember: TeamMember = new TeamMember();
        teamMember.projectId = data.projectId;
        teamMember.userId = data.userId;
        teamMember.hasAcceptedInvitation = true;
        teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
        teamMember.teamId = team.id!;

        const joined: TeamMember = await TeamMemberService.create({
          data: teamMember,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

        teamsJoined++;

        await AuditLogService.recordCreate({
          model: new TeamMember(),
          createdItem: joined,
          props: SsoTeamMembership.getJoinProps(data.userId),
        });
      }
    } catch (error) {
      /*
       * Only a refusal of someone new is NoRoom. Once a team has taken them
       * they are in the project, and counted already, so a later refusal
       * would be something else gone wrong: thrown, as it came.
       */
      if (teamsJoined === 0 && PeopleLimitRefusal.isRefusal(error)) {
        return SsoTeamMembershipOutcome.NoRoom;
      }

      throw error;
    }

    return SsoTeamMembershipOutcome.Added;
  }

  // Whose a join is in the audit log: the person who signed in.
  public static getJoinProps(userId: ObjectID): DatabaseCommonInteractionProps {
    return OnBehalfOfProps.get({ userId, userType: UserType.User });
  }
}
