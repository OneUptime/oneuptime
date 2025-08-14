import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
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
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import User from "../../Models/DatabaseModels/User";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";

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
        user: {
          timezone: true,
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
        createdByUserId: true,
      },
      props: {
        isRoot: true,
      },
    });

    // send notification to the new current user.

    const sendEmailToUserId: ObjectID | undefined | null =
      createdModel?.user?.id;

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
        createdModel.onCallDutyPolicyEscalationRule?.name || "No name provided",
      escalationRuleOrder:
        createdModel.onCallDutyPolicyEscalationRule?.order?.toString() ||
        "No order provided",
      reason: "You have been added to the on-call duty policy escalation rule.",
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
      subject: `You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name}`,
    };

    const sms: SMSMessage = {
      message: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
    };

    const callMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
        },
      ],
    };

    const pushMessage: PushNotificationMessage =
      PushNotificationUtil.createOnCallPolicyAddedNotification({
        policyName: createdModel.onCallDutyPolicy?.name || "",
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
      onCallPolicyId: createdModel.onCallDutyPolicy!.id!,
      onCallPolicyEscalationRuleId:
        createdModel.onCallDutyPolicyEscalationRule!.id!,
    });

    // add workspace message.

    const onCallDutyPolicyId: ObjectID | undefined | null =
      createdModel.onCallDutyPolicy!.id;
    const projectId: ObjectID | undefined = createdModel.projectId;

    if (onCallDutyPolicyId) {
      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: onCallDutyPolicyId,
        projectId: projectId!,
        onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType.UserAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `👨🏻‍💻 Added **${await UserService.getUserMarkdownString(
          {
            userId: createdModel.user!.id!,
            projectId: projectId!,
          },
        )}** to the [On-Call Policy ${createdModel.onCallDutyPolicy?.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${createdModel.onCallDutyPolicyEscalationRule?.name}** with order **${createdModel.onCallDutyPolicyEscalationRule?.order}**.`,
        userId: createdModel.createdByUserId! || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: createdModel.createdByUserId! || undefined,
        },
      });

      // also add on-call duty time log.
      OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        projectId: projectId!,
        onCallDutyPolicyId: onCallDutyPolicyId!,
        onCallDutyPolicyEscalationRuleId:
          createdModel.onCallDutyPolicyEscalationRule!.id!,
        userId: createdModel.user!.id!,
        startsAt: OneUptimeDate.getCurrentDate(),
      }).catch((error: Error) => {
        logger.error(
          `Error starting time log for user ${createdModel.user?.id}: ${error}`,
        );
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
        user: {
          timezone: true,
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
        createdByUserId: true,
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
      const userId: ObjectID | undefined = item.user!.id!;

      if (onCallDutyPolicyId && userId && projectId) {
        const user: User | null = await UserService.findOneById({
          id: userId,
          select: {
            name: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

        const onCallDutyPolicyName: string | null =
          item.onCallDutyPolicy?.name || "No name provided";

        if (user && user.name) {
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) from the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) for escalation rule ${item.onCallDutyPolicyEscalationRule?.name} with order ${item.onCallDutyPolicyEscalationRule?.order}.`,
            userId: deleteByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: userId || undefined,
            },
          });

          // also remove on-call duty time log.
          OnCallDutyPolicyTimeLogService.endTimeLogForUser({
            projectId: projectId,
            onCallDutyPolicyId: onCallDutyPolicyId,
            onCallDutyPolicyEscalationRuleId:
              item.onCallDutyPolicyEscalationRule!.id!,
            userId: userId,
            endsAt: OneUptimeDate.getCurrentDate(),
          }).catch((error: Error) => {
            logger.error(`Error ending time log for user ${userId}: ${error}`);
          });
        }
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
      const sendEmailToUserId: ObjectID | undefined | null =
        deletedItem.user?.id;

      if (!sendEmailToUserId) {
        return onDelete;
      }

      const vars: Dictionary<string> = {
        onCallPolicyName:
          deletedItem.onCallDutyPolicy?.name || "No name provided",
        escalationRuleName:
          deletedItem.onCallDutyPolicyEscalationRule?.name ||
          "No name provided",
        escalationRuleOrder:
          deletedItem.onCallDutyPolicyEscalationRule?.order?.toString() ||
          "No order provided",
        reason:
          "You have been removed from the on-call duty policy escalation rule.",
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
        subject: `You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
          },
        ],
      };

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyRemovedNotification({
          policyName: deletedItem.onCallDutyPolicy?.name || "",
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
        onCallPolicyId: deletedItem.onCallDutyPolicy!.id!,
        onCallPolicyEscalationRuleId:
          deletedItem.onCallDutyPolicyEscalationRule!.id!,
      });
    }

    return onDelete;
  }
}
export default new Service();
