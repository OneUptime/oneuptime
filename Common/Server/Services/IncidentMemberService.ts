import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentMember";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import IncidentService from "./IncidentService";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import IncidentRoleService from "./IncidentRoleService";
import BadDataException from "../../Types/Exception/BadDataException";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.incidentId) {
      throw new BadDataException("incidentId is required");
    }

    if (!createBy.data.userId) {
      throw new BadDataException("userId is required");
    }

    if (!createBy.data.incidentRoleId) {
      throw new BadDataException("incidentRoleId is required");
    }

    // Check if this user is already assigned to this role for this incident
    const existingMember: Model | null = await this.findOneBy({
      query: {
        incidentId: createBy.data.incidentId,
        userId: createBy.data.userId,
        incidentRoleId: createBy.data.incidentRoleId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    if (existingMember) {
      throw new BadDataException(
        "This user is already assigned to this role for this incident",
      );
    }

    return { createBy, carryForward: null };
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
        incidentId: true,
        projectId: true,
        userId: true,
        incidentRoleId: true,
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
      const incidentId: ObjectID | undefined = item.incidentId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;
      const incidentRoleId: ObjectID | undefined = item.incidentRoleId;

      if (incidentId && userId && projectId) {
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

        let roleName: string = "Member";
        if (incidentRoleId) {
          const role: IncidentRole | null =
            await IncidentRoleService.findOneById({
              id: incidentRoleId,
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            });
          if (role && role.name) {
            roleName = role.name;
          }
        }

        const incidentNumberResult = await IncidentService.getIncidentNumber({
          incidentId: incidentId,
        });
        const incidentNumberDisplay: string =
          incidentNumberResult.numberWithPrefix ||
          "#" + incidentNumberResult.number;

        if (user && user.name) {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incidentId,
            projectId: projectId,
            incidentFeedEventType: IncidentFeedEventType.IncidentMemberRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👤 Removed **${user.name.toString()}** (${user.email?.toString()}) as **${roleName}** from [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()}).`,
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
    const incidentId: ObjectID | undefined = createdItem.incidentId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const incidentRoleId: ObjectID | undefined = createdItem.incidentRoleId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (incidentId && userId && projectId) {
      let roleName: string = "Member";
      if (incidentRoleId) {
        const role: IncidentRole | null = await IncidentRoleService.findOneById(
          {
            id: incidentRoleId,
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          },
        );
        if (role && role.name) {
          roleName = role.name;
        }
      }

      const incidentNumberResult = await IncidentService.getIncidentNumber({
        incidentId: incidentId,
      });
      const incidentNumberDisplay: string =
        incidentNumberResult.numberWithPrefix ||
        "#" + incidentNumberResult.number;

      if (userId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: incidentId,
          projectId: projectId,
          incidentFeedEventType: IncidentFeedEventType.IncidentMemberAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `👤 Added **${await UserService.getUserMarkdownString(
            {
              userId: userId,
              projectId: projectId,
            },
          )}** as **${roleName}** to [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()}).`,
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
            incidentId: incidentId,
          },
          notificationRuleEventType: NotificationRuleEventType.Incident,
        },
      );

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels: await IncidentService.getWorkspaceChannelForIncident(
          {
            incidentId: incidentId!,
          },
        ),
        userIds: [userId!],
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}
export default new Service();
