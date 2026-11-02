import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnFind, OnUpdate } from "../Types/Database/Hooks";
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
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import StateChangePublicNote from "../Utils/StatusPage/StateChangePublicNote";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import FeedApiKeyActorUtil from "../Utils/Feed/FeedApiKeyActor";
import SavedChatMessage from "../../Types/Workspace/SavedChatMessage";
import SavedChatMessageNote, {
  SavedChatMessageNoteKind,
} from "../Utils/Notes/SavedChatMessageNote";
import PrivateRecordPublicNoteRule from "../Utils/Notes/PrivateRecordPublicNoteRule";
import { PrivateRecordKind } from "../../Types/StatusPage/PrivateRecordPublicNotes";
import FindBy from "../Types/Database/FindBy";
import CountBy from "../Types/Database/CountBy";
import PositiveNumber from "../../Types/PositiveNumber";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The public notes of a private incident are read only by those who see the
   * incident: its owners - the people named on it and the members of the
   * teams named on it - and the project's owners and admins
   * (applyIncidentRelatedRecordPrivacyFilter), as every other part of one is
   * (PrivateRecordParts.test). Changing or deleting them follows
   * the private record rule (PrivateRecordPermission).
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(
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
   * create the note and their read of the incident, it is held to the
   * project's plan, and it is theirs - DatabaseService stamps them as its
   * creator.
   *
   * A message saved as a note keeps who wrote it, in which chat and when
   * (savedFromChatMessage, SavedChatMessageNote). It is published now, as any public note is.
   */
  @CaptureSpan()
  public async addNote(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    note: string;
    postedFromSlackMessageId?: string | undefined;
    savedFromChatMessage?: SavedChatMessage | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const publicNote: Model = new Model();
    publicNote.incidentId = data.incidentId;
    publicNote.projectId = data.projectId;
    publicNote.note = data.note;
    publicNote.postedAt = OneUptimeDate.getCurrentDate();

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
     * The incident the note is posted on, read once for the two things it
     * decides here. A private incident takes no new public notes: a public
     * note on it reached no status page and no subscriber, whatever its form
     * promised, so it is refused on every way one is made - the API,
     * workflows, the AI, Slack and Microsoft Teams, an SLA's reminders, a
     * state change (PrivateRecordPublicNoteRule). And a note that does not
     * say whether to notify subscribers follows the incident (below).
     */
    const incident: Incident | null = await this.getIncidentOfNote(
      createBy.data,
    );

    PrivateRecordPublicNoteRule.assertRecordTakesPublicNotes({
      kind: PrivateRecordKind.Incident,
      record: incident,
    });

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
      (createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ===
        undefined ||
        createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated ===
          null) &&
      incident
    ) {
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
        PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
          incident,
        );
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
   * The incident a note is posted on, with the two switches the note's
   * create reads: whether it is private, and whether it notified
   * subscribers when it was declared. Null when the note names no incident
   * or it cannot be found: nothing is refused, and the column default
   * decides whether the note notifies. Read as root - the create has made
   * sure its caller may read the incident (DatabaseService
   * checkCreateParents) - and only these two switches.
   */
  private async getIncidentOfNote(note: Model): Promise<Incident | null> {
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

    return await IncidentService.findOneBy({
      query: query,
      select: {
        isPrivate: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
      props: {
        isRoot: true,
      },
    });
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

    const attachmentsMarkdown: MarkdownText = await this.getAttachmentsMarkdown(
      createdItem.id!,
      "/incident-public-note/attachment",
    );

    const incidentLink: string = (
      await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)
    ).toString();

    /*
     * A message saved as a public note: its entry names who wrote it and
     * who saved it, and is not posted back into the channel the message is
     * in. Like any public note it is filed when it was published.
     */
    const saved: SavedChatMessage | null =
      SavedChatMessageNote.read(createdItem);

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.PublicNote,
      displayColor: Indigo500,
      userId: userId || undefined,
      apiKeyActor: FeedApiKeyActorUtil.fromProps(_onCreate.createBy.props),
      ...(saved ? { savedFromChatMessage: saved } : {}),
      feedInfoInMarkdown: saved
        ? SavedChatMessageNote.getFeedMarkdown({
            saved: saved,
            noteKind: SavedChatMessageNoteKind.Public,
            record: mdText`[Incident ${incidentNumberDisplay}](${incidentLink})`,
            savedByName: await SavedChatMessageNote.getSavedByName({
              saved: saved,
              userId: userId,
            }),
            note: SavedChatMessageNote.getNoteMarkdown({
              note: createdItem.note,
              attachments: attachmentsMarkdown,
            }),
          }).toString()
        : mdText`📄 posted **public note** for this [Incident ${incidentNumberDisplay}](${incidentLink}) on status page:

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

        const attachmentsMarkdown: MarkdownText =
          await this.getAttachmentsMarkdown(
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
          apiKeyActor: FeedApiKeyActorUtil.fromProps(onUpdate.updateBy.props),

          feedInfoInMarkdown:
            mdText`📄 updated **Public Note** for this [Incident ${incident.incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId!, incident.id!)).toString()})
        
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
