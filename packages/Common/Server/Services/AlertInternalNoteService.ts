import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService from "./ProjectReferencesService";
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
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import CreateBy from "../Types/Database/CreateBy";
import OneUptimeDate from "../../Types/Date";
import SavedChatMessage from "../../Types/Workspace/SavedChatMessage";
import SavedChatMessageNote, {
  SavedChatMessageNoteKind,
} from "../Utils/Notes/SavedChatMessageNote";

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
    return { deleteBy, carryForward: null };
  }

  /*
   * A note posted from Slack or Microsoft Teams - a button's form, or a
   * message saved with a note emoji - made with the props of the member who
   * posted it (WorkspaceActionAuthorization.getProjectMemberProps), as the
   * dashboard makes the note they post there: it needs their permission to
   * create the note and their read of the alert, it is held to the
   * project's plan, and it is theirs - DatabaseService stamps them as its
   * creator.
   *
   * A message saved as a note keeps who wrote it, in which chat and when
   * (savedFromChatMessage, SavedChatMessageNote), and is filed at the time it was posted (postedAt).
   */
  @CaptureSpan()
  public async addNote(data: {
    alertId: ObjectID;
    projectId: ObjectID;
    note: string;
    postedFromSlackMessageId?: string | undefined;
    savedFromChatMessage?: SavedChatMessage | undefined;
    postedAt?: Date | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const internalNote: Model = new Model();
    internalNote.alertId = data.alertId;
    internalNote.projectId = data.projectId;
    internalNote.note = data.note;

    if (data.postedAt) {
      internalNote.postedAt = data.postedAt;
    }

    if (data.postedFromSlackMessageId) {
      internalNote.postedFromSlackMessageId = data.postedFromSlackMessageId;
    }

    return await SavedChatMessageNote.create({
      createBy: {
        data: internalNote,
        props: data.props,
      },
      savedFromChatMessage: data.savedFromChatMessage,
      create: (createBy: CreateBy<Model>): Promise<Model> => {
        return this.create(createBy);
      },
    });
  }

  /*
   * A note is filed in the timeline at postedAt: when it is written, unless
   * the create says otherwise (a message saved as a note: when it was
   * posted).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.postedAt) {
      createBy.data.postedAt = OneUptimeDate.getCurrentDate();
    }

    return { createBy: createBy, carryForward: null };
  }

  // Where a message saved as a note came from: no caller may write it.
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);
    SavedChatMessageNote.writeHandedOver(onCreate.createBy);
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

    const attachmentsMarkdown: MarkdownText = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/alert-internal-note/attachment",
    );

    const alertNumberDisplay: string =
      alertNumberResult.numberWithPrefix || "#" + alertNumberResult.number;
    const alertLink: string = (
      await AlertService.getAlertLinkInDashboard(
        createdItem.projectId!,
        alertId,
      )
    ).toString();

    /*
     * A message saved as a note: its entry names who wrote it and who saved
     * it, is filed when the message was posted, and is not posted back into
     * the channel the message is in.
     */
    const saved: SavedChatMessage | null =
      SavedChatMessageNote.read(createdItem);

    await AlertFeedService.createAlertFeedItem({
      alertId: createdItem.alertId!,
      projectId: createdItem.projectId!,
      alertFeedEventType: AlertFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,
      ...(saved
        ? { postedAt: createdItem.postedAt, savedFromChatMessage: saved }
        : {}),
      feedInfoInMarkdown: saved
        ? SavedChatMessageNote.getFeedMarkdown({
            saved: saved,
            noteKind: SavedChatMessageNoteKind.Private,
            record: mdText`[Alert ${alertNumberDisplay}](${alertLink})`,
            savedByName: await SavedChatMessageNote.getSavedByName({
              saved: saved,
              userId: userId,
            }),
            note: SavedChatMessageNote.getNoteMarkdown({
              note: createdItem.note,
              attachments: attachmentsMarkdown,
            }),
          }).toString()
        : mdText`📄 posted **private note** for this [Alert ${alertNumberDisplay}](${alertLink}):

${FeedMarkdown.asMarkdown(createdItem.note)}${attachmentsMarkdown}
                `.toString(),
      workspaceNotification: {
        sendWorkspaceNotification: true,
        // Not a saved message's: its entry names its people itself.
        leadWithAuthor: true,
        exceptChannel: SavedChatMessageNote.getSourceChannel({
          saved: saved,
          messageKey: createdItem.postedFromSlackMessageId,
        }),
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
        const attachmentsMarkdown: MarkdownText =
          await this.getAttachmentsMarkdown(
            updatedItem.id!,
            "/alert-internal-note/attachment",
          );
        await AlertFeedService.createAlertFeedItem({
          alertId: updatedItem.alertId!,
          projectId: updatedItem.projectId!,
          alertFeedEventType: AlertFeedEventType.PrivateNote,
          displayColor: Blue500,
          userId: userId || undefined,

          feedInfoInMarkdown:
            mdText`📄 updated **Private Note** for this [Alert ${alert.alertNumber}](${(await AlertService.getAlertLinkInDashboard(alert.projectId!, alert.id!)).toString()})
          
${FeedMarkdown.asMarkdown(updatedItem.note)}${attachmentsMarkdown}
                    `.toString(),
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: true,
          },
        });
      }
    }
    return onUpdate;
  }

  private async getAttachmentsMarkdown(
    modelId: ObjectID,
    attachmentApiPath: string,
  ): Promise<MarkdownText> {
    if (!modelId) {
      return FeedMarkdown.empty();
    }

    const noteWithAttachments: Model | null = await this.findOneById({
      id: modelId,
      select: {
        projectId: true,
        attachments: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!noteWithAttachments || !noteWithAttachments.attachments) {
      return FeedMarkdown.empty();
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
      return FeedMarkdown.empty();
    }

    return await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
      modelId,
      projectId: noteWithAttachments.projectId,
      attachmentIds,
      attachmentApiPath,
    });
  }
}

export default new Service();
