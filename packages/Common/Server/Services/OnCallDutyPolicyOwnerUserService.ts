import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import OnCallChatByWorkspace from "../Utils/OnCall/OnCallChatByWorkspace";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Model[] = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        onCallDutyPolicyId: true,
        projectId: true,
        userId: true,
      },
    );

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
        const onCallDutyPolicyName: string | null =
          await OnCallDutyPolicyService.getOnCallDutyPolicyName({
            onCallDutyPolicyId: onCallDutyPolicyId,
          });

        /*
         * The entry is the channels' line too. It used to name the owner by
         * their name with their address after it - for someone only
         * invited, the address they were invited at - and said nothing of
         * a member with no name. Now it names them as the added entry
         * does, through OnCallChatByWorkspace (#10616).
         */
        const ownerMarkdown: MarkdownText = await new OnCallChatByWorkspace({
          projectId: projectId,
        }).nameIn(null)(userId);

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.OwnerUserRemoved,
          displayColor: Red500,
          feedInfoInMarkdown:
            mdText`👨🏻‍💻 Removed **${ownerMarkdown}** from the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) as the owner.`.toString(),
          userId: deleteByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: true,
          },
        });
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
        /*
         * The entry is the channels' line too: someone only invited is
         * named by the name typed for them, never their address (#10616).
         */
        const ownerMarkdown: MarkdownText = await new OnCallChatByWorkspace({
          projectId: projectId,
        }).nameIn(null)(userId);

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.OwnerUserAdded,
          displayColor: Gray500,
          feedInfoInMarkdown:
            mdText`👨🏻‍💻 Added **${ownerMarkdown}** to the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) as the owner.`.toString(),
          userId: createdByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: true,
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
        notificationFor: {
          onCallDutyPolicyId: onCallDutyPolicyId,
        },
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}

export default new Service();
