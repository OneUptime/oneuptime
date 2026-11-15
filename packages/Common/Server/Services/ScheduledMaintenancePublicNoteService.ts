import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import {
  DatabaseTriggerType,
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import ProjectReferencesService from "./ProjectReferencesService";
import OneUptimeDate from "../../Types/Date";
import Model from "../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import ObjectID from "../../Types/ObjectID";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500, Indigo500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../Types/StatusPage/SubscriberUpdateNotification";
import PublicNoteSubscriberNotificationDefault from "../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Query from "../Types/Database/Query";
import File from "../../Models/DatabaseModels/File";
import FileAttachmentMarkdownUtil from "../Utils/FileAttachmentMarkdownUtil";
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import StateChangePublicNote from "../Utils/StatusPage/StateChangePublicNote";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import SavedChatMessage from "../../Types/Workspace/SavedChatMessage";
import SavedChatMessageNote, {
  SavedChatMessageNoteKind,
} from "../Utils/Notes/SavedChatMessageNote";
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
   * (PublicNoteApprovalEngine): the event a note is on, by name and link,
   * its feed, and the entries a published note has always had.
   */
  /*
   * This kind of note, as the checks before a note is written read it
   * (onBeforeCreate, onBeforeUpdate): nothing in it writes.
   */
  public getApprovalKind(): PublicNoteApprovalKind<Model> {
    return {
      kind: PublicNoteKind.ScheduledMaintenance,
      eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
      modelType: Model,
      service: this,
      parentIdColumn: "scheduledMaintenanceId",
      recordNoun: "maintenance event",
    };
  }

  public getApprovalHost(): PublicNoteApprovalHost<Model> {
    return {
      ...this.getApprovalKind(),
      getRecord: async (data: {
        projectId: ObjectID;
        parentId: ObjectID;
      }): Promise<PublicNoteApprovalRecordInfo | null> => {
        const event: ScheduledMaintenance | null =
          await ScheduledMaintenanceService.findOneById({
            id: data.parentId,
            select: {
              title: true,
              scheduledMaintenanceNumber: true,
              scheduledMaintenanceNumberWithPrefix: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!event) {
          return null;
        }

        const url: string = (
          await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            data.projectId,
            data.parentId,
          )
        ).toString();

        return {
          label: `Scheduled Maintenance ${event.scheduledMaintenanceNumberWithPrefix || "#" + event.scheduledMaintenanceNumber}`,
          title: event.title || "",
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
        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: data.parentId,
            projectId: data.projectId,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.PublicNoteApproval,
            displayColor: data.color,
            userId: data.userId,
            feedInfoInMarkdown: data.markdown.toString(),
            workspaceNotification: {
              sendWorkspaceNotification: false,
            },
          },
        );
      },
      announcePublished: async (data: {
        noteId: ObjectID;
        approvedByNames: Array<string>;
      }): Promise<void> => {
        const note: Model | null = await this.findOneById({
          id: data.noteId,
          select: {
            _id: true,
            scheduledMaintenanceId: true,
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
        return { scheduledMaintenanceId: parentId };
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * The state the event moved to, when this is the note a state change
     * posts with it - what its subscriber messages name ("Status:
     * Ongoing"). Only that note carries one (StateChangePublicNote): any
     * other create, whatever it sent, has none.
     */
    RelationIdUtil.stamp(
      createBy.data as unknown as Record<string, unknown>,
      [
        "postedWithScheduledMaintenanceStateId",
        "postedWithScheduledMaintenanceState",
      ],
      StateChangePublicNote.getStatePostedWith(createBy.data),
    );

    // A time chosen as it was written stays when it is published after approval.
    const isPostedAtChosen: boolean = Boolean(createBy.data.postedAt);

    if (!createBy.data.postedAt) {
      createBy.data.postedAt = OneUptimeDate.getCurrentDate();
    }

    /*
     * A note that does not say whether to notify subscribers (Slack and
     * Teams notes, workflows, API calls that leave the field out) follows
     * its scheduled maintenance event, so one created without telling
     * subscribers stays quiet. An explicit true or false is kept as sent.
     */
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ===
        undefined ||
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated === null
    ) {
      const notifyByDefault: boolean | null =
        await this.getScheduledMaintenanceNotifyDefault(createBy.data);

      if (notifyByDefault !== null) {
        createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
          notifyByDefault;
      }
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnNoteCreated
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated === false
    ) {
      createBy.data.subscriberNotificationStatusOnNoteCreated =
        StatusPageSubscriberNotificationStatus.Skipped;
      createBy.data.subscriberNotificationStatusMessage =
        "Notifications skipped as subscribers are not to be notified for this scheduled maintenance note.";
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
   * Whether a note on this scheduled maintenance event notifies subscribers
   * when nobody said, or null when the event cannot be found (the column
   * default applies). Read as root: posting a note does not require
   * permission to read the event, and the answer is only this one flag.
   */
  private async getScheduledMaintenanceNotifyDefault(
    note: Model,
  ): Promise<boolean | null> {
    const scheduledMaintenanceId: ObjectID | null | undefined =
      note.scheduledMaintenanceId || note.scheduledMaintenance?.id;

    if (!scheduledMaintenanceId) {
      return null;
    }

    const query: Query<ScheduledMaintenance> = {
      _id: scheduledMaintenanceId.toString(),
    };

    if (note.projectId) {
      query.projectId = note.projectId;
    }

    const scheduledMaintenance: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneBy({
        query: query,
        select: {
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenance) {
      return null;
    }

    return PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
      scheduledMaintenance,
    );
  }

  /*
   * An edit tells subscribers nothing unless the editor asked for it on this
   * edit (see SubscriberUpdateNotification). When they did, queue the update
   * notification; the ScheduledMaintenancePublicNote worker job sends it.
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
     * Held for approval: the event's feed says it waits and its approvers
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
   * The entry a published public note gets, on its event's feed and in its
   * Slack and Microsoft Teams channels: as it is created, or - when the
   * project asks for approval - once it is approved, naming who approved it.
   */
  private async announceNote(data: {
    note: Model;
    approvedByNames: Array<string>;
  }): Promise<void> {
    const createdItem: Model = data.note;
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    const scheduledMaintenanceId: ObjectID =
      createdItem.scheduledMaintenanceId!;
    const projectId: ObjectID = createdItem.projectId!;
    const scheduledMaintenanceNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
      scheduledMaintenanceId: scheduledMaintenanceId,
    });

    const attachmentsMarkdown: MarkdownText = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/scheduled-maintenance-public-note/attachment",
    );

    const scheduledMaintenanceNumberDisplay: string =
      scheduledMaintenanceNumberResult.numberWithPrefix ||
      "#" + scheduledMaintenanceNumberResult.number;
    const scheduledMaintenanceLink: string = (
      await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        projectId!,
        scheduledMaintenanceId!,
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

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.PublicNote,
      displayColor: Indigo500,
      userId: userId || undefined,
      ...(saved ? { savedFromChatMessage: saved } : {}),
      feedInfoInMarkdown: saved
        ? mdText`${SavedChatMessageNote.getFeedMarkdown({
            saved: saved,
            noteKind: SavedChatMessageNoteKind.Public,
            record: mdText`[Scheduled Maintenance ${scheduledMaintenanceNumberDisplay}](${scheduledMaintenanceLink})`,
            savedByName: await SavedChatMessageNote.getSavedByName({
              saved: saved,
              userId: userId,
            }),
            note: SavedChatMessageNote.getNoteMarkdown({
              note: createdItem.note,
              attachments: attachmentsMarkdown,
            }),
          })}${approvedBy}`.toString()
        : mdText`📄 posted **public note** for this [Scheduled Maintenance ${scheduledMaintenanceNumberDisplay}](${scheduledMaintenanceLink}) on status page:

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
     * says so on the event's feed alone: an edit is posted to the chat
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
   * The entry an edit of a published public note gets, on its event's feed
   * and in its chat channels: as it is made, or once it is approved. A note
   * that is not published gets none - nothing of it goes out.
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
        scheduledMaintenanceId: true,
        scheduledMaintenance: {
          _id: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
          projectId: true,
        },
        projectId: true,
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

      const scheduledMaintenance: ScheduledMaintenance =
        updatedItem.scheduledMaintenance!;

      const attachmentsMarkdown: MarkdownText =
        await this.getAttachmentsMarkdown(
          updatedItem.id!,
          "/scheduled-maintenance-public-note/attachment",
        );

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: updatedItem.scheduledMaintenanceId!,
        projectId: updatedItem.projectId!,
        // An edit to a public note is a public note event, not a private one.
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.PublicNote,
        displayColor: Blue500,
        userId: data.userId || undefined,

        feedInfoInMarkdown:
          mdText`📄 updated **Public Note** for this [Scheduled Maintenance ${scheduledMaintenance.scheduledMaintenanceNumberWithPrefix || "#" + scheduledMaintenance.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(scheduledMaintenance.projectId!, scheduledMaintenance.id!)).toString()})
        
${FeedMarkdown.asMarkdown(updatedItem.note)}${attachmentsMarkdown}${approvedBy}
                  `.toString(),
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });
    }
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
   * (savedFromChatMessage, SavedChatMessageNote). It is published now, as
   * any public note is - or, when the project asks for public notes to be
   * approved, once it is approved, and posted then (it names no time of
   * its own, so onBeforeCreate's "now" is the time it is published at).
   */
  @CaptureSpan()
  public async addNote(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
    note: string;
    postedFromSlackMessageId?: string | undefined;
    savedFromChatMessage?: SavedChatMessage | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const publicNote: Model = new Model();
    publicNote.scheduledMaintenanceId = data.scheduledMaintenanceId;
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
