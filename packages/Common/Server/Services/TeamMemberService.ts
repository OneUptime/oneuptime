import ProjectMilestoneService from "./ProjectMilestoneService";
import ActivationMilestone from "../../Types/Analytics/ActivationMilestone";
import DatabaseConfig from "../DatabaseConfig";
import { IsBillingEnabled } from "../EnvironmentConfig";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../Infrastructure/Semaphore";
import CreateBy from "../Types/Database/CreateBy";
import CreateLimit from "../Types/Database/CreateLimit";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import ModelPermission from "../Types/Database/Permissions/Index";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import EditionEnforcement from "../Utils/EditionEnforcement";
import Errors from "../Utils/Errors";
import logger, { LogAttributes } from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import UserRegistrationToken from "../Utils/UserRegistrationToken";
import PublicMessageRateLimit, {
  PublicMessageSendPermit,
  TeamMessageKind,
} from "../Utils/RateLimit/PublicMessageRateLimit";
import InvitationEmailWindow, {
  InvitationEmailWindowClaim,
} from "../Utils/TeamMember/InvitationEmailWindow";
import InvitationSsoSignInLink from "../Utils/TeamMember/InvitationSsoSignInLink";
import { StatementContext } from "../Utils/Database/StatementOutcome";
import Exception from "../../Types/Exception/Exception";
import AccessTokenService from "./AccessTokenService";
import BillingService from "./BillingService";
import ProjectReferencesService from "./ProjectReferencesService";
import MailService from "./MailService";
import ProjectService from "./ProjectService";
import TeamPermissionService from "./TeamPermissionService";
import TeamService from "./TeamService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import UserService from "./UserService";
import { AccountsRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import Route from "../../Types/API/Route";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../../Types/BaseDatabase/Query";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Email from "../../Types/Email";
import EmailMessage from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Name from "../../Types/Name";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import {
  RESEND_INVITATION_LOCK_TIMEOUT_IN_MS,
  RESEND_INVITATION_REFUSALS,
  RESEND_INVITATION_SEND_TIMEOUT_IN_MS,
  ResentInvitation,
  getInvitationMayNotBeResentMessage,
  getInvitationNotResentMessage,
} from "../../Types/Team/ResendInvitation";
import ServerSendingStatus from "../Utils/ServerSending/ServerSendingStatus";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ProjectCountLimit from "../Utils/Database/ProjectCountLimit";
import PositiveNumber from "../../Types/PositiveNumber";
import Project from "../../Models/DatabaseModels/Project";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";
import ProjectSCIMService from "./ProjectSCIMService";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyUserOverrideService from "./OnCallDutyPolicyUserOverrideService";
import UserOnCallCalendarFeedService from "./UserOnCallCalendarFeedService";
import UserOnCallShiftReminderService from "./UserOnCallShiftReminderService";
import OnCallDutyPolicyScheduleCalendarFeedService from "./OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectOnCallCalendarFeedService from "./ProjectOnCallCalendarFeedService";
import OnCallCalendarFeedCache from "../Infrastructure/OnCallCalendarFeedCache";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ProjectLeaveResourceCleanup, {
  ProjectLeaveResourceCleanupResult,
} from "../Utils/TeamMember/ProjectLeaveResourceCleanup";
import ProjectLeaveNotificationCleanup from "../Utils/TeamMember/ProjectLeaveNotificationCleanup";
import { ProjectLeaveRemovalResult } from "../Utils/TeamMember/ProjectLeaveRows";
import ProjectLeaveAccessCleanup from "../Utils/TeamMember/ProjectLeaveAccessCleanup";
import InvitationInviterUtil, {
  InvitationInviter,
} from "../Utils/TeamMember/InvitationInviter";
import {
  getInvitationLanguage,
  getInvitationProjectLogLanguage,
} from "../../Types/Team/InvitationEmailWords";
import { DEFAULT_READER_LANGUAGE } from "../../Types/ReaderLanguage";
import { getUserChosenLanguage } from "../../Types/UserLanguage";
import SsoManagedSignIn from "../Utils/SsoManagedSignIn";
import { SsoManagedBy } from "../../Types/SSO/SsoManagedSignIn";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import { EntityManager } from "typeorm";
import OnDutyPoliciesCache from "../Utils/OnCall/OnDutyPoliciesCache";

/*
 * What cleanupOnCallAssignmentsForUserLeavingProject did, for logging and
 * for the tests. Every count is "as far as we got": a step that failed is
 * logged and the remaining steps still run.
 */
export interface OnCallLeaveCleanupResult {
  removedLayerUserCount: number;
  removedEscalationRuleUserCount: number;
  removedUserOverrideCount: number;
  refreshedScheduleIds: Array<string>;
  personalFeedDisabled: boolean;
  removedReminderCount: number;
  rotatedScheduleFeedIds: Array<string>;
  rotatedProjectFeedIds: Array<string>;
}

// The two names of a membership's team and person, ID column first.
const TEAM_KEYS: Array<string> = ["teamId", "team"];
const USER_KEYS: Array<string> = ["userId", "user"];

/*
 * THE LIMITS ON HOW MANY PEOPLE A PROJECT MAY HAVE: the seats of a plan
 * bought from a reseller (Project.seatLimit; none when it is empty or 0),
 * and the Free plan's one person. Both are the project's, whoever adds the
 * person (readPeopleLimits), and both count people, not memberships - the
 * distinct users with any membership in the project, a pending invitation
 * included (getUniqueTeamMemberCountInProject) - so someone already in the
 * project joins another of its teams whatever the count.
 *
 * Asked twice: early, in onBeforeCreate, before an account is made for
 * an invitee or anyone is mailed, and again with the INSERT, in its own
 * transaction under the limit's lock in the project (getCreateLimit), so
 * people added at the same moment cannot all pass - on every path that adds
 * someone: an invitation, a first sign-in through the project's SSO, SCIM,
 * an import. The lock's name, and what it counts.
 */
export const SEAT_LIMIT_NAME: string = "seats";

export const PEOPLE_IN_PROJECT_STATEMENT: string =
  'SELECT COUNT(DISTINCT "userId")::int AS "count" FROM "TeamMember" WHERE "projectId" = $1 AND "deletedAt" IS NULL';

// A person's memberships in the project: any one means they are counted.
export const MEMBERSHIPS_OF_PERSON_STATEMENT: string =
  'SELECT COUNT(*)::int AS "count" FROM "TeamMember" WHERE "projectId" = $1 AND "userId" = $2 AND "deletedAt" IS NULL';

// How many people the Free plan allows: the project's owner.
export const ALLOWED_PEOPLE_IN_FREE_PLAN: number = 1;

// Why nobody may be invited from OneUptime while SCIM manages the teams.
export const SCIM_PUSH_GROUPS_INVITE_MESSAGE: string =
  "Cannot invite team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.";

// Where one resend of a person's invitation holds the others back (resendInvitation).
export const RESEND_INVITATION_LOCK_NAMESPACE: string =
  "TeamMemberService.resendInvitation";

/*
 * Someone the caller's Remove from Project would leave in the project
 * (getTeamsOutOfRemovalReach): the teams the caller's own delete does not
 * reach, and whether it reaches any of theirs.
 */
export interface TeamsOutOfRemovalReach {
  userId: ObjectID;
  teamIds: Array<ObjectID>;
  // Memberships out of reach that name no team: counted, as the check counts them.
  membershipsWithoutTeam: number;
  hasTeamInReach: boolean;
}

// One person's memberships, as getTeamsOutOfRemovalReach groups them.
interface PersonsMembershipsInReach {
  userId: ObjectID;
  teamIds: Map<string, ObjectID>;
  membershipsWithoutTeam: number;
  hasTeamInReach: boolean;
}

/*
 * The invitation a membership create plans (onBeforeCreate), sent once the
 * membership is made, after the request (sendPlannedInvitation, #10180).
 */
export interface PlannedInvitation {
  // The invitee's account: its id, and its password column.
  user: User;
  // Where the email goes, or null when this create sends none.
  email: Email | null;
  // Its account was made by this invitation.
  isNewUser: boolean;
  // Accepted for them as it was made: nothing left for them to accept.
  isAccepted: boolean;
  // The name an account nobody has claimed takes, if it has none yet.
  nameForUnclaimedAccount?: string | undefined;
}

// What onBeforeCreate hands the rest of a membership's create.
export interface TeamMemberCreateCarryForward {
  invitation: PlannedInvitation | null;
  // The address's count of the email (PublicMessageRateLimit).
  invitationPermit: PublicMessageSendPermit | null;
  // The project's window for the person (InvitationEmailWindow).
  invitationWindow: InvitationEmailWindowClaim | null;
  // Set once onCreateSuccess has started the email: nothing is given back after.
  isSending: boolean;
}

// The limits on people a membership create is held to.
export interface ProjectPeopleLimits {
  // The plan's seats, when it has a number of them.
  seatLimit: number | null;
  // Whether the Free plan's one person holds it.
  isFreePlan: boolean;
}

export class TeamMemberService extends ProjectReferencesService<TeamMember> {
  /*
   * Caches the user's accepted team memberships per project. Auth middleware
   * calls this on every authenticated request to evaluate the `Owned`
   * permission scope; without the cache it's a Postgres findBy per request.
   * 60s of staleness on team membership changes is acceptable; we also
   * invalidate proactively when team membership writes happen.
   */
  private teamIdsForUserCache: InMemoryTTLCache<Array<string>> =
    new InMemoryTTLCache(10_000);

  // The invitations sent after their requests that have not finished yet.
  private invitationsInFlight: Set<Promise<void>> = new Set<Promise<void>>();

  public constructor() {
    super(TeamMember);
  }

  /*
   * An id no account has, for a read asked of an address with no account as
   * it is of one with an account (#10180): new each time, so it matches
   * nobody.
   */
  public static getStandInUserId(): ObjectID {
    return ObjectID.generate();
  }

  /*
   * Settles once every invitation started after its request so far
   * (sendPlannedInvitation) has been sent or has failed: for whatever must
   * know the email went - the tests that drive a create through its hooks.
   */
  public async whenInvitationsSent(): Promise<void> {
    while (this.invitationsInFlight.size > 0) {
      await Promise.allSettled(Array.from(this.invitationsInFlight));
    }
  }

  /*
   * Ends the project's invitation email window of each person these
   * memberships name (InvitationEmailWindow): they accepted, or declined.
   * Never throws.
   */
  private static async endInvitationWindows(
    memberships: Array<TeamMember>,
  ): Promise<void> {
    const byProject: Map<
      string,
      { projectId: ObjectID; userIds: Map<string, ObjectID> }
    > = new Map();

    for (const membership of memberships) {
      if (!membership.projectId || !membership.userId) {
        continue;
      }

      const projectKey: string = membership.projectId.toString().toLowerCase();
      const entry: { projectId: ObjectID; userIds: Map<string, ObjectID> } =
        byProject.get(projectKey) || {
          projectId: membership.projectId,
          userIds: new Map<string, ObjectID>(),
        };

      entry.userIds.set(
        membership.userId.toString().toLowerCase(),
        membership.userId,
      );
      byProject.set(projectKey, entry);
    }

    for (const entry of byProject.values()) {
      await InvitationEmailWindow.end({
        projectId: entry.projectId,
        userIds: Array.from(entry.userIds.values()),
      });
    }
  }

  // What onBeforeCreate carried forward, or null for a create that skipped it.
  private static readCarryForward(
    carryForward: unknown,
  ): TeamMemberCreateCarryForward | null {
    if (
      !carryForward ||
      typeof carryForward !== "object" ||
      Array.isArray(carryForward) ||
      !("isSending" in carryForward)
    ) {
      return null;
    }

    return carryForward as TeamMemberCreateCarryForward;
  }

  /*
   * Why an invitation into `projectId` would make the person's sign-in
   * SSO's (SsoManagedSignIn.getManagedByOnceIn, #9819), or null. Only the
   * email's words depend on it: a rule that cannot be read is logged, and
   * the invitation goes out as it always did.
   */
  public static async readInvitationSsoManagedBy(data: {
    userId: ObjectID | null;
    projectId: ObjectID;
  }): Promise<SsoManagedBy | null> {
    try {
      return await SsoManagedSignIn.getManagedByOnceIn({
        userId: data.userId,
        joiningProjectId: data.projectId,
      });
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
        } as LogAttributes,
      );
      return null;
    }
  }

  /*
   * A name typed for someone invited, as a membership keeps it
   * (TeamMember.inviteeName, #9823): trimmed, cut to the column's length,
   * and undefined when there is none.
   */
  public static toInviteeName(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const name: string = value
      .trim()
      .substring(0, ColumnLength.ShortText)
      .trim();

    return name || undefined;
  }

  /*
   * The user is the person being invited, who is not a member of the
   * project until this row exists - an invitation by email names someone
   * who may not even have an account yet - so the membership the generic
   * check asks for cannot apply to them. The team must be the project's own,
   * for every caller, workflows included.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["user"];
  }

  /*
   * Whether SCIM Push Groups owns this project's team membership, which locks
   * member invites and removals made from OneUptime and lifts the one-member
   * guard. Never on the Community Edition: it serves no SCIM endpoint, so a
   * leftover Push Groups setting there would leave teams nobody can manage.
   */
  @CaptureSpan()
  private async isSCIMPushGroupsEnabled(projectId: ObjectID): Promise<boolean> {
    if (!EditionEnforcement.areScimTeamLocksEnforced()) {
      return false;
    }

    const count: PositiveNumber = await ProjectSCIMService.countBy({
      query: {
        projectId: projectId,
        enablePushGroups: true,
      },
      props: {
        isRoot: true,
      },
    });
    return count.toNumber() > 0;
  }

  /*
   * WHO IS EMAILED ABOUT A MEMBERSHIP MADE FOR A USER ID (#8421): the
   * person's account - with its address, and its password column, which
   * says which link the invitation carries - or null when nobody is.
   *
   * A membership made for a person picked by id, not named by address, sent
   * no email: the invitation email was sent only for an address
   * (miscDataProps["email"]). Now the person is sent the same InviteMember
   * email an invitation by address sends - "You're Invited to ..." while it
   * waits for them, "You've Been Added to ..." when it was accepted for them,
   * with the sign-up link (and its token) when they have no password yet -
   * except:
   *
   *   - when OneUptime itself makes it (isRoot). Its own writes decide whom
   *     they email: SCIM names the address with a person's first invitation
   *     into a project; a first sign-in through SSO or a marketplace and the
   *     owner of a new project are emailed nothing;
   *   - when the person makes it for themselves: they know;
   *   - when the person has a membership in this project already, pending or
   *     accepted. A pending one has their invitation, and its email, waiting
   *     already, and accepting it accepts every team of the project
   *     (acceptPendingInvitationsInProject); an accepted one is in the
   *     project. A person's Teams > Invite on the Dashboard, a project user's
   *     Add to Team in the Admin Dashboard and an import that fills the teams
   *     it made only ever add such a person to another team, and one email
   *     per team, for the same project, would tell them nothing new. Someone
   *     named by address is still emailed as before: that form says it
   *     emails them, and it is how an invitation is sent again.
   */
  @CaptureSpan()
  public async getInviteeToEmailById(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    userId: ObjectID | null;
  }): Promise<User | null> {
    if (!data.userId || data.props.isRoot) {
      return null;
    }

    if (
      data.props.userId &&
      data.props.userId.toString().toLowerCase() ===
        data.userId.toString().toLowerCase()
    ) {
      return null;
    }

    if (
      await this.hasMembershipInProject({
        projectId: data.projectId,
        userId: data.userId,
      })
    ) {
      return null;
    }

    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        _id: true,
        email: true,
        password: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user?.id || !user.email) {
      return null;
    }

    return user;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<TeamMember>,
  ): Promise<OnCreate<TeamMember>> {
    await super.onBeforeCreate(createBy);

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    /*
     * The team and the person, each under either of its names: the two must
     * agree (RelationIdUtil.readConsistent), and each is then written under
     * its ID column alone (stamp), so every check below reads the team and
     * the person the membership is stored with.
     */
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;
    const teamId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      TEAM_KEYS,
      "Team",
    );
    const namedUserId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      USER_KEYS,
      "User",
    );

    if (namedUserId) {
      RelationIdUtil.stamp(createData, USER_KEYS, namedUserId);
    }

    if (!projectId) {
      throw new BadDataException(
        "The request did not say which project to invite the member to.",
      );
    }

    if (!teamId) {
      throw new BadDataException(
        "The request did not say which team to invite the member to.",
      );
    }

    createBy.data.projectId = projectId;
    RelationIdUtil.stamp(createData, TEAM_KEYS, teamId);

    /*
     * A name the request gave the membership itself (an API client's
     * inviteeName): kept as the invite forms' Name is, trimmed and cut to
     * fit, and none at all when blank. The forms' Name, below, wins.
     */
    const givenInviteeName: string | undefined =
      TeamMemberService.toInviteeName(createBy.data.inviteeName);

    if (givenInviteeName) {
      createBy.data.inviteeName = givenInviteeName;
    } else {
      delete createBy.data.inviteeName;
    }

    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      if (
        !createBy.props.tenantId ||
        createBy.props.tenantId.toString() !== projectId.toString()
      ) {
        throw new NotAuthorizedException(
          "Team members can only be managed inside the current project.",
        );
      }

      const team: Team | null = await TeamService.findOneBy({
        query: {
          _id: teamId,
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!team) {
        throw new BadDataException(
          "This team no longer exists in this project. Reload the page and pick another team.",
        );
      }

      await TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: teamId,
        projectId: projectId,
        props: createBy.props,
      });
    }

    // Check if SCIM is enabled for the project
    if (
      !createBy.props.isRoot &&
      (await this.isSCIMPushGroupsEnabled(
        createBy.data.projectId! || createBy.props.tenantId,
      ))
    ) {
      throw new BadDataException(SCIM_PUSH_GROUPS_INVITE_MESSAGE);
    }

    /*
     * An invitation by email is for whoever has that address. They are only
     * looked up here, so that the member limits below can tell whether they
     * are in the project already. Someone with no account yet gets one
     * further down, once the invitation has been allowed, so a refused
     * invitation never leaves a user behind.
     *
     * `password` comes back too, because whether this person has finished
     * registering decides both which link the invitation carries and whether
     * that link needs a registration token. UserService.findByEmail selects
     * only the id, so it cannot answer that.
     */
    const invitedEmail: Email | null =
      createBy.miscDataProps && createBy.miscDataProps["email"]
        ? new Email(createBy.miscDataProps["email"] as string)
        : null;

    const userWithInvitedEmail: User | null = invitedEmail
      ? await UserService.findOneBy({
          query: {
            email: invitedEmail,
          },
          select: {
            _id: true,
            password: true,
          },
          props: {
            isRoot: true,
          },
        })
      : null;

    /*
     * Check if this project can have more people: early, so a project at
     * its limit is refused before an account is made for the invitee or
     * anyone is mailed. The INSERT asks again, under the limit's lock
     * (getCreateLimit).
     */
    if (IsBillingEnabled && createBy.data.projectId) {
      const peopleLimits: ProjectPeopleLimits | null =
        await this.readPeopleLimits({
          projectId: projectId,
          props: createBy.props,
        });

      /*
       * An address with no account is asked about as a stand-in nobody is
       * (#10180): the same read as for an address with one, so how long the
       * invitation takes says nothing of which it was.
       */
      const invitedUserId: ObjectID | null | undefined = invitedEmail
        ? userWithInvitedEmail?.id || TeamMemberService.getStandInUserId()
        : createBy.data.userId;

      /*
       * Both limits count people, not memberships, and a pending invitation
       * counts as much as an accepted one (see
       * getUniqueTeamMemberCountInProject). Someone who already has either in
       * this project is in that count already: adding them to another team
       * leaves it where it was, so neither limit applies to them.
       */
      const isInvitedUserAlreadyCounted: boolean = Boolean(
        peopleLimits &&
          invitedUserId &&
          (await this.hasMembershipInProject({
            projectId: projectId,
            userId: invitedUserId,
          })),
      );

      if (peopleLimits && !isInvitedUserAlreadyCounted) {
        /*
         * Billing can lag after a provider outage. Admission limits must use
         * persisted memberships, including pending invitations.
         */
        const numberOfMembers: number =
          await this.getUniqueTeamMemberCountInProject(projectId);

        const refusal: string | null = this.getPeopleLimitRefusal({
          limits: peopleLimits,
          people: numberOfMembers,
        });

        if (refusal) {
          throw new BadDataException(refusal);
        }
      }
    }

    /*
     * Only internal writes (isRoot) and a master admin acting from the Admin
     * Dashboard may create a membership that is already accepted - that is the
     * "accept the invitation automatically" checkbox on the admin invite forms.
     *
     * Everyone else invites, and the invited person accepts for themselves. A
     * project admin who could accept on someone's behalf would be able to pull
     * an account into their project - and into whatever the team's permissions
     * grant - without that person ever agreeing to it. The one exception is a
     * person who has already accepted joining this project, further down.
     */
    const canCreateAcceptedInvitation: boolean = Boolean(
      createBy.props.isRoot || createBy.props.isMasterAdmin,
    );

    if (!canCreateAcceptedInvitation) {
      createBy.data.hasAcceptedInvitation = false;
    }

    /*
     * A person picked by id rather than named by address - a user's Add to
     * Project in the Admin Dashboard and its bulk twin on the Users list, a
     * membership made through the API - is emailed the invitation too, once:
     * with the membership that first brings them into the project (#8421).
     * They were never told before, so they found out only if they happened
     * to sign in, and someone with no account was never sent their link.
     * getInviteeToEmailById says who is not emailed, and why.
     */
    const inviteeNamedById: User | null = invitedEmail
      ? null
      : await this.getInviteeToEmailById({
          props: createBy.props,
          projectId: projectId,
          userId: namedUserId,
        });

    // Where the invitation goes, whichever way the person was named.
    const invitationAddress: Email | null =
      invitedEmail || inviteeNamedById?.email || null;

    /*
     * An invitation by email to someone who is not in the project yet is a
     * message to an address the team names, from this installation's mail
     * server, and the project's to send (#10179):
     *
     *   - once per window: a project that emailed the person an invitation
     *     within the last hour sends them no second one until they accept or
     *     decline one (InvitationEmailWindow). The invitation is made all the
     *     same, and Resend Invitation still sends it, so a SCIM connection
     *     that creates, deletes and creates a user again mails them once;
     *   - counted for the project and the address
     *     (PublicMessageRateLimit.assertTeamMaySend): past the project's
     *     limit it is refused with 429, and past the cap on every project's
     *     invitations to the address together with a 503 that says only "not
     *     now", never that anybody else invited them.
     *
     * The team is never counted, so inviting many colleagues at once goes
     * on. Asked before an account is made for the invitee, so a refused
     * invitation leaves nothing behind; given back, with the window, when the
     * invitation ends with nothing sent (onCreateError, sendPlannedInvitation).
     * Someone who has joined the project already, added to another of its
     * teams, is told so rather than invited, and is not counted: asked of
     * every address, of a stand-in when no account has it, so the reads are
     * the same either way (#10180). A person picked by id is counted by their
     * account's address, the same way.
     */
    const isEmailedIfMade: boolean = Boolean(
      invitationAddress &&
        !createBy.data.hasAcceptedInvitation &&
        !(
          invitedEmail &&
          (await this.isUserMemberOfProject({
            projectId: projectId,
            userId:
              userWithInvitedEmail?.id || TeamMemberService.getStandInUserId(),
          }))
        ),
    );

    // Whose window it is, where the person has an account already.
    const invitedAccountId: ObjectID | null =
      userWithInvitedEmail?.id || inviteeNamedById?.id || null;

    let invitationWindow: InvitationEmailWindowClaim | null = null;
    let invitationPermit: PublicMessageSendPermit | null = null;

    if (isEmailedIfMade && invitationAddress) {
      if (invitedAccountId) {
        invitationWindow = await InvitationEmailWindow.claim({
          projectId: projectId,
          userId: invitedAccountId,
        });
      }

      // Within the window nothing is sent, so nothing is counted.
      if (!invitationWindow || invitationWindow.isClaimed) {
        try {
          invitationPermit = await PublicMessageRateLimit.assertTeamMaySend({
            kind: TeamMessageKind.Invitation,
            projectId: projectId,
            contacts: [PublicMessageRateLimit.forEmail(invitationAddress)],
          });
        } catch (err) {
          await invitationWindow?.release();
          throw err;
        }
      }
    }

    /*
     * What this create sends once its membership is made (onCreateSuccess),
     * and gives back if it fails before (onCreateError).
     */
    const carryForward: TeamMemberCreateCarryForward = {
      invitation: null,
      invitationPermit: invitationPermit,
      invitationWindow: invitationWindow,
      isSending: false,
    };

    try {
      /*
       * Set when the member is invited by email: the account the address belongs
       * to, and whether this invite just created it - or, for a person picked by
       * id, their account. The invitation email is planned once everything below
       * has decided what this membership is.
       */
      let invitedUser: User | null = inviteeNamedById;
      let isNewUser: boolean = false;

      // The name an account nobody has claimed takes, after the request (below).
      let nameForUnclaimedAccount: string | undefined = undefined;

      if (invitedEmail) {
        /*
         * The optional name the invite forms offer for every address
         * (#9745, Common/UI/Utils/InviteeName). It names an account only
         * while nobody has signed up to it: the one this invitation creates,
         * or one an earlier invitation created that its person has not
         * claimed yet (no password) and that has no name yet. Whoever has
         * signed up keeps the name they gave, or did not give: no inviter,
         * of any project, writes their profile. The answer is the same
         * either way, so the form tells its inviter nothing about the
         * address.
         */
        const nameValue: string | undefined = createBy.miscDataProps?.["name"]
          ? (createBy.miscDataProps["name"] as string).trim()
          : undefined;

        /*
         * The same name, kept on the membership (#9823): what the project
         * sees of the person until they accept, whoever the address
         * belongs to - never the profile of an account it already had
         * (PendingInviteeProfiles).
         */
        const typedInviteeName: string | undefined =
          TeamMemberService.toInviteeName(nameValue);

        if (typedInviteeName) {
          createBy.data.inviteeName = typedInviteeName;
        }

        let user: User | null = userWithInvitedEmail;

        if (!user) {
          isNewUser = true;

          user = await UserService.createByEmail({
            email: invitedEmail,
            name: nameValue ? new Name(nameValue) : undefined,
            // Record who invited this brand-new user, so it can be surfaced later.
            createdByUserId: createBy.props.userId,
            props: {
              isRoot: true,
            },
          });
        } else if (nameValue && !user.password) {
          /*
           * An invitation nobody has claimed yet: named only if it has no
           * name yet, so a name another inviter gave it stands - once the
           * membership is made, beside its email (#10180). Read and written
           * here, it was work an invitation to an account that has signed
           * up does not do, so how long the answer took said that somebody
           * had invited the address before.
           */
          nameForUnclaimedAccount = nameValue;
        }

        RelationIdUtil.stamp(createData, USER_KEYS, user.id!);

        invitedUser = user;

        /*
         * An address that had no account had no window yet: its new
         * account's opens now, for the email this invitation sends.
         */
        if (isEmailedIfMade && isNewUser && user.id && !invitationWindow) {
          invitationWindow = await InvitationEmailWindow.claim({
            projectId: projectId,
            userId: user.id,
          });
          carryForward.invitationWindow = invitationWindow;
        }
      }

      /*
       * Check if this user is already invited. Before the invitation email,
       * so a repeated invite fails without mailing anybody or minting a
       * registration token for a membership that is never created.
       */
      const member: TeamMember | null = await this.findOneBy({
        query: {
          userId: createBy.data.userId!,
          teamId: teamId,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

      if (member) {
        throw new BadDataException(Errors.TeamMemberService.ALREADY_INVITED);
      }

      /*
       * Acceptance is per project, not per team. Someone who has accepted an
       * invitation to any team of this project has already agreed to be in it,
       * so adding them to another of its teams is a change to their teams - the
       * project admins' call, like changing what a team they are already on may
       * do - and not a new invitation for them to accept. Without this they were
       * asked to accept the same project again for every team they were added
       * to. The permission and SCIM checks above have already run, so this
       * grants nothing the inviter could not grant to an existing teammate.
       *
       * A pending invitee is not a member yet (see isUserMemberOfProject), so a
       * second team they are invited to stays an invitation, and accepting
       * either one accepts both (acceptPendingInvitationsInProject).
       */
      if (
        !createBy.data.hasAcceptedInvitation &&
        createBy.data.userId &&
        (await this.isUserMemberOfProject({
          projectId: projectId,
          userId: createBy.data.userId,
        }))
      ) {
        createBy.data.hasAcceptedInvitation = true;
      }

      const isInvitationAcceptedOnCreate: boolean = Boolean(
        createBy.data.hasAcceptedInvitation,
      );

      /*
       * The acceptance timestamp is stamped here rather than taken from the
       * request, so it can never disagree with hasAcceptedInvitation - a row that
       * says "Member" with no accepted-at date, or an accepted-at date on a row
       * that is still only invited.
       */
      if (isInvitationAcceptedOnCreate) {
        createBy.data.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
      } else {
        delete createBy.data.invitationAcceptedAt;
      }

      /*
       * The address this project invited, kept on a membership that waits
       * for the person (#10175): what the project sees of them, beside the
       * name typed for them, until they accept - never the address their
       * account moves to meanwhile (PendingInviteeProfiles). OneUptime's
       * alone to write: the address it was sent to. A membership made with
       * no address - another team of someone invited already - keeps none,
       * and is read beside the invitation that has one.
       */
      if (!isInvitationAcceptedOnCreate && invitationAddress) {
        createBy.data.inviteeEmail = invitationAddress;
      } else {
        delete createBy.data.inviteeEmail;
      }

      /*
       * A member of the project who has signed up, named by address for
       * another of its teams, is not emailed (#8568). They are in the
       * project and sign in as ever, with nothing to accept or claim, and
       * "You've Been Added to <project>" for every team told them only what
       * they knew; a person picked by id is not emailed either
       * (getInviteeToEmailById). A member who has not signed up yet is: the
       * email carries a new sign-up link, and theirs lasts 7 days. So is a
       * pending invitee, reminded of the invitation the form says it emails
       * - unless the project emailed them within the window
       * (InvitationEmailWindow): that email stands.
       */
      const isSignedUpMemberAlready: boolean = Boolean(
        invitedEmail &&
          invitedUser &&
          !isNewUser &&
          invitedUser.password &&
          isInvitationAcceptedOnCreate &&
          (await this.isUserMemberOfProject({
            projectId: projectId,
            userId: invitedUser.id!,
          })),
      );

      const isEmailedNow: boolean = Boolean(
        invitedUser &&
          invitationAddress &&
          !isSignedUpMemberAlready &&
          !(invitationWindow && !invitationWindow.isClaimed),
      );

      /*
       * The invitation email, as a resend sends it too - built, its link's
       * token minted and sent once the membership is made, after the
       * request (sendPlannedInvitation, #10180) - and the name an account
       * nobody has claimed takes.
       */
      if (invitedUser && (isEmailedNow || nameForUnclaimedAccount)) {
        carryForward.invitation = {
          user: invitedUser,
          email: isEmailedNow ? invitationAddress : null,
          isNewUser: isNewUser,
          isAccepted: isInvitationAcceptedOnCreate,
          nameForUnclaimedAccount: nameForUnclaimedAccount,
        };
      }
    } catch (err) {
      // Nothing was sent: the address gets its count back, and the window closes.
      await carryForward.invitationPermit?.giveBack();
      await carryForward.invitationWindow?.release();
      throw err;
    }

    return { createBy, carryForward: carryForward };
  }

  /*
   * WHAT AN INVITATION DOES ONCE ITS MEMBERSHIP IS MADE, AFTER THE REQUEST
   * (#10180): the name an account nobody has claimed takes, and the
   * invitation email - built, its link's token minted, and sent.
   *
   * All of it used to be done in the request, before the membership was
   * written, and some of it only for an account nobody had claimed yet - one
   * an earlier invitation made: its registration token (one INSERT), and
   * the read and write of its name. So an invitation to such an account took
   * a few milliseconds longer than one to an account that has signed up,
   * which said that somebody had invited the address before - on a
   * dashboard invitation, a SCIM create and a SCIM group add alike. Now the
   * request does the same reads and writes for every account, and none of
   * this: the token goes only into the email, which nobody waited for
   * anyway. An email for a membership whose write then failed is no longer
   * sent either.
   *
   * Never waited for, never thrown: what fails is logged, and nothing sent
   * gives the address its count back and closes the project's window for
   * the person (InvitationEmailWindow), so the next invitation emails them.
   */
  private sendPlannedInvitationInBackground(data: {
    carryForward: TeamMemberCreateCarryForward;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): void {
    /*
     * On the next turn of the event loop, so not even its first read is
     * asked for before the request has answered.
     */
    const sending: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        setTimeout(resolve, 0);
      },
    )
      .then((): Promise<void> => {
        return this.sendPlannedInvitation(data);
      })
      .catch((err: Error): void => {
        logger.error(err, {
          projectId: data.projectId.toString(),
        } as LogAttributes);
      })
      .finally((): void => {
        this.invitationsInFlight.delete(sending);
      });

    this.invitationsInFlight.add(sending);
  }

  private async sendPlannedInvitation(data: {
    carryForward: TeamMemberCreateCarryForward;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const invitation: PlannedInvitation | null = data.carryForward.invitation;

    // Until the mail service may have taken it, nothing was sent.
    let mayHaveBeenSent: boolean = false;

    try {
      if (!invitation) {
        return;
      }

      if (invitation.nameForUnclaimedAccount && invitation.user.id) {
        await TeamMemberService.nameUnclaimedAccount({
          userId: invitation.user.id,
          name: invitation.nameForUnclaimedAccount,
        });
      }

      if (!invitation.email) {
        return;
      }

      const invitationEmail: EmailMessage | null =
        await this.buildInvitationEmail({
          props: data.props,
          projectId: data.projectId,
          user: invitation.user,
          email: invitation.email,
          isNewUser: invitation.isNewUser,
          isAccepted: invitation.isAccepted,
        });

      // The project went meanwhile.
      if (!invitationEmail) {
        return;
      }

      mayHaveBeenSent = true;

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await MailService.sendMail(invitationEmail, {
          projectId: data.projectId,
          userId: invitation.user.id!,
        });

      // The mail service refused it: nothing went out.
      if (response instanceof HTTPErrorResponse) {
        mayHaveBeenSent = false;

        logger.warn(
          `The mail service did not send an invitation email: ${response.message || "no reason given"}`,
          {
            projectId: data.projectId.toString(),
            userId: invitation.user.id?.toString(),
          } as LogAttributes,
        );
      }
    } finally {
      if (!mayHaveBeenSent) {
        await data.carryForward.invitationPermit?.giveBack();
        await data.carryForward.invitationWindow?.release();
      }
    }
  }

  /*
   * The name an invitation typed, for an account nobody has claimed yet that
   * has none: what its sign-up form starts with. Read again here, after the
   * request, so an account claimed meanwhile, or named by another
   * invitation, keeps what it has.
   */
  private static async nameUnclaimedAccount(data: {
    userId: ObjectID;
    name: string;
  }): Promise<void> {
    const account: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        _id: true,
        name: true,
        password: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!account || account.password || account.name?.toString()) {
      return;
    }

    await UserService.updateOneById({
      id: data.userId,
      data: {
        name: new Name(data.name),
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * THE INVITATION EMAIL (the InviteMember template), as it is sent to a
   * new invitation (sendPlannedInvitation) and to one sent again
   * (resendInvitation, #9519) alike. Null when the project is gone.
   * Sending it is the caller's: a new invitation is sent after its request,
   * a resend while its person waits.
   */
  @CaptureSpan()
  private async buildInvitationEmail(data: {
    // Whose request it is: the inviter it names (InvitationInviter).
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    // The invitee's account: its id, and its password column.
    user: User;
    email: Email;
    // Its account was made by this invitation.
    isNewUser: boolean;
    // Accepted for them as it was made: nothing left for them to accept.
    isAccepted: boolean;
  }): Promise<EmailMessage | null> {
    const user: User = data.user;
    const email: Email = data.email;

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      return null;
    }

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    /*
     * "Still has to register", not "we just created the row". Someone
     * invited to a second project before they ever signed up already has a
     * user row and still has no password, and used to be sent the sign-in
     * link — which they could not use, having no password to sign in with.
     */
    const needsRegistration: boolean = data.isNewUser || !user.password;

    /*
     * The token is what lets the recipient claim this account, so it exists
     * only on the link inside this email and only for someone who has not
     * registered yet. An already-registered invitee gets the plain link;
     * they sign in instead, and minting a claim token for an account that
     * cannot be claimed would just be a spare key lying around.
     */
    const registerLink: string = needsRegistration
      ? (
          await UserRegistrationToken.generateRegistrationLink({
            userId: user.id!,
            email: email,
          })
        ).toString()
      : URL.fromString(
          new URL(
            httpProtocol,
            host,
            new Route(AccountsRoute.toString()),
          ).toString(),
        )
          .addRoute("/register")
          .addQueryParam("email", email.toString(), true)
          .toString();

    /*
     * Who is inviting them, named in the subject and the first line,
     * and - on a self-hosted server - whom they ask, and whom a reply
     * reaches (#7471, InvitationInviter). Nobody, for an invitation
     * OneUptime, an API key or a workflow makes. For an invitation sent
     * again, the person sending it now.
     */
    const inviter: InvitationInviter | null = await InvitationInviterUtil.read({
      props: data.props,
      inviteeUserId: user.id,
    });

    /*
     * In the invitee's language (#9897, Types/Team/InvitationEmailWords):
     * the one their account picked, else the inviter's - an account this
     * invitation made has none - else English, as a project has no language
     * of its own. Subject and body alike.
     *
     * The project's email log, which its members and viewers read, keeps
     * the subject in the language the email has for an invitee with no
     * language of their own: the inviter's, else English. Written in the
     * invitee's, it would say that the address already had an account, and
     * which language it reads (#9823).
     */
    const language: string = getInvitationLanguage({
      inviteeLanguage: await TeamMemberService.readInviteeLanguage(user.id),
      inviterLanguage: inviter?.language,
    });
    const projectLogLanguage: string = getInvitationProjectLogLanguage({
      inviterLanguage: inviter?.language,
    });

    /*
     * An invitation that makes the person's sign-in SSO's (#9819): every
     * project they would be in manages sign-in with SSO, or the server
     * requires it. They have no password to set and nothing to create, so
     * the email offers single sign-on instead. The sign-up page its link
     * opens offers the project's providers (SignUpInvitation); someone
     * signed up already is sent to sign in with SSO. Anyone who also
     * belongs to a project that does not manage sign-in gets the email it
     * always was.
     */
    const ssoManagedBy: SsoManagedBy | null =
      await TeamMemberService.readInvitationSsoManagedBy({
        userId: data.isNewUser ? null : user.id || null,
        projectId: data.projectId,
      });

    const ssoSignInLink: string = needsRegistration
      ? registerLink
      : await TeamMemberService.getSignedUpSsoSignInLink({
          ssoManagedBy: ssoManagedBy,
          user: user,
          email: email,
          projectId: data.projectId,
          isAccepted: data.isAccepted,
          host: host,
          httpProtocol: httpProtocol,
        });

    return {
      toEmail: email,
      templateType: EmailTemplateType.InviteMember,
      vars: {
        signInLink: URL.fromString(
          new URL(
            httpProtocol,
            host,
            new Route(AccountsRoute.toString()),
          ).toString(),
        ).toString(),
        registerLink: registerLink,
        isNewUser: needsRegistration.toString(),
        /*
         * An auto-accepted member - accepted by a master admin, or
         * already in the project through another team - has nothing
         * left to accept, so the template drops the "sign in to accept
         * your invitation" framing and tells them they are already in.
         */
        isInvitationAccepted: data.isAccepted.toString(),
        // Offer single sign-on, not a password (#9819); and where it opens.
        isSsoSignIn: (ssoManagedBy !== null).toString(),
        ssoSignInLink: ssoSignInLink,
        projectName: project.name!,
        homeUrl: new URL(httpProtocol, host).toString(),
        ...InvitationInviterUtil.getTemplateVars(inviter),
      },
      subject: InvitationInviterUtil.getSubject({
        projectName: project.name!,
        inviter: inviter,
        isAccepted: data.isAccepted,
        language: language,
      }),
      projectLogSubject: InvitationInviterUtil.getSubject({
        projectName: project.name!,
        inviter: inviter,
        isAccepted: data.isAccepted,
        language: projectLogLanguage,
      }),
      isSubjectLiteral: true,
      ...(language === DEFAULT_READER_LANGUAGE ? {} : { language: language }),
      replyToEmail: InvitationInviterUtil.getReplyTo({
        inviter: inviter,
        isSelfHosted: !IsBillingEnabled,
      }),
    };
  }

  /*
   * Where an invitation's Sign In with SSO opens for someone who has signed
   * up already (#10178):
   *
   *   - when the project's single sign-on manages their sign-in, the
   *     project's own SSO page, which lists its providers
   *     (/accounts/sso/<project id>, #9918) - "Sign in with SSO" finds them
   *     only by the address's verified domain, so found nothing for an
   *     address on another domain - and, on OneUptime Cloud, with a
   *     single-use link of their own (InvitationSsoSignInLink): picking a
   *     provider there confirms the project's single sign-on, so the
   *     provider signs them in the first time, with no second email. Not
   *     for an invitation accepted for them, which has nothing to accept,
   *     and not on a self-hosted server, which asks no mailbox;
   *   - else "Sign in with SSO" (/accounts/sso), as before: the server
   *     requires single sign-on, and its own providers sign them in.
   *
   * Minted with the email, after the request (#10180), and only into it.
   */
  private static async getSignedUpSsoSignInLink(data: {
    ssoManagedBy: SsoManagedBy | null;
    user: User;
    email: Email;
    projectId: ObjectID;
    isAccepted: boolean;
    host: Hostname;
    httpProtocol: Protocol;
  }): Promise<string> {
    if (data.ssoManagedBy !== SsoManagedBy.Projects) {
      return URL.fromString(
        new URL(
          data.httpProtocol,
          data.host,
          new Route(AccountsRoute.toString()),
        ).toString(),
      )
        .addRoute("/sso")
        .toString();
    }

    if (!IsBillingEnabled || data.isAccepted || !data.user.id) {
      return InvitationSsoSignInLink.getPageUrl({
        host: data.host,
        httpProtocol: data.httpProtocol,
        projectId: data.projectId,
      });
    }

    return await InvitationSsoSignInLink.mint({
      userId: data.user.id,
      email: data.email,
      projectId: data.projectId,
      host: data.host,
      httpProtocol: data.httpProtocol,
    });
  }

  /*
   * The language the invitee's account picked (Types/UserLanguage), or ""
   * when it picked none - as an account this invitation made has not. Read
   * by the account's id for every invitation, new account or not, so the
   * work is the same either way. A read that fails is none: the invitation
   * is written in the inviter's language, and never held back for it.
   */
  private static async readInviteeLanguage(
    userId: ObjectID | null | undefined,
  ): Promise<string> {
    if (!userId) {
      return "";
    }

    try {
      const account: User | null = await UserService.findOneById({
        id: userId,
        select: {
          _id: true,
          language: true,
        },
        props: {
          isRoot: true,
        },
      });

      return getUserChosenLanguage(account);
    } catch (err) {
      logger.warn(
        "Could not read the language of an invitee's account; the invitation is written in the inviter's.",
      );
      logger.warn(err);
      return "";
    }
  }

  /*
   * RESEND INVITATION (#9519, Types/Team/ResendInvitation): a pending
   * person's invitation email, sent again from their row - the same email
   * a new invitation sends (buildInvitationEmail), with a new sign-up link
   * and token for someone who has not signed up yet. Inviting the address
   * to the same team again is refused while the invitation waits
   * (ALREADY_INVITED), so this took removing them and inviting them again.
   *
   * Held to what inviting them to that team is held to, with the caller's
   * own permissions: the membership's create, asked without creating it
   * (checkCallerMayCreate: the table's create permission and its blocks,
   * and Invite New Members scoped to the teams the caller owns), and the
   * grant ceiling (TeamPermissionService.assertCanGrantTeamPermissions).
   * Then, in this order, so nothing is counted, minted or sent for a resend
   * that is refused:
   *
   *   - a membership that is gone - the person was removed, or declined -
   *     or that is another project's is refused alike (notInvited);
   *   - someone who has joined has no invitation waiting (joined);
   *   - a server with no email set up sends nothing (emailNotSetUp);
   *   - one resend of a person's invitation at a time: a second press, in
   *     another tab or by somebody else, while the first is still with
   *     the mail service, sends nothing more (alreadySending);
   *   - the address is counted with the project's other invitations to it
   *     (PublicMessageRateLimit.assertTeamMaySend, TeamMessageKind
   *     .Invitation, #10179): past the project's limit, refused with 429,
   *     carrying when to come back; past the cap on every project's
   *     invitations to it together, with a 503 that says only "not now".
   *     Once it went, the project's window for the person starts again
   *     (InvitationEmailWindow), so an invitation to another of its teams
   *     straight after sends no second email.
   *
   * The send is waited for, unlike a new invitation's: the person who
   * pressed Resend Invitation is told where it went, or why it did not
   * go. A send the mail service refused gives the address its count back;
   * one it did not answer in time may still go out, and keeps it. Either
   * way the Notification service writes the project's Email Log row, with
   * its template, so the row says Invitation Sent again once it went
   * (InvitationEmailsNotSent).
   */
  @CaptureSpan()
  public async resendInvitation(data: {
    teamMemberId: ObjectID;
    // The request's project; none for a master admin in the Admin Dashboard.
    projectId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<ResentInvitation> {
    const membership: TeamMember | null = await this.findOneById({
      id: data.teamMemberId,
      select: {
        _id: true,
        projectId: true,
        teamId: true,
        userId: true,
        hasAcceptedInvitation: true,
        inviteeEmail: true,
      },
      props: {
        isRoot: true,
      },
    });

    const projectId: ObjectID | undefined = membership?.projectId;
    const teamId: ObjectID | undefined = membership?.teamId;
    const userId: ObjectID | undefined = membership?.userId;

    if (
      !membership ||
      !projectId ||
      !teamId ||
      !userId ||
      (data.projectId &&
        data.projectId.toString().toLowerCase() !==
          projectId.toString().toLowerCase())
    ) {
      throw new NotFoundException(RESEND_INVITATION_REFUSALS.notInvited);
    }

    // Whoever may invite to that team, by their own permissions.
    const invitation: TeamMember = new TeamMember();
    invitation.projectId = projectId;
    invitation.teamId = teamId;
    invitation.userId = userId;

    await this.checkCallerMayCreate({
      data: invitation,
      props: data.props,
    });

    await TeamPermissionService.assertCanGrantTeamPermissions({
      teamId: teamId,
      projectId: projectId,
      props: data.props,
    });

    // Joined, through this team or another of the project's.
    if (
      membership.hasAcceptedInvitation ||
      (await this.isUserMemberOfProject({
        projectId: projectId,
        userId: userId,
      }))
    ) {
      throw new BadDataException(RESEND_INVITATION_REFUSALS.joined);
    }

    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        email: true,
        password: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user?.id || !user.email) {
      throw new NotFoundException(RESEND_INVITATION_REFUSALS.notInvited);
    }

    /*
     * Sent again to the address the project invited (#10175), as the row
     * shows it: the answer, and the project's email log, say where it went,
     * and the address their account has moved to since is not the
     * project's to learn. An invitation made before the address was kept
     * goes to the account's.
     */
    const userEmail: Email =
      membership.inviteeEmail &&
      Email.isValid(membership.inviteeEmail.toString())
        ? new Email(membership.inviteeEmail.toString())
        : user.email;

    if (await ServerSendingStatus.isEmailKnownNotSetUp()) {
      throw new BadDataException(
        data.props.isMasterAdmin
          ? RESEND_INVITATION_REFUSALS.emailNotSetUpForMasterAdmin
          : RESEND_INVITATION_REFUSALS.emailNotSetUp,
      );
    }

    const lock: SemaphoreMutex | null = await this.lockInvitationResend({
      projectId: projectId,
      userId: userId,
    });

    try {
      const permit: PublicMessageSendPermit =
        await PublicMessageRateLimit.assertTeamMaySend({
          kind: TeamMessageKind.Invitation,
          projectId: projectId,
          contacts: [PublicMessageRateLimit.forEmail(userEmail)],
        });

      // Until the mail service may have taken it, nothing was sent.
      let mayHaveBeenSent: boolean = false;

      try {
        const invitationEmail: EmailMessage | null =
          await this.buildInvitationEmail({
            props: data.props,
            projectId: projectId,
            user: user,
            email: userEmail,
            isNewUser: false,
            isAccepted: false,
          });

        // The project went with it.
        if (!invitationEmail) {
          throw new NotFoundException(RESEND_INVITATION_REFUSALS.notInvited);
        }

        mayHaveBeenSent = true;

        let response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse;

        try {
          response = await MailService.sendMail(invitationEmail, {
            projectId: projectId,
            userId: user.id,
            timeoutInMs: RESEND_INVITATION_SEND_TIMEOUT_IN_MS,
          });
        } catch (err) {
          // No answer in time: it may still go out.
          logger.error(err, {
            projectId: projectId.toString(),
            userId: user.id.toString(),
          } as LogAttributes);

          throw new BadDataException(
            getInvitationMayNotBeResentMessage({
              email: userEmail.toString(),
            }),
          );
        }

        // The mail service refused it: nothing went out.
        if (response instanceof HTTPErrorResponse) {
          mayHaveBeenSent = false;

          throw new BadDataException(
            getInvitationNotResentMessage({
              email: userEmail.toString(),
              reason: response.message || "",
            }),
          );
        }

        /*
         * It went: the project's window for the person starts again, so an
         * invitation to another of its teams straight after mails them
         * nothing more (InvitationEmailWindow, #10179).
         */
        await InvitationEmailWindow.renew({
          projectId: projectId,
          userId: userId,
        });
      } catch (err) {
        // Nothing was sent: the address gets its count back.
        if (!mayHaveBeenSent) {
          await permit.giveBack();
        }

        throw err;
      }
    } finally {
      await this.unlockInvitationResend(lock);
    }

    return {
      email: userEmail.toString(),
    };
  }

  /*
   * One resend of a person's invitation to a project at a time
   * (resendInvitation): the lock, or a refusal while another holds it.
   * Null when no lock can be taken at all (Valkey away): the resend goes
   * on unlocked, as the per-address limit lets a team's send through
   * uncounted then. Never kept alive: a resend that fails half way leaves
   * it to run out.
   */
  private async lockInvitationResend(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: `${data.projectId.toString()}-${data.userId.toString()}`,
        namespace: RESEND_INVITATION_LOCK_NAMESPACE,
        lockTimeout: RESEND_INVITATION_LOCK_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        refreshInterval: 0,
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        throw new BadDataException(RESEND_INVITATION_REFUSALS.alreadySending);
      }

      logger.warn(
        "Resend Invitation: could not lock the person's invitation, so it is sent unlocked.",
      );
      logger.warn(err);

      return null;
    }
  }

  // Gives a resend's lock back. A failure is logged: the lock runs out by itself.
  private async unlockInvitationResend(
    lock: SemaphoreMutex | null,
  ): Promise<void> {
    if (!lock) {
      return;
    }

    try {
      await Semaphore.release(lock);
    } catch (err) {
      logger.warn("Resend Invitation: could not give the lock back.");
      logger.warn(err);
    }
  }

  /*
   * The limits on people a membership create in `projectId` is held to
   * (ProjectPeopleLimits), or null when it is held to none: without
   * billing, or when the project has no seat limit and is not on the Free
   * plan. Both are read from the project's row, whoever adds the person: a
   * teammate's invitation, an import, and OneUptime adding someone who signs
   * in through the project's SSO for the first time - who carries no plan,
   * and joins like anyone invited. A server admin is held to no plan
   * (CallerPlan), so not to the Free plan's one person; a plan's seats hold
   * them too.
   */
  public async readPeopleLimits(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ProjectPeopleLimits | null> {
    if (!IsBillingEnabled) {
      return null;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        seatLimit: true,
        paymentProviderPlanId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      return null;
    }

    const limits: ProjectPeopleLimits = {
      seatLimit: project.seatLimit || null,
      isFreePlan: this.isHeldToFreePlanPerson({
        project: project,
        props: data.props,
      }),
    };

    if (!limits.seatLimit && !limits.isFreePlan) {
      return null;
    }

    return limits;
  }

  /*
   * Whether the Free plan's one person holds a membership create in
   * `project`: the project is on the Free plan - as its row names its plan,
   * or as the plan CommonAPI read for the request says (read from the same
   * row, kept for a minute) - and the create is not a server admin's, whom
   * no plan holds (CallerPlan).
   */
  private isHeldToFreePlanPerson(data: {
    project: Project;
    props: DatabaseCommonInteractionProps;
  }): boolean {
    if (data.props.isMasterAdmin) {
      return false;
    }

    if (data.props.currentPlan === PlanType.Free) {
      return true;
    }

    const planId: string | undefined = data.project.paymentProviderPlanId;

    if (!planId) {
      return false;
    }

    return (
      SubscriptionPlan.getSubscriptionPlanById(planId)?.getName() ===
      PlanType.Free
    );
  }

  /*
   * WHY INVITING THESE ADDRESSES WOULD BE REFUSED NOW, or null (#7242): the
   * answers onBeforeCreate gives an invitation by address, asked before
   * Ask AI's approval card so it never promises an invitation the project
   * refuses - SCIM Push Groups owning the project's teams, and room for
   * every invitee not in the project yet under its seats or the Free plan's
   * one person. Someone in the project already takes no seat. Not under the
   * limit's lock: an answer for now, which each create asks again.
   */
  @CaptureSpan()
  public async getInvitationRefusal(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    emails: ReadonlyArray<string>;
  }): Promise<string | null> {
    if (
      !data.props.isRoot &&
      (await this.isSCIMPushGroupsEnabled(data.projectId))
    ) {
      return SCIM_PUSH_GROUPS_INVITE_MESSAGE;
    }

    const limits: ProjectPeopleLimits | null = await this.readPeopleLimits({
      projectId: data.projectId,
      props: data.props,
    });

    if (!limits) {
      return null;
    }

    let newPeople: number = 0;

    for (const email of data.emails) {
      const user: User | null = await UserService.findOneBy({
        query: { email: new Email(email) },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (
        user?.id &&
        (await this.hasMembershipInProject({
          projectId: data.projectId,
          userId: user.id,
        }))
      ) {
        continue;
      }

      newPeople++;
    }

    if (newPeople === 0) {
      return null;
    }

    // Each must fit: asked for the last of them.
    return this.getPeopleLimitRefusal({
      limits: limits,
      people:
        (await this.getUniqueTeamMemberCountInProject(data.projectId)) +
        newPeople -
        1,
    });
  }

  /*
   * The refusal of one more person in a project that has `people`, or null
   * when the limits leave room for them. The plan's seats are asked first.
   */
  public getPeopleLimitRefusal(data: {
    limits: ProjectPeopleLimits;
    people: number;
  }): string | null {
    if (data.limits.seatLimit && data.people >= data.limits.seatLimit) {
      return Errors.TeamMemberService.LIMIT_REACHED;
    }

    if (data.limits.isFreePlan && data.people >= ALLOWED_PEOPLE_IN_FREE_PLAN) {
      return Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN;
    }

    return null;
  }

  /*
   * The limits on people, decided again with the INSERT: the person is
   * looked for and the project's people counted in the INSERT's own
   * transaction, under the limit's lock in the project, so memberships
   * created at the same moment - each of which passed the early count in
   * onBeforeCreate - cannot all add someone new. Every create is asked, one
   * that skips its hooks too: a first sign-in through the project's SSO
   * adds people that way, and takes a seat like anyone invited. Null when
   * the create is held to no limit.
   */
  protected override async getCreateLimit(
    createBy: CreateBy<TeamMember>,
  ): Promise<CreateLimit | null> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      return null;
    }

    const limits: ProjectPeopleLimits | null = await this.readPeopleLimits({
      projectId: projectId,
      props: createBy.props,
    });

    if (!limits) {
      return null;
    }

    const userId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      USER_KEYS,
      "User",
    );

    return {
      limitName: SEAT_LIMIT_NAME,
      projectId: projectId,
      check: async (manager: EntityManager): Promise<void> => {
        // Someone already in the project is counted already.
        if (
          userId &&
          (await ProjectCountLimit.count({
            manager: manager,
            statement: MEMBERSHIPS_OF_PERSON_STATEMENT,
            parameters: [projectId.toString(), userId.toString()],
          })) > 0
        ) {
          return;
        }

        const refusal: string | null = this.getPeopleLimitRefusal({
          limits: limits,
          people: await ProjectCountLimit.count({
            manager: manager,
            statement: PEOPLE_IN_PROJECT_STATEMENT,
            parameters: [projectId.toString()],
          }),
        });

        if (refusal) {
          throw new BadDataException(refusal);
        }
      },
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<TeamMember>,
  ): Promise<OnUpdate<TeamMember>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * CurrentUser may set this column so an invitee can accept a pending
     * invitation. The inverse transition is not a safe way to leave: merely
     * flipping the flag bypasses the delete hook that removes notification
     * settings, on-call assignments, calendar feeds, and cached permissions.
     * Force ordinary users through the established delete/leave path instead.
     */
    if (
      updateBy.data.hasAcceptedInvitation === false &&
      !updateBy.props.isRoot &&
      !updateBy.props.isMasterAdmin
    ) {
      throw new NotAuthorizedException(
        "An accepted team membership must be removed through the leave flow.",
      );
    }

    /*
     * And the invited person accepts for themselves, as a create already
     * holds (onBeforeCreate): the inviter's permission to change memberships
     * - and CurrentUser, which every signed-in person holds, on the column -
     * let them mark anyone's pending invitation accepted, pulling that
     * account into the project and whatever its teams grant without its
     * owner ever agreeing.
     */
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (
      (data["hasAcceptedInvitation"] === true ||
        data["invitationAcceptedAt"] !== undefined) &&
      !updateBy.props.isRoot &&
      !updateBy.props.isMasterAdmin
    ) {
      const memberships: Array<TeamMember> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          userId: true,
        });

      const callerId: string | undefined = updateBy.props.userId
        ?.toString()
        .toLowerCase();

      if (
        memberships.some((membership: TeamMember): boolean => {
          return (
            !callerId ||
            membership.userId?.toString().toLowerCase() !== callerId
          );
        })
      ) {
        throw new NotAuthorizedException(
          "Only the person invited can accept an invitation to a team.",
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Drops this server's cached list of the person's teams in the project
   * (getTeamIdsForUser), or in every project when none is named, so the
   * next read asks the database. Called when their membership changes,
   * here or on another server (RealtimeAccessChanges).
   */
  public forgetTeamIdsForUser(userId: ObjectID, projectId?: ObjectID): void {
    if (!projectId) {
      this.teamIdsForUserCache.deleteByPrefix(`${userId.toString()}:`);
      return;
    }

    this.teamIdsForUserCache.delete(
      `${userId.toString()}:${projectId.toString()}`,
    );
  }

  @CaptureSpan()
  public async refreshTokens(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    /*
     * Invalidate the in-process cache of this user's team memberships in
     * this project — membership just changed.
     */
    this.forgetTeamIdsForUser(userId, projectId);

    // Their teams' escalation rules page them, or no longer do.
    await OnDutyPoliciesCache.forgetProjects([projectId]);

    /*
     * Refresh tokens. Only the project's refresh, made last, tells the
     * person's open live updates (on every server) to read them again: the
     * membership changed in this project alone.
     */
    await AccessTokenService.refreshUserGlobalAccessPermission(userId, {
      forgetLiveUpdateReaders: false,
    });

    await AccessTokenService.refreshUserTenantAccessPermission(
      userId,
      projectId,
    );
  }

  /*
   * The per-project notification defaults a member gets the moment their
   * membership becomes accepted, whether that happened by them accepting the
   * invitation or by a master admin accepting it for them on create. Without
   * these, an auto-accepted member is a member who is never notified about
   * anything.
   *
   * Skipped for an unverified email: UserService adds the defaults for every
   * accepted membership once the address is verified.
   *
   * Best effort. Both helpers below are idempotent, and by the time either
   * caller runs, the membership row is already committed - failing the write
   * that created it would report "invite failed" for a member who exists.
   */
  @CaptureSpan()
  private async addDefaultNotificationSettingsAndRules(data: {
    userId: ObjectID;
    projectId: ObjectID;
    user?: User | undefined;
  }): Promise<void> {
    try {
      const user: User | null =
        data.user ||
        (await UserService.findOneById({
          id: data.userId,
          select: {
            email: true,
            isEmailVerified: true,
          },
          props: {
            isRoot: true,
          },
        }));

      if (!user || !user.isEmailVerified || !user.email) {
        return;
      }

      await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
        data.userId,
        data.projectId,
      );

      await UserNotificationRuleService.addDefaultNotificationRuleForUser(
        data.projectId,
        data.userId,
        user.email,
      );
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
    }
  }

  /**
   * Accept every invitation still pending for this user in this project.
   *
   * Acceptance is per project, not per team: a person who accepts one
   * invitation into a project has agreed to be in it, and must not be asked
   * again for each of the other teams of that project they were invited to.
   * Both hooks call this whenever a membership becomes accepted - the invitee
   * accepting one, a master admin creating one accepted, SSO or SCIM adding
   * one - so a member of a project never has invitations left there.
   *
   * Written with ignoreHooks: every caller refreshes this user's permissions
   * in this project and adds their notification defaults right after, which
   * is all onUpdateSuccess would do for these rows. Call it before that
   * refresh, so the permissions include these teams. Best effort: the
   * membership that triggered it is already committed, and an invitation left
   * pending can still be accepted by hand. Returns how many were accepted.
   */
  @CaptureSpan()
  public async acceptPendingInvitationsInProject(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<number> {
    try {
      return await this.updateBy({
        query: {
          userId: data.userId,
          projectId: data.projectId,
          hasAcceptedInvitation: false,
        },
        data: {
          hasAcceptedInvitation: true,
          invitationAcceptedAt: OneUptimeDate.getCurrentDate(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );

      return 0;
    }
  }

  /**
   * Accept the invitations left pending for people who had already joined
   * that project through another team - what adding them to those teams
   * does now (see onBeforeCreate). Somebody who is only invited is left
   * alone: they still have to accept. Run once by the data migration that
   * came with acceptance becoming per project.
   *
   * The (person, project) pairs are walked in key order, a batch at a time,
   * and each is handled as an acceptance is: its invitations accepted, then
   * the person's cached permissions in the project refreshed. Best effort per
   * pair - a failure is logged and the walk goes on. Idempotent, since an
   * accepted invitation is no longer pending, and safe to run twice at once
   * as the data migration runner requires. Returns how many invitations it
   * accepted.
   */
  @CaptureSpan()
  public async acceptPendingInvitationsOfProjectMembers(options?: {
    batchSize?: number | undefined;
  }): Promise<number> {
    const batchSize: number = Math.max(
      1,
      Math.floor(options?.batchSize || 500),
    );

    let acceptedCount: number = 0;
    let lastPair: { userId: string; projectId: string } | null = null;

    for (;;) {
      const pairs: Array<{ userId: string; projectId: string }> =
        await this.getRepository().manager.query(
          `SELECT DISTINCT pending."userId", pending."projectId"
             FROM "TeamMember" pending
            WHERE pending."hasAcceptedInvitation" = false
              AND pending."deletedAt" IS NULL
              AND ($2::uuid IS NULL OR (pending."userId", pending."projectId") > ($2::uuid, $3::uuid))
              AND EXISTS (
                    SELECT 1
                      FROM "TeamMember" accepted
                     WHERE accepted."userId" = pending."userId"
                       AND accepted."projectId" = pending."projectId"
                       AND accepted."hasAcceptedInvitation" = true
                       AND accepted."deletedAt" IS NULL
                  )
            ORDER BY pending."userId" ASC, pending."projectId" ASC
            LIMIT $1`,
          [batchSize, lastPair?.userId || null, lastPair?.projectId || null],
        );

      for (const pair of pairs) {
        const userId: ObjectID = new ObjectID(pair.userId);
        const projectId: ObjectID = new ObjectID(pair.projectId);

        acceptedCount += await this.acceptPendingInvitationsInProject({
          userId: userId,
          projectId: projectId,
        });

        try {
          await this.refreshTokens(userId, projectId);
        } catch (err) {
          logger.error(
            err as Error,
            {
              projectId: projectId.toString(),
              userId: userId.toString(),
            } as LogAttributes,
          );
        }
      }

      if (pairs.length < batchSize) {
        break;
      }

      lastPair = pairs[pairs.length - 1]!;
    }

    return acceptedCount;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<TeamMember>,
    createdItem: TeamMember,
  ): Promise<TeamMember> {
    /*
     * An accepted membership puts the person in the project, so whatever else
     * they were invited to there is accepted with it.
     */
    if (createdItem.hasAcceptedInvitation) {
      await this.acceptPendingInvitationsInProject({
        userId: createdItem.userId!,
        projectId: onCreate.createBy.data.projectId!,
      });
    }

    await this.refreshTokens(
      createdItem.userId!,
      onCreate.createBy.data.projectId!,
    );

    await this.syncSubscriptionSeatsAfterMembershipChange(
      onCreate.createBy.data.projectId!,
    );

    /*
     * A membership created already accepted never goes through the
     * accept-invitation update, so it would otherwise miss the defaults that
     * hook adds.
     */
    if (createdItem.hasAcceptedInvitation) {
      await this.addDefaultNotificationSettingsAndRules({
        userId: createdItem.userId!,
        projectId: onCreate.createBy.data.projectId!,
      });

      // A public note waiting for a step that names the team asks them too.
      this.followUpWaitingPublicNotes([onCreate.createBy.data.projectId]);
    }

    if (createdItem.hasAcceptedInvitation) {
      this.noteSecondMemberJoined([
        onCreate.createBy.data.projectId || createdItem.projectId,
      ]);
    }

    // Activation event for marketing funnels, attributed to the inviter.
    ProductAnalytics.captureForUser({
      userId: onCreate.createBy.props.userId,
      event: "server/team_member_invited",
      properties: {
        project_id: onCreate.createBy.data.projectId?.toString() || "",
        has_accepted_invitation: Boolean(createdItem.hasAcceptedInvitation),
      },
    });

    /*
     * The membership is made: its invitation goes out now, in the
     * background. Last, so it starts as the request ends, and a create that
     * failed before here sent nothing and gives its count back
     * (onCreateError).
     */
    this.startPlannedInvitation(onCreate, createdItem);

    return createdItem;
  }

  /*
   * Starts what a create's onBeforeCreate planned for its invitation, once
   * its membership is made (onCreateSuccess, last): in the background,
   * never waited for (sendPlannedInvitation, #10180). From here on its count
   * is not given back on a failed create: the email may be on its way.
   */
  public startPlannedInvitation(
    onCreate: OnCreate<TeamMember>,
    createdItem: TeamMember,
  ): void {
    const carryForward: TeamMemberCreateCarryForward | null =
      TeamMemberService.readCarryForward(onCreate.carryForward);

    if (!carryForward) {
      return;
    }

    carryForward.isSending = true;

    this.sendPlannedInvitationInBackground({
      carryForward: carryForward,
      projectId: onCreate.createBy.data.projectId || createdItem.projectId!,
      props: onCreate.createBy.props,
    });
  }

  /*
   * A create that failed before onCreateSuccess started its invitation sent
   * nothing: the address gets its count back, and the project's window for
   * the person closes, so the next invitation emails them.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<TeamMember> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    const carryForward: TeamMemberCreateCarryForward | null =
      TeamMemberService.readCarryForward(onCreate?.carryForward);

    if (carryForward && !carryForward.isSending) {
      await carryForward.invitationPermit?.giveBack();
      await carryForward.invitationWindow?.release();
    }

    return await super.onCreateError(error, onCreate, failedStatement);
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<TeamMember>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<TeamMember>> {
    const updateBy: UpdateBy<TeamMember> = onUpdate.updateBy;
    const items: Array<TeamMember> = await this.findBy({
      query: {
        _id: QueryHelper.any(updatedItemIds),
      },
      select: {
        userId: true,
        user: {
          email: true,
          isEmailVerified: true,
        } as Select<User>,
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,

      props: {
        isRoot: true,
      },
    });

    /*
     * The (user, project) pairs whose remaining invitations have been
     * accepted already. Accepting every invitation of a project at once
     * updates several rows of the same pair, and one pass covers them all.
     */
    const acceptedProjectKeys: Set<string> = new Set<string>();

    for (const item of items) {
      /*
       * Accepting one invitation into a project accepts the person's other
       * invitations there too: they have just agreed to be in the project.
       */
      const projectKey: string = `${item.userId?.toString()}:${item.projectId?.toString()}`;

      if (
        updateBy.data.hasAcceptedInvitation &&
        !acceptedProjectKeys.has(projectKey)
      ) {
        acceptedProjectKeys.add(projectKey);

        await this.acceptPendingInvitationsInProject({
          userId: item.userId!,
          projectId: item.projectId!,
        });
      }

      await this.refreshTokens(item.userId!, item.projectId!);

      if (updateBy.data.hasAcceptedInvitation) {
        await this.addDefaultNotificationSettingsAndRules({
          userId: item.userId!,
          projectId: item.projectId!,
          user: item.user,
        });
      }
    }

    /*
     * They accepted: the project's window for them ends, so an invitation it
     * sends them after this emails them as it would anyone (#10179).
     */
    if (updateBy.data.hasAcceptedInvitation) {
      await TeamMemberService.endInvitationWindows(items);
    }

    // Their teams' public notes waiting for a step that names a team ask them too.
    if (updateBy.data.hasAcceptedInvitation) {
      this.followUpWaitingPublicNotes(
        items.map((item: TeamMember): ObjectID | undefined => {
          return item.projectId;
        }),
      );
    }

    if (updateBy.data.hasAcceptedInvitation) {
      this.noteSecondMemberJoined(
        items.map((item: TeamMember): ObjectID | undefined => {
          return item.projectId;
        }),
      );
    }

    return { updateBy, carryForward: onUpdate.carryForward };
  }

  /*
   * A project's second person (issue #6830): once somebody accepts to be in
   * it - an invitation accepted, a member added already accepted - and two
   * different people have, its SecondMemberJoined milestone is kept. A
   * person in several teams is one person. In the background: it never
   * holds up or fails the write, and once the project has the milestone it
   * costs a memo lookup and no query.
   */
  private noteSecondMemberJoined(
    projectIds: Array<ObjectID | null | undefined>,
  ): void {
    const projects: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const projectId of projectIds) {
      if (
        projectId &&
        !ProjectMilestoneService.isKnownReached(
          projectId,
          ActivationMilestone.SecondMemberJoined,
        )
      ) {
        projects.set(projectId.toString().toLowerCase(), projectId);
      }
    }

    for (const projectId of projects.values()) {
      this.hasTwoAcceptedMembers(projectId)
        .then((hasTwo: boolean): void => {
          if (hasTwo) {
            ProjectMilestoneService.reachInBackground({
              projectId: projectId,
              milestone: ActivationMilestone.SecondMemberJoined,
            });
          }
        })
        .catch((error: Error): void => {
          logger.error(
            "Could not check whether a project has a second member:",
          );
          logger.error(error);
        });
    }
  }

  // Whether two different people have accepted to be in the project.
  public async hasTwoAcceptedMembers(projectId: ObjectID): Promise<boolean> {
    const rows: Array<{ userId: string }> =
      (await this.getRepository().manager.query(
        `SELECT DISTINCT "userId" FROM "TeamMember" WHERE "projectId" = $1 AND "hasAcceptedInvitation" = true AND "userId" IS NOT NULL AND "deletedAt" IS NULL LIMIT 2`,
        [projectId.toString()],
      )) as Array<{ userId: string }>;

    return Array.isArray(rows) && rows.length >= 2;
  }

  /*
   * A team's members changed - somebody joined one, accepted an invitation
   * to one, or left one: the public notes of these projects that wait for
   * approval follow the members of the teams their steps name as they are
   * now, in the background (PublicNoteApproverChanges) - a new member is
   * asked, a member who left no longer is. Required here, not imported: it
   * reads the notes' services, which read this one as they load
   * (PublicNoteApprovalPolicy). Never fails the write: what cannot even
   * start is logged.
   */
  private followUpWaitingPublicNotes(
    projectIds: Array<ObjectID | null | undefined>,
  ): void {
    const projects: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const projectId of projectIds) {
      if (projectId) {
        projects.set(projectId.toString().toLowerCase(), projectId);
      }
    }

    if (projects.size === 0) {
      return;
    }

    try {
      const approverChanges: typeof import("../Utils/Notes/PublicNoteApproverChanges").default =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../Utils/Notes/PublicNoteApproverChanges").default;

      approverChanges.afterTeamMembersChanged(Array.from(projects.values()));
    } catch (error) {
      logger.error(
        "Public note approval: could not start asking the new approvers of the public notes waiting for a team whose members changed.",
      );
      logger.error(error as Error);
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<TeamMember>,
  ): Promise<OnDelete<TeamMember>> {
    // The memberships the delete removes, and the delete held to them.
    const members: Array<TeamMember> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        userId: true,
        projectId: true,
        teamId: true,
        hasAcceptedInvitation: true,
        team: {
          _id: true,
          shouldHaveAtLeastOneMember: true,
        } as Select<TeamMember>,
      },
    );

    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const member of members) {
      if (member.projectId) {
        projectIds.set(member.projectId.toString(), member.projectId);
      }
    }

    // Whether SCIM Push Groups manages a project's teams, asked once each.
    const pushGroupsManaged: Map<string, boolean> = new Map<string, boolean>();
    const isPushGroupsManaged: (
      projectId: ObjectID,
    ) => Promise<boolean> = async (projectId: ObjectID): Promise<boolean> => {
      const key: string = projectId.toString().toLowerCase();
      let managed: boolean | undefined = pushGroupsManaged.get(key);

      if (managed === undefined) {
        managed = await this.isSCIMPushGroupsEnabled(projectId);
        pushGroupsManaged.set(key, managed);
      }

      return managed;
    };

    /*
     * While SCIM Push Groups manages a project's teams, their members are
     * managed from the identity provider: asked of every project the delete
     * removes members of.
     */
    if (!deleteBy.props.isRoot) {
      for (const projectId of projectIds.values()) {
        if (await isPushGroupsManaged(projectId)) {
          throw new BadDataException(
            "Cannot delete team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
          );
        }
      }
    }

    /*
     * A team that should have at least one member keeps one: its accepted
     * members, less those this delete removes, must not come to none - one
     * delete of several members is held to the same rule as several deletes
     * of one. The members' on-call time logs are closed once they are
     * actually removed (onDeleteSuccess), so a removal refused here leaves
     * them on call.
     */
    const acceptedRemovedByTeam: Map<
      string,
      { teamId: ObjectID; projectId: ObjectID; removed: number }
    > = new Map();

    for (const member of members) {
      if (
        !member.team?.shouldHaveAtLeastOneMember ||
        !member.hasAcceptedInvitation ||
        !member.teamId ||
        !member.projectId
      ) {
        continue;
      }

      const key: string = member.teamId.toString();
      const removedOfTeam: {
        teamId: ObjectID;
        projectId: ObjectID;
        removed: number;
      } = acceptedRemovedByTeam.get(key) || {
        teamId: member.teamId,
        projectId: member.projectId,
        removed: 0,
      };

      removedOfTeam.removed += 1;
      acceptedRemovedByTeam.set(key, removedOfTeam);
    }

    // A removal lifts the team's blocks from whoever stays. See the helper.
    await this.assertRemoverMayLiftBlocks({
      members: members,
      props: deleteBy.props,
    });

    for (const removedOfTeam of acceptedRemovedByTeam.values()) {
      const membersInTeam: PositiveNumber = await this.countBy({
        query: {
          teamId: removedOfTeam.teamId,
          hasAcceptedInvitation: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      // Skip the one-member guard when SCIM manages membership for the project.
      const managedBySCIM: boolean = await isPushGroupsManaged(
        removedOfTeam.projectId,
      );

      if (
        !managedBySCIM &&
        membersInTeam.toNumber() - removedOfTeam.removed < 1
      ) {
        throw new BadDataException(
          Errors.TeamMemberService.ONE_MEMBER_REQUIRED,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: members,
    };
  }

  /*
   * Remove from Project takes someone off every team of the project, or off
   * none. A delete removes only the memberships its caller may delete - with
   * Remove Team Members scoped to Owned, those of the teams they, or the
   * team holding it, own - and keeps the rest without a word: the person
   * would stay in the project, on the teams left, though the caller was
   * told they had left it. So a caller who may remove only some of
   * someone's memberships is refused, before anything is removed, and told
   * where to remove them from the teams they may. OneUptime's own removals
   * and a master admin's reach every membership.
   */
  @CaptureSpan()
  public async assertCallerMayRemoveUserFromProject(data: {
    userId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const memberships: number = (
      await this.countBy({
        query: {
          userId: data.userId,
          projectId: data.projectId,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    // The same memberships, as far as the caller's own delete reaches.
    const removableQuery: Query<TeamMember> =
      await ModelPermission.checkDeleteQueryPermission(
        TeamMember,
        {
          userId: data.userId,
          projectId: data.projectId,
        } as Query<TeamMember>,
        data.props,
      );

    const removable: number = (
      await this.countBy({
        query: removableQuery,
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (removable < memberships) {
      throw new BadDataException(
        Errors.TeamMemberService.REMOVE_FROM_SOME_TEAMS_ONLY,
      );
    }
  }

  /*
   * WHOM THE CALLER'S REMOVE FROM PROJECT WOULD LEAVE IN THE PROJECT (#6599):
   * of these people, the ones assertCallerMayRemoveUserFromProject would
   * refuse to remove, each with the teams the caller's own delete does not
   * reach - read the way that check reads them (the memberships as
   * OneUptime, then those ModelPermission.checkDeleteQueryPermission hands
   * the caller), so the Users list's lock and the refusal never disagree.
   * Someone whose every membership the caller reaches is left out, and so
   * is everyone for OneUptime's own reads and a master admin's, whom the
   * check never refuses. A caller who may delete no membership at all is
   * refused by the permission check itself, as the removal would be.
   *
   * Team ids only: the route names the teams the caller may read.
   */
  @CaptureSpan()
  public async getTeamsOutOfRemovalReach(data: {
    userIds: Array<ObjectID>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<TeamsOutOfRemovalReach>> {
    if (
      data.props.isRoot ||
      data.props.isMasterAdmin ||
      data.userIds.length === 0
    ) {
      return [];
    }

    const query: Query<TeamMember> = {
      userId: QueryHelper.any(data.userIds),
      projectId: data.projectId,
    } as Query<TeamMember>;

    const memberships: Array<TeamMember> = await this.findBy({
      query: query,
      select: {
        _id: true,
        userId: true,
        teamId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // The same memberships, as far as the caller's own delete reaches.
    const reachableQuery: Query<TeamMember> =
      await ModelPermission.checkDeleteQueryPermission(
        TeamMember,
        query,
        data.props,
      );

    const reachable: Array<TeamMember> = await this.findBy({
      query: reachableQuery,
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const reachableIds: Set<string> = new Set<string>(
      reachable
        .map((membership: TeamMember): string => {
          return membership.id?.toString().toLowerCase() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    );

    const byUser: Map<string, PersonsMembershipsInReach> = new Map();

    for (const membership of memberships) {
      if (!membership.id || !membership.userId) {
        continue;
      }

      const userKey: string = membership.userId.toString().toLowerCase();
      const person: PersonsMembershipsInReach = byUser.get(userKey) || {
        userId: membership.userId,
        teamIds: new Map<string, ObjectID>(),
        membershipsWithoutTeam: 0,
        hasTeamInReach: false,
      };

      if (reachableIds.has(membership.id.toString().toLowerCase())) {
        person.hasTeamInReach = true;
      } else if (membership.teamId) {
        person.teamIds.set(
          membership.teamId.toString().toLowerCase(),
          membership.teamId,
        );
      } else {
        // Counted by the check all the same, so counted here.
        person.membershipsWithoutTeam += 1;
      }

      byUser.set(userKey, person);
    }

    const people: Array<TeamsOutOfRemovalReach> = [];

    for (const person of byUser.values()) {
      if (person.teamIds.size === 0 && person.membershipsWithoutTeam === 0) {
        continue;
      }

      people.push({
        userId: person.userId,
        teamIds: Array.from(person.teamIds.values()),
        membershipsWithoutTeam: person.membershipsWithoutTeam,
        hasTeamInReach: person.hasTeamInReach,
      });
    }

    return people;
  }

  /*
   * TAKING SOMEONE OUT OF A TEAM LIFTS ITS BLOCKS FROM THEM. A block on one
   * team wins over an allow on another (HeldPermissions), so once a person
   * is out of a team that blocks Incident Member for the Security label,
   * the Incident Member another team of theirs grants reaches the Security
   * incidents too. Lifting a block is granting what it blocks, as deleting
   * the block row is: whoever removes an accepted membership - the person
   * leaving included - could grant every block row of its team
   * (TeamPermissionService.assertCanLiftTeamBlocks), or the removal is
   * refused, before anything is removed.
   *
   * Asked only where a block is lifted from someone: of an accepted
   * membership (a pending invitation holds no permissions) whose person
   * keeps another accepted membership in the project once `members` are
   * removed. Someone who leaves the project with it keeps no allow for the
   * block to hold back. Root writes (SCIM, SSO, OneUptime's own) are not
   * asked. `members` are the memberships a delete removes, each read with
   * its id, person, project, team and whether it was accepted.
   */
  @CaptureSpan()
  public async assertRemoverMayLiftBlocks(data: {
    members: Array<TeamMember>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    // Nothing to read for someone who may hand on every permission.
    if (TeamPermissionService.canGrantEveryPermission(data.props)) {
      return;
    }

    // Every membership the delete removes, accepted or not, by person and project.
    const removedIdsByPerson: Map<string, Array<ObjectID>> = new Map();

    for (const member of data.members) {
      if (!member.id || !member.userId || !member.projectId) {
        continue;
      }

      const key: string = `${member.userId.toString()}:${member.projectId.toString()}`;
      const removedIds: Array<ObjectID> = removedIdsByPerson.get(key) || [];

      removedIds.push(member.id);
      removedIdsByPerson.set(key, removedIds);
    }

    // Whether a person keeps an accepted membership, asked once each.
    const keepsMembership: Map<string, boolean> = new Map<string, boolean>();

    /*
     * The teams whose blocks are lifted from someone, by project and by
     * whether that someone is the remover, leaving.
     */
    const liftedByProject: Map<
      string,
      {
        projectId: ObjectID;
        teamIds: Map<string, ObjectID>;
        leaves: boolean;
      }
    > = new Map();

    for (const member of data.members) {
      if (
        !member.hasAcceptedInvitation ||
        !member.userId ||
        !member.projectId ||
        !member.teamId
      ) {
        continue;
      }

      const personKey: string = `${member.userId.toString()}:${member.projectId.toString()}`;
      let keeps: boolean | undefined = keepsMembership.get(personKey);

      if (keeps === undefined) {
        keeps =
          (
            await this.countBy({
              query: {
                userId: member.userId,
                projectId: member.projectId,
                hasAcceptedInvitation: true,
                _id: QueryHelper.notIn(removedIdsByPerson.get(personKey) || []),
              },
              props: {
                isRoot: true,
              },
            })
          ).toNumber() > 0;

        keepsMembership.set(personKey, keeps);
      }

      if (!keeps) {
        continue;
      }

      const leaves: boolean = Boolean(
        data.props.userId &&
          data.props.userId.toString().toLowerCase() ===
            member.userId.toString().toLowerCase(),
      );
      const liftKey: string = `${member.projectId.toString()}:${leaves}`;
      const lifted: {
        projectId: ObjectID;
        teamIds: Map<string, ObjectID>;
        leaves: boolean;
      } = liftedByProject.get(liftKey) || {
        projectId: member.projectId,
        teamIds: new Map<string, ObjectID>(),
        leaves: leaves,
      };

      lifted.teamIds.set(member.teamId.toString().toLowerCase(), member.teamId);
      liftedByProject.set(liftKey, lifted);
    }

    for (const lifted of liftedByProject.values()) {
      await TeamPermissionService.assertCanLiftTeamBlocks({
        teamIds: Array.from(lifted.teamIds.values()),
        projectId: lifted.projectId,
        props: data.props,
        leaves: lifted.leaves,
      });
    }
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<TeamMember>,
    itemIdsBeforeDelete?: Array<ObjectID>,
  ): Promise<OnDelete<TeamMember>> {
    this.endOnCallTimeLogsOfRemovedMembers(
      onDelete.carryForward as Array<TeamMember>,
      itemIdsBeforeDelete,
    );

    /*
     * Someone who declined their own invitation: the project's window for
     * them ends, so inviting them again emails them (#10179). Removing them
     * is not declining: a SCIM connection that deletes the users it created
     * and creates them again still mails them once per window.
     */
    await TeamMemberService.endInvitationWindows(
      ((onDelete.carryForward as Array<TeamMember>) || []).filter(
        (member: TeamMember): boolean => {
          return (
            !member.hasAcceptedInvitation &&
            Boolean(member.userId) &&
            Boolean(onDelete.deleteBy.props.userId) &&
            member.userId!.toString().toLowerCase() ===
              onDelete.deleteBy.props.userId!.toString().toLowerCase()
          );
        },
      ),
    );

    /*
     * A member who left a team a step names is no longer asked about the
     * notes waiting for it: their chat messages about them say so.
     */
    this.followUpWaitingPublicNotes(
      ((onDelete.carryForward as Array<TeamMember>) || [])
        .filter((member: TeamMember): boolean => {
          return Boolean(member.hasAcceptedInvitation);
        })
        .map((member: TeamMember): ObjectID | undefined => {
          return member.projectId;
        }),
    );

    /*
     * remove-user-from-project deletes every membership of one user in one
     * deleteBy, so the same (user, project) can appear several times here;
     * the leave cleanups are idempotent but not free, so run them once.
     */
    const leaveCleanupDone: Set<string> = new Set<string>();

    /*
     * Whether ANY of the deleted rows for a (user, project) was an ACCEPTED
     * membership. Revoking a pending invitation also brings the accepted
     * count to zero, but someone who never accepted never had feed access —
     * rotating every opted-in shared feed for that would clear each
     * teammate's subscribed calendar for nothing (see
     * cleanupOnCallAssignmentsIfUserLeftProject).
     */
    const acceptedMembershipKeys: Set<string> = new Set<string>();
    for (const item of onDelete.carryForward as Array<TeamMember>) {
      if (item.hasAcceptedInvitation && item.userId && item.projectId) {
        acceptedMembershipKeys.add(
          `${item.userId.toString()}:${item.projectId.toString()}`,
        );
      }
    }

    /*
     * Revoke first, once per (user, project), each on its own. A delete can
     * cover several users - a team, a SCIM group - and a failure in one
     * user's cleanup below must not leave a later one with the permissions of
     * the membership that was just removed: their cached entries would still
     * list the project, and nothing would refresh them again. A failure is
     * reported once everything else has run.
     */
    const refreshedKeys: Set<string> = new Set<string>();
    let refreshError: Error | null = null;

    for (const item of onDelete.carryForward as Array<TeamMember>) {
      if (!item.userId || !item.projectId) {
        continue;
      }

      const refreshKey: string = `${item.userId.toString()}:${item.projectId.toString()}`;

      if (refreshedKeys.has(refreshKey)) {
        continue;
      }

      refreshedKeys.add(refreshKey);

      try {
        await this.refreshTokens(item.userId, item.projectId);
      } catch (err) {
        refreshError = refreshError || (err as Error);

        logger.error(
          err as Error,
          {
            projectId: item.projectId.toString(),
            userId: item.userId.toString(),
          } as LogAttributes,
        );

        // Fall back to dropping the cached entries: a missing entry is rebuilt from the memberships.
        await AccessTokenService.clearCachedPermissions(
          item.userId,
          item.projectId,
        ).catch((clearError: Error) => {
          logger.error(clearError, {
            projectId: item.projectId?.toString(),
            userId: item.userId?.toString(),
          } as LogAttributes);
        });
      }
    }

    for (const item of onDelete.carryForward as Array<TeamMember>) {
      await this.syncSubscriptionSeatsAfterMembershipChange(item.projectId!);

      /*
       * Their on-call assignments, then their roles on open incidents and
       * their owner rows (see cleanupResourceAssignmentsIfUserLeftProject).
       * The "removed from on-call policy" notices those deletes trigger do
       * not reach somebody who has left: they are no longer a member, and
       * nothing of the project is sent to non-members (ProjectMembership).
       */
      const cleanupKey: string = `${item.userId?.toString()}:${item.projectId?.toString()}`;
      if (!leaveCleanupDone.has(cleanupKey) && item.userId && item.projectId) {
        leaveCleanupDone.add(cleanupKey);
        /*
         * First: what lets them, or a client acting for them, into the
         * project on their own - the MCP clients they connected and their
         * consent to its single sign-on.
         */
        await this.removeProjectAccessIfUserLeftProject({
          projectId: item.projectId,
          userId: item.userId,
        });
        await this.cleanupOnCallAssignmentsIfUserLeftProject({
          projectId: item.projectId,
          userId: item.userId,
          hadAcceptedMembership: acceptedMembershipKeys.has(cleanupKey),
        });
        await this.cleanupResourceAssignmentsIfUserLeftProject({
          projectId: item.projectId,
          userId: item.userId,
        });
        /*
         * After the resource cleanup: its "removed as owner / role" workspace
         * posts can still mention the person through their chat account link.
         */
        await this.removeWorkspaceAccountLinksIfUserLeftProject({
          projectId: item.projectId,
          userId: item.userId,
        });
        /*
         * Last: their own notification methods, rules and settings for the
         * project, so joining again starts from the defaults.
         */
        await this.removePersonalNotificationSettingsIfUserLeftProject({
          projectId: item.projectId,
          userId: item.userId,
        });
      }

      await UserNotificationSettingService.removeDefaultNotificationSettingsForUser(
        item.userId!,
        item.projectId!,
      );
    }

    if (refreshError) {
      throw refreshError;
    }

    return onDelete;
  }

  /*
   * A removed member's open on-call time logs for the team they left end
   * now. Only for the memberships the delete removed (DatabaseService hands
   * their ids to onDeleteSuccess); called without them, every member read
   * before the delete counts. Fire and forget, as before: a failure is
   * logged.
   */
  private endOnCallTimeLogsOfRemovedMembers(
    members: Array<TeamMember>,
    removedIds: Array<ObjectID> | undefined,
  ): void {
    const removed: Set<string> | null = removedIds
      ? new Set(
          removedIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        )
      : null;

    for (const member of members || []) {
      if (removed && (!member.id || !removed.has(member.id.toString()))) {
        continue;
      }

      if (!member.projectId || !member.userId) {
        continue;
      }

      OnCallDutyPolicyTimeLogService.endTimeForUser({
        projectId: member.projectId,
        userId: member.userId,
        /*
         * scope to the team being left so the user's still-active logs from
         * other teams, direct escalation assignments, and schedule rosters stay
         * open (audit F17).
         */
        teamId: member.teamId!,
        endsAt: OneUptimeDate.getCurrentDate(),
      }).catch((err: Error) => {
        logger.error(err, {
          projectId: member.projectId?.toString(),
          userId: member.userId?.toString(),
        } as LogAttributes);
      });
    }
  }

  /**
   * Run the on-call cleanup when — and only when — the user no longer holds
   * an accepted membership in ANY team of the project: the same rule
   * removeDefaultNotificationSettingsForUser applies. A user who merely left
   * one of several teams keeps every on-call assignment. Best-effort: never
   * throws into the delete path.
   *
   * hadAcceptedMembership (default true): whether the membership rows that
   * were just deleted included an ACCEPTED one. Revoking a never-accepted
   * invitation passes false — the row cleanup still runs, but the opted-in
   * shared feeds are NOT rotated: the invitee never had the links or any
   * access, and rotation would silently clear every teammate's subscribed
   * calendar.
   */
  @CaptureSpan()
  public async cleanupOnCallAssignmentsIfUserLeftProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
    hadAcceptedMembership?: boolean | undefined;
  }): Promise<OnCallLeaveCleanupResult | null> {
    try {
      const remaining: PositiveNumber = await this.countBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
          hasAcceptedInvitation: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (remaining.toNumber() > 0) {
        return null;
      }

      return await this.cleanupOnCallAssignmentsForUserLeavingProject({
        projectId: data.projectId,
        userId: data.userId,
        rotateSharedFeeds: data.hadAcceptedMembership !== false,
      });
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      return null;
    }
  }

  /**
   * Take a departed user off the project's open incidents and episodes (their
   * roles) and off everything they own, under the same rule as
   * cleanupOnCallAssignmentsIfUserLeftProject: only once they hold no
   * accepted membership in any team of the project. A revoked invitation runs
   * it too — a pending invitee has no business owning anything either.
   * Best-effort: never throws into the delete path. See
   * ProjectLeaveResourceCleanup.cleanupForUserLeavingProject for what goes.
   */
  @CaptureSpan()
  public async cleanupResourceAssignmentsIfUserLeftProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveResourceCleanupResult | null> {
    try {
      if (
        await this.isUserMemberOfProject({
          projectId: data.projectId,
          userId: data.userId,
        })
      ) {
        return null;
      }

      return await ProjectLeaveResourceCleanup.cleanupForUserLeavingProject({
        projectId: data.projectId,
        userId: data.userId,
      });
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      return null;
    }
  }

  /**
   * A user who has left the project must stop acting in it from Slack or
   * Microsoft Teams. Their WorkspaceUserAuthToken rows for the project are
   * what map a chat account to them, and nothing removed those rows on leave:
   * only uninstalling the app or disconnecting the workspace did. So once the
   * user holds no accepted membership in ANY team of the project, delete them.
   * Deleting through the service also removes the Slack / Teams notification
   * methods that point at them (see WorkspaceUserAuthTokenService).
   *
   * The chat handlers check membership on every action as well; this keeps
   * the table from holding links for people who are gone. Best-effort: never
   * throws into the delete path. Returns how many links were removed.
   */
  @CaptureSpan()
  public async removeWorkspaceAccountLinksIfUserLeftProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<number> {
    try {
      const remaining: PositiveNumber = await this.countBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
          hasAcceptedInvitation: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (remaining.toNumber() > 0) {
        return 0;
      }

      return await WorkspaceUserAuthTokenService.deleteBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        "Error removing the Slack / Microsoft Teams account links of a user who left the project (best-effort).",
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      return 0;
    }
  }

  /**
   * A user who has left the project keeps no way into it: once they hold no
   * accepted membership in ANY team of the project, the MCP clients they
   * connected to it are disconnected and their consent to its single
   * sign-on goes (see ProjectLeaveAccessCleanup). Joining again starts from
   * nothing: a client has to be connected again, and on the hosted service
   * the project's SSO asks the account's owner to confirm again. A revoked
   * invitation runs it too.
   *
   * Best-effort: never throws into the delete path. Returns what was
   * removed, or null when the user is still a member (or the check failed).
   */
  @CaptureSpan()
  public async removeProjectAccessIfUserLeftProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveRemovalResult | null> {
    try {
      if (
        await this.isUserMemberOfProject({
          projectId: data.projectId,
          userId: data.userId,
        })
      ) {
        return null;
      }

      return await ProjectLeaveAccessCleanup.removeProjectAccess({
        projectId: data.projectId,
        userId: data.userId,
      });
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      return null;
    }
  }

  /**
   * A user who has left the project keeps nothing of it that could notify
   * them: once they hold no accepted membership in ANY team of the project,
   * their own notification methods (email, SMS, call, WhatsApp, Telegram,
   * push, webhook, Slack, Microsoft Teams), notification rules, notification
   * settings, email rollup preference and pending rollup mail, routed call
   * number and shift reminders for the project are removed (see
   * ProjectLeaveNotificationCleanup). Joining again starts from the
   * defaults. A revoked invitation runs it too - a pending invitee has no
   * business holding any of these either.
   *
   * Best-effort: never throws into the delete path. Returns null when the
   * user is still a member (or the check failed).
   */
  @CaptureSpan()
  public async removePersonalNotificationSettingsIfUserLeftProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveRemovalResult | null> {
    try {
      if (
        await this.isUserMemberOfProject({
          projectId: data.projectId,
          userId: data.userId,
        })
      ) {
        return null;
      }

      return await ProjectLeaveNotificationCleanup.removePersonalNotificationSettings(
        {
          projectId: data.projectId,
          userId: data.userId,
        },
      );
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      return null;
    }
  }

  /**
   * A user who has left the project must stop being paged and must stop
   * seeing the project's shifts. Nothing used to do this: their layer-user
   * and escalation-rule-user rows survived, so schedules kept rotating onto
   * an ex-member and policies kept escalating to them. In order:
   *
   *   1. delete the user's OnCallDutyPolicyScheduleLayerUser rows in the
   *      project (root; the layers' 1-based order is re-sequenced),
   *   2. delete the user's OnCallDutyPolicyEscalationRuleUser rows through
   *      the service, so its hooks close the time logs, write the policy feed
   *      items and notify as a manual removal would,
   *   3. delete the project's not-yet-ended OnCallDutyPolicyUserOverride rows
   *      that name the user on EITHER side (as the overridden user or as the
   *      substitute), through the service — an override "route my alerts to
   *      Bob" would keep paging a departed Bob, and "route Alice's alerts to
   *      me" would keep the departed user's covering shifts in the feeds and
   *      in /my-shifts; the service's hooks write the policy feed items,
   *      refresh the overridden colleagues' rosters and propagate,
   *   4. re-resolve the roster of every affected schedule (this pages the
   *      person who is now on call — intended: who gets paged changed),
   *   5. bump those schedules' shiftConfigVersion, purge the feed caches and
   *      notify the shift-change listeners (reminders re-plan),
   *   6. disable — not delete — the user's personal calendar feed for the
   *      project, so their subscribed calendar clears itself,
   *   7. delete the user's shift reminders in the project,
   *   8. rotate every enabled schedule / project feed that opted into
   *      rotateWhenMemberLeaves, and purge the project's feed bodies —
   *      skipped when rotateSharedFeeds is false (a revoked never-accepted
   *      invitation: the invitee never had the links).
   *
   * Each step is isolated: a failure is logged and the next step still runs.
   * Unconditional — callers decide whether the user really left (see
   * cleanupOnCallAssignmentsIfUserLeftProject).
   */
  @CaptureSpan()
  public async cleanupOnCallAssignmentsForUserLeavingProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
    rotateSharedFeeds?: boolean | undefined;
  }): Promise<OnCallLeaveCleanupResult> {
    const { projectId, userId } = data;

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      userId: userId.toString(),
    } as LogAttributes;

    const result: OnCallLeaveCleanupResult = {
      removedLayerUserCount: 0,
      removedEscalationRuleUserCount: 0,
      removedUserOverrideCount: 0,
      refreshedScheduleIds: [],
      personalFeedDisabled: false,
      removedReminderCount: 0,
      rotatedScheduleFeedIds: [],
      rotatedProjectFeedIds: [],
    };

    const affectedScheduleIds: Array<ObjectID> = [];
    const affectedLayerIds: Array<ObjectID> = [];

    // 1. Layer-user rows.
    try {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        await OnCallDutyPolicyScheduleLayerUserService.findBy({
          query: {
            projectId,
            userId,
          },
          select: {
            _id: true,
            onCallDutyPolicyScheduleId: true,
            onCallDutyPolicyScheduleLayerId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const seenSchedules: Set<string> = new Set<string>();
      const seenLayers: Set<string> = new Set<string>();

      for (const row of layerUsers) {
        const scheduleId: string | undefined =
          row.onCallDutyPolicyScheduleId?.toString();
        if (scheduleId && !seenSchedules.has(scheduleId)) {
          seenSchedules.add(scheduleId);
          affectedScheduleIds.push(row.onCallDutyPolicyScheduleId!);
        }

        const layerId: string | undefined =
          row.onCallDutyPolicyScheduleLayerId?.toString();
        if (layerId && !seenLayers.has(layerId)) {
          seenLayers.add(layerId);
          affectedLayerIds.push(row.onCallDutyPolicyScheduleLayerId!);
        }
      }

      if (layerUsers.length > 0) {
        result.removedLayerUserCount =
          await OnCallDutyPolicyScheduleLayerUserService.deleteBy({
            query: {
              projectId,
              userId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        for (const layerId of affectedLayerIds) {
          try {
            await OnCallDutyPolicyScheduleLayerUserService.resequenceOrderInLayer(
              layerId,
            );
          } catch (err) {
            logger.error(err as Error, logAttributes);
          }
        }
      }
    } catch (err) {
      logger.error(
        "Error removing on-call schedule layer users for a user who left the project (best-effort).",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    // 2. Escalation-rule user rows (through the service so its hooks run).
    try {
      const ruleUserCount: PositiveNumber =
        await OnCallDutyPolicyEscalationRuleUserService.countBy({
          query: {
            projectId,
            userId,
          },
          props: {
            isRoot: true,
          },
        });

      if (ruleUserCount.toNumber() > 0) {
        result.removedEscalationRuleUserCount =
          await OnCallDutyPolicyEscalationRuleUserService.deleteBy({
            query: {
              projectId,
              userId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });
      }
    } catch (err) {
      logger.error(
        "Error removing escalation-rule users for a user who left the project (best-effort).",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    /*
     * 3. Not-yet-ended user overrides that name the user on either side.
     *    Deleted THROUGH the service so its hooks write the policy feed
     *    items, refresh the overridden colleagues' rosters and propagate
     *    (version bump, cache purge, reminder re-plan). Ended overrides are
     *    history and stay. overrideUserId and routeAlertsToUserId can never
     *    be the same user (enforced on create), so the two deletes are
     *    disjoint.
     */
    try {
      const now: Date = OneUptimeDate.getCurrentDate();

      result.removedUserOverrideCount +=
        await OnCallDutyPolicyUserOverrideService.deleteBy({
          query: {
            projectId,
            overrideUserId: userId,
            endsAt: QueryHelper.greaterThan(now),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      result.removedUserOverrideCount +=
        await OnCallDutyPolicyUserOverrideService.deleteBy({
          query: {
            projectId,
            routeAlertsToUserId: userId,
            endsAt: QueryHelper.greaterThan(now),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
    } catch (err) {
      logger.error(
        "Error removing user overrides for a user who left the project (best-effort).",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    // 4. Rosters of the affected schedules.
    for (const scheduleId of affectedScheduleIds) {
      try {
        await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
          scheduleId,
        );
        result.refreshedScheduleIds.push(scheduleId.toString());
      } catch (err) {
        logger.error(
          `Error refreshing the roster of schedule ${scheduleId.toString()} after a member left the project (best-effort).`,
          logAttributes,
        );
        logger.error(err as Error, logAttributes);
      }
    }

    // 5. Version bump, cache purge, listeners (never throws).
    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: affectedScheduleIds,
      projectId,
      userIds: [userId],
      reason: OnCallShiftChangeReason.MemberLeftProject,
    });

    // 6. Personal calendar feed: disabled, not deleted.
    try {
      const feeds: PositiveNumber = await UserOnCallCalendarFeedService.countBy(
        {
          query: {
            projectId,
            userId,
          },
          props: {
            isRoot: true,
          },
        },
      );

      if (feeds.toNumber() > 0) {
        await UserOnCallCalendarFeedService.updateOneBy({
          query: {
            projectId,
            userId,
          },
          data: {
            isEnabled: false,
          },
          props: {
            isRoot: true,
          },
        });

        result.personalFeedDisabled = true;
      }

      await OnCallCalendarFeedCache.purgeForUser(
        projectId.toString(),
        userId.toString(),
      );
    } catch (err) {
      logger.error(
        "Error disabling the personal calendar feed of a user who left the project (best-effort).",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    // 7. Shift reminders.
    try {
      result.removedReminderCount =
        await UserOnCallShiftReminderService.deleteBy({
          query: {
            projectId,
            userId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
    } catch (err) {
      logger.error(
        "Error removing shift reminders of a user who left the project (best-effort).",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    /*
     * 8. Shared feeds that opted into rotation on member leave. Skipped when
     *    the caller says no ACCEPTED membership went away (a revoked pending
     *    invitation): the invitee never had the links, and rotating would
     *    clear every subscribed teammate's calendar for nothing.
     */
    if (data.rotateSharedFeeds !== false) {
      try {
        const rotatedScheduleFeedIds: Array<ObjectID> =
          await OnCallDutyPolicyScheduleCalendarFeedService.rotateFeedsForMemberLeave(
            { projectId },
          );

        result.rotatedScheduleFeedIds = rotatedScheduleFeedIds.map(
          (id: ObjectID) => {
            return id.toString();
          },
        );
      } catch (err) {
        logger.error(
          "Error rotating schedule calendar feeds after a member left the project (best-effort).",
          logAttributes,
        );
        logger.error(err as Error, logAttributes);
      }

      try {
        const rotatedProjectFeedIds: Array<ObjectID> =
          await ProjectOnCallCalendarFeedService.rotateFeedsForMemberLeave({
            projectId,
          });

        result.rotatedProjectFeedIds = rotatedProjectFeedIds.map(
          (id: ObjectID) => {
            return id.toString();
          },
        );
      } catch (err) {
        logger.error(
          "Error rotating the project calendar feed after a member left the project (best-effort).",
          logAttributes,
        );
        logger.error(err as Error, logAttributes);
      }

      if (
        result.rotatedScheduleFeedIds.length > 0 ||
        result.rotatedProjectFeedIds.length > 0
      ) {
        try {
          await OnCallCalendarFeedCache.purgeForProject(projectId.toString());
        } catch (err) {
          logger.error(err as Error, logAttributes);
        }
      }
    }

    logger.debug(
      `On-call cleanup for a user leaving the project: ${JSON.stringify(result)}`,
      logAttributes,
    );

    return result;
  }

  @CaptureSpan()
  public async getUniqueTeamMemberCountInProject(
    projectId: ObjectID,
  ): Promise<number> {
    const members: Array<TeamMember> = await this.findBy({
      query: {
        projectId: projectId!,
      },
      props: {
        isRoot: true,
      },
      select: {
        userId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
    });

    const memberIds: Array<string | undefined> = members
      .map((member: TeamMember) => {
        return member.userId?.toString();
      })
      .filter((memberId: string | undefined) => {
        return Boolean(memberId);
      });

    return [...new Set(memberIds)].length; //get unique member ids.
  }

  /*
   * Whether the user has any membership in the project, a pending invitation
   * included - which is what getUniqueTeamMemberCountInProject counts them
   * by. isUserMemberOfProject answers the narrower question of whether they
   * have accepted one.
   */
  @CaptureSpan()
  private async hasMembershipInProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<boolean> {
    const count: PositiveNumber = await this.countBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber() > 0;
  }

  /**
   * Every member row of the teams, pending invitations included. Pass
   * acceptedOnly for the accepted rows alone - the only ones that grant the
   * team's permissions and come with notification settings.
   */
  @CaptureSpan()
  public async getUsersInTeams(
    teamIds: Array<ObjectID>,
    options?: { acceptedOnly?: boolean | undefined } | undefined,
  ): Promise<Array<User>> {
    const members: Array<TeamMember> = await this.findBy({
      query: {
        teamId: QueryHelper.any(teamIds),
        ...(options?.acceptedOnly ? { hasAcceptedInvitation: true } : {}),
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        user: {
          _id: true,
          email: true,
          name: true,
          timezone: true,
        } as Select<User>,
      },

      skip: 0,
      limit: LIMIT_MAX,
    });

    const uniqueUserIds: Set<string> = new Set<string>();
    const uniqueMembers: TeamMember[] = members.filter((member: TeamMember) => {
      const userId: string | undefined = member.user?._id?.toString();
      if (userId && !uniqueUserIds.has(userId)) {
        uniqueUserIds.add(userId);
        return true;
      }
      return false;
    });

    return uniqueMembers.map((member: TeamMember) => {
      return member.user!;
    });
  }

  @CaptureSpan()
  public async getUsersInTeam(teamId: ObjectID): Promise<Array<User>> {
    const members: Array<TeamMember> = await this.findBy({
      query: {
        teamId: teamId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        user: {
          _id: true,
          email: true,
          name: true,
        } as Select<User>,
      },

      skip: 0,
      limit: LIMIT_MAX,
    });

    return members.map((member: TeamMember) => {
      return member.user!;
    });
  }

  /**
   * The membership write has already committed. A payment-provider outage
   * must not report a failed invite or prevent removal cleanup. The scheduled
   * seat reconciliation retries projects whose acknowledged count is stale.
   */
  @CaptureSpan()
  private async syncSubscriptionSeatsAfterMembershipChange(
    projectId: ObjectID,
  ): Promise<void> {
    try {
      await this.updateSubscriptionSeatsByUniqueTeamMembersInProject(projectId);
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: projectId.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  public async updateSubscriptionSeatsByUniqueTeamMembersInProject(
    projectId: ObjectID,
  ): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    /*
     * Serialize the request and worker paths, then read the latest count so
     * an older synchronization cannot overwrite a newer seat quantity.
     */
    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: projectId.toString(),
      namespace: "team-member-subscription-seats",
      lockTimeout: 60000,
      acquireTimeout: 5000,
    });

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          paymentProviderSubscriptionId: true,
          paymentProviderPlanId: true,
          paymentProviderSubscriptionSeats: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (
        !project?.paymentProviderSubscriptionId ||
        !project.paymentProviderPlanId
      ) {
        return;
      }

      const plan: SubscriptionPlan | undefined =
        SubscriptionPlan.getSubscriptionPlanById(project.paymentProviderPlanId);

      if (!plan) {
        return;
      }

      const numberOfMembers: number =
        await this.getUniqueTeamMemberCountInProject(projectId);

      if (project.paymentProviderSubscriptionSeats === numberOfMembers) {
        return;
      }

      /*
       * The provider may apply the quantity and then time out. Persist that
       * uncertainty before calling it, so even a later return to the previous
       * member count cannot make reconciliation mistake the seats for synced.
       */
      const invalidated: number = await ProjectService.updateSubscriptionSeats({
        projectId: projectId,
        subscriptionId: project.paymentProviderSubscriptionId,
        planId: project.paymentProviderPlanId,
        seats: null,
      });

      if (invalidated === 0) {
        return;
      }

      await BillingService.changeQuantity(
        project.paymentProviderSubscriptionId,
        numberOfMembers,
      );

      await ProjectService.updateSubscriptionSeats({
        projectId: projectId,
        subscriptionId: project.paymentProviderSubscriptionId,
        planId: project.paymentProviderPlanId,
        seats: numberOfMembers,
      });
    } finally {
      await Semaphore.release(mutex);
    }
  }

  /*
   * Returns the IDs of teams the given user has accepted membership in,
   * scoped to a single project. Used by the `Owned` permission scope to
   * resolve "any of the user's teams owns this resource."
   */
  @CaptureSpan()
  public async getTeamIdsForUser(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const cacheKey: string = `${userId.toString()}:${projectId.toString()}`;
    const cached: Array<string> | undefined =
      this.teamIdsForUserCache.get(cacheKey);
    if (cached !== undefined) {
      return cached.map((id: string) => {
        return new ObjectID(id);
      });
    }

    const members: Array<TeamMember> = await this.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        hasAcceptedInvitation: true,
      },
      props: {
        isRoot: true,
      },
      select: {
        teamId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
    });

    const teamIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();
    for (const member of members) {
      const id: ObjectID | undefined = member.teamId;
      if (id && !seen.has(id.toString())) {
        seen.add(id.toString());
        teamIds.push(id);
      }
    }

    this.teamIdsForUserCache.set(
      cacheKey,
      teamIds.map((id: ObjectID) => {
        return id.toString();
      }),
      60_000,
    );
    return teamIds;
  }

  /*
   * Whether the user holds an accepted membership in any team of the project.
   * A pending invitee is not a member yet, and someone removed from every
   * team is not one any more — their notification settings are gone, so
   * nothing addressed to them from this project reaches them.
   */
  @CaptureSpan()
  public async isUserMemberOfProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<boolean> {
    const count: PositiveNumber = await this.countBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        hasAcceptedInvitation: true,
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber() > 0;
  }

  /*
   * The ids among `userIds` that belong to members of the project (see
   * isUserMemberOfProject), in their input order, each once. Ids stored in
   * saved configuration can arrive as plain strings; they come back as ids.
   */
  @CaptureSpan()
  public async getProjectMemberUserIds(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID | string>;
  }): Promise<Array<ObjectID>> {
    const requested: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const userId of data.userIds) {
      const value: string = userId?.toString() || "";

      if (value && !requested.has(value.toLowerCase())) {
        requested.set(value.toLowerCase(), new ObjectID(value));
      }
    }

    if (requested.size === 0) {
      return [];
    }

    const members: Array<TeamMember> = await this.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(Array.from(requested.values())),
        hasAcceptedInvitation: true,
      },
      select: {
        userId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const memberIds: Set<string> = new Set<string>(
      members.map((member: TeamMember): string => {
        return member.userId?.toString().toLowerCase() || "";
      }),
    );

    return Array.from(requested.entries())
      .filter(([key]: [string, ObjectID]): boolean => {
        return memberIds.has(key);
      })
      .map(([, userId]: [string, ObjectID]): ObjectID => {
        return userId;
      });
  }

  /*
   * `users` without the ones who are not members of the project. Owner lists
   * use it so an owner who left is neither notified nor reported as
   * notified, and a resource whose owners have all left falls back to the
   * project owners.
   */
  @CaptureSpan()
  public async filterUsersToProjectMembers(data: {
    projectId: ObjectID;
    users: Array<User>;
  }): Promise<Array<User>> {
    if (data.users.length === 0) {
      return [];
    }

    const memberIds: Set<string> = new Set<string>(
      (
        await this.getProjectMemberUserIds({
          projectId: data.projectId,
          userIds: data.users
            .map((user: User): string => {
              return user?.id?.toString() || "";
            })
            .filter(Boolean),
        })
      ).map((userId: ObjectID): string => {
        return userId.toString().toLowerCase();
      }),
    );

    return data.users.filter((user: User): boolean => {
      return Boolean(
        user?.id && memberIds.has(user.id.toString().toLowerCase()),
      );
    });
  }
}

export default new TeamMemberService();
