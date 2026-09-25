import LIMIT_MAX from "Common/Types/Database/LimitMax";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ObjectID from "Common/Types/ObjectID";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserProjectSsoConsentService from "Common/Server/Services/UserProjectSsoConsentService";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";

/*
 * ---------------------------------------------------------------------------
 * WHAT A PROJECT'S SCIM MAY DO TO A ONEUPTIME ACCOUNT.
 *
 * A project's SCIM endpoint is configured by that project's admins, and the
 * accounts it names are instance-wide: the same account can belong to other
 * projects, and on the hosted service those projects belong to other
 * customers. So SCIM must not be able to act on an account beyond this one
 * project on that customer's say-so alone.
 *
 * Two rules follow.
 *
 * 1. MEMBERSHIP. Accepting a membership is a permission grant (see
 *    TeamMemberService.onBeforeCreate), so on the hosted service SCIM creates
 *    an ACCEPTED membership only for:
 *      - an account this SCIM request has just created,
 *      - an account that has already joined this project, or
 *      - an account whose mailbox owner confirmed this project's single
 *        sign-on (UserProjectSsoConsent), which is them agreeing to join.
 *    Any other existing account is INVITED: a pending membership and the
 *    ordinary invitation email, which it accepts or rejects for itself.
 *    Self-hosted installs keep accepting on arrival. Their project admins are
 *    usually one organisation, and many have no working SMTP to invite with.
 *
 * 2. PROFILE. The email address is the account's sign-in and its password
 *    recovery address. SCIM that could rewrite it could send the account's
 *    reset link to a mailbox the project admin reads, and so take the account
 *    over -- along with every other project it belongs to. So:
 *      - on the hosted service, SCIM never changes an email address;
 *      - everywhere, SCIM changes the email address or the name only of an
 *        account this project manages: one that has joined this project,
 *        belongs to no other project, and is not a master admin.
 *    An invitee who has not accepted is not managed by this project yet.
 * ---------------------------------------------------------------------------
 */

// Where an account stands in one project, judged from its team memberships.
export enum ProjectSCIMAccountStanding {
  // At least one accepted membership in the project.
  Member = "member",
  // Only pending invitations in the project.
  Invited = "invited",
  // No membership in the project at all.
  None = "none",
}

export enum ProjectSCIMTeamAddOutcome {
  AddedAsMember = "added-as-member",
  Invited = "invited",
  AlreadyInTeam = "already-in-team",
  UserNotFound = "user-not-found",
}

/*
 * SCIM asked to change an email address it may not change. A 400 with the
 * SCIM "mutability" error type: the attribute cannot be modified here.
 */
export class ProjectSCIMEmailChangeRefusedException extends BadRequestException {}

export const HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE: string =
  "SCIM cannot change the email address of a OneUptime account on this service, because the address is how the person signs in to every project they belong to. The user can change their email address from their own OneUptime profile.";

export const UNMANAGED_EMAIL_CHANGE_REFUSED_MESSAGE: string =
  "SCIM can only change the email address of an account that has joined this project, belongs to no other project, and is not a OneUptime administrator. The user can change their email address from their own OneUptime profile.";

export default class ProjectSCIMAccountPolicy {
  /*
   * Whether existing accounts are invited rather than added, and whether
   * SCIM may never change an email address: on the hosted service only. Read
   * on every call, never cached.
   */
  public static isHostedService(): boolean {
    return IsBillingEnabled;
  }

  public static getStandingFromMemberships(
    memberships: Array<TeamMember>,
  ): ProjectSCIMAccountStanding {
    if (memberships.length === 0) {
      return ProjectSCIMAccountStanding.None;
    }

    return memberships.some((membership: TeamMember) => {
      return Boolean(membership.hasAcceptedInvitation);
    })
      ? ProjectSCIMAccountStanding.Member
      : ProjectSCIMAccountStanding.Invited;
  }

  public static async getStandingInProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectSCIMAccountStanding> {
    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
      },
      select: {
        _id: true,
        hasAcceptedInvitation: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return this.getStandingFromMemberships(memberships);
  }

