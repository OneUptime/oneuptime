import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
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
    incidentEpisodeId: ObjectID;
    projectId: ObjectID;
    note: string;
    attachmentFileIds?: Array<ObjectID>;
    postedFromSlackMessageId?: string;
  }): Promise<Model> {
    const internalNote: Model = new Model();
    internalNote.createdByUserId = data.userId;
    internalNote.incidentEpisodeId = data.incidentEpisodeId;
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
    incidentEpisodeId: ObjectID;
    postedFromSlackMessageId: string;
  }): Promise<boolean> {
    const existingNote: Model | null = await this.findOneBy({
      query: {
        incidentEpisodeId: data.incidentEpisodeId,
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

    const incidentEpisodeId: ObjectID = createdItem.incidentEpisodeId!;

    const episodeNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await IncidentEpisodeService.getEpisodeNumber({
      episodeId: incidentEpisodeId,
    });
    const episodeNumberDisplay: string =
      episodeNumberResult.numberWithPrefix || "#" + episodeNumberResult.number;

    const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/incident-episode-internal-note/attachment",
    );

    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: createdItem.incidentEpisodeId!,
      projectId: createdItem.projectId!,
      incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,
      feedInfoInMarkdown: `📄 posted **private note** for this [Episode ${episodeNumberDisplay}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(createdItem.projectId!, incidentEpisodeId)).toString()}):

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
          incidentEpisodeId: true,
          incidentEpisode: {
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
        const episode: IncidentEpisode = updatedItem.incidentEpisode!;

        const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
          updatedItem.id!,
          "/incident-episode-internal-note/attachment",
        );

        await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
          incidentEpisodeId: updatedItem.incidentEpisodeId!,
          projectId: updatedItem.projectId!,
          incidentEpisodeFeedEventType:
            IncidentEpisodeFeedEventType.PrivateNote,
          displayColor: Blue500,
          userId: userId || undefined,
          feedInfoInMarkdown: `📄 updated **Private Note** for this [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()})

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
