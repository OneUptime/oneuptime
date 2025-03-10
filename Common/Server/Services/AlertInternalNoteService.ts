import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/AlertInternalNote";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

    public async addNote(data: {
      userId: ObjectID;
      alertId: ObjectID;
      projectId: ObjectID;
      note: string;
    }): Promise<Model> {
      const internalNote: Model = new Model();
      internalNote.createdByUserId = data.userId;
      internalNote.alertId = data.alertId;
      internalNote.projectId = data.projectId;
      internalNote.note = data.note;
  
      return this.create({
        data: internalNote,
        props: {
          isRoot: true,
        },
      });
    }

  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    await AlertFeedService.createAlertFeedItem({
      alertId: createdItem.alertId!,
      projectId: createdItem.projectId!,
      alertFeedEventType: AlertFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,

      feedInfoInMarkdown: `**Posted Internal / Private Note**
  
  ${createdItem.note}
            `,
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
          alertId: true,
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
        await AlertFeedService.createAlertFeedItem({
          alertId: updatedItem.alertId!,
          projectId: updatedItem.projectId!,
          alertFeedEventType: AlertFeedEventType.PrivateNote,
          displayColor: Blue500,
          userId: userId || undefined,

          feedInfoInMarkdown: `**Updated Internal / Private Note**
  
  ${updatedItem.note}
            `,
        });
      }
    }
    return onUpdate;
  }
}

export default new Service();
