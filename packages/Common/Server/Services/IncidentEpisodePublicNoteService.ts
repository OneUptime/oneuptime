import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import {
  DatabaseTriggerType,
  OnCreate,
  OnDelete,
  OnFind,
  OnUpdate,
} from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import ProjectReferencesService from "./ProjectReferencesService";
import OneUptimeDate from "../../Types/Date";
import Model from "../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500, Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../Types/StatusPage/SubscriberUpdateNotification";
import PublicNoteSubscriberNotificationDefault from "../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Query from "../Types/Database/Query";
import File from "../../Models/DatabaseModels/File";
import FileAttachmentMarkdownUtil from "../Utils/FileAttachmentMarkdownUtil";
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import SavedChatMessage from "../../Types/Workspace/SavedChatMessage";
import SavedChatMessageNote, {
  SavedChatMessageNoteKind,
} from "../Utils/Notes/SavedChatMessageNote";
import PrivateRecordPublicNoteRule from "../Utils/Notes/PrivateRecordPublicNoteRule";
import { PrivateRecordKind } from "../../Types/StatusPage/PrivateRecordPublicNotes";
import FindBy from "../Types/Database/FindBy";
import CountBy from "../Types/Database/CountBy";
import PositiveNumber from "../../Types/PositiveNumber";
import { applyIncidentEpisodeRelatedRecordPrivacyFilter } from "../Utils/IncidentEpisode/IncidentEpisodePrivacyFilter";
import { JSONObject } from "../../Types/JSON";
import Color from "../../Types/Color";
import { PublicNoteApprovalEventType } from "../../Types/StatusPage/PublicNoteApproval";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalDelete,
  PublicNoteApprovalHost,
  PublicNoteApprovalKind,
  PublicNoteApprovalRecordInfo,
  PublicNoteApprovalUpdate,
  PublicNoteKind,
} from "../Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalFeed from "../Utils/Notes/PublicNoteApprovalFeed";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * What public note approval needs from this kind of note
   * (PublicNoteApprovalEngine): the episode a note is on, by name and link,
   * its feed, and the entries a published note has always had. An
   * episode's notes are approved by the project's incident approvers.
   */
  /*
   * This kind of note, as the checks before a note is written read it
   * (onBeforeCreate, onBeforeUpdate): nothing in it writes.
   */
  public getApprovalKind(): PublicNoteApprovalKind<Model> {
    return {
      kind: PublicNoteKind.IncidentEpisode,
      eventType: PublicNoteApprovalEventType.Incident,
      modelType: Model,
      service: this,
      parentIdColumn: "incidentEpisodeId",
    };
  }

  public getApprovalHost(): PublicNoteApprovalHost<Model> {
    return {
      ...this.getApprovalKind(),
      getRecord: async (data: {
        projectId: ObjectID;
        parentId: ObjectID;
      }): Promise<PublicNoteApprovalRecordInfo | null> => {
        const episode: IncidentEpisode | null =
          await IncidentEpisodeService.findOneById({
            id: data.parentId,
            select: {
              title: true,
              episodeNumber: true,
              episodeNumberWithPrefix: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!episode) {
          return null;
        }

        const url: string = (
          await IncidentEpisodeService.getEpisodeLinkInDashboard(
            data.projectId,
            data.parentId,
          )
        ).toString();

        return {
          label: `Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}`,
          title: episode.title || "",
          url: url,
          notesUrl: `${url}/public-notes`,
        };
      },
      addFeedItem: async (data: {
        projectId: ObjectID;
        parentId: ObjectID;
        markdown: MarkdownText;
        userId?: ObjectID | undefined;
        color: Color;
      }): Promise<void> => {
        await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
          incidentEpisodeId: data.parentId,
          projectId: data.projectId,
          incidentEpisodeFeedEventType:
            IncidentEpisodeFeedEventType.PublicNoteApproval,
          displayColor: data.color,
          userId: data.userId,
          feedInfoInMarkdown: data.markdown.toString(),
          workspaceNotification: {
            sendWorkspaceNotification: false,
          },
        });
      },
      announcePublished: async (data: {
        noteId: ObjectID;
        approvedByNames: Array<string>;
      }): Promise<void> => {
        const note: Model | null = await this.findOneById({
          id: data.noteId,
          select: {
            _id: true,
            incidentEpisodeId: true,
            projectId: true,
            note: true,
            createdByUserId: true,
            postedFromSlackMessageId: true,
            savedFromChatMessage: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (note) {
          await this.announceNote({
            note,
            approvedByNames: data.approvedByNames,
          });
        }
      },
      announceEditPublished: async (data: {
        noteId: ObjectID;
        editorUserId?: ObjectID | undefined;
        approvedByNames: Array<string>;
      }): Promise<void> => {
        await this.announceEdits({
          query: { _id: data.noteId.toString() },
          userId: data.editorUserId,
          approvedByNames: data.approvedByNames,
        });
      },
      getMessageIds: (parentId: ObjectID) => {
        return { incidentEpisodeId: parentId };
      },
    };
  }

  /*
   * A public note that is not published starts no workflow: not when it is
   * created, nor when it is edited or decided on while it waits for
   * approval. Its On Create workflows start when it is published
   * (PublicNoteApprovalEngine).
   */
  @CaptureSpan()
  public override async onTriggerWorkflow(
    id: ObjectID,
    projectId: ObjectID,
    triggerType: DatabaseTriggerType,
    miscData?: JSONObject | undefined,
  ): Promise<void> {
    if (
      triggerType !== "on-delete" &&
      !(await PublicNoteApprovalEngine.isPublishedNow({ service: this, id }))
    ) {
      return;
    }

    return await super.onTriggerWorkflow(id, projectId, triggerType, miscData);
  }

  /*
   * The public notes of a private incident episode are read only by those who see the
   * incident episode: its owners - the people named on it and the members of the
   * teams named on it - and the project's owners and admins
   * (applyIncidentEpisodeRelatedRecordPrivacyFilter), as every other part of one is
   * (PrivateRecordParts.test). Changing or deleting them follows
   * the private record rule (PrivateRecordPermission).
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentEpisodeRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentEpisodeRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  /*
   * A note posted from Slack or Microsoft Teams - a button's form, or a
   * message saved with a note emoji - made with the props of the member who
   * posted it (WorkspaceActionAuthorization.getProjectMemberProps), as the
   * dashboard makes the note they post there: it needs their permission to
   * create the note and their read of the incident episode, it is held to the
   * project's plan, and it is theirs - DatabaseService stamps them as its
   * creator.
   *
   * A message saved as a note keeps who wrote it, in which chat and when
   * (savedFromChatMessage, SavedChatMessageNote). It is published now, as
   * any public note is - or, when the project asks for public notes to be
   * approved, once it is approved, and posted then (it names no time of
   * its own, so onBeforeCreate's "now" is the time it is published at).
   */
  @CaptureSpan()
  public async addNote(data: {
    incidentEpisodeId: ObjectID;
    projectId: ObjectID;
    note: string;
    postedFromSlackMessageId?: string | undefined;
    savedFromChatMessage?: SavedChatMessage | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const publicNote: Model = new Model();
    publicNote.incidentEpisodeId = data.incidentEpisodeId;
    publicNote.projectId = data.projectId;
    publicNote.note = data.note;

    if (data.postedFromSlackMessageId) {
      publicNote.postedFromSlackMessageId = data.postedFromSlackMessageId;
    }

    return await SavedChatMessageNote.create({
      createBy: {
        data: publicNote,
        props: data.props,
      },
      savedFromChatMessage: data.savedFromChatMessage,
      create: (createBy: CreateBy<Model>): Promise<Model> => {
        return this.create(createBy);
      },
    });
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
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * The episode the note is posted on, read once. A private episode takes
     * no new public notes, as a private incident takes none
     * (PrivateRecordPublicNoteRule); and a note that does not say whether to
     * notify subscribers follows the episode (below).
     */
    const incidentEpisode: IncidentEpisode | null =
      await this.getIncidentEpisodeOfNote(createBy.data);

    PrivateRecordPublicNoteRule.assertRecordTakesPublicNotes({
      kind: PrivateRecordKind.IncidentEpisode,
      record: incidentEpisode,
    });

    // A time chosen as it was written stays when it is published after approval.
    const isPostedAtChosen: boolean = Boolean(createBy.data.postedAt);

    if (!createBy.data.postedAt) {
      createBy.data.postedAt = OneUptimeDate.getCurrentDate();
    }

    /*
     * A note that does not say whether to notify subscribers (Slack and
     * Teams notes, workflows, API calls that leave the field out) follows
     * its episode, so one created without telling subscribers stays quiet.
     * An explicit true or false is kept as sent.
     */
    if (
      (createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ===
        undefined ||
        createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ===
          null) &&
      incidentEpisode
    ) {
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
        PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
          incidentEpisode,
        );
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnNoteCreated
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated === false
    ) {
      createBy.data.subscriberNotificationStatusOnNoteCreated =
        StatusPageSubscriberNotificationStatus.Skipped;
      createBy.data.subscriberNotificationStatusMessage =
        "Notifications skipped as subscribers are not to be notified for this episode note.";
    } else if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated === true
    ) {
      createBy.data.subscriberNotificationStatusOnNoteCreated =
        StatusPageSubscriberNotificationStatus.Pending;
    }

    /*
     * Held for approval when the project asks for it: not published, and
     * none of what follows a published note - its notification stays
     * queued until it is (PublicNoteApprovalEngine).
     */
    await PublicNoteApprovalEngine.holdOnCreate({
      host: this.getApprovalKind(),
      createBy: createBy,
      keepPostedAt: isPostedAtChosen,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /*
   * The episode a note is posted on, with the two switches the note's
   * create reads: whether it is private, and whether it notified
   * subscribers when it was created. Null when the note names no episode or
   * it cannot be found: nothing is refused, and the column default decides
   * whether the note notifies. Read as root - the create has made sure its
   * caller may read the episode (DatabaseService checkCreateParents) - and
   * only these two switches.
   */
  private async getIncidentEpisodeOfNote(
    note: Model,
  ): Promise<IncidentEpisode | null> {
    const incidentEpisodeId: ObjectID | null | undefined =
      note.incidentEpisodeId || note.incidentEpisode?.id;

    if (!incidentEpisodeId) {
      return null;
    }

    const query: Query<IncidentEpisode> = {
      _id: incidentEpisodeId.toString(),
    };

    if (note.projectId) {
      query.projectId = note.projectId;
    }

    return await IncidentEpisodeService.findOneBy({
      query: query,
      select: {
        isPrivate: true,
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * An edit tells subscribers nothing unless the editor asked for it on this
   * edit (see SubscriberUpdateNotification). When they did, queue the update
   * notification; the IncidentEpisodePublicNote worker job sends it.
   *
   * Sending the note's 'posted' notification again - its status written back
   * to Pending, as the dashboard's Retry does - needs the permission to post
   * a note that notifies subscribers, and a note whose notification can go
   * out again (see SubscriberNotificationResendAccess). So does telling
   * subscribers about an edit, which is also refused while that update
   * notification is being sent.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * Public note approval first (PublicNoteApprovalEngine): an edit of a
     * note that is not published, or of a published one while public notes
     * need approval, waits for approval - and tells subscribers nothing
     * until the note, or its edit, is published.
     */
    const approvalUpdate: PublicNoteApprovalUpdate =
      await PublicNoteApprovalEngine.beforeUpdate({
        host: this.getApprovalKind(),
        updateBy: updateBy,
      });

    await SubscriberNotificationResendAccess.assertPublicNoteResendAllowed({
      modelType: Model,
      service: this,
      updateBy: updateBy,
    });

    if (
      SubscriberUpdateNotification.isRequested(updateBy.miscDataProps) &&
      !approvalUpdate.isUpdateNotificationHeld
    ) {
      updateBy.data.subscriberNotificationStatusOnNoteUpdated =
        StatusPageSubscriberNotificationStatus.Pending;
      updateBy.data.subscriberNotificationStatusMessageOnNoteUpdated =
        SubscriberUpdateNotification.queuedMessage;
    }

    /*
     * Telling subscribers about the edit - asked for above, or written as
     * Pending directly (the dashboard's Retry of a failed update) - needs
     * the permission to post a note that notifies subscribers too, and is
     * refused while the update notification is being sent.
     */
    await SubscriberNotificationResendAccess.assertPublicNoteUpdateNotificationAllowed(
      {
        modelType: Model,
        service: this,
        updateBy: updateBy,
      },
    );

    return {
      updateBy: updateBy,
      carryForward: PublicNoteApprovalEngine.getCarryForward(approvalUpdate),
    };
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Held for approval: the episode's feed says it waits and its approvers
     * are asked; nothing of it is posted until it is published.
     */
    if (
      await PublicNoteApprovalEngine.afterCreate({
        host: this.getApprovalHost(),
        note: createdItem,
        props: onCreate.createBy.props,
      })
    ) {
      return createdItem;
    }

    await this.announceNote({
      note: createdItem,
      approvedByNames: [],
    });

    return createdItem;
  }

  /*
   * The entry a published public note gets, on its episode's feed and in
   * its Slack and Microsoft Teams channels: as it is created, or - when the
   * project asks for approval - once it is approved, naming who approved it.
   */
  private async announceNote(data: {
    note: Model;
    approvedByNames: Array<string>;
  }): Promise<void> {
    const createdItem: Model = data.note;
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    const incidentEpisodeId: ObjectID = createdItem.incidentEpisodeId!;
    const projectId: ObjectID = createdItem.projectId!;
    const episodeNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await IncidentEpisodeService.getEpisodeNumber({
      episodeId: incidentEpisodeId,
    });

    const attachmentsMarkdown: MarkdownText = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/incident-episode-public-note/attachment",
    );

    const episodeNumberDisplay: string =
      episodeNumberResult.numberWithPrefix || "#" + episodeNumberResult.number;
    const episodeLink: string = (
      await IncidentEpisodeService.getEpisodeLinkInDashboard(
        projectId!,
        incidentEpisodeId!,
      )
    ).toString();

    const approvedBy: MarkdownText = PublicNoteApprovalFeed.approvedByLine(
      data.approvedByNames,
    );

    /*
     * A message saved as a public note: its entry names who wrote it and
     * who saved it, and is not posted back into the channel the message is
     * in. Like any public note it is filed when it was published.
     */
    const saved: SavedChatMessage | null =
      SavedChatMessageNote.read(createdItem);

    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: createdItem.incidentEpisodeId!,
      projectId: createdItem.projectId!,
      incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.PublicNote,
      displayColor: Indigo500,
      userId: userId || undefined,
      ...(saved ? { savedFromChatMessage: saved } : {}),
      feedInfoInMarkdown: saved
        ? mdText`${SavedChatMessageNote.getFeedMarkdown({
            saved: saved,
            noteKind: SavedChatMessageNoteKind.Public,
            record: mdText`[Episode ${episodeNumberDisplay}](${episodeLink})`,
            savedByName: await SavedChatMessageNote.getSavedByName({
              saved: saved,
              userId: userId,
            }),
            note: SavedChatMessageNote.getNoteMarkdown({
              note: createdItem.note,
              attachments: attachmentsMarkdown,
            }),
          })}${approvedBy}`.toString()
        : mdText`📄 posted **public note** for this [Episode ${episodeNumberDisplay}](${episodeLink}) on status page:

${FeedMarkdown.asMarkdown(createdItem.note)}${attachmentsMarkdown}${approvedBy}
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
  }

  /*
   * A delete of notes reads the chat copies of their approval messages
   * first - the database deletes them with the notes - and replaces them in
   * the background once it is done, saying the note was deleted
   * (PublicNoteApprovalEngine.beforeDelete, afterDelete).
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const onDelete: OnDelete<Model> = await super.onBeforeDelete(deleteBy);

    return {
      deleteBy: onDelete.deleteBy,
      carryForward: {
        publicNoteApproval: await PublicNoteApprovalEngine.beforeDelete({
          host: this.getApprovalKind(),
          deleteBy: onDelete.deleteBy,
        }),
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    PublicNoteApprovalEngine.afterDelete({
      delete: (
        onDelete.carryForward as {
          publicNoteApproval?: PublicNoteApprovalDelete;
        } | null
      )?.publicNoteApproval,
      deletedIds: deletedIds,
    });

    return onDelete;
  }

  @CaptureSpan()
  public override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * An edit that now waits for approval - or a waiting edit dropped -
     * says so on the episode's feed alone: an edit is posted to the chat
     * channels once it is published.
     */
    if (
      await PublicNoteApprovalEngine.afterUpdate({
        host: this.getApprovalHost(),
        update: (
          onUpdate.carryForward as {
            publicNoteApproval?: PublicNoteApprovalUpdate;
          } | null
        )?.publicNoteApproval,
        updatedNoteIds: updatedItemIds,
        props: onUpdate.updateBy.props,
      })
    ) {
      return onUpdate;
    }

    if (onUpdate.updateBy.data.note) {
      await this.announceEdits({
        query: onUpdate.updateBy.query,
        userId: onUpdate.updateBy.props.userId,
        approvedByNames: [],
      });
    }

    return onUpdate;
  }

  /*
   * The entry an edit of a published public note gets, on its episode's
   * feed and in its chat channels: as it is made, or once it is approved.
   * A note that is not published gets none - nothing of it goes out.
   */
  private async announceEdits(data: {
    query: Query<Model>;
    userId?: ObjectID | null | undefined;
    approvedByNames: Array<string>;
  }): Promise<void> {
    const updatedItems: Array<Model> = await this.findBy({
      query: data.query,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        incidentEpisodeId: true,
        projectId: true,
        incidentEpisode: {
          _id: true,
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          projectId: true,
        },
        note: true,
        isPublished: true,
        createdByUserId: true,
        createdByUser: {
          _id: true,
        },
      },
    });

    const approvedBy: MarkdownText = PublicNoteApprovalFeed.approvedByLine(
      data.approvedByNames,
    );

    for (const updatedItem of updatedItems) {
      if (updatedItem.isPublished === false) {
        continue;
      }

      const episode: IncidentEpisode = updatedItem.incidentEpisode!;

      const attachmentsMarkdown: MarkdownText =
        await this.getAttachmentsMarkdown(
          updatedItem.id!,
          "/incident-episode-public-note/attachment",
        );

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: updatedItem.incidentEpisodeId!,
        projectId: updatedItem.projectId!,
        incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.PublicNote,
        displayColor: Blue500,
        userId: data.userId || undefined,
        feedInfoInMarkdown:
          mdText`📄 updated **Public Note** for this [Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(episode.projectId!, episode.id!)).toString()})

${FeedMarkdown.asMarkdown(updatedItem.note)}${attachmentsMarkdown}${approvedBy}
                  `.toString(),
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    }
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
