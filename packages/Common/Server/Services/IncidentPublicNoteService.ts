import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import OneUptimeDate from "../../Types/Date";
import Model from "../../Models/DatabaseModels/IncidentPublicNote";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500, Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import IncidentService from "./IncidentService";
import Incident from "../../Models/DatabaseModels/Incident";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../Types/StatusPage/SubscriberUpdateNotification";
import PublicNoteSubscriberNotificationDefault from "../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Query from "../Types/Database/Query";
import File from "../../Models/DatabaseModels/File";
import FileAttachmentMarkdownUtil from "../Utils/FileAttachmentMarkdownUtil";
import { syncIsPublicForMarkdownImages } from "../Utils/InlineImageAccessTokenSync";
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import StateChangePublicNote from "../Utils/StatusPage/StateChangePublicNote";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async addNote(data: {
    userId: ObjectID;
    incidentId: ObjectID;
    projectId: ObjectID;
    note: string;
    attachmentFileIds?: Array<ObjectID>;
    postedFromSlackMessageId?: string;
  }): Promise<Model> {
    const publicNote: Model = new Model();
    publicNote.createdByUserId = data.userId;
    publicNote.incidentId = data.incidentId;
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
    incidentId: ObjectID;
    postedFromSlackMessageId: string;
  }): Promise<boolean> {
    const existingNote: Model | null = await this.findOneBy({
      query: {
        incidentId: data.incidentId,
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
     * The state the incident moved to, when this is the note a state change
     * posts with it - what its subscriber messages name ("Status:
     * Resolved"). Only that note carries one (StateChangePublicNote): any
     * other create, whatever it sent, has none.
     */
    RelationIdUtil.stamp(
      createBy.data as unknown as Record<string, unknown>,
      ["postedWithIncidentStateId", "postedWithIncidentState"],
      StateChangePublicNote.getStatePostedWith(createBy.data),
    );

    if (!createBy.data.postedAt) {
      createBy.data.postedAt = OneUptimeDate.getCurrentDate();
    }

    /*
     * A note that does not say whether to notify subscribers (Slack and
     * Teams notes, workflows, API calls that leave the field out) follows
     * its incident, so one declared without telling subscribers stays quiet.
     * An explicit true or false is kept as sent.
     */
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ===
        undefined ||
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated === null
    ) {
      const notifyByDefault: boolean | null =
        await this.getIncidentNotifyDefault(createBy.data);

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
        "Notifications skipped as subscribers are not to be notified for this incident note.";
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
   * Whether a note on this incident notifies subscribers when nobody said,
   * or null when the incident cannot be found (the column default applies).
   * Read as root: posting a note does not require permission to read the
   * incident, and the answer is only this one flag.
   */
  private async getIncidentNotifyDefault(note: Model): Promise<boolean | null> {
    const incidentId: ObjectID | null | undefined =
      note.incidentId || note.incident?.id;

    if (!incidentId) {
      return null;
    }

    const query: Query<Incident> = {
      _id: incidentId.toString(),
    };

    if (note.projectId) {
      query.projectId = note.projectId;
    }

    const incident: Incident | null = await IncidentService.findOneBy({
      query: query,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return null;
    }

    return PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
      incident,
    );
  }

  /*
   * An edit tells subscribers nothing unless the editor asked for it on this
   * edit (see SubscriberUpdateNotification). When they did, queue the update
   * notification; the IncidentPublicNote worker job sends it.
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

    await SubscriberNotificationResendAccess.assertPublicNoteResendAllowed({
      modelType: Model,
      service: this,
      updateBy: updateBy,
    });

    if (SubscriberUpdateNotification.isRequested(updateBy.miscDataProps)) {
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
      `incident public note ${createdItem.id?.toString()}`,
      createdItem.projectId,
    );

    const incidentId: ObjectID = createdItem.incidentId!;
    const projectId: ObjectID = createdItem.projectId!;
    const incidentNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await IncidentService.getIncidentNumber({
      incidentId: incidentId,
    });
    const incidentNumberDisplay: string =
      incidentNumberResult.numberWithPrefix ||
      "#" + incidentNumberResult.number;

    const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/incident-public-note/attachment",
    );

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.PublicNote,
      displayColor: Indigo500,
      userId: userId || undefined,
      feedInfoInMarkdown: `📄 posted **public note** for this [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()}) on status page:

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
          incidentId: true,
          projectId: true,
          incident: {
            _id: true,
            incidentNumber: true,
            projectId: true,
          },
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
        const incident: Incident = updatedItem.incident!;

        await syncIsPublicForMarkdownImages(
          updatedItem.note,
          true,
          `incident public note ${updatedItem.id?.toString()}`,
          updatedItem.projectId,
        );

        const attachmentsMarkdown: string = await this.getAttachmentsMarkdown(
          updatedItem.id!,
          "/incident-public-note/attachment",
        );

        await IncidentFeedService.createIncidentFeedItem({
          incidentId: updatedItem.incidentId!,
          projectId: updatedItem.projectId!,
          // An edit to a public note is a public note event, not a private one.
          incidentFeedEventType: IncidentFeedEventType.PublicNote,
          displayColor: Blue500,
          userId: userId || undefined,

          feedInfoInMarkdown: `📄 updated **Public Note** for this [Incident ${incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()})
        
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
