import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async addNote(data: {
    userId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
    note: string;
  }): Promise<Model> {
    const internalNote: Model = new Model();
    internalNote.createdByUserId = data.userId;
    internalNote.scheduledMaintenanceId = data.scheduledMaintenanceId;
    internalNote.projectId = data.projectId;
    internalNote.note = data.note;

    return this.create({
      data: internalNote,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    const scheduledMaintenanceId: ObjectID =
      createdItem.scheduledMaintenanceId!;

    const scheduledMaintenanceNumber: number | null =
      await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
        scheduledMaintenanceId: scheduledMaintenanceId,
      });

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,

      feedInfoInMarkdown: `📄 posted **private note** for this [Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(createdItem.projectId!, scheduledMaintenanceId)).toString()}):
    
${createdItem.note}
              `,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: userId || undefined,
      },
    });

    return createdItem;
  }

  @CaptureSpan()
  public override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.note) {
      const updatedItems: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          scheduledMaintenanceId: true,
          projectId: true,
          note: true,
          createdByUserId: true,
          createdByUser: {
            _id: true,
          },
          scheduledMaintenance: {
            scheduledMaintenanceNumber: true,
            projectId: true,
            _id: true,
          },
        },
      });

      const userId: ObjectID | null | undefined =
        onUpdate.updateBy.props.userId;

      for (const updatedItem of updatedItems) {
        const scheduledMaintenance: ScheduledMaintenance =
          updatedItem.scheduledMaintenance!;

        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: updatedItem.scheduledMaintenanceId!,
            projectId: updatedItem.projectId!,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.PrivateNote,
            displayColor: Blue500,
            userId: userId || undefined,

            feedInfoInMarkdown: `📄 updated **Private Note** for this [Scheduled Maintenance ${scheduledMaintenance.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(scheduledMaintenance.projectId!, scheduledMaintenance.id!)).toString()})
        
${updatedItem.note}
                  `,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: userId || undefined,
            },
          },
        );
      }
    }
    return onUpdate;
  }
}

export default new Service();
