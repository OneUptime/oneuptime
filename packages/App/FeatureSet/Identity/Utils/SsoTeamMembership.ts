import OneUptimeDate from "Common/Types/Date";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import AuditLogService from "Common/Server/Services/AuditLogService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OnBehalfOfProps from "Common/Server/Utils/AuditLog/OnBehalfOfProps";
import logger from "Common/Server/Utils/Logger";
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
 *
 * Only the project's own teams take them (#11149). A provider's teams are
 * held to its project when it is saved (Common/Server/Utils
 * /SsoProviderTeamGrant, ValidateGlobalProviderProjectTeams), but a
 * provider saved before that rule keeps the teams it had, and a team can be
 * deleted after it was picked. A membership of this project written into a
 * team of another one would put the person on that team's on-call and
 * notifications - TeamMemberService.getUsersInTeams reads a team's members
 * by the team alone - so a sign-in through one project's provider would
 * reach another project. Such a team is left out, and logged; when none of
 * the teams is the project's, nobody joins anything (NoTeams), and the
 * caller says so as it does for a provider with no teams.
 * ---------------------------------------------------------------------------
 */

export enum SsoTeamMembershipOutcome {
  Added = "added",
  NoRoom = "no-room",
  // None of the teams is a team of the project: nothing was written.
  NoTeams = "no-teams",
}

// What a project's provider with no teams of its project tells the person.
export const SSO_NO_TEAMS_TITLE: string = "No teams added.";

// The same, as the reason code on the mobile app's deep link.
export const SSO_NO_TEAMS_ERROR: string = "sso_no_default_teams";

// A team's id as a key: ids are compared without regard to case.
const teamKey: (team: Team) => string = (team: Team): string => {
  return (team.id || team._id || "").toString().toLowerCase();
};

export const SSO_NO_ROOM_TITLE: string = "No room in this project.";

export const SSO_NO_ROOM_MESSAGE: string =
  "This project's plan has no room for another person, so you were not added to it. Ask an admin of the project to free a seat or change its plan, then sign in again.";

// The same, as the reason code on the mobile app's deep link.
export const SSO_NO_ROOM_ERROR: string = "sso_project_full";

export default class SsoTeamMembership {
  /*
   * The teams among `teams` that are teams of the project, in the order
   * given, each once: none for no teams. One read, by the teams' ids and
   * the project; a deleted team, or one of another project, is not found.
   */
  public static async getProjectTeams(data: {
    projectId: ObjectID;
    teams: Array<Team> | null | undefined;
  }): Promise<Array<Team>> {
    const named: Array<Team> = (data.teams || []).filter(
      (team: Team): boolean => {
        return Boolean(teamKey(team));
      },
    );

    if (named.length === 0) {
      return [];
    }

    const found: Array<Team> = await TeamService.findBy({
      query: {
        _id: QueryHelper.any(
          named.map((team: Team): string => {
            return teamKey(team);
          }),
        ),
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const ofTheProject: Set<string> = new Set<string>(
      found.map((team: Team): string => {
        return teamKey(team);
      }),
    );

    const kept: Array<Team> = [];
    const seen: Set<string> = new Set<string>();

    for (const team of named) {
      const key: string = teamKey(team);

      if (!ofTheProject.has(key) || seen.has(key)) {
        continue;
      }

      seen.add(key);
      kept.push(team);
    }

    return kept;
  }

  /*
   * Adds the person to each of `teams` that is a team of the project,
   * accepted. NoTeams when none of them is - nothing is written; NoRoom
   * when the project has no room for them - refused before any team took
   * them; Added once they are in every one of the project's teams.
   */
  public static async addToTeams(data: {
    projectId: ObjectID;
    userId: ObjectID;
    teams: Array<Team> | null | undefined;
  }): Promise<SsoTeamMembershipOutcome> {
    const teams: Array<Team> = await SsoTeamMembership.getProjectTeams({
      projectId: data.projectId,
      teams: data.teams,
    });

    // How many teams were named, each once.
    const namedCount: number = new Set<string>(
      (data.teams || [])
        .map((team: Team): string => {
          return teamKey(team);
        })
        .filter((key: string): boolean => {
          return Boolean(key);
        }),
    ).size;

    if (teams.length < namedCount) {
      /*
       * Ids only: which provider it was is the caller's to say, and the
       * person signing in is not named in the server's log.
       */
      logger.warn(
        `A single sign-on provider of project ${data.projectId.toString()} names ${
          namedCount - teams.length
        } team(s) that are not teams of the project, so nobody who signs in with it joins them. Save the provider again with teams of its own project.`,
        {
          projectId: data.projectId.toString(),
          service: "identity",
        },
      );
    }

    if (teams.length === 0) {
      return SsoTeamMembershipOutcome.NoTeams;
    }

    let teamsJoined: number = 0;

    try {
      for (const team of teams) {
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
