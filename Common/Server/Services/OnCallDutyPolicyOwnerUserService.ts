import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Model[] = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
      select: {
        onCallDutyPolicyId: true,
        projectId: true,
        userId: true,
      },
    });

    return {
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
      deleteBy: deleteBy,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deleteByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    const itemsToDelete: Model[] = onDelete.carryForward.itemsToDelete;

    for (const item of itemsToDelete) {
      const onCallDutyPolicyId: ObjectID | undefined = item.onCallDutyPolicyId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

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
          await OnCallDutyPolicyService.getOnCallDutyPolicyName({
            onCallDutyPolicyId: onCallDutyPolicyId,
          });

        if (user && user.name) {
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) from the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) as the owner.`,
            userId: deleteByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: userId || undefined,
            },
          });
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add onCallDutyPolicy feed.

    const onCallDutyPolicyId: ObjectID | undefined =
      createdItem.onCallDutyPolicyId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (onCallDutyPolicyId && userId && projectId) {
      const onCallDutyPolicyName: string | null =
        await OnCallDutyPolicyService.getOnCallDutyPolicyName({
          onCallDutyPolicyId: onCallDutyPolicyId,
        });

      if (userId) {
        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.OwnerUserAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `👨🏻‍💻 Added **${await UserService.getUserMarkdownString(
            {
              userId: userId,
              projectId: projectId,
            },
          )}** to the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) as the owner.`,
          userId: createdByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: userId || undefined,
          },
        });
      }
    }

    // get notification rule where inviteOwners is true.
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteOwnersIsTrue(
        {
          projectId: projectId!,
          notificationFor: {
            onCallDutyPolicyId: onCallDutyPolicyId,
          },
          notificationRuleEventType: NotificationRuleEventType.OnCallDutyPolicy,
        },
      );

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels:
          await OnCallDutyPolicyService.getWorkspaceChannelForOnCallDutyPolicy({
            onCallDutyPolicyId: onCallDutyPolicyId!,
          }),
        userIds: [userId!],
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}

export default new Service();
