import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
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

  /*
   * A note posted from Slack or Microsoft Teams - a button's form, or a
   * message saved with a note emoji - made with the props of the member who
   * posted it (WorkspaceActionAuthorization.getProjectMemberProps), as the
   * dashboard makes the note they post there: it needs their permission to
   * create the note and their read of the scheduled maintenance event, it is held to the
   * project's plan, and it is theirs - DatabaseService stamps them as its
   * creator.
   *
   * A message saved as a note keeps who wrote it, in which chat and when
   * (savedFromChatMessage, SavedChatMessageNote), and is filed at the time it was posted (postedAt).
   */
  @CaptureSpan()
  public async addNote(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
    note: string;
    postedFromSlackMessageId?: string | undefined;
    savedFromChatMessage?: SavedChatMessage | undefined;
    postedAt?: Date | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const internalNote: Model = new Model();
    internalNote.scheduledMaintenanceId = data.scheduledMaintenanceId;
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
    scheduledMaintenanceId: ObjectID;
    postedFromSlackMessageId: string;
  }): Promise<boolean> {
    const existingNote: Model | null = await this.findOneBy({
      query: {
        scheduledMaintenanceId: data.scheduledMaintenanceId,
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

    const scheduledMaintenanceId: ObjectID =
      createdItem.scheduledMaintenanceId!;

    const scheduledMaintenanceNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
      scheduledMaintenanceId: scheduledMaintenanceId,
    });

    const attachmentsMarkdown: MarkdownText = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/scheduled-maintenance-internal-note/attachment",
    );

    const scheduledMaintenanceNumberDisplay: string =
      scheduledMaintenanceNumberResult.numberWithPrefix ||
      "#" + scheduledMaintenanceNumberResult.number;
    const scheduledMaintenanceLink: string = (
      await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        createdItem.projectId!,
        scheduledMaintenanceId,
      )
    ).toString();

    /*
     * A message saved as a note: its entry names who wrote it and who saved
     * it, is filed when the message was posted, and is not posted back into
     * the channel the message is in.
     */
    const saved: SavedChatMessage | null =
      SavedChatMessageNote.read(createdItem);

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,
      ...(saved
        ? { postedAt: createdItem.postedAt, savedFromChatMessage: saved }
        : {}),
      /*
       * The note starts its own line, not indented: four spaces in front of
       * it made its first line code in the chats.
       */
      feedInfoInMarkdown: saved
        ? SavedChatMessageNote.getFeedMarkdown({
            saved: saved,
            noteKind: SavedChatMessageNoteKind.Private,
            record: mdText`[Scheduled Maintenance ${scheduledMaintenanceNumberDisplay}](${scheduledMaintenanceLink})`,
            savedByName: await SavedChatMessageNote.getSavedByName({
              saved: saved,
              userId: userId,
            }),
            note: SavedChatMessageNote.getNoteMarkdown({
              note: createdItem.note,
              attachments: attachmentsMarkdown,
            }),
          }).toString()
        : mdText`📄 posted **private note** for this [Scheduled Maintenance ${scheduledMaintenanceNumberDisplay}](${scheduledMaintenanceLink}):

${FeedMarkdown.asMarkdown(createdItem.note)}${attachmentsMarkdown}
              `.toString(),
      workspaceNotification: {
        sendWorkspaceNotification: true,
        // A saved message's entry names its people itself.
        leadWithAuthor: !saved,
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
          scheduledMaintenanceId: true,
          projectId: true,
          note: true,
          createdByUserId: true,
          createdByUser: {
            _id: true,
          },
          scheduledMaintenance: {
            scheduledMaintenanceNumber: true,
            scheduledMaintenanceNumberWithPrefix: true,
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

        const attachmentsMarkdown: MarkdownText =
          await this.getAttachmentsMarkdown(
            updatedItem.id!,
            "/scheduled-maintenance-internal-note/attachment",
          );

        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: updatedItem.scheduledMaintenanceId!,
            projectId: updatedItem.projectId!,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.PrivateNote,
            displayColor: Blue500,
            userId: userId || undefined,

            feedInfoInMarkdown:
              mdText`📄 updated **Private Note** for this [Scheduled Maintenance ${scheduledMaintenance.scheduledMaintenanceNumberWithPrefix || "#" + scheduledMaintenance.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(scheduledMaintenance.projectId!, scheduledMaintenance.id!)).toString()})
        
${FeedMarkdown.asMarkdown(updatedItem.note)}${attachmentsMarkdown}
                  `.toString(),
            workspaceNotification: {
              sendWorkspaceNotification: true,
              leadWithAuthor: true,
            },
          },
        );
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
