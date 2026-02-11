import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertEpisodeInternalNote";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import File from "../../Models/DatabaseModels/File";
import FileAttachmentMarkdownUtil from "../Utils/FileAttachmentMarkdownUtil";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async addNote(data: {
    userId: ObjectID;
    alertEpisodeId: ObjectID;
    projectId: ObjectID;
    note: string;
    attachmentFileIds?: Array<ObjectID>;
    postedFromSlackMessageId?: string;
  }): Promise<Model> {
    const internalNote: Model = new Model();
    internalNote.createdByUserId = data.userId;
    internalNote.alertEpisodeId = data.alertEpisodeId;
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
    alertEpisodeId: ObjectID;
    postedFromSlackMessageId: string;
  }): Promise<boolean> {
    const existingNote: Model | null = await this.findOneBy({
      query: {
        alertEpisodeId: data.alertEpisodeId,
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

    const alertEpisodeId: ObjectID = createdItem.alertEpisodeId!;

    const episodeNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await AlertEpisodeService.getEpisodeNumber({
      episodeId: alertEpisodeId,
    });
    const episodeNumberDisplay: string =
      episodeNumberResult.numberWithPrefix || "#" + episodeNumberResult.number;

    const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/alert-episode-internal-note/attachment",
    );

    await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
      alertEpisodeId: createdItem.alertEpisodeId!,
      projectId: createdItem.projectId!,
      alertEpisodeFeedEventType: AlertEpisodeFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,
      feedInfoInMarkdown: `📄 posted **private note** for this [Episode ${episodeNumberDisplay}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(createdItem.projectId!, alertEpisodeId)).toString()}):

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
          alertEpisodeId: true,
          alertEpisode: {
            projectId: true,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
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
        const episode: AlertEpisode = updatedItem.alertEpisode!;

        const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
          updatedItem.id!,
          "/alert-episode-internal-note/attachment",
        );

        await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
          alertEpisodeId: updatedItem.alertEpisodeId!,
          projectId: updatedItem.projectId!,
          alertEpisodeFeedEventType: AlertEpisodeFeedEventType.PrivateNote,
          displayColor: Blue500,
          userId: userId || undefined,
          feedInfoInMarkdown: `📄 updated **Private Note** for this [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()})

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
