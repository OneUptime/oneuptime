import User from "../../Models/DatabaseModels/User";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/AlertOwnerUser";
import UserService from "./UserService";
import PendingInviteeProfiles from "../Utils/TeamMember/PendingInviteeProfiles";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import AlertService from "./AlertService";
import { applyAlertRelatedRecordPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import AlertOnCallRulesOnOwnerChange from "../Utils/Alert/AlertOnCallRulesOnOwnerChange";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyAlertRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyAlertRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    updateBy.query = applyAlertRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyAlertRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    const itemsToDelete: Model[] = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        alertId: true,
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
      const alertId: ObjectID | undefined = item.alertId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (alertId && userId && projectId) {
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

        // Someone only invited is named as the project knows them (#9823).
        await PendingInviteeProfiles.nameInProject({
          users: [user],
          projectId: projectId,
        });

        if (user && user.name) {
          const alertNumberResult: {
            number: number | null;
            numberWithPrefix: string | null;
          } = await AlertService.getAlertNumber({
            alertId: alertId,
          });

          await AlertFeedService.createAlertFeedItem({
            alertId: alertId,
            projectId: projectId,
            alertFeedEventType: AlertFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown:
              mdText`👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) from the [Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${(await AlertService.getAlertLinkInDashboard(projectId!, alertId!)).toString()}) as the owner.`.toString(),
            userId: deleteByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              leadWithAuthor: true,
            },
          });
        }
      }
    }

    const changedAlerts: Map<string, Model> = new Map();

    for (const item of itemsToDelete) {
      if (item.alertId && item.projectId) {
        changedAlerts.set(item.alertId.toString(), item);
      }
    }

    for (const item of changedAlerts.values()) {
      this.runOnCallRulesAgain({
        alertId: item.alertId,
        projectId: item.projectId,
      });
    }

    return onDelete;
  }

  /*
   * An owner added or taken off may make the alert match an on-call rule
   * with an Alert Owner condition: such rules run again, in the background
   * - the change is not held up by them, and never fails for them
   * (AlertOnCallRulesOnOwnerChange).
   */
  private runOnCallRulesAgain(data: {
    alertId: ObjectID | undefined;
    projectId: ObjectID | undefined;
  }): void {
    AlertOnCallRulesOnOwnerChange.onOwnersChanged({
      alertId: data.alertId,
      projectId: data.projectId,
    }).catch((error: Error) => {
      logger.error(
        `Running alert on-call rules again after an owner change failed: ${error}`,
      );
    });
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add alert feed.

    const alertId: ObjectID | undefined = createdItem.alertId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (alertId && userId && projectId) {
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

      if (user && user.name) {
        const alertNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await AlertService.getAlertNumber({
          alertId: alertId,
        });
        await AlertFeedService.createAlertFeedItem({
          alertId: alertId,
          projectId: projectId,
          alertFeedEventType: AlertFeedEventType.OwnerUserAdded,
          displayColor: Gray500,
          feedInfoInMarkdown:
            mdText`👨🏻‍💻 Added **${await UserService.getUserMarkdownString({
              userId: userId,
              projectId: projectId,
            })}** to the [Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${(await AlertService.getAlertLinkInDashboard(projectId!, alertId!)).toString()}) as the owner.`.toString(),
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
            alertId: alertId,
          },
          notificationRuleEventType: NotificationRuleEventType.Alert,
        },
      );

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels: await AlertService.getWorkspaceChannelForAlert({
          alertId: alertId!,
        }),
        userIds: [userId!],
        notificationFor: {
          alertId: alertId,
        },
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    this.runOnCallRulesAgain({
      alertId: alertId,
      projectId: projectId,
    });

    return createdItem;
  }
}

export default new Service();
