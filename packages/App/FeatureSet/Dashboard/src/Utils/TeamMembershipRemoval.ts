import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";

/*
 * In OneUptime a project has no member list of its own: a user belongs to a
 * project exactly as long as they belong to at least one of its teams. So
 * "remove from team" and "remove from project" are the same operation seen
 * from two ends, and removing someone from their last team quietly removed them
 * from the project too - behind a dialog that said "Are you sure you want to
 * delete this  ?" and nothing about which user, which team, or the project.
 *
 * This works out, before anything is deleted, what a removal will actually do
 * to the user's place in the project, and says it in words.
 */

/*
 * What removing one team membership does to the user's place in the project.
 * Mirrors the server: TeamMemberService takes a user off on-call duty and
 * drops their notification settings once they hold no ACCEPTED membership in
 * the project, and the project's Users list shows anyone with ANY membership,
 * pending invitations included.
 */
export enum TeamRemovalOutcome {
  // At least one other accepted membership remains: only this team goes.
  StaysInProject = "StaysInProject",
  /*
   * The last accepted membership goes, but pending invitations to other teams
   * remain: access to the project goes with it, yet the user is still listed
   * as invited.
   */
  LosesProjectAccess = "LosesProjectAccess",
  // Nothing remains: the user leaves the project altogether.
  LeavesProject = "LeavesProject",
}

export interface RemovalConfirmation {
  title: string;
  description: string;
  submitButtonText: string;
}

export interface TeamRemovalPlan {
  outcome: TeamRemovalOutcome;
  confirmation: RemovalConfirmation;
}

// Past this many, a list of team names ends in "and N more".
const MAX_LISTED_TEAM_NAMES: number = 5;

// "Platform Team", but not "Dreamteam".
const TEAM_NAME_ENDS_WITH_TEAM: RegExp = new RegExp("\\bteam$", "i");

/*
 * What leaving the project costs, as the server carries it out once no accepted
 * membership is left (TeamMemberService.onDeleteSuccess).
 */
const LEAVING_PROJECT_IMPACT: string =
  "They will lose access to it immediately, be taken off every on-call schedule and escalation policy in it, and stop receiving its notifications.";

const ACCOUNT_KEPT_NOTE: string =
  "Their OneUptime account is not deleted, and you can invite them back at any time.";

export default class TeamMembershipRemoval {
  /**
   * "Jane Doe (jane@example.com)", falling back to whichever half is known.
   * Both, where possible: two people can share a name, and the email is what
   * the person reading the dialog can check against.
   */
  public static getUserLabel(user: User | undefined | null): string {
    const name: string = user?.name?.toString().trim() || "";
    const email: string = user?.email?.toString().trim() || "";

    if (name && email) {
      return `${name} (${email})`;
    }

    return name || email || "this user";
  }

  /**
   * "the Backend team". A team already called "Platform Team" reads as "the
   * Platform Team", not "the Platform Team team".
   */
  public static getTeamPhrase(teamName: string | undefined | null): string {
    const name: string = teamName?.trim() || "";

    if (!name) {
      return "this team";
    }

    if (TEAM_NAME_ENDS_WITH_TEAM.test(name)) {
      return `the ${name}`;
    }

    return `the ${name} team`;
  }

  /**
   * "A", "A and B", "A, B and C" - alphabetical, de-duplicated, and cut off
   * with "and N more" past MAX_LISTED_TEAM_NAMES so one prolific user cannot
   * turn a dialog into a wall of names.
   */
  public static formatNames(names: Array<string>): string {
    const unique: Array<string> = Array.from(
      new Set(
        names
          .map((name: string) => {
            return name.trim();
          })
          .filter((name: string) => {
            return Boolean(name);
          }),
      ),
    ).sort((a: string, b: string) => {
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });

    if (unique.length === 0) {
      return "";
    }

    if (unique.length > MAX_LISTED_TEAM_NAMES) {
      const shown: Array<string> = unique.slice(0, MAX_LISTED_TEAM_NAMES);
      return `${shown.join(", ")} and ${unique.length - shown.length} more`;
    }

    if (unique.length === 1) {
      return unique[0]!;
    }

    return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  }

  public static getTeamNames(memberships: Array<TeamMember>): Array<string> {
    return memberships
      .map((membership: TeamMember) => {
        return membership.team?.name?.toString() || "";
      })
      .filter((name: string) => {
        return Boolean(name);
      });
  }

