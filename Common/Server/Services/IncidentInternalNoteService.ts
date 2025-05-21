import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentInternalNote";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import IncidentService from "./IncidentService";
import Incident from "../../Models/DatabaseModels/Incident";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async addNote(data: {
    userId: ObjectID;
    incidentId: ObjectID;
    projectId: ObjectID;
    note: string;
  }): Promise<Model> {
    const internalNote: Model = new Model();
    internalNote.createdByUserId = data.userId;
    internalNote.incidentId = data.incidentId;
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

    const incidentId: ObjectID = createdItem.incidentId!;

    const incidentNumber: number | null =
      await IncidentService.getIncidentNumber({
        incidentId: incidentId,
      });

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,

      feedInfoInMarkdown: `📄 posted **private note** for this [Incident ${incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(createdItem.projectId!, incidentId)).toString()}):

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
          incidentId: true,
          incident: {
            projectId: true,
            incidentNumber: true,
          },
          projectId: true,
          note: true,
          createdByUserId: true,
          createdByUser: {
            _id: true,
          },
        },
      });

      const userId: ObjectID | null | undefined =
        onUpdate.updateBy.props.userId;

      for (const updatedItem of updatedItems) {
        const incident: Incident = updatedItem.incident!;

        await IncidentFeedService.createIncidentFeedItem({
          incidentId: updatedItem.incidentId!,
          projectId: updatedItem.projectId!,
          incidentFeedEventType: IncidentFeedEventType.PrivateNote,
          displayColor: Blue500,
          userId: userId || undefined,

          feedInfoInMarkdown: `📄 updated **Private Note** for this [Incident ${incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()})

${updatedItem.note}
          `,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: userId || undefined,
          },
        });
      }
    }
    return onUpdate;
  }
}

export default new Service();
