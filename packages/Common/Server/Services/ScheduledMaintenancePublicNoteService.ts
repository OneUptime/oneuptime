import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
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
import { syncIsPublicForMarkdownImages } from "../Utils/InlineImageAccessTokenSync";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
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
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (SubscriberUpdateNotification.isRequested(updateBy.miscDataProps)) {
      updateBy.data.subscriberNotificationStatusOnNoteUpdated =
        StatusPageSubscriberNotificationStatus.Pending;
      updateBy.data.subscriberNotificationStatusMessageOnNoteUpdated =
        SubscriberUpdateNotification.queuedMessage;
    }

    return {
      updateBy: updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    /*
     * A public note is always rendered on the status page, so any inline
     * image the markdown editor uploaded as private must flip to public
     * for anonymous status page viewers to be able to render it.
     */
    await syncIsPublicForMarkdownImages(
      createdItem.note,
      true,
      `scheduled maintenance public note ${createdItem.id?.toString()}`,
    );

    const scheduledMaintenanceId: ObjectID =
      createdItem.scheduledMaintenanceId!;
    const projectId: ObjectID = createdItem.projectId!;
    const scheduledMaintenanceNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
      scheduledMaintenanceId: scheduledMaintenanceId,
    });

    const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/scheduled-maintenance-public-note/attachment",
    );

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.PublicNote,
      displayColor: Indigo500,
      userId: userId || undefined,
      feedInfoInMarkdown: `📄 posted **public note** for this [Scheduled Maintenance ${scheduledMaintenanceNumberResult.numberWithPrefix || "#" + scheduledMaintenanceNumberResult.number}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId!, scheduledMaintenanceId!)).toString()}) on status page:
    
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
          scheduledMaintenanceId: true,
          scheduledMaintenance: {
            _id: true,
            scheduledMaintenanceNumber: true,
            scheduledMaintenanceNumberWithPrefix: true,
            projectId: true,
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
        const scheduledMaintenance: ScheduledMaintenance =
          updatedItem.scheduledMaintenance!;

        await syncIsPublicForMarkdownImages(
          updatedItem.note,
          true,
          `scheduled maintenance public note ${updatedItem.id?.toString()}`,
        );

        const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
          updatedItem.id!,
          "/scheduled-maintenance-public-note/attachment",
        );

        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: updatedItem.scheduledMaintenanceId!,
            projectId: updatedItem.projectId!,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.PrivateNote,
            displayColor: Blue500,
            userId: userId || undefined,

            feedInfoInMarkdown: `📄 updated **Public Note** for this [Scheduled Maintenance ${scheduledMaintenance.scheduledMaintenanceNumberWithPrefix || "#" + scheduledMaintenance.scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(scheduledMaintenance.projectId!, scheduledMaintenance.id!)).toString()})
        
${(updatedItem.note || "") + attachmentsMarkdown}
                  `,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: userId || undefined,
            },
          },
        );
      }
    }
    return onUpdate;
  }

  @CaptureSpan()
  public async addNote(data: {
    userId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID;
    note: string;
    attachmentFileIds?: Array<ObjectID>;
    postedFromSlackMessageId?: string;
  }): Promise<Model> {
    const publicNote: Model = new Model();
    publicNote.createdByUserId = data.userId;
    publicNote.scheduledMaintenanceId = data.scheduledMaintenanceId;
    publicNote.projectId = data.projectId;
    publicNote.note = data.note;
    publicNote.postedAt = OneUptimeDate.getCurrentDate();

    if (data.postedFromSlackMessageId) {
      publicNote.postedFromSlackMessageId = data.postedFromSlackMessageId;
    }

    if (data.attachmentFileIds && data.attachmentFileIds.length > 0) {
      publicNote.attachments = data.attachmentFileIds.map(
        (fileId: ObjectID) => {
          const file: File = new File();
          file.id = fileId;
          return file;
        },
      );
    }

    return this.create({
      data: publicNote,
      props: {
        isRoot: true,
      },
    });
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
