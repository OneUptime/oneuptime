import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertInternalNote";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import { applyAlertRelatedRecordPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import File from "../../Models/DatabaseModels/File";
import FileAttachmentMarkdownUtil from "../Utils/FileAttachmentMarkdownUtil";

export class Service extends DatabaseService<Model> {
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
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  public async addNote(data: {
    userId: ObjectID;
    alertId: ObjectID;
    projectId: ObjectID;
    note: string;
    attachmentFileIds?: Array<ObjectID>;
    postedFromSlackMessageId?: string;
  }): Promise<Model> {
    const internalNote: Model = new Model();
    internalNote.createdByUserId = data.userId;
    internalNote.alertId = data.alertId;
    internalNote.projectId = data.projectId;
    internalNote.note = data.note;

    if (data.postedFromSlackMessageId) {
      internalNote.postedFromSlackMessageId = data.postedFromSlackMessageId;
    }

    if (data.attachmentFileIds && data.attachmentFileIds.length > 0) {
      internalNote.attachments = data.attachmentFileIds.map(
        (fileId: ObjectID) => {
          const file: File = new File();
          file.id = fileId;
          return file;
        },
      );
    }

    return this.create({
      data: internalNote,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async hasNoteFromSlackMessage(data: {
    alertId: ObjectID;
    postedFromSlackMessageId: string;
  }): Promise<boolean> {
    const existingNote: Model | null = await this.findOneBy({
      query: {
        alertId: data.alertId,
        postedFromSlackMessageId: data.postedFromSlackMessageId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return existingNote !== null;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    const alertId: ObjectID = createdItem.alertId!;

    const alertNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await AlertService.getAlertNumber({
      alertId: alertId,
    });

    const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/alert-internal-note/attachment",
    );

    await AlertFeedService.createAlertFeedItem({
      alertId: createdItem.alertId!,
      projectId: createdItem.projectId!,
      alertFeedEventType: AlertFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,

      feedInfoInMarkdown: `📄 posted **private note** for this [Alert ${alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number}](${(await AlertService.getAlertLinkInDashboard(createdItem.projectId!, alertId)).toString()}):
      
${(createdItem.note || "") + attachmentsMarkdown}
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
          alertId: true,
          projectId: true,
          note: true,
          createdByUserId: true,
          alert: {
            projectId: true,
            alertNumber: true,
            _id: true,
          },
          createdByUser: {
            _id: true,
          },
        },
      });

      const userId: ObjectID | null | undefined =
        onUpdate.updateBy.props.userId;

      for (const updatedItem of updatedItems) {
        const alert: Alert = updatedItem.alert!;
        const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
          updatedItem.id!,
          "/alert-internal-note/attachment",
        );
        await AlertFeedService.createAlertFeedItem({
          alertId: updatedItem.alertId!,
          projectId: updatedItem.projectId!,
          alertFeedEventType: AlertFeedEventType.PrivateNote,
          displayColor: Blue500,
          userId: userId || undefined,

          feedInfoInMarkdown: `📄 updated **Private Note** for this [Alert ${alert.alertNumber}](${(await AlertService.getAlertLinkInDashboard(alert.projectId!, alert.id!)).toString()})
          
${(updatedItem.note || "") + attachmentsMarkdown}
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

  private async getAttachmentsMarkdown(
    modelId: ObjectID,
    attachmentApiPath: string,
  ): Promise<string> {
    if (!modelId) {
      return "";
    }

    const noteWithAttachments: Model | null = await this.findOneById({
      id: modelId,
      select: {
        attachments: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!noteWithAttachments || !noteWithAttachments.attachments) {
      return "";
    }

    const attachmentIds: Array<ObjectID> = noteWithAttachments.attachments
      .map((file: File) => {
        if (file.id) {
          return file.id;
        }

        if (file._id) {
          return new ObjectID(file._id);
        }

        return null;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (!attachmentIds.length) {
      return "";
    }

    return await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
      modelId,
      attachmentIds,
      attachmentApiPath,
    });
  }
}

export default new Service();