  /*
   * Where each of these accounts stands in the project right now, keyed by
   * lower-cased user id. A replace of a group's members deletes the team's rows before it
   * re-adds them; this is taken first, so an account that had joined the
   * project only through that team is not re-added as a stranger.
   */
  public static async getStandingsInProject(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<Map<string, ProjectSCIMAccountStanding>> {
    const standings: Map<string, ProjectSCIMAccountStanding> = new Map<
      string,
      ProjectSCIMAccountStanding
    >();

    if (data.userIds.length === 0) {
      return standings;
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(data.userIds),
      },
      select: {
        _id: true,
        userId: true,
        hasAcceptedInvitation: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Lower-cased keys: an IdP may echo an id back in a different case.
    for (const userId of data.userIds) {
      const key: string = userId.toString().toLowerCase();

      standings.set(
        key,
        this.getStandingFromMemberships(
          memberships.filter((membership: TeamMember) => {
            return membership.userId?.toString().toLowerCase() === key;
          }),
        ),
      );
    }

    return standings;
  }

  /*
   * Adds an account to one of the project's teams: accepted when rule 1
   * above allows it, as a pending invitation when it does not.
   *
   * `userWasCreatedByScim` is for an account this very request created.
   * `standingBeforeReplace` is for a group replace, from getStandingsInProject.
   */
  public static async addUserToTeam(data: {
    projectId: ObjectID;
    userId: ObjectID;
    teamId: ObjectID;
    userWasCreatedByScim?: boolean | undefined;
    standingBeforeReplace?: ProjectSCIMAccountStanding | undefined;
  }): Promise<ProjectSCIMTeamAddOutcome> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        _id: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      return ProjectSCIMTeamAddOutcome.UserNotFound;
    }

    const existingMember: TeamMember | null = await TeamMemberService.findOneBy(
      {
        query: {
          projectId: data.projectId,
          userId: data.userId,
          teamId: data.teamId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    if (existingMember) {
      return ProjectSCIMTeamAddOutcome.AlreadyInTeam;
    }

    const teamMember: TeamMember = new TeamMember();
    teamMember.projectId = data.projectId;
    teamMember.userId = data.userId;
    teamMember.teamId = data.teamId;

    if (!this.isHostedService() || data.userWasCreatedByScim) {
      return await this.createAcceptedMembership(teamMember);
    }

    const standing: ProjectSCIMAccountStanding =
      data.standingBeforeReplace ||
      (await this.getStandingInProject({
        projectId: data.projectId,
        userId: data.userId,
      }));

    if (standing === ProjectSCIMAccountStanding.Member) {
      return await this.createAcceptedMembership(teamMember);
    }

    if (
      await UserProjectSsoConsentService.hasConsent({
        userId: data.userId,
        projectId: data.projectId,
      })
    ) {
      return await this.createAcceptedMembership(teamMember);
    }

    teamMember.hasAcceptedInvitation = false;

    /*
     * The invitation email goes out with the account's first invitation into
     * this project. An invitee added to a second team already has one waiting,
     * and a group sync must not mail them every time it runs.
     */
    const shouldSendInvitationEmail: boolean =
      standing === ProjectSCIMAccountStanding.None && Boolean(user.email);

    await TeamMemberService.create({
      data: teamMember,
      props: {
        isRoot: true,
      },
      ...(shouldSendInvitationEmail
        ? { miscDataProps: { email: user.email!.toString() } }
        : {}),
    });

    return ProjectSCIMTeamAddOutcome.Invited;
  }

  private static async createAcceptedMembership(
    teamMember: TeamMember,
  ): Promise<ProjectSCIMTeamAddOutcome> {
    teamMember.hasAcceptedInvitation = true;

    await TeamMemberService.create({
      data: teamMember,
      props: {
        isRoot: true,
      },
    });

    return ProjectSCIMTeamAddOutcome.AddedAsMember;
  }

  /*
   * Rule 2's "an account this project manages". Every membership the account
   * has, in any project, is read: one elsewhere is what disqualifies it.
   */
  public static async isAccountManagedByProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<boolean> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        _id: true,
        isMasterAdmin: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user || user.isMasterAdmin) {
      return false;
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: data.userId,
      },
      select: {
        _id: true,
        projectId: true,
        hasAcceptedInvitation: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const belongsToAnotherProject: boolean = memberships.some(
      (membership: TeamMember) => {
        return membership.projectId?.toString() !== data.projectId.toString();
      },
    );

    if (belongsToAnotherProject) {
      return false;
    }

    return (
      this.getStandingFromMemberships(memberships) ===
      ProjectSCIMAccountStanding.Member
    );
  }

  /*
   * Why SCIM may not change this account's email address, or null when it
   * may. Only asked when the address would actually change: an IdP that sends
   * the address the account already has is not changing anything.
   */
  public static async getEmailChangeRefusal(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<string | null> {
    if (this.isHostedService()) {
      return HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE;
    }

    if (!(await this.isAccountManagedByProject(data))) {
      return UNMANAGED_EMAIL_CHANGE_REFUSED_MESSAGE;
    }

    return null;
  }

  // Throws ProjectSCIMEmailChangeRefusedException when the change is refused.
  public static async assertMayChangeEmail(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const refusal: string | null = await this.getEmailChangeRefusal(data);

    if (refusal) {
      throw new ProjectSCIMEmailChangeRefusedException(refusal);
    }
  }

  /*
   * A name is not a credential, so a name SCIM may not write is skipped
   * rather than failing the request: IdPs send names with every update.
   */
  public static async mayChangeName(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<boolean> {
    return await this.isAccountManagedByProject(data);
  }

  /*
   * Whether an update carrying `newEmail` would change the address of an
   * account whose current address is `currentEmail`. Email normalises case
   * and whitespace, so this compares what would actually be stored.
   */
  public static isEmailChanging(data: {
    currentEmail: string | undefined;
    newEmail: string;
  }): boolean {
    return (
      (data.currentEmail || "").trim().toLowerCase() !==
      data.newEmail.trim().toLowerCase()
    );
  }
}
