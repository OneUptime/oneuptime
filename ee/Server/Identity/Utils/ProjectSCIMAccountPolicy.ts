import { isScimEmailChanging } from "./SCIMUtils";
import ColumnLength from "Common/Types/Database/ColumnLength";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
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
 *    an ACCEPTED membership only for an account that has already joined
 *    this project - which includes everybody whose mailbox owner confirmed
 *    this project's single sign-on (UserProjectSsoConsent): confirming joins
 *    them. Everybody else is INVITED: a pending membership and the ordinary
 *    invitation email, which they accept or reject for themselves. That
 *    includes somebody who has left the project: leaving ends their consent
 *    to its single sign-on (ProjectLeaveAccessCleanup), so the project
 *    cannot add them back without asking.
 *
 *    And it includes an account the connection has just created (#9899).
 *    It used to be added at once, where one that existed was invited, so
 *    the project's Users list - Member or Invited - said which addresses
 *    already had an account. Now both are invited, after the same reads,
 *    named by the name the identity provider sent (TeamMember.inviteeName)
 *    until they accept: what the project reads of the two is the same.
 *    Accepting SCIM's word for addresses on the project's verified domains,
 *    so that both are members instead, would not hide it: a member's own
 *    profile shows (#9823, PendingInviteeProfiles), and an account that
 *    existed would show its own name and picture where one SCIM made shows
 *    the provider's.
 *
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
 *        belongs to no other project, and is not a master admin;
 *      - and an address only to one no other account signs in with.
 *    An invitee who has not accepted is not managed by this project yet.
 *
 * How either rule came out for an account is never said to the project
 * (#9825). Its SCIM log, which its members and viewers read, and the
 * answers its identity provider reads would otherwise say which accounts
 * existed before SCIM created them, belong to other projects or are
 * administrators, and which addresses other accounts have. The identity
 * provider is answered with what it sent, and the log says the same words
 * whether or not the account took a new address or name
 * (SELF_HOSTED_EMAIL_CHANGE_STEP, NAME_CHANGE_STEP).
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

// Why the account keeps its address on the hosted service: the same for every account there.
export const HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE: string =
  "SCIM cannot change the email address of a OneUptime account on this service, because the address is how the person signs in to every project they belong to. The user can change their email address from their own OneUptime profile.";

/*
 * What the connection's SCIM log says when the identity provider gives a
 * user a new address on the hosted service, where no account takes one.
 */
export const HOSTED_EMAIL_CHANGE_STEP: string = `Email change not applied to the OneUptime account: ${HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE} The SCIM user keeps the address the identity provider sent.`;

/*
 * What the connection's SCIM log says when the identity provider gives a
 * user a new address on a self-hosted install: the same words whether the
 * account took it or not, and whatever kept it from taking it - an account
 * this project does not manage, or an address another account signs in
 * with. The log is read by the project's members and viewers, and which it
 * was would say whether the account belongs to other projects or is an
 * administrator, or whether another account has the address (#9825).
 */
export const SELF_HOSTED_EMAIL_CHANGE_STEP: string =
  "The SCIM user keeps the new address the identity provider sent. The OneUptime account signs in with it only if this project's SCIM may give the account that address; if not, the person keeps the address they have, and can change it from their own OneUptime profile.";

/*
 * The same for a new name, everywhere: whether the account took it would say
 * whether this project manages it (rule 2 above).
 */
export const NAME_CHANGE_STEP: string =
  "The SCIM user keeps the new name the identity provider sent. The OneUptime account takes it only if this project's SCIM may rename the account; if not, the person keeps the name they have.";

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
   * A name the identity provider sent, as a membership keeps it
   * (TeamMember.inviteeName, as TeamMemberService.toInviteeName keeps an
   * invite form's): trimmed, cut to the column's length, and undefined when
   * there is none.
   */
  public static toInviteeName(
    name: string | null | undefined,
  ): string | undefined {
    if (typeof name !== "string") {
      return undefined;
    }

    const kept: string = name
      .trim()
      .substring(0, ColumnLength.ShortText)
      .trim();

    return kept || undefined;
  }

  /*
   * Adds an account to one of the project's teams: accepted when rule 1
   * above allows it, as a pending invitation when it does not. Asked the
   * same way, with the same reads, whether the connection has just created
   * the account or it existed (#9899).
   *
   * `inviteeName` is the name the identity provider sent for the person -
   * never the account's own - which the project sees in place of their
   * profile until they accept (TeamMember.inviteeName, #9823).
   */
  public static async addUserToTeam(data: {
    projectId: ObjectID;
    userId: ObjectID;
    teamId: ObjectID;
    inviteeName?: string | null | undefined;
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

    const inviteeName: string | undefined = this.toInviteeName(
      data.inviteeName,
    );

    if (inviteeName) {
      teamMember.inviteeName = inviteeName;
    }

    if (!this.isHostedService()) {
      return await this.createAcceptedMembership(teamMember);
    }

    /*
     * Where the account stands in the project, read for every address -
     * one the connection has just created as well as one that existed - so
     * that both take the same reads, and only having joined the project
     * already makes a member (rule 1 above).
     */
    const standing: ProjectSCIMAccountStanding =
      await this.getStandingInProject({
        projectId: data.projectId,
        userId: data.userId,
      });

    if (standing === ProjectSCIMAccountStanding.Member) {
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

  /*
   * The identity provider renamed a SCIM user: the person's invitations into
   * the project that wait for them take the new name, so the project goes
   * on seeing the provider's name for someone it has not met yet (#9899).
   * An accepted membership is left as it is: the project sees a member's
   * own profile. A provider that sends no name any more leaves the one it
   * sent. The same write, whether or not the account existed before the
   * connection named it: both are invitations until they accept.
   */
  public static async renamePendingInvitations(data: {
    projectId: ObjectID;
    userId: ObjectID;
    inviteeName: string | null | undefined;
  }): Promise<void> {
    const inviteeName: string | undefined = this.toInviteeName(
      data.inviteeName,
    );

    if (!inviteeName) {
      return;
    }

    await TeamMemberService.updateBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        hasAcceptedInvitation: false,
      },
      data: {
        inviteeName: inviteeName,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
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
   * Read before anything is decided - for an administrator's account too,
   * which no project manages - so every account takes the same reads, and
   * how long the answer takes says nothing of which it was (#9899).
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

    if (!user || user.isMasterAdmin) {
      return false;
    }

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
   * Whether SCIM may give this account `newEmail`: never on the hosted
   * service; on a self-hosted install, only to an account this project
   * manages, and only an address no other account signs in with. Only asked
   * when the address would actually change: an IdP that sends the address
   * the account already has is not changing anything.
   *
   * Which of these it was is never said (SELF_HOSTED_EMAIL_CHANGE_STEP).
   */
  public static async mayChangeEmail(data: {
    projectId: ObjectID;
    userId: ObjectID;
    newEmail: string;
  }): Promise<boolean> {
    if (this.isHostedService()) {
      return false;
    }

    /*
     * Both asked of every account, managed or not, so the answer takes the
     * same reads whichever it is: an account this project manages has
     * joined it and no other, and how long the answer took would say which
     * (#9899).
     */
    const isManaged: boolean = await this.isAccountManagedByProject(data);

    const isTaken: boolean = await this.isAddressOfAnotherAccount({
      userId: data.userId,
      email: data.newEmail,
    });

    return isManaged && !isTaken;
  }

  /*
   * Whether another account signs in with `email`. An address belongs to one
   * account, so this one cannot take it - and an attempt would be refused
   * with words that say the address is taken.
   */
  public static async isAddressOfAnotherAccount(data: {
    userId: ObjectID;
    email: string;
  }): Promise<boolean> {
    const holder: User | null = await UserService.findOneBy({
      query: {
        email: new Email(data.email),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return (
      Boolean(holder?.id) &&
      holder!.id!.toString().toLowerCase() !==
        data.userId.toString().toLowerCase()
    );
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
   * account whose current address is `currentEmail`: SCIMUtils'
   * isScimEmailChanging, which compares what would actually be stored.
   */
  public static isEmailChanging(data: {
    currentEmail: string | undefined;
    newEmail: string;
  }): boolean {
    return isScimEmailChanging(data);
  }
}
