import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/IncidentInternalNote";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,

      feedInfoInMarkdown: `**Posted Internal / Private Note**

${createdItem.note}
          `,
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    return createdItem;
  }

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
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: updatedItem.incidentId!,
          projectId: updatedItem.projectId!,
          incidentFeedEventType: IncidentFeedEventType.PrivateNote,
          displayColor: Blue500,
          userId: userId || undefined,

          feedInfoInMarkdown: `**Updated Internal / Private Note**

${updatedItem.note}
          `,
          workspaceNotification: {
            sendWorkspaceNotification: true,
          },
        });
      }
    }
    return onUpdate;
  }
}

export default new Service();
