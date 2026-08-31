import DatabaseConfig from "../DatabaseConfig";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import Errors from "../Utils/Errors";
import logger, { LogAttributes } from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import UserRegistrationToken from "../Utils/UserRegistrationToken";
import AccessTokenService from "./AccessTokenService";
import BillingService from "./BillingService";
import DatabaseService from "./DatabaseService";
import MailService from "./MailService";
import ProjectService from "./ProjectService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import UserService from "./UserService";
import { AccountsRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import Route from "../../Types/API/Route";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import Name from "../../Types/Name";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";
import ProjectSCIMService from "./ProjectSCIMService";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import UserOnCallCalendarFeedService from "./UserOnCallCalendarFeedService";
import UserOnCallShiftReminderService from "./UserOnCallShiftReminderService";
import OnCallDutyPolicyScheduleCalendarFeedService from "./OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectOnCallCalendarFeedService from "./ProjectOnCallCalendarFeedService";
import OnCallCalendarFeedCache from "../Infrastructure/OnCallCalendarFeedCache";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";

/*
 * What cleanupOnCallAssignmentsForUserLeavingProject did, for logging and
 * for the tests. Every count is "as far as we got": a step that failed is
 * logged and the remaining steps still run.
 */
export interface OnCallLeaveCleanupResult {
  removedLayerUserCount: number;
  removedEscalationRuleUserCount: number;
  refreshedScheduleIds: Array<string>;
  personalFeedDisabled: boolean;
  removedReminderCount: number;
  rotatedScheduleFeedIds: Array<string>;
  rotatedProjectFeedIds: Array<string>;
}

export class TeamMemberService extends DatabaseService<TeamMember> {
  /*
   * Caches the user's accepted team memberships per project. Auth middleware
   * calls this on every authenticated request to evaluate the `Owned`
   * permission scope; without the cache it's a Postgres findBy per request.
   * 60s of staleness on team membership changes is acceptable; we also
   * invalidate proactively when team membership writes happen.
   */
  private teamIdsForUserCache: InMemoryTTLCache<Array<string>> =
    new InMemoryTTLCache(10_000);

  public constructor() {
    super(TeamMember);
  }

  @CaptureSpan()
  private async isSCIMPushGroupsEnabled(projectId: ObjectID): Promise<boolean> {
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<TeamMember>,
  ): Promise<OnCreate<TeamMember>> {
    // Check if SCIM is enabled for the project
    if (
      !createBy.props.isRoot &&
      (await this.isSCIMPushGroupsEnabled(
        createBy.data.projectId! || createBy.props.tenantId,
      ))
    ) {
      throw new BadDataException(
        "Cannot invite team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
      );
    }

    // check if this project can have more members.
    if (IsBillingEnabled && createBy.data.projectId) {
      const project: Project | null = await ProjectService.findOneById({
        id: createBy.data.projectId!,
        select: {
          seatLimit: true,
          paymentProviderSubscriptionSeats: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (
        project &&
        project.seatLimit &&
        project.paymentProviderSubscriptionSeats &&
        project.paymentProviderSubscriptionSeats >= project.seatLimit
      ) {
        throw new BadDataException(Errors.TeamMemberService.LIMIT_REACHED);
      }

      if (
        createBy.props.currentPlan === PlanType.Free &&
        project &&
        project.paymentProviderSubscriptionSeats &&
        project.paymentProviderSubscriptionSeats >= 1
      ) {
        throw new BadDataException(
          Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
        );
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
     * grant - without that person ever agreeing to it.
     */
    const canCreateAcceptedInvitation: boolean = Boolean(
      createBy.props.isRoot || createBy.props.isMasterAdmin,
    );

    if (!canCreateAcceptedInvitation) {
      createBy.data.hasAcceptedInvitation = false;
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

    if (createBy.miscDataProps && createBy.miscDataProps["email"]) {
      const email: Email = new Email(createBy.miscDataProps["email"] as string);

      /*
       * Optional name supplied on the invite form. Used only to set the name on
       * a brand-new user, or to backfill an existing user who has no name yet —
       * we never overwrite a name the user has already set.
       */
      const nameValue: string | undefined = createBy.miscDataProps["name"]
        ? (createBy.miscDataProps["name"] as string).trim()
        : undefined;

      /*
       * `password` comes back too, because whether this person has finished
       * registering decides both which link the invitation carries and whether
       * that link needs a registration token. UserService.findByEmail selects
       * only the id, so it cannot answer that.
       */
      let user: User | null = await UserService.findOneBy({
        query: {
          email: email,
        },
        select: {
          _id: true,
          password: true,
        },
        props: {
          isRoot: true,
        },
      });

      let isNewUser: boolean = false;

      if (!user) {
        isNewUser = true;

        user = await UserService.createByEmail({
          email,
          name: nameValue ? new Name(nameValue) : undefined,
          // Record who invited this brand-new user, so it can be surfaced later.
          createdByUserId: createBy.props.userId,
          props: {
            isRoot: true,
          },
        });
      } else if (nameValue) {
        /*
         * User already exists. Backfill their name only if they don't have one
         * yet; if they already have a name, leave it untouched.
         */
        const existingUser: User | null = await UserService.findOneById({
          id: user.id!,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (existingUser && !existingUser.name?.toString()) {
          await UserService.updateOneById({
            id: user.id!,
            data: {
              name: new Name(nameValue),
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      createBy.data.userId = user.id!;

      const project: Project | null = await ProjectService.findOneById({
        id: createBy.data.projectId!,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (project) {
        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        /*
         * "Still has to register", not "we just created the row". Someone
         * invited to a second project before they ever signed up already has a
         * user row and still has no password, and used to be sent the sign-in
         * link — which they could not use, having no password to sign in with.
         */
        const needsRegistration: boolean = isNewUser || !user.password;

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

        MailService.sendMail(
          {
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
               * An auto-accepted member has nothing left to accept, so the
               * template drops the "sign in to accept your invitation" framing
               * and tells them they are already in.
               */
              isInvitationAccepted: isInvitationAcceptedOnCreate.toString(),
              projectName: project.name!,
              homeUrl: new URL(httpProtocol, host).toString(),
            },
            subject: isInvitationAcceptedOnCreate
              ? "You have been added to " + project.name
              : "You have been invited to " + project.name,
          },
          {
            projectId: createBy.data.projectId!,
            userId: user.id!,
          },
        ).catch((err: Error) => {
          logger.error(err, {
            projectId: createBy.data.projectId?.toString(),
            userId: user?.id?.toString(),
          } as LogAttributes);
        });
      }
    }

    //check if this user is already invited.

    const member: TeamMember | null = await this.findOneBy({
      query: {
        userId: createBy.data.userId!,
        teamId: createBy.data.teamId || new ObjectID(createBy.data.team!._id!),
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

    return { createBy, carryForward: null };
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
    this.teamIdsForUserCache.delete(
      `${userId.toString()}:${projectId.toString()}`,
    );

    /// Refresh tokens.
    await AccessTokenService.refreshUserGlobalAccessPermission(userId);

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

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<TeamMember>,
    createdItem: TeamMember,
  ): Promise<TeamMember> {
    await this.refreshTokens(
      onCreate.createBy.data.userId!,
      onCreate.createBy.data.projectId!,
    );

    await this.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      onCreate.createBy.data.projectId!,
    );

    /*
     * A membership created already accepted never goes through the
     * accept-invitation update, so it would otherwise miss the defaults that
     * hook adds.
     */
    if (createdItem.hasAcceptedInvitation) {
      await this.addDefaultNotificationSettingsAndRules({
        userId: onCreate.createBy.data.userId!,
        projectId: onCreate.createBy.data.projectId!,
      });
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

    return createdItem;
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

    for (const item of items) {
      await this.refreshTokens(item.userId!, item.projectId!);

      if (updateBy.data.hasAcceptedInvitation) {
        await this.addDefaultNotificationSettingsAndRules({
          userId: item.userId!,
          projectId: item.projectId!,
          user: item.user,
        });
      }
    }

    return { updateBy, carryForward: onUpdate.carryForward };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<TeamMember>,
  ): Promise<OnDelete<TeamMember>> {
    const members: Array<TeamMember> = await this.findBy({
      query: deleteBy.query,
      select: {
        userId: true,
        projectId: true,
        teamId: true,
        hasAcceptedInvitation: true,
        team: {
          _id: true,
          shouldHaveAtLeastOneMember: true,
        } as Select<TeamMember>,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Check if SCIM is enabled for the project
    if (
      // check if not root.
      !deleteBy.props.isRoot &&
      members.length > 0 &&
      members[0]?.projectId &&
      (await this.isSCIMPushGroupsEnabled(members[0].projectId))
    ) {
      throw new BadDataException(
        "Cannot delete team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
      );
    }

    // check if there's one member in the team.
    for (const member of members) {
      OnCallDutyPolicyTimeLogService.endTimeForUser({
        projectId: member.projectId!,
        userId: member.userId!,
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

      if (member.team?.shouldHaveAtLeastOneMember) {
        if (!member.hasAcceptedInvitation) {
          continue;
        }

        const membersInTeam: PositiveNumber = await this.countBy({
          query: {
            teamId: member.teamId!,
            hasAcceptedInvitation: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

        // Skip the one-member guard when SCIM manages membership for the project.
        const isPushGroupsManaged: boolean = await this.isSCIMPushGroupsEnabled(
          member.projectId!,
        );

        if (!isPushGroupsManaged && membersInTeam.toNumber() <= 1) {
          throw new BadDataException(
            Errors.TeamMemberService.ONE_MEMBER_REQUIRED,
          );
        }
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: members,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<TeamMember>,
  ): Promise<OnDelete<TeamMember>> {
    /*
     * remove-user-from-project deletes every membership of one user in one
     * deleteBy, so the same (user, project) can appear several times here;
     * the on-call cleanup is idempotent but not free, so run it once.
     */
    const onCallCleanupDone: Set<string> = new Set<string>();

    for (const item of onDelete.carryForward as Array<TeamMember>) {
      await this.refreshTokens(item.userId!, item.projectId!);
      await this.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        item.projectId!,
      );

      /*
       * Before the notification settings go: the "removed from on-call
       * policy" notices the cleanup triggers should still reach the person,
       * exactly as they would for a manual removal.
       */
      const cleanupKey: string = `${item.userId?.toString()}:${item.projectId?.toString()}`;
      if (!onCallCleanupDone.has(cleanupKey) && item.userId && item.projectId) {
        onCallCleanupDone.add(cleanupKey);
        await this.cleanupOnCallAssignmentsIfUserLeftProject({
          projectId: item.projectId,
          userId: item.userId,
        });
      }

      await UserNotificationSettingService.removeDefaultNotificationSettingsForUser(
        item.userId!,
        item.projectId!,
      );
    }

    return onDelete;
  }

  /**
   * Run the on-call cleanup when — and only when — the user no longer holds
   * an accepted membership in ANY team of the project: the same rule
   * removeDefaultNotificationSettingsForUser applies. A user who merely left
   * one of several teams keeps every on-call assignment. Best-effort: never
   * throws into the delete path.
   */
  @CaptureSpan()
  public async cleanupOnCallAssignmentsIfUserLeftProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
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

      return await this.cleanupOnCallAssignmentsForUserLeavingProject(data);
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
   *   3. re-resolve the roster of every affected schedule (this pages the
   *      person who is now on call — intended: who gets paged changed),
   *   4. bump those schedules' shiftConfigVersion, purge the feed caches and
   *      notify the shift-change listeners (reminders re-plan),
   *   5. disable — not delete — the user's personal calendar feed for the
   *      project, so their subscribed calendar clears itself,
   *   6. delete the user's shift reminders in the project,
   *   7. rotate every enabled schedule / project feed that opted into
   *      rotateWhenMemberLeaves, and purge the project's feed bodies.
   *
   * Each step is isolated: a failure is logged and the next step still runs.
   * Unconditional — callers decide whether the user really left (see
   * cleanupOnCallAssignmentsIfUserLeftProject).
   */
  @CaptureSpan()
  public async cleanupOnCallAssignmentsForUserLeavingProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<OnCallLeaveCleanupResult> {
    const { projectId, userId } = data;

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      userId: userId.toString(),
    } as LogAttributes;

    const result: OnCallLeaveCleanupResult = {
      removedLayerUserCount: 0,
      removedEscalationRuleUserCount: 0,
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

    // 3. Rosters of the affected schedules.
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

    // 4. Version bump, cache purge, listeners (never throws).
    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: affectedScheduleIds,
      projectId,
      userIds: [userId],
      reason: OnCallShiftChangeReason.MemberLeftProject,
    });

    // 5. Personal calendar feed: disabled, not deleted.
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

    // 6. Shift reminders.
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

    // 7. Shared feeds that opted into rotation on member leave.
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

  @CaptureSpan()
  public async getUsersInTeams(teamIds: Array<ObjectID>): Promise<Array<User>> {
    const members: Array<TeamMember> = await this.findBy({
      query: {
        teamId: QueryHelper.any(teamIds),
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

  @CaptureSpan()
  public async updateSubscriptionSeatsByUniqueTeamMembersInProject(
    projectId: ObjectID,
  ): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    const numberOfMembers: number =
      await this.getUniqueTeamMemberCountInProject(projectId);
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        paymentProviderSubscriptionId: true,
        paymentProviderPlanId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      project &&
      project.paymentProviderSubscriptionId &&
      project?.paymentProviderPlanId
    ) {
      const plan: SubscriptionPlan | undefined =
        SubscriptionPlan.getSubscriptionPlanById(
          project?.paymentProviderPlanId,
        );

      if (!plan) {
        return;
      }

      await BillingService.changeQuantity(
        project.paymentProviderSubscriptionId,
        numberOfMembers,
      );

      await ProjectService.updateOneById({
        id: projectId,
        data: {
          paymentProviderSubscriptionSeats: numberOfMembers,
        },
        props: {
          isRoot: true,
        },
      });
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
}

export default new TeamMemberService();