  /**
   * What removing `membershipId` does, given every one of the user's
   * memberships in the project (the one being removed included).
   */
  public static getTeamRemovalOutcome(data: {
    membershipId: ObjectID | string;
    memberships: Array<TeamMember>;
  }): TeamRemovalOutcome {
    const removingId: string = data.membershipId.toString();

    const removing: TeamMember | undefined = data.memberships.find(
      (membership: TeamMember) => {
        return membership.id?.toString() === removingId;
      },
    );

    const remaining: Array<TeamMember> = data.memberships.filter(
      (membership: TeamMember) => {
        return membership.id?.toString() !== removingId;
      },
    );

    if (remaining.length === 0) {
      return TeamRemovalOutcome.LeavesProject;
    }

    const hasRemainingAccepted: boolean = remaining.some(
      (membership: TeamMember) => {
        return Boolean(membership.hasAcceptedInvitation);
      },
    );

    if (removing?.hasAcceptedInvitation && !hasRemainingAccepted) {
      return TeamRemovalOutcome.LosesProjectAccess;
    }

    return TeamRemovalOutcome.StaysInProject;
  }

  /**
   * The confirmation for removing one user from one team, spelling out
   * whether they stay in the project.
   */
  public static buildTeamRemovalPlan(data: {
    membershipId: ObjectID | string;
    memberships: Array<TeamMember>;
    /*
     * The row that was clicked, for its user and team when the memberships
     * list no longer holds it (removed elsewhere since the table loaded).
     */
    fallbackMembership?: TeamMember | undefined;
  }): TeamRemovalPlan {
    const removingId: string = data.membershipId.toString();

    const removing: TeamMember | undefined =
      data.memberships.find((membership: TeamMember) => {
        return membership.id?.toString() === removingId;
      }) || data.fallbackMembership;

    const remaining: Array<TeamMember> = data.memberships.filter(
      (membership: TeamMember) => {
        return membership.id?.toString() !== removingId;
      },
    );

    const remainingAccepted: Array<TeamMember> = remaining.filter(
      (membership: TeamMember) => {
        return Boolean(membership.hasAcceptedInvitation);
      },
    );

    const user: User | undefined =
      removing?.user ||
      data.fallbackMembership?.user ||
      data.memberships.find((membership: TeamMember) => {
        return Boolean(membership.user);
      })?.user;

    const teamName: string =
      removing?.team?.name?.toString() ||
      data.fallbackMembership?.team?.name?.toString() ||
      "";

    const isAccepted: boolean = Boolean(removing?.hasAcceptedInvitation);

    const outcome: TeamRemovalOutcome = this.getTeamRemovalOutcome({
      membershipId: removingId,
      memberships: data.memberships,
    });

    const question: string = `Remove ${this.getUserLabel(user)} from ${this.getTeamPhrase(teamName)}?`;

    const paragraphs: Array<string> = [question];

    if (outcome === TeamRemovalOutcome.LeavesProject) {
      if (isAccepted) {
        paragraphs.push(
          `This is their only team in this project, so they will also be removed from the project. ${LEAVING_PROJECT_IMPACT}`,
        );
        paragraphs.push(
          `${ACCOUNT_KEPT_NOTE} To move them to a different team instead, add them to that team first.`,
        );
      } else {
        paragraphs.push(
          "They have not accepted this invitation yet, and it is their only invitation to this project, so they will also be removed from the project and will no longer be able to join it.",
        );
      }

      return {
        outcome: outcome,
        confirmation: {
          title: "Remove from Team and Project",
          description: paragraphs.join("\n\n"),
          submitButtonText: "Remove from Team and Project",
        },
      };
    }

    if (outcome === TeamRemovalOutcome.LosesProjectAccess) {
      paragraphs.push(
        "This is the only team they have joined in this project, so they will lose access to the project immediately, be taken off every on-call schedule and escalation policy in it, and stop receiving its notifications.",
      );
      paragraphs.push(
        `They will stay listed as invited to ${this.formatNames(this.getTeamNames(remaining)) || "another team"}, and will get access back if they accept.`,
      );

      return {
        outcome: outcome,
        confirmation: {
          title: "Remove from Team",
          description: paragraphs.join("\n\n"),
          submitButtonText: "Remove from Team",
        },
      };
    }

    // StaysInProject.
    const pendingNote: string = isAccepted
      ? ""
      : "They have not accepted this invitation yet. ";

    if (remainingAccepted.length > 0) {
      const otherTeams: string = this.formatNames(
        this.getTeamNames(remainingAccepted),
      );
      const teamWord: string =
        remainingAccepted.length === 1 ? "team" : "teams";
      const through: string = otherTeams
        ? `through their other ${teamWord}: ${otherTeams}.`
        : `through their other ${teamWord}.`;

      paragraphs.push(
        isAccepted
          ? `They will lose the permissions this team grants, but will stay in this project ${through}`
          : `${pendingNote}They will stay in this project ${through}`,
      );
    } else {
      // Removing a pending invitation while other pending invitations remain.
      const otherTeams: string = this.formatNames(this.getTeamNames(remaining));

      paragraphs.push(
        `${pendingNote}They will still be invited to ${otherTeams || "their other teams"} in this project.`,
      );
    }

    return {
      outcome: outcome,
      confirmation: {
        title: "Remove from Team",
        description: paragraphs.join("\n\n"),
        submitButtonText: "Remove from Team",
      },
    };
  }

