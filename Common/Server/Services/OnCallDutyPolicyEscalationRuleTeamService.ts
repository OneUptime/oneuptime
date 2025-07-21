import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import Dictionary from "../../Types/Dictionary";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import { SMSMessage } from "../../Types/SMS/SMS";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import DeleteBy from "../Types/Database/DeleteBy";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import TeamMemberService from "./TeamMemberService";
import User from "../../Models/DatabaseModels/User";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import Team from "../../Models/DatabaseModels/Team";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const createdItemId: ObjectID = createdItem.id!;

    if (!createdItemId) {
      throw new BadDataException("Created item does not have an ID");
    }

    const createdModel: Model | null = await this.findOneById({
      id: createdItemId,
      select: {
        projectId: true,
        teamId: true,
        team: {
          name: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
        createdByUserId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!createdModel) {
      throw new BadDataException("Created item does not have an ID");
    }

    if (!createdModel.teamId) {
      throw new BadDataException("Created item does not have a teamId");
    }

    // send notification to the new current user.

    const usersInTeam: Array<User> = await TeamMemberService.getUsersInTeam(
      createdModel.teamId!,
    );

    for (const user of usersInTeam) {
      const temaName: string = createdModel.team?.name || "No name provided";

      const sendEmailToUserId: ObjectID | undefined | null = user?.id;

      if (!sendEmailToUserId) {
        return createdItem;
      }

      if (!createdModel) {
        return createdItem;
      }

      const vars: Dictionary<string> = {
        onCallPolicyName:
          createdModel.onCallDutyPolicy?.name || "No name provided",
        escalationRuleName:
          createdModel.onCallDutyPolicyEscalationRule?.name ||
          "No name provided",
        escalationRuleOrder:
          createdModel.onCallDutyPolicyEscalationRule?.order?.toString() ||
          "No order provided",
        reason:
          "You have been added to the on-call duty policy escalation rule because you are a member of the team " +
          temaName,
        onCallPolicyViewLink: (
          await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
            createdModel!.projectId!,
            createdModel.onCallDutyPolicy!.id!,
          )
        ).toString(),
      };

      // current user changed, send alert the new current user.
      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.UserAddedToOnCallPolicy,
        vars: vars,
        subject: `You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for team ${temaName}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for team ${temaName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for team ${temaName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
          },
        ],
      };

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyAddedNotification({
          policyName: createdModel.onCallDutyPolicy?.name || "No name provided",
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: sendEmailToUserId,
        projectId: createdModel!.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage: pushMessage,
        eventType:
          NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
      });

      // add start log
      OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        userId: sendEmailToUserId,
        onCallDutyPolicyId: createdModel.onCallDutyPolicy!.id!,
        onCallDutyPolicyEscalationRuleId:
          createdModel.onCallDutyPolicyEscalationRule!.id!,
        projectId: createdModel.projectId!,
        teamId: createdModel.teamId!,
        startsAt: new Date(),
      });
    }

    // add workspace message.

    const onCallDutyPolicyId: ObjectID | undefined | null =
      createdModel.onCallDutyPolicy!.id;
    const projectId: ObjectID | undefined = createdModel.projectId;

    const createdByUserId: ObjectID | undefined | null =
      createdModel.createdByUserId;

    const team: Team | undefined = createdModel.team;
    const onCallDutyPolicyName: string | null =
      createdModel.onCallDutyPolicy?.name || "";

    if (onCallDutyPolicyId) {
      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: onCallDutyPolicyId,
        projectId: projectId!,
        onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType.TeamAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Added team **${team?.name || ""}** from the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${createdModel.onCallDutyPolicyEscalationRule?.name}** with order **${createdModel.onCallDutyPolicyEscalationRule?.order}**.`,
        userId: createdByUserId || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: createdByUserId || undefined,
        },
      });
    }

    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToFetchBeforeDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      props: {
        isRoot: true,
      },
      select: {
        projectId: true,
        teamId: true,
        team: {
          name: true,
          _id: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    const deleteByUserId: ObjectID | undefined =
      deleteBy.deletedByUser?.id || deleteBy.props.userId;

    for (const item of itemsToFetchBeforeDelete) {
      const onCallDutyPolicyId: ObjectID | undefined =
        item.onCallDutyPolicy!.id!;
      const projectId: ObjectID | undefined = item.projectId;

      if (onCallDutyPolicyId && projectId) {
        const onCallDutyPolicyName: string | null =
          item.onCallDutyPolicy?.name || "No name provided";

        const team: Team | undefined = item.team;

        if (!team) {
          continue;
        }

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.OwnerTeamRemoved,
          displayColor: Red500,
          feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Removed team **${team.name}** from the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) and escalation rule ${item.onCallDutyPolicyEscalationRule?.name} with order ${item.onCallDutyPolicyEscalationRule?.order}.`,
          userId: deleteByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: deleteByUserId || undefined,
          },
        });
      }
    }

    return {
      deleteBy,
      carryForward: {
        deletedItems: itemsToFetchBeforeDelete,
      },
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedItems: Array<Model> = onDelete.carryForward.deletedItems;

    for (const deletedItem of deletedItems) {
      const usersInTeam: Array<User> = await TeamMemberService.getUsersInTeam(
        deletedItem.teamId!,
      );

      for (const user of usersInTeam) {
        const sendEmailToUserId: ObjectID | undefined | null = user?.id;

        if (!sendEmailToUserId) {
          return onDelete;
        }

        const teamName: string = deletedItem.team?.name || "No name provided";

        const vars: Dictionary<string> = {
          onCallPolicyName:
            deletedItem.onCallDutyPolicy?.name || "No name provided",
          escalationRuleName:
            deletedItem.onCallDutyPolicyEscalationRule?.name ||
            "No name provided",
          escalationRuleOrder:
            deletedItem.onCallDutyPolicyEscalationRule?.order?.toString() ||
            "No order provided",
          reason: `You have been removed from the on-call duty policy escalation rule for team ${teamName}.`,
          onCallPolicyViewLink: (
            await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
              deletedItem!.projectId!,
              deletedItem.onCallDutyPolicy!.id!,
            )
          ).toString(),
        };

        // current user changed, send alert the new current user.
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
          vars: vars,
          subject: `You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for team ${teamName}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for team ${teamName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for team ${teamName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createOnCallPolicyRemovedNotification({
            policyName:
              deletedItem.onCallDutyPolicy?.name || "No name provided",
          });

        UserNotificationSettingService.sendUserNotification({
          userId: sendEmailToUserId,
          projectId: deletedItem!.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          eventType:
            NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
        });

        // end time log
        await OnCallDutyPolicyTimeLogService.endTimeLogForUser({
          userId: sendEmailToUserId,
          onCallDutyPolicyId: deletedItem.onCallDutyPolicy!.id!,
          onCallDutyPolicyEscalationRuleId:
            deletedItem.onCallDutyPolicyEscalationRule!.id!,

          projectId: deletedItem.projectId!,
          teamId: deletedItem.teamId!,
          endsAt: OneUptimeDate.getCurrentDate(),
        });
      }
    }

    return onDelete;
  }
}
export default new Service();
