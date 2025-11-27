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
import logger from "../Utils/Logger";
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
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";
import ProjectSCIMService from "./ProjectSCIMService";

export class TeamMemberService extends DatabaseService<TeamMember> {
  public constructor() {
    super(TeamMember);
  }

  @CaptureSpan()
  private async isSCIMPushGroupsEnabled(
    projectId: ObjectID,
  ): Promise<boolean> {
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

    if (!createBy.props.isRoot) {
      createBy.data.hasAcceptedInvitation = false;
    }

    if (createBy.miscDataProps && createBy.miscDataProps["email"]) {
      const email: Email = new Email(createBy.miscDataProps["email"] as string);

      let user: User | null = await UserService.findByEmail(email, {
        isRoot: true,
      });

      let isNewUser: boolean = false;

      if (!user) {
        isNewUser = true;
        user = await UserService.createByEmail({
          email,
          name: undefined, // name is not required for now.
          props: {
            isRoot: true,
          },
        });
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
              registerLink: URL.fromString(
                new URL(
                  httpProtocol,
                  host,
                  new Route(AccountsRoute.toString()),
                ).toString(),
              )
                .addRoute("/register")
                .addQueryParam("email", email.toString(), true)
                .toString(),
              isNewUser: isNewUser.toString(),
              projectName: project.name!,
              homeUrl: new URL(httpProtocol, host).toString(),
            },
            subject: "You have been invited to " + project.name,
          },
          {
            projectId: createBy.data.projectId!,
            userId: user.id!,
          },
        ).catch((err: Error) => {
          logger.error(err);
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
    /// Refresh tokens.
    await AccessTokenService.refreshUserGlobalAccessPermission(userId);

    await AccessTokenService.refreshUserTenantAccessPermission(
      userId,
      projectId,
    );
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

      if (updateBy.data.hasAcceptedInvitation && item.user?.isEmailVerified) {
        await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
          item.userId!,
          item.projectId!,
        );
        await UserNotificationRuleService.addDefaultNotificationRuleForUser(
          item.projectId!,
          item.userId!,
          item.user?.email as Email,
        );
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
        endsAt: OneUptimeDate.getCurrentDate(),
      }).catch((err: Error) => {
        logger.error(err);
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
        const isPushGroupsManaged: boolean =
          await this.isSCIMPushGroupsEnabled(member.projectId!);

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
    for (const item of onDelete.carryForward as Array<TeamMember>) {
      await this.refreshTokens(item.userId!, item.projectId!);
      await this.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        item.projectId!,
      );
      await UserNotificationSettingService.removeDefaultNotificationSettingsForUser(
        item.userId!,
        item.projectId!,
      );
    }

    return onDelete;
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
}

export default new TeamMemberService();