  /**
   * The confirmation for removing a user from the whole project - every team
   * they are on in it.
   */
  public static buildProjectRemovalConfirmation(data: {
    user: User | undefined | null;
    teamNames: Array<string>;
    // Whether any of their memberships has been accepted, i.e. they have access.
    hasJoined: boolean;
  }): RemovalConfirmation {
    const userLabel: string = this.getUserLabel(data.user);
    const teamCount: number = new Set(
      data.teamNames
        .map((name: string) => {
          return name.trim();
        })
        .filter((name: string) => {
          return Boolean(name);
        }),
    ).size;
    const teamList: string = this.formatNames(data.teamNames);

    const paragraphs: Array<string> = [
      `Remove ${userLabel} from this project?`,
    ];

    if (!data.hasJoined) {
      const invitations: string =
        teamCount === 0
          ? "their invitation to this project"
          : teamCount === 1
            ? `their invitation to ${this.getTeamPhrase(teamList)}`
            : `their invitations to ${teamCount} teams (${teamList})`;

      paragraphs.push(
        `They have not accepted an invitation to this project yet. Removing them cancels ${invitations}, and they will no longer be able to join.`,
      );
    } else {
      const teams: string =
        teamCount === 0
          ? "every team they belong to"
          : teamCount === 1
            ? this.getTeamPhrase(teamList)
            : `all ${teamCount} of their teams (${teamList})`;

      paragraphs.push(
        `They will be removed from ${teams}. ${LEAVING_PROJECT_IMPACT}`,
      );
      paragraphs.push(ACCOUNT_KEPT_NOTE);
    }

    return {
      title: "Remove from Project",
      description: paragraphs.join("\n\n"),
      submitButtonText: "Remove from Project",
    };
  }

  /**
   * Every membership the user holds in the project, with the team and user
   * fields the confirmations above read.
   */
  public static async fetchUserMemberships(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<TeamMember>> {
    const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: {
        userId: data.userId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        userId: true,
        teamId: true,
        hasAcceptedInvitation: true,
        team: {
          _id: true,
          name: true,
        },
        user: {
          _id: true,
          name: true,
          email: true,
        },
      },
      sort: {},
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    return result.data;
  }

  /**
   * Whether the user still belongs to the project in any way - an accepted
   * membership or a pending invitation - which is what keeps them on the
   * project's Users list.
   */
  public static async isUserStillInProject(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const count: number = await ModelAPI.count<TeamMember>({
      modelType: TeamMember,
      query: {
        userId: data.userId,
        projectId: data.projectId,
      },
    });

    return count > 0;
  }

  /**
   * Reads the user's memberships and builds the confirmation for removing
   * `membership` - the row a table's Remove button was clicked on.
   */
  public static async getTeamRemovalPlan(data: {
    membership: TeamMember;
    projectId: ObjectID;
    // When the page already knows whose memberships it lists.
    userId?: ObjectID | undefined;
  }): Promise<TeamRemovalPlan> {
    const membershipId: ObjectID | null = data.membership.id;

    if (!membershipId) {
      throw new BadDataException("Team member id is missing");
    }

    let userId: ObjectID | undefined =
      data.userId ||
      data.membership.userId ||
      data.membership.user?.id ||
      undefined;

    if (!userId) {
      // Not every table selects the user; ask the membership itself.
      const membership: TeamMember | null = await ModelAPI.getItem<TeamMember>({
        modelType: TeamMember,
        id: membershipId,
        select: {
          _id: true,
          userId: true,
        },
      });

      userId = membership?.userId;
    }

    if (!userId) {
      throw new BadDataException(
        "Could not find the user for this team membership. It may already have been removed - please refresh the page.",
      );
    }

    const memberships: Array<TeamMember> = await this.fetchUserMemberships({
      userId: userId,
      projectId: data.projectId,
    });

    return this.buildTeamRemovalPlan({
      membershipId: membershipId,
      memberships: memberships,
      fallbackMembership: data.membership,
    });
  }
}
