import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import Team from "../../../Models/DatabaseModels/Team";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FeedApiKeyActorUtil, { FeedApiKeyActor } from "../Feed/FeedApiKeyActor";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteApproval, {
  PublicNoteApprovalColumns,
  PublicNoteApprovalDecision,
  PublicNoteApprovalEventType,
  PublicNoteApprovalGiven,
  PublicNoteApprovalMessages,
  PublicNoteApprovalPosition,
  PublicNoteApprovalRound,
  PublicNoteApprovalState,
  PublicNoteApprovalStepRule,
} from "../../../Types/StatusPage/PublicNoteApproval";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import DatabaseService from "../../Services/DatabaseService";
import TeamService from "../../Services/TeamService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../Types/Database/CreateBy";
import DeleteBy from "../../Types/Database/DeleteBy";
import PartialEntity from "../../../Types/Database/PartialEntity";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import UpdateBy from "../../Types/Database/UpdateBy";
import type WorkspacePublicNoteApprovalMessage from "../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import PublicNoteApprovalFeed, {
  PublicNoteApprovalFeedRecord,
  PublicNoteApprovalWaitingFor,
} from "./PublicNoteApprovalFeed";
import PublicNoteApprovalNotifications, {
  PublicNoteApprovalChatAsk,
  PublicNoteApprovalMessageFacts,
} from "./PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "./PublicNoteApprovalPolicy";
import PublicNoteApprovalRequests, {
  PublicNoteApprovalRequestKey,
} from "./PublicNoteApprovalRequests";
import PublicNoteApprovalWrites, {
  PUBLIC_NOTE_APPROVAL_COLUMNS,
  PublicNoteApprovalWrite,
} from "./PublicNoteApprovalWrites";

/*
 * PUBLIC NOTE APPROVAL, AS THE SERVER DOES IT.
 *
 * Types/StatusPage/PublicNoteApproval says what approval is; this is where
 * it happens, for each kind of public note - an incident's, an episode's, a
 * scheduled maintenance event's. Each note service hands its hooks here,
 * with what only it knows (PublicNoteApprovalHost): its record's name and
 * link, and how its feed is written.
 *
 *  - A note is created held for approval when its project asks for it
 *    (holdOnCreate). Held, it has none of what a published note does: no
 *    status page shows it (every public read asks for isPublished), no
 *    subscriber is told (their jobs send published notes only), no owner is
 *    told it was posted, no chat channel gets it, no workflow starts with
 *    it (onTriggerWorkflow, below), and its images stay private
 *    (PublishedImages shows a note's images only while it is published).
 *    Its record's feed says it waits, and the first step's approvers are
 *    asked.
 *  - An edit of a held note sends it for approval again; an edit of a
 *    published note waits in pendingNote while its project asks for
 *    approval (beforeUpdate). What such an edit writes is worked out from
 *    the note as it was read, so it is written only while the note is
 *    still at that version: a decision written in between is never
 *    overwritten by it (holdToVersionRead).
 *  - A decision (decide) is the only thing that publishes a note: the last
 *    step's approval. It is written in one update that holds only while the
 *    note is at the version the decision read, so two people deciding at
 *    once decide once, and what follows a decision - the feed, the chat
 *    channels, the workflows, the people told - happens once, for the one
 *    who won.
 */

export enum PublicNoteKind {
  Incident = "Incident",
  IncidentEpisode = "IncidentEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

// The record a note is on, as messages name it.
export interface PublicNoteApprovalRecordInfo {
  // "Incident INC-42"
  label: string;
  title: string;
  // The record in the Dashboard, and its public notes there.
  url: string;
  notesUrl: string;
}

/*
 * A kind of note, as the checks made before a note is written read it
 * (holdOnCreate, beforeUpdate): what it is and where it is stored -
 * nothing that writes, so a write refused or failed leaves nothing behind.
 */
export interface PublicNoteApprovalKind<TNote extends BaseModel> {
  kind: PublicNoteKind;
  eventType: PublicNoteApprovalEventType;
  modelType: { new (): TNote };
  service: DatabaseService<TNote>;
  // The note's column naming its record: incidentId, incidentEpisodeId...
  parentIdColumn: string;
  // "incident", "episode", "maintenance event"
  recordNoun: string;
}

/*
 * What each kind of note's service hands the engine once a note is written,
 * or decided: its kind, and how its record is named, told and announced.
 */
export interface PublicNoteApprovalHost<TNote extends BaseModel>
  extends PublicNoteApprovalKind<TNote> {
  getRecord: (data: {
    projectId: ObjectID;
    parentId: ObjectID;
  }) => Promise<PublicNoteApprovalRecordInfo | null>;
  /*
   * An entry on the record's feed, never posted to a chat channel - by the
   * API key the request was made with, when it was (a feed that names keys).
   */
  addFeedItem: (data: {
    projectId: ObjectID;
    parentId: ObjectID;
    markdown: MarkdownText;
    userId?: ObjectID | undefined;
    apiKeyActor?: FeedApiKeyActor | undefined;
    color: Color;
  }) => Promise<void>;
  /*
   * The entry a published note always gets - on the record's feed and its
   * chat channels - now that it is published, ending with who approved it.
   */
  announcePublished: (data: {
    noteId: ObjectID;
    approvedByNames: Array<string>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<void>;
  // The same for an edit now on status pages.
  announceEditPublished: (data: {
    noteId: ObjectID;
    editorUserId?: ObjectID | undefined;
    approvedByNames: Array<string>;
  }) => Promise<void>;
  // The ids a person's webhook names the record by.
  getMessageIds: (parentId: ObjectID) => {
    incidentId?: ObjectID | undefined;
    incidentEpisodeId?: ObjectID | undefined;
    scheduledMaintenanceId?: ObjectID | undefined;
  };
}

// A note's columns, as every kind of note names them.
interface NoteFields {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  projectId?: ObjectID | undefined;
  note?: string | undefined;
  pendingNote?: string | null | undefined;
  isPublished?: boolean | undefined;
  approvalStatus?: string | null | undefined;
  approval?: JSONObject | null | undefined;
  createdByUserId?: ObjectID | undefined;
  attachments?: Array<File> | undefined;
  version?: number | undefined;
}

/*
 * What onBeforeUpdate hands onUpdateSuccess (carryForward.publicNoteApproval).
 * Every note named here was held to the version it was read at
 * (holdToVersionRead): one the update did not write was changed meanwhile.
 */
export interface PublicNoteApprovalUpdate {
  // Published notes whose edit now waits for approval.
  heldEditNoteIds: Array<string>;
  // Notes not published yet, edited and sent for approval again.
  resentNoteIds: Array<string>;
  // Published notes whose waiting edit was dropped by an edit back to the published text.
  droppedEditNoteIds: Array<string>;
  /*
   * Published notes whose waiting edit gave way to an edit that applies as
   * it is: their project no longer asks for approval. The edit is announced
   * as any edit is; only the waiting one's chat messages are replaced.
   */
  withdrawnEditNoteIds?: Array<string> | undefined;
  // The project of the one note an edit approval governs.
  projectId?: string | undefined;
  /*
   * The edit tells subscribers nothing now: the note is not published, or
   * its edit waits (its notification is queued when it is approved).
   */
  isUpdateNotificationHeld: boolean;
}

/*
 * What onBeforeDelete hands onDeleteSuccess: the chat copies of the approval
 * messages of the notes the delete removes, read before the database
 * deletes them with the notes (ON DELETE CASCADE).
 */
export interface PublicNoteApprovalDelete {
  chatMessages: Array<WorkspacePublicNoteApprovalMessage>;
}

// What a decision, a resubmission or a withdrawal leaves the note as.
export interface PublicNoteApprovalOutcome {
  noteId: string;
  state: PublicNoteApprovalState;
  isPublished: boolean;
}

// What the Dashboard is told about a note's approval.
export interface PublicNoteApprovalNoteSummary {
  noteId: string;
  state: PublicNoteApprovalState;
  isEdit: boolean;
  submittedAt?: string | undefined;
  submittedBy?: string | undefined;
  // The step the note waits for, while it waits.
  step?: PublicNoteApprovalStepSummary | undefined;
  approvals: Array<{
    by: string;
    at: string;
    stepName?: string | undefined;
    comment?: string | undefined;
  }>;
  rejection?:
    | { by: string; at: string; reason: string; stepName?: string | undefined }
    | undefined;
  canApprove: boolean;
  canReject: boolean;
  // Why the person reading may not decide, when they may not.
  decisionRefusal?: string | undefined;
}

export interface PublicNoteApprovalStepSummary {
  number: number;
  count: number;
  name?: string | undefined;
  isFinal: boolean;
  isAskedAgain: boolean;
  people: Array<string>;
  teams: Array<string>;
}

// What the Dashboard is told about who approves a kind of note.
export interface PublicNoteApprovalPolicySummary {
  isRequired: boolean;
  steps: Array<{
    id: string;
    number: number;
    name?: string | undefined;
    people: Array<string>;
    teams: Array<string>;
  }>;
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const WRITE_AS_ONEUPTIME: DatabaseCommonInteractionProps = {
  isRoot: true,
  ignoreHooks: true,
};

export default class PublicNoteApprovalEngine {
  // ---------- creating a note ----------

  /*
   * A note being created (onBeforeCreate, after the note's own checks):
   * held for approval when its project asks for it, published otherwise.
   * Every approval column is set here, so nothing a caller sent stands.
   * `keepPostedAt`: the note's time was chosen as it was written, before
   * the service filled in "now".
   */
  @CaptureSpan()
  public static async holdOnCreate<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalKind<TNote>;
    createBy: CreateBy<TNote>;
    keepPostedAt: boolean;
  }): Promise<boolean> {
    const note: NoteFields = data.createBy.data as unknown as NoteFields;
    const projectId: ObjectID | undefined =
      note.projectId || data.createBy.props.tenantId;

    const isRequired: boolean = projectId
      ? await PublicNoteApprovalPolicy.isRequired({
          projectId,
          eventType: data.host.eventType,
        })
      : false;

    this.assign(
      data.createBy.data,
      PublicNoteApprovalWrites.forCreate({
        isRequired,
        now: OneUptimeDate.getCurrentDate(),
        submittedByUserId: data.createBy.props.userId?.toString(),
        keepPostedAt: data.keepPostedAt,
      }),
    );

    return isRequired;
  }

  /*
   * A note just created (onCreateSuccess): when it is held, its record's
   * feed says it waits and the first step's approvers are asked, and the
   * caller posts nothing more. False for a published note, which the caller
   * announces as it always has.
   */
  @CaptureSpan()
  public static async afterCreate<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: TNote;
    // The create's: whose request it was, for the feed to name.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<boolean> {
    const created: NoteFields = data.note as unknown as NoteFields;

    if (created.isPublished !== false) {
      return false;
    }

    const noteId: string | null = this.idOf(data.note);

    if (!noteId) {
      return true;
    }

    try {
      await this.announceWaiting({
        host: data.host,
        noteId: new ObjectID(noteId),
        isAgain: false,
        props: data.props,
      });
    } catch (error) {
      logger.error("Public note approval: could not record a held note.");
      logger.error(error);
    }

    return true;
  }

  // ---------- editing a note ----------

  /*
   * An update of notes (onBeforeUpdate, after the note's own checks):
   *
   *  - nobody writes the approval columns: OneUptime does, here and in
   *    decide;
   *  - a note that is not published tells subscribers nothing: no
   *    notification of it is sent again, and an edit of it is no update
   *    they hear about;
   *  - an edit of a note that is not published - its text or its files -
   *    sends it for approval again, from the first step;
   *  - an edit of a published note's text, while its project asks for
   *    approval, waits in pendingNote and the note keeps showing as it was
   *    approved; its files cannot change then (a file cannot wait); an
   *    edit back to the published text drops a waiting one;
   *  - while the project no longer asks, an edit of a published note
   *    applies as it always has, and a waiting edit it replaces is dropped.
   *
   * The notes are the very rows the update writes, and the update is held
   * to them (readNotesOfUpdate). An edit whose approval is worked out here
   * is also held to the version of the note it was worked out from
   * (holdToVersionRead).
   */
  @CaptureSpan()
  public static async beforeUpdate<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalKind<TNote>;
    updateBy: UpdateBy<TNote>;
  }): Promise<PublicNoteApprovalUpdate> {
    const result: PublicNoteApprovalUpdate = {
      heldEditNoteIds: [],
      resentNoteIds: [],
      droppedEditNoteIds: [],
      isUpdateNotificationHeld: false,
    };

    const written: Record<string, unknown> = data.updateBy.data as Record<
      string,
      unknown
    >;

    for (const column of PUBLIC_NOTE_APPROVAL_COLUMNS) {
      if (written[column] !== undefined) {
        throw new BadDataException(
          PublicNoteApprovalMessages.writtenByOneUptime(column),
        );
      }
    }

    const writesText: boolean = written["note"] !== undefined;
    const writesFiles: boolean = written["attachments"] !== undefined;
    const asksUpdateNotification: boolean =
      SubscriberUpdateNotification.isRequested(data.updateBy.miscDataProps);

    /*
     * Nothing approval governs: the note's notifications sent again are
     * held to it where they are checked (SubscriberNotificationResendAccess:
     * a note that is not published has told nobody yet).
     */
    if (!writesText && !writesFiles && !asksUpdateNotification) {
      return result;
    }

    const notes: Array<NoteFields> = (await this.readNotesOfUpdate({
      host: data.host,
      updateBy: data.updateBy,
    })) as unknown as Array<NoteFields>;

    if (notes.length === 0) {
      return result;
    }

    const isAnyUnpublished: boolean = notes.some((note: NoteFields) => {
      return note.isPublished === false;
    });

    // An edit of no text or files: told only about a published note.
    if (!writesText && !writesFiles) {
      result.isUpdateNotificationHeld = isAnyUnpublished;
      return result;
    }

    /*
     * An edit of a note that approval governs names that one note: what it
     * becomes depends on where that note stands.
     */
    const isGoverned: boolean =
      isAnyUnpublished ||
      notes.some((note: NoteFields): boolean => {
        return (
          PublicNoteApproval.getState(note) !==
          PublicNoteApprovalState.Published
        );
      }) ||
      (await this.isRequiredForAnyOf(data.host, notes));

    if (!isGoverned) {
      return result;
    }

    if (notes.length > 1) {
      throw new BadDataException(PublicNoteApprovalMessages.oneNoteAtATime);
    }

    const note: NoteFields = notes[0]!;
    const noteId: string = this.idOf(note as unknown as BaseModel) || "";
    const state: PublicNoteApprovalState = PublicNoteApproval.getState(note);
    // Whose chat messages the edit replaces, when it ends a round (afterUpdate).
    const projectId: string | undefined = note.projectId?.toString();
    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );
    const now: Date = OneUptimeDate.getCurrentDate();
    const editorUserId: string | undefined =
      data.updateBy.props.userId?.toString();

    const isTextChanged: boolean = PublicNoteApprovalWrites.isChangedText(
      written["note"],
      note.note,
    );
    const isFilesChanged: boolean = PublicNoteApprovalWrites.isChangedFiles(
      written["attachments"],
      this.fileIdsOf(note),
    );

    // Not published yet: written as sent, and sent for approval again.
    if (note.isPublished === false) {
      result.isUpdateNotificationHeld = true;

      if (isTextChanged || isFilesChanged) {
        this.assign(
          data.updateBy.data,
          PublicNoteApprovalWrites.forUnpublishedEdit({
            round,
            now,
            editorUserId,
          }),
        );
        this.holdToVersionRead(data.updateBy, note);
        result.resentNoteIds.push(noteId);
        result.projectId = projectId;
      }

      return result;
    }

    const isRequired: boolean = await this.isRequiredFor(data.host, note);

    // Published, and approval no longer asked for: the edit applies.
    if (!isRequired) {
      if (
        state === PublicNoteApprovalState.EditWaitingForApproval ||
        state === PublicNoteApprovalState.EditRejected
      ) {
        this.assign(
          data.updateBy.data,
          PublicNoteApprovalWrites.forDroppedEdit(round),
        );
        result.withdrawnEditNoteIds = [noteId];
        result.projectId = projectId;
      }

      return result;
    }

    // Published, approval asked for: its files cannot change now.
    if (isFilesChanged) {
      throw new BadDataException(
        PublicNoteApprovalMessages.attachmentsOfPublishedNote,
      );
    }

    if (!writesText) {
      return result;
    }

    const hasWaitingEdit: boolean =
      state === PublicNoteApprovalState.EditWaitingForApproval ||
      state === PublicNoteApprovalState.EditRejected;

    if (!isTextChanged) {
      // Back to the published text: a waiting edit is dropped.
      if (hasWaitingEdit) {
        this.assign(
          data.updateBy.data,
          PublicNoteApprovalWrites.forDroppedEdit(round),
        );
        this.holdToVersionRead(data.updateBy, note);
        result.droppedEditNoteIds.push(noteId);
        result.projectId = projectId;
        result.isUpdateNotificationHeld = true;
      }

      return result;
    }

    const pendingNote: string =
      typeof written["note"] === "string" ? (written["note"] as string) : "";

    delete written["note"];

    this.assign(
      data.updateBy.data,
      PublicNoteApprovalWrites.forHeldEdit({
        state,
        approvalStatus: note.approvalStatus,
        round,
        pendingNote,
        now,
        editorUserId,
        notifySubscribersOfEdit: asksUpdateNotification,
      }),
    );

    this.holdToVersionRead(data.updateBy, note);
    result.heldEditNoteIds.push(noteId);
    result.projectId = projectId;
    result.isUpdateNotificationHeld = true;

    return result;
  }

  /*
   * What an edit of a note writes to its approval - sent again, held in
   * pendingNote, a waiting edit dropped - is worked out from the note as
   * beforeUpdate read it, and the note can change before the edit is
   * written: the last step's approval publishes it, an approver rejects it,
   * another edit sends it again. So the edit is written only while the note
   * is still at the version it was read at: the update's query names that
   * version, and DatabaseService writes such a query as a compare-and-set,
   * in the UPDATE itself. A decision written in between stands, and the
   * edit writes nothing; afterUpdate tells its author to look again. Were
   * the edit written anyway, an edit of a waiting note would land on the
   * published note - on status pages unapproved, and read as an edit
   * waiting with no text, which approving would publish as an empty note.
   */
  private static holdToVersionRead<TNote extends BaseModel>(
    updateBy: UpdateBy<TNote>,
    note: NoteFields,
  ): void {
    if (typeof note.version !== "number") {
      throw new BadDataException(PublicNoteApprovalMessages.changedMeanwhile);
    }

    updateBy.query = {
      ...updateBy.query,
      version: note.version,
    } as Query<TNote>;
  }

  /*
   * What onBeforeUpdate hands onUpdateSuccess: the approval's part of the
   * edit, or nothing when approval left the edit alone.
   */
  public static getCarryForward(
    update: PublicNoteApprovalUpdate,
  ): { publicNoteApproval: PublicNoteApprovalUpdate } | null {
    if (
      update.heldEditNoteIds.length === 0 &&
      update.resentNoteIds.length === 0 &&
      update.droppedEditNoteIds.length === 0 &&
      (update.withdrawnEditNoteIds || []).length === 0
    ) {
      return null;
    }

    return { publicNoteApproval: update };
  }

  /*
   * After an update (onUpdateSuccess): an edit that now waits says so on
   * its record's feed and asks the first step's approvers; a waiting edit
   * dropped says that. True when the update was one of those, so the
   * caller posts nothing more - an edit is announced, to the feed and the
   * chat channels, only once it is approved.
   *
   * An edit held to a note's version (holdToVersionRead) that did not
   * write it found the note changed meanwhile: nothing of it was saved, so
   * nothing is announced, and its author is told to look again - rather
   * than told the edit was saved, or that they may not edit the note.
   */
  @CaptureSpan()
  public static async afterUpdate<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    update: PublicNoteApprovalUpdate | null | undefined;
    // The notes the update wrote (onUpdateSuccess's updatedItemIds).
    updatedNoteIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (!data.update) {
      return false;
    }

    const written: Set<string> = new Set<string>(
      data.updatedNoteIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    const heldNoteIds: Array<string> = [
      ...data.update.heldEditNoteIds,
      ...data.update.resentNoteIds,
      ...data.update.droppedEditNoteIds,
    ];

    if (
      heldNoteIds.some((noteId: string): boolean => {
        return !written.has(noteId.toLowerCase());
      })
    ) {
      throw new BadDataException(PublicNoteApprovalMessages.changedMeanwhile);
    }

    const handled: boolean = heldNoteIds.length > 0;

    /*
     * The edit ended the round each of these notes' approval messages asked
     * about - sent it again, or dropped the edit that waited: the chat
     * copies say so instead, in the background.
     */
    this.replaceChatMessagesOf({
      host: data.host,
      projectId: data.update.projectId,
      noteIds: [
        ...heldNoteIds,
        ...(data.update.withdrawnEditNoteIds || []).filter(
          (noteId: string): boolean => {
            return written.has(noteId.toLowerCase());
          },
        ),
      ],
    });

    try {
      for (const noteId of [
        ...data.update.heldEditNoteIds,
        ...data.update.resentNoteIds,
      ]) {
        await this.announceWaiting({
          host: data.host,
          noteId: new ObjectID(noteId),
          isAgain: data.update.resentNoteIds.includes(noteId),
          props: data.props,
        });
      }

      for (const noteId of data.update.droppedEditNoteIds) {
        const note: NoteFields | null = await this.readNote(
          data.host,
          new ObjectID(noteId),
        );

        if (!note) {
          continue;
        }

        await this.addFeedItem({
          host: data.host,
          note,
          markdown: (record: PublicNoteApprovalFeedRecord): MarkdownText => {
            return PublicNoteApprovalFeed.editWithdrawn({ record });
          },
          userId: data.props.userId,
          props: data.props,
          color: Gray500,
        });
      }
    } catch (error) {
      logger.error("Public note approval: could not record an edit.");
      logger.error(error);
    }

    return handled;
  }

  // The chat copies of these notes' approval messages, replaced in the background.
  private static replaceChatMessagesOf<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalKind<TNote>;
    projectId: string | undefined;
    noteIds: Array<string>;
  }): void {
    if (!data.projectId) {
      return;
    }

    for (const noteId of new Set<string>(data.noteIds)) {
      PublicNoteApprovalNotifications.replaceChatMessages({
        kind: data.host.kind,
        projectId: new ObjectID(data.projectId),
        noteId: new ObjectID(noteId),
      });
    }
  }

  /*
   * The notes an update writes, as they are, for beforeUpdate - and the
   * update held to them (DatabaseService.findRowsAndHoldUpdateToThem): the
   * rows the caller may write, in the update's own window, every one of
   * them. So the notes approval judges are the notes written: none the
   * caller may not write, none outside the window, and none left unread -
   * an update of three notes is judged by all three, not by two of them.
   */
  @CaptureSpan()
  public static async readNotesOfUpdate<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalKind<TNote>;
    updateBy: UpdateBy<TNote>;
  }): Promise<Array<TNote>> {
    return await data.host.service.findRowsAndHoldUpdateToThem(
      data.updateBy,
      this.noteSelect(data.host),
    );
  }

  // ---------- deleting a note ----------

  /*
   * A delete of notes (onBeforeDelete): the notes it removes - the delete
   * held to them (DatabaseService.findRowsAndHoldDeleteToThem) - and the
   * chat copies of their approval messages, which the database deletes with
   * them. afterDelete replaces those copies once the delete is done: "this
   * public note was deleted", with no Approve or Reject left on them.
   */
  @CaptureSpan()
  public static async beforeDelete<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalKind<TNote>;
    deleteBy: DeleteBy<TNote>;
  }): Promise<PublicNoteApprovalDelete> {
    const notes: Array<NoteFields> =
      (await data.host.service.findRowsAndHoldDeleteToThem(data.deleteBy, {
        _id: true,
        projectId: true,
      } as Select<TNote>)) as unknown as Array<NoteFields>;

    // Best effort: a delete never fails for its notes' chat copies.
    try {
      return {
        chatMessages:
          await PublicNoteApprovalNotifications.getChatMessages().readForNotes({
            kind: data.host.kind,
            notes: notes.map((note: NoteFields) => {
              const id: string | null = this.idOf(note as unknown as BaseModel);

              return {
                id: id ? new ObjectID(id) : null,
                projectId: note.projectId,
              };
            }),
          }),
      };
    } catch (error) {
      logger.error(
        "Public note approval: could not read the chat messages of public notes being deleted.",
      );
      logger.error(error);
      return { chatMessages: [] };
    }
  }

  /*
   * After a delete of notes (onDeleteSuccess): the copies beforeDelete read,
   * of the notes the delete removed, replaced in the background.
   */
  public static afterDelete(data: {
    delete: PublicNoteApprovalDelete | null | undefined;
    deletedIds: Array<ObjectID>;
  }): void {
    if (!data.delete || data.delete.chatMessages.length === 0) {
      return;
    }

    try {
      PublicNoteApprovalNotifications.getChatMessages().replaceDeleted({
        kept: data.delete.chatMessages,
        deletedIds: data.deletedIds,
        by: "note",
      });
    } catch (error) {
      logger.error(
        "Public note approval: could not replace the chat messages of deleted public notes.",
      );
      logger.error(error);
    }
  }

  /*
   * A delete of records - incidents, episodes, scheduled maintenance events
   * - takes their public notes (of `kind`) with it, and with them the chat
   * copies of the notes' approval messages: read here, before the delete
   * (the record service's onBeforeDelete, with the records it removes), and
   * replaced once it is done (afterRecordsDelete). Best effort: a delete
   * never fails for them.
   */
  @CaptureSpan()
  public static async beforeRecordsDelete(data: {
    kind: PublicNoteKind;
    records: Array<{
      id?: ObjectID | null | undefined;
      projectId?: ObjectID | undefined;
    }>;
  }): Promise<PublicNoteApprovalDelete> {
    try {
      return {
        chatMessages:
          await PublicNoteApprovalNotifications.getChatMessages().readForRecords(
            {
              kind: data.kind,
              records: data.records,
            },
          ),
      };
    } catch (error) {
      logger.error(
        "Public note approval: could not read the chat messages of the public notes of records being deleted.",
      );
      logger.error(error);
      return { chatMessages: [] };
    }
  }

  /*
   * After a delete of records (onDeleteSuccess): the copies
   * beforeRecordsDelete read, of the records the delete removed, replaced
   * in the background.
   */
  public static afterRecordsDelete(data: {
    delete: PublicNoteApprovalDelete | null | undefined;
    deletedIds: Array<ObjectID>;
  }): void {
    if (!data.delete || data.delete.chatMessages.length === 0) {
      return;
    }

    try {
      PublicNoteApprovalNotifications.getChatMessages().replaceDeleted({
        kept: data.delete.chatMessages,
        deletedIds: data.deletedIds,
        by: "record",
      });
    } catch (error) {
      logger.error(
        "Public note approval: could not replace the chat messages of the public notes of deleted records.",
      );
      logger.error(error);
    }
  }

  // ---------- deciding ----------

  /*
   * An approver approves or rejects a note (POST .../:noteId/approve and
   * .../reject). Only a signed-in person who can read the note, named on
   * the step it waits for - themselves, or through a team they are on now -
   * who did not send it, and who has not approved an earlier step of it
   * (PublicNoteApproval.getDecisionRefusal). A rejection says why.
   */
  @CaptureSpan()
  public static async decide<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
    decision: PublicNoteApprovalDecision;
    props: DatabaseCommonInteractionProps;
    text?: string | null | undefined;
  }): Promise<PublicNoteApprovalOutcome> {
    if (!data.props.userId) {
      throw new NotAuthorizedException(PublicNoteApprovalMessages.notAPerson);
    }

    const note: NoteFields = await this.readNoteAsReader(data);
    const projectId: ObjectID = note.projectId!;
    const state: PublicNoteApprovalState = PublicNoteApproval.getState(note);
    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );

    const steps: Array<PublicNoteApprovalStepRule> =
      await PublicNoteApprovalPolicy.getSteps({
        projectId,
        eventType: data.host.eventType,
      });

    const userTeamIds: Array<string> =
      await PublicNoteApprovalPolicy.getUserTeamIds({
        projectId,
        userId: data.props.userId,
      });

    const refusal: string | null = PublicNoteApproval.getDecisionRefusal({
      state,
      round,
      steps,
      userId: data.props.userId.toString(),
      userTeamIds,
      decision: data.decision,
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }

    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      round,
      steps,
    );
    const now: Date = OneUptimeDate.getCurrentDate();
    const userId: string = data.props.userId.toString();
    const isEdit: boolean = note.isPublished !== false;

    if (data.decision === PublicNoteApprovalDecision.Reject) {
      const reason: string = PublicNoteApproval.cleanText(data.text);

      if (!reason) {
        throw new BadDataException(PublicNoteApprovalMessages.reasonRequired);
      }

      const rejected: PublicNoteApprovalRound =
        PublicNoteApproval.recordRejection({
          round,
          step: position.step,
          userId,
          now,
          reason,
        });

      await this.writeOnce(
        data.host,
        note,
        PublicNoteApprovalWrites.forRejection(rejected),
      );

      await this.afterRejection({
        host: data.host,
        note,
        round: rejected,
        reason,
        isEdit,
        props: data.props,
      });

      return {
        noteId: data.noteId.toString(),
        state: isEdit
          ? PublicNoteApprovalState.EditRejected
          : PublicNoteApprovalState.Rejected,
        isPublished: isEdit,
      };
    }

    const approved: PublicNoteApprovalRound = PublicNoteApproval.recordApproval(
      {
        round,
        step: position.step!,
        userId,
        now,
        comment: data.text,
        isFinal: position.isFinal,
      },
    );

    if (!position.isFinal) {
      await this.writeOnce(
        data.host,
        note,
        PublicNoteApprovalWrites.forStepApproval(approved),
      );

      await this.afterStepApproval({
        host: data.host,
        note,
        round: approved,
        steps,
        approvedPosition: position,
        isEdit,
        props: data.props,
      });

      return {
        noteId: data.noteId.toString(),
        state,
        isPublished: isEdit,
      };
    }

    await this.writeOnce(
      data.host,
      note,
      PublicNoteApprovalWrites.forPublish({
        state,
        round: approved,
        roundAsSent: round,
        pendingNote: note.pendingNote,
        now,
      }),
    );

    await this.afterPublish({
      host: data.host,
      note,
      round: approved,
      isEdit,
      approverUserId: data.props.userId,
      props: data.props,
    });

    return {
      noteId: data.noteId.toString(),
      state: PublicNoteApprovalState.Published,
      isPublished: true,
    };
  }

  /*
   * A rejected note, or a rejected edit, sent for approval again as it is
   * (POST .../:noteId/resubmit), by someone who may edit it. Once its
   * project no longer asks for approval, a note that waits - or was
   * rejected - is published by this instead: approval is not asked for, so
   * the person who may post a note may publish it.
   */
  @CaptureSpan()
  public static async resubmit<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<PublicNoteApprovalOutcome> {
    const note: NoteFields = await this.readNoteAsEditor(data);
    const state: PublicNoteApprovalState = PublicNoteApproval.getState(note);
    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );
    const isEdit: boolean = note.isPublished !== false;

    if (state === PublicNoteApprovalState.Published) {
      throw new BadDataException(PublicNoteApprovalMessages.notWaiting);
    }

    const isRequired: boolean = await this.isRequiredFor(data.host, note);
    const now: Date = OneUptimeDate.getCurrentDate();

    if (!isRequired) {
      await this.writeOnce(
        data.host,
        note,
        PublicNoteApprovalWrites.forPublish({
          state,
          round: null,
          roundAsSent: round,
          pendingNote: note.pendingNote,
          now,
        }),
      );

      await this.addFeedItem({
        host: data.host,
        note,
        markdown: (record: PublicNoteApprovalFeedRecord): MarkdownText => {
          return PublicNoteApprovalFeed.publishedWithoutApproval({
            record,
            isEdit,
          });
        },
        userId: data.props.userId,
        props: data.props,
        color: Green500,
      });

      await this.announce({
        host: data.host,
        note,
        isEdit,
        editorUserId: round?.submittedByUserId,
        approvedByNames: [],
        props: data.props,
      });

      return {
        noteId: data.noteId.toString(),
        state: PublicNoteApprovalState.Published,
        isPublished: true,
      };
    }

    if (!PublicNoteApproval.isRejected(state)) {
      throw new BadDataException(PublicNoteApprovalMessages.stillWaiting);
    }

    await this.writeOnce(
      data.host,
      note,
      PublicNoteApprovalWrites.forResubmission({
        state,
        round,
        now,
        submittedByUserId: data.props.userId?.toString(),
      }),
    );

    await this.announceWaiting({
      host: data.host,
      noteId: data.noteId,
      isAgain: true,
      props: data.props,
    });

    return {
      noteId: data.noteId.toString(),
      state: isEdit
        ? PublicNoteApprovalState.EditWaitingForApproval
        : PublicNoteApprovalState.WaitingForApproval,
      isPublished: isEdit,
    };
  }

  /*
   * A waiting or rejected edit of a published note dropped (POST
   * .../:noteId/discard-edit) by someone who may edit the note: status
   * pages keep the note as it was approved.
   */
  @CaptureSpan()
  public static async discardEdit<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<PublicNoteApprovalOutcome> {
    const note: NoteFields = await this.readNoteAsEditor(data);
    const state: PublicNoteApprovalState = PublicNoteApproval.getState(note);

    if (
      state !== PublicNoteApprovalState.EditWaitingForApproval &&
      state !== PublicNoteApprovalState.EditRejected
    ) {
      throw new BadDataException(PublicNoteApprovalMessages.noEditWaiting);
    }

    await this.writeOnce(
      data.host,
      note,
      PublicNoteApprovalWrites.forDroppedEdit(
        PublicNoteApproval.readRound(note.approval),
      ),
    );

    await this.addFeedItem({
      host: data.host,
      note,
      markdown: (record: PublicNoteApprovalFeedRecord): MarkdownText => {
        return PublicNoteApprovalFeed.editWithdrawn({ record });
      },
      userId: data.props.userId,
      props: data.props,
      color: Gray500,
    });

    return {
      noteId: data.noteId.toString(),
      state: PublicNoteApprovalState.Published,
      isPublished: true,
    };
  }

  // ---------- when who approves changes ----------

  /*
   * A note, once who approves its kind of note changed while it may wait:
   * its project's approval steps, or the members of a team a step names
   * (PublicNoteApproverChanges). While it waits, for the step it waits for
   * now, in the steps' order now:
   *
   *  - its chat copies that no longer ask what is true say what happened
   *    instead, and so do those of the people the step no longer asks
   *    (WorkspacePublicNoteApprovalMessages.replaceOver);
   *  - the people the step asks now are asked, as askApprovers asks - each
   *    only by what they were not asked by about this step of this round yet
   *    (PublicNoteApprovalRequests).
   *
   * A note that no longer waits - published, rejected, gone - is left as it
   * is, and so is its record's feed: who approves changed, not the note.
   * Returns the people asked.
   */
  @CaptureSpan()
  public static async followUp<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const note: NoteFields | null = await this.readNote(data.host, data.noteId);

    if (!note || !note.projectId) {
      return [];
    }

    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );

    // Who was asked is recorded by the round: a note with none is left as it was.
    if (
      !PublicNoteApproval.isWaiting(PublicNoteApproval.getState(note)) ||
      !round
    ) {
      return [];
    }

    const steps: Array<PublicNoteApprovalStepRule> =
      await PublicNoteApprovalPolicy.getSteps({
        projectId: note.projectId,
        eventType: data.host.eventType,
      });
    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      round,
      steps,
    );
    const people: Array<string> = await this.getPeopleToAsk({
      projectId: note.projectId,
      round,
      position,
    });

    try {
      await PublicNoteApprovalNotifications.getChatMessages().replaceOver({
        kind: data.host.kind,
        projectId: note.projectId,
        noteId: data.noteId,
        askedUserIds: people,
      });
    } catch (error) {
      logger.error(
        "Public note approval: could not replace the chat messages of a public note whose approvers changed.",
        { projectId: note.projectId.toString() },
      );
      logger.error(error, { projectId: note.projectId.toString() });
    }

    return await this.askApprovers({
      host: data.host,
      note,
      round,
      position,
      isEdit: note.isPublished !== false,
      isFollowUp: true,
      people,
    });
  }

  /*
   * A note that waited before OneUptime kept whom it asked
   * (PublicNoteApprovalRequests): the people the step it waits for asks
   * now are taken as asked about it - as they were when the note reached
   * the step - without asking them, so the first change of who approves it
   * asks only those who are new. How many requests were recorded.
   */
  @CaptureSpan()
  public static async recordAsAsked<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalKind<TNote>;
    noteId: ObjectID;
  }): Promise<number> {
    const note: NoteFields | null = await this.readNote(data.host, data.noteId);

    if (!note || !note.projectId) {
      return 0;
    }

    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );

    if (
      !PublicNoteApproval.isWaiting(PublicNoteApproval.getState(note)) ||
      !round
    ) {
      return 0;
    }

    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      round,
      await PublicNoteApprovalPolicy.getSteps({
        projectId: note.projectId,
        eventType: data.host.eventType,
      }),
    );
    const request: PublicNoteApprovalRequestKey | undefined =
      this.getRequestKey({ host: data.host, note, round, position });

    if (!request) {
      return 0;
    }

    return await PublicNoteApprovalRequests.record({
      key: request,
      userIds: await this.getPeopleToAsk({
        projectId: note.projectId,
        round,
        position,
      }),
    });
  }

  // ---------- what a held note may not start ----------

  /*
   * Whether a note is published now, for the workflows its writes start: a
   * held note starts none - not when it is created, nor when it is edited
   * or decided on while it waits. Its On Create starts when it is
   * published (afterPublish), and that write starts On Update. One that
   * cannot be read starts nothing.
   */
  @CaptureSpan()
  public static async isPublishedNow<TNote extends BaseModel>(data: {
    service: DatabaseService<TNote>;
    id: ObjectID;
  }): Promise<boolean> {
    try {
      const note: TNote | null = await data.service.findOneById({
        id: data.id,
        select: {
          isPublished: true,
        } as Select<TNote>,
        props: ROOT,
      });

      return Boolean(
        note && (note as unknown as NoteFields).isPublished !== false,
      );
    } catch (error) {
      logger.error(error);
      return false;
    }
  }

  // ---------- who a note waits for ----------

  /*
   * Who a note waits for now, for a message that names them - the answer a
   * note sent from Slack, Microsoft Teams or Mattermost gets while it waits
   * (WorkspaceHeldPublicNote): the step it waits for among the steps as they
   * are now, and the people and teams that step names, as the record's feed
   * names them. Null for a note nobody is asked about: one published with
   * no edit waiting, or one rejected.
   */
  @CaptureSpan()
  public static async getWaitingForNote(data: {
    eventType: PublicNoteApprovalEventType;
    note: PublicNoteApprovalColumns & {
      projectId?: ObjectID | null | undefined;
    };
  }): Promise<PublicNoteApprovalWaitingFor | null> {
    const state: PublicNoteApprovalState = PublicNoteApproval.getState(
      data.note,
    );

    if (!PublicNoteApproval.isWaiting(state) || !data.note.projectId) {
      return null;
    }

    const steps: Array<PublicNoteApprovalStepRule> =
      await PublicNoteApprovalPolicy.getSteps({
        projectId: data.note.projectId,
        eventType: data.eventType,
      });

    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      PublicNoteApproval.readRound(data.note.approval),
      steps,
    );

    return await this.getWaitingFor(position);
  }

  // ---------- what the Dashboard is told ----------

  /*
   * Where each of these notes stands, for the person reading them: the step
   * a waiting note waits for and who it names, what it was decided, and
   * whether this person may decide now. Only notes they can read.
   */
  @CaptureSpan()
  public static async describeNotes<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Array<PublicNoteApprovalNoteSummary>> {
    if (data.noteIds.length === 0) {
      return [];
    }

    const readable: Array<TNote> = await data.host.service.findBy({
      query: {
        _id: QueryHelper.any(data.noteIds),
        projectId: data.projectId,
      } as unknown as Query<TNote>,
      select: {
        _id: true,
        isPublished: true,
        approvalStatus: true,
        approval: true,
      } as Select<TNote>,
      limit: data.noteIds.length,
      skip: 0,
      props: data.props,
    });

    const steps: Array<PublicNoteApprovalStepRule> =
      await PublicNoteApprovalPolicy.getSteps({
        projectId: data.projectId,
        eventType: data.host.eventType,
      });

    const userTeamIds: Array<string> = data.props.userId
      ? await PublicNoteApprovalPolicy.getUserTeamIds({
          projectId: data.projectId,
          userId: data.props.userId,
        })
      : [];

    const notes: Array<NoteFields> = readable as unknown as Array<NoteFields>;
    const rounds: Array<PublicNoteApprovalRound | null> = notes.map(
      (note: NoteFields): PublicNoteApprovalRound | null => {
        return PublicNoteApproval.readRound(note.approval);
      },
    );

    // Everybody the summaries name, read at once.
    const userIds: Set<string> = new Set<string>();
    const teamIds: Set<string> = new Set<string>();

    for (const step of steps) {
      step.userIds.forEach((id: string) => {
        return userIds.add(id);
      });
      step.teamIds.forEach((id: string) => {
        return teamIds.add(id);
      });
    }

    for (const round of rounds) {
      if (round?.submittedByUserId) {
        userIds.add(round.submittedByUserId);
      }

      (round?.approvals || []).forEach((given: PublicNoteApprovalGiven) => {
        userIds.add(given.userId);
      });

      if (round?.rejection) {
        userIds.add(round.rejection.userId);
      }
    }

    const userNames: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(Array.from(userIds));
    const teamNames: Record<string, string> = await this.getTeamNames(
      Array.from(teamIds),
    );

    return notes.map(
      (note: NoteFields, index: number): PublicNoteApprovalNoteSummary => {
        const round: PublicNoteApprovalRound | null = rounds[index] || null;
        const state: PublicNoteApprovalState =
          PublicNoteApproval.getState(note);

        const summary: PublicNoteApprovalNoteSummary = {
          noteId: this.idOf(note as unknown as BaseModel) || "",
          state,
          isEdit: Boolean(round?.isEdit) || note.isPublished !== false,
          approvals: (round?.approvals || []).map(
            (given: PublicNoteApprovalGiven) => {
              return {
                by: userNames[given.userId] || "A former team member",
                at: given.at,
                ...(given.stepName ? { stepName: given.stepName } : {}),
                ...(given.comment ? { comment: given.comment } : {}),
              };
            },
          ),
          canApprove: false,
          canReject: false,
        };

        if (round?.submittedAt) {
          summary.submittedAt = round.submittedAt;
        }

        if (round?.submittedByUserId) {
          summary.submittedBy =
            userNames[round.submittedByUserId] || "A former team member";
        }

        if (round?.rejection) {
          summary.rejection = {
            by: userNames[round.rejection.userId] || "A former team member",
            at: round.rejection.at,
            reason: round.rejection.reason,
            ...(round.rejection.stepName
              ? { stepName: round.rejection.stepName }
              : {}),
          };
        }

        if (PublicNoteApproval.isWaiting(state)) {
          const position: PublicNoteApprovalPosition =
            PublicNoteApproval.getPosition(round, steps);

          if (position.step) {
            summary.step = {
              number: position.number,
              count: position.count,
              ...(position.step.name ? { name: position.step.name } : {}),
              isFinal: position.isFinal,
              isAskedAgain: position.isAskedAgain,
              people: position.step.userIds
                .map((id: string): string => {
                  return userNames[id] || "";
                })
                .filter(Boolean),
              teams: position.step.teamIds
                .map((id: string): string => {
                  return teamNames[id] || "";
                })
                .filter(Boolean),
            };
          }

          const refusalOf: (
            decision: PublicNoteApprovalDecision,
          ) => string | null = (
            decision: PublicNoteApprovalDecision,
          ): string | null => {
            return PublicNoteApproval.getDecisionRefusal({
              state,
              round,
              steps,
              userId: data.props.userId?.toString(),
              userTeamIds,
              decision,
            });
          };

          const approveRefusal: string | null = refusalOf(
            PublicNoteApprovalDecision.Approve,
          );
          const rejectRefusal: string | null = refusalOf(
            PublicNoteApprovalDecision.Reject,
          );

          summary.canApprove = approveRefusal === null;
          summary.canReject = rejectRefusal === null;

          // Why they may not approve - what the Dashboard shows instead.
          if (approveRefusal) {
            summary.decisionRefusal = approveRefusal;
          }
        }

        return summary;
      },
    );
  }

  // Whether the project asks for approval of this kind of note, and who approves.
  @CaptureSpan()
  public static async describePolicy<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    projectId: ObjectID;
  }): Promise<PublicNoteApprovalPolicySummary> {
    const policy: {
      isRequired: boolean;
      steps: Array<PublicNoteApprovalStepRule>;
    } = await PublicNoteApprovalPolicy.read({
      projectId: data.projectId,
      eventType: data.host.eventType,
    });

    const steps: Array<PublicNoteApprovalStepRule> =
      PublicNoteApproval.sortSteps(policy.steps);

    const userNames: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(
        steps.flatMap((step: PublicNoteApprovalStepRule) => {
          return step.userIds;
        }),
      );
    const teamNames: Record<string, string> = await this.getTeamNames(
      steps.flatMap((step: PublicNoteApprovalStepRule) => {
        return step.teamIds;
      }),
    );

    return {
      isRequired: policy.isRequired,
      steps: steps.map((step: PublicNoteApprovalStepRule, index: number) => {
        return {
          id: step.id,
          number: index + 1,
          ...(step.name ? { name: step.name } : {}),
          people: step.userIds
            .map((id: string): string => {
              return userNames[id] || "";
            })
            .filter(Boolean),
          teams: step.teamIds
            .map((id: string): string => {
              return teamNames[id] || "";
            })
            .filter(Boolean),
        };
      }),
    };
  }

  // ---------- after a decision ----------

  private static async afterRejection<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: NoteFields;
    round: PublicNoteApprovalRound;
    reason: string;
    isEdit: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      await this.addFeedItem({
        host: data.host,
        note: data.note,
        markdown: (record: PublicNoteApprovalFeedRecord): MarkdownText => {
          return PublicNoteApprovalFeed.rejected({
            record,
            isEdit: data.isEdit,
            reason: data.reason,
          });
        },
        userId: data.props.userId,
        props: data.props,
        color: Red500,
      });

      const facts: PublicNoteApprovalMessageFacts | null = await this.getFacts(
        data.host,
        data.note,
        data.isEdit,
      );

      if (facts) {
        await PublicNoteApprovalNotifications.tellSender({
          facts,
          sentByUserId: data.round.submittedByUserId,
          decidedByUserId: data.props.userId!.toString(),
          isApproved: false,
          reason: data.reason,
          canRead: this.readCheck(data.host, data.note),
        });
      }
    } catch (error) {
      logger.error("Public note approval: could not record a rejection.");
      logger.error(error);
    }
  }

  private static async afterStepApproval<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: NoteFields;
    round: PublicNoteApprovalRound;
    steps: Array<PublicNoteApprovalStepRule>;
    approvedPosition: PublicNoteApprovalPosition;
    isEdit: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      const next: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
        data.round,
        data.steps,
      );
      const waitingFor: PublicNoteApprovalWaitingFor =
        await this.getWaitingFor(next);

      await this.addFeedItem({
        host: data.host,
        note: data.note,
        markdown: (record: PublicNoteApprovalFeedRecord): MarkdownText => {
          return PublicNoteApprovalFeed.approvedStep({
            record,
            isEdit: data.isEdit,
            approvedPosition: data.approvedPosition,
            waitingFor,
          });
        },
        userId: data.props.userId,
        props: data.props,
        color: Green500,
      });

      await this.askApprovers({
        host: data.host,
        note: data.note,
        round: data.round,
        position: next,
        isEdit: data.isEdit,
      });
    } catch (error) {
      logger.error("Public note approval: could not record an approval.");
      logger.error(error);
    }
  }

  /*
   * The note, or its edit, is published: what it always did when it was
   * posted happens now, once - its entry on the record's feed and its chat
   * channels, and for a new note the workflows that start when a note is
   * created. Its subscribers' notification and its owners' are sent by
   * their jobs, which send published notes only; its images were made
   * public by the write itself (PublishedImages).
   */
  private static async afterPublish<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: NoteFields;
    round: PublicNoteApprovalRound;
    isEdit: boolean;
    approverUserId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      await this.addFeedItem({
        host: data.host,
        note: data.note,
        markdown: (record: PublicNoteApprovalFeedRecord): MarkdownText => {
          return PublicNoteApprovalFeed.approvedAndPublished({
            record,
            isEdit: data.isEdit,
          });
        },
        userId: data.approverUserId,
        props: data.props,
        color: Green500,
      });
    } catch (error) {
      logger.error("Public note approval: could not record an approval.");
      logger.error(error);
    }

    const names: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(
        data.round.approvals.map((given: PublicNoteApprovalGiven) => {
          return given.userId;
        }),
      );

    await this.announce({
      host: data.host,
      note: data.note,
      isEdit: data.isEdit,
      editorUserId: data.round.submittedByUserId,
      approvedByNames: data.round.approvals
        .map((given: PublicNoteApprovalGiven): string => {
          return names[given.userId] || "";
        })
        .filter(Boolean),
      props: data.props,
    });

    try {
      const facts: PublicNoteApprovalMessageFacts | null = await this.getFacts(
        data.host,
        data.note,
        data.isEdit,
      );

      if (facts) {
        await PublicNoteApprovalNotifications.tellSender({
          facts,
          sentByUserId: data.round.submittedByUserId,
          decidedByUserId: data.approverUserId.toString(),
          isApproved: true,
          canRead: this.readCheck(data.host, data.note),
        });
      }
    } catch (error) {
      logger.error("Public note approval: could not tell the sender.");
      logger.error(error);
    }
  }

  private static async announce<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: NoteFields;
    isEdit: boolean;
    editorUserId?: string | undefined;
    approvedByNames: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const noteId: ObjectID | null = this.idOf(data.note as unknown as BaseModel)
      ? new ObjectID(this.idOf(data.note as unknown as BaseModel)!)
      : null;

    if (!noteId || !data.note.projectId) {
      return;
    }

    try {
      if (data.isEdit) {
        await data.host.announceEditPublished({
          noteId,
          editorUserId: data.editorUserId
            ? new ObjectID(data.editorUserId)
            : undefined,
          approvedByNames: data.approvedByNames,
        });
        return;
      }

      await data.host.announcePublished({
        noteId,
        approvedByNames: data.approvedByNames,
        props: data.props,
      });
    } catch (error) {
      logger.error("Public note approval: could not announce a note.");
      logger.error(error);
    }

    if (!data.isEdit) {
      try {
        // A held note's On Create workflows start now that it is published.
        await data.host.service.onTriggerWorkflow(
          noteId,
          data.note.projectId,
          "on-create",
        );
      } catch (error) {
        logger.error(
          "Public note approval: could not start a note's workflows.",
        );
        logger.error(error);
      }
    }
  }

  // ---------- asking approvers ----------

  // A note, or its edit, now waits: its record's feed says so, and the step it waits for is asked.
  private static async announceWaiting<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
    isAgain: boolean;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    const note: NoteFields | null = await this.readNote(data.host, data.noteId);

    if (!note || !note.projectId) {
      return;
    }

    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );
    const isEdit: boolean = note.isPublished !== false;
    const steps: Array<PublicNoteApprovalStepRule> =
      await PublicNoteApprovalPolicy.getSteps({
        projectId: note.projectId,
        eventType: data.host.eventType,
      });
    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      round,
      steps,
    );
    const waitingFor: PublicNoteApprovalWaitingFor =
      await this.getWaitingFor(position);

    await this.addFeedItem({
      host: data.host,
      note,
      markdown: (record: PublicNoteApprovalFeedRecord): MarkdownText => {
        return PublicNoteApprovalFeed.submitted({
          record,
          note: isEdit ? note.pendingNote : note.note,
          isEdit,
          isAgain: data.isAgain,
          waitingFor,
        });
      },
      userId: round?.submittedByUserId
        ? new ObjectID(round.submittedByUserId)
        : undefined,
      props: data.props,
      color: Yellow500,
    });

    await this.askApprovers({
      host: data.host,
      note,
      round,
      position,
      isEdit,
    });
  }

  private static async askApprovers<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: NoteFields;
    round: PublicNoteApprovalRound | null;
    position: PublicNoteApprovalPosition;
    isEdit: boolean;
    /*
     * Who approves changed while the note waits (followUp): only those the
     * step did not ask yet are asked. With them, who the step asks, read
     * already.
     */
    isFollowUp?: boolean | undefined;
    people?: Array<string> | undefined;
  }): Promise<Array<ObjectID>> {
    if (!data.position.step || !data.note.projectId) {
      return [];
    }

    const people: Array<string> =
      data.people ||
      (await this.getPeopleToAsk({
        projectId: data.note.projectId,
        round: data.round,
        position: data.position,
      }));

    const facts: PublicNoteApprovalMessageFacts | null = await this.getFacts(
      data.host,
      data.note,
      data.isEdit,
    );

    if (!facts || people.length === 0) {
      return [];
    }

    return await PublicNoteApprovalNotifications.askApprovers({
      facts,
      userIds: people,
      namedUserIds: data.position.step.userIds,
      sentByUserId: data.round?.submittedByUserId,
      stepLabel:
        data.position.count > 1
          ? data.position.step.name
            ? `Step ${data.position.number} of ${data.position.count} (${data.position.step.name})`
            : `Step ${data.position.number} of ${data.position.count}`
          : data.position.step.name || "Approval",
      canRead: this.readCheck(data.host, data.note),
      chat: await this.getChatAsk({
        host: data.host,
        note: data.note,
        round: data.round,
        position: data.position,
      }),
      request: this.getRequestKey({
        host: data.host,
        note: data.note,
        round: data.round,
        position: data.position,
      }),
      isFollowUp: Boolean(data.isFollowUp),
    });
  }

  /*
   * The people the step a note waits for asks: those it names, and the
   * members of the teams it names now, less whoever sent the note and
   * whoever approved it already (PublicNoteApproval.getPeopleToAsk).
   */
  private static async getPeopleToAsk(data: {
    projectId: ObjectID;
    round: PublicNoteApprovalRound | null;
    position: PublicNoteApprovalPosition;
  }): Promise<Array<string>> {
    if (!data.position.step) {
      return [];
    }

    const teamMembers: Record<
      string,
      Array<string>
    > = await PublicNoteApprovalPolicy.getTeamMemberIds({
      projectId: data.projectId,
      teamIds: data.position.step.teamIds,
    });

    return PublicNoteApproval.getPeopleToAsk({
      step: data.position.step,
      teamMembers,
      round: data.round,
    });
  }

  /*
   * The step of the note's round an ask is about, for the record of whom it
   * asked (PublicNoteApprovalRequests); undefined for a note with no round
   * to name, whose approvers are asked as they always were.
   */
  private static getRequestKey<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalKind<TNote>;
    note: NoteFields;
    round: PublicNoteApprovalRound | null;
    position: PublicNoteApprovalPosition;
  }): PublicNoteApprovalRequestKey | undefined {
    const noteId: string | null = this.idOf(data.note as unknown as BaseModel);

    if (
      !noteId ||
      !data.note.projectId ||
      !data.round?.submittedAt ||
      !data.position.step
    ) {
      return undefined;
    }

    return {
      kind: data.host.kind,
      projectId: data.note.projectId,
      noteId: new ObjectID(noteId),
      submittedAt: data.round.submittedAt,
      stepId: data.position.step.id,
      isFinal: data.position.isFinal,
      isAskedAgain: data.position.isAskedAgain,
    };
  }

  /*
   * What the chat message that asks (WorkspacePublicNoteApproval) carries
   * on its Approve and Reject: the note and its record, the round of
   * approval and the step it asks about, and whether approving that step
   * publishes the note - with who the step names, in the feed's words.
   * Undefined for a note that cannot be named so, or whose step's names
   * cannot be read: its approvers are still asked, in chat as before, with
   * no buttons.
   */
  private static async getChatAsk<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: NoteFields;
    round: PublicNoteApprovalRound | null;
    position: PublicNoteApprovalPosition;
  }): Promise<PublicNoteApprovalChatAsk | undefined> {
    const noteId: string | null = this.idOf(data.note as unknown as BaseModel);
    const recordId: ObjectID | null = this.parentIdOf(data.host, data.note);

    if (
      !noteId ||
      !recordId ||
      !data.round?.submittedAt ||
      !data.position.step
    ) {
      return undefined;
    }

    try {
      return {
        kind: data.host.kind,
        noteId: new ObjectID(noteId),
        recordId: recordId,
        submittedAt: data.round.submittedAt,
        stepId: data.position.step.id,
        isFinal: data.position.isFinal,
        waitingFor: await this.getWaitingFor(data.position),
      };
    } catch (error) {
      logger.error(
        "Public note approval: could not name a step for its chat buttons.",
      );
      logger.error(error);
      return undefined;
    }
  }

  private static async getWaitingFor(
    position: PublicNoteApprovalPosition,
  ): Promise<PublicNoteApprovalWaitingFor> {
    if (!position.step) {
      return { position, approverNames: [] };
    }

    const userNames: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(position.step.userIds);
    const teamNames: Record<string, string> = await this.getTeamNames(
      position.step.teamIds,
    );

    return {
      position,
      approverNames: [
        ...position.step.userIds.map((id: string): string => {
          return userNames[id] || "";
        }),
        ...position.step.teamIds.map((id: string): string => {
          return teamNames[id] || "";
        }),
      ].filter(Boolean),
    };
  }

  // ---------- reading and writing ----------

  /*
   * The note, written only while it is at the version it was read at: a
   * decision another person wrote first leaves this one unwritten, and its
   * caller is told to look again. As OneUptime, with no hooks: the note's
   * own update hook is for edits, not for this - but the write's effects
   * on what everyone sees still run (PublishedImages, the status page
   * overview cache, the workflows On Update starts on a published note).
   */
  private static async writeOnce<TNote extends BaseModel>(
    host: PublicNoteApprovalHost<TNote>,
    note: NoteFields,
    write: PublicNoteApprovalWrite,
  ): Promise<void> {
    const noteId: string | null = this.idOf(note as unknown as BaseModel);

    if (!noteId || typeof note.version !== "number") {
      throw new BadDataException(PublicNoteApprovalMessages.decidedMeanwhile);
    }

    const written: number = await host.service.updateOneBy({
      query: {
        _id: noteId,
        version: note.version,
      } as unknown as Query<TNote>,
      data: write as unknown as PartialEntity<TNote>,
      props: WRITE_AS_ONEUPTIME,
    });

    if (written === 0) {
      throw new BadDataException(PublicNoteApprovalMessages.decidedMeanwhile);
    }

    /*
     * Every such write decides, sends again or withdraws what the note's
     * approval messages asked about: the chat copies that no longer ask
     * what is true say what happened instead, in the background.
     */
    if (note.projectId) {
      PublicNoteApprovalNotifications.replaceChatMessages({
        kind: host.kind,
        projectId: note.projectId,
        noteId: new ObjectID(noteId),
      });
    }
  }

  // The note as the caller may read it - else not found - read whole as OneUptime.
  private static async readNoteAsReader<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<NoteFields> {
    const readable: TNote | null = await data.host.service.findOneBy({
      query: {
        _id: data.noteId.toString(),
      } as unknown as Query<TNote>,
      select: {
        _id: true,
      } as Select<TNote>,
      props: data.props,
    });

    if (!readable) {
      throw new NotFoundException("Public note not found.");
    }

    return await this.readNoteInCallerProject(data);
  }

  // The note as the caller may edit it - else refused as an update is.
  private static async readNoteAsEditor<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<NoteFields> {
    const editable: TNote | null = await data.host.service.findOneUpdatableById(
      {
        id: data.noteId,
        select: {
          _id: true,
        } as Select<TNote>,
        props: data.props,
      },
    );

    if (!editable) {
      const refusal: Exception = await data.host.service.getUnwrittenByIdError({
        id: data.noteId,
        props: data.props,
        type: DatabaseRequestType.Update,
      });

      throw refusal;
    }

    return await this.readNoteInCallerProject(data);
  }

  private static async readNoteInCallerProject<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    noteId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<NoteFields> {
    const note: NoteFields | null = await this.readNote(data.host, data.noteId);

    if (
      !note ||
      !note.projectId ||
      (data.props.tenantId &&
        note.projectId.toString() !== data.props.tenantId.toString())
    ) {
      throw new NotFoundException("Public note not found.");
    }

    return note;
  }

  private static async readNote<TNote extends BaseModel>(
    host: PublicNoteApprovalKind<TNote>,
    noteId: ObjectID,
  ): Promise<NoteFields | null> {
    const note: TNote | null = await host.service.findOneById({
      id: noteId,
      select: this.noteSelect(host),
      props: ROOT,
    });

    return note ? (note as unknown as NoteFields) : null;
  }

  private static noteSelect<TNote extends BaseModel>(
    host: PublicNoteApprovalKind<TNote>,
  ): Select<TNote> {
    return {
      _id: true,
      version: true,
      projectId: true,
      [host.parentIdColumn]: true,
      note: true,
      pendingNote: true,
      isPublished: true,
      approvalStatus: true,
      approval: true,
      createdByUserId: true,
      attachments: {
        _id: true,
      },
    } as unknown as Select<TNote>;
  }

  /*
   * Whether a person may read this note, with their permissions: what an
   * approver must be able to do, and what decides who is told about it.
   */
  private static readCheck<TNote extends BaseModel>(
    host: PublicNoteApprovalHost<TNote>,
    note: NoteFields,
  ): (props: DatabaseCommonInteractionProps) => Promise<boolean> {
    const noteId: string | null = this.idOf(note as unknown as BaseModel);

    return async (props: DatabaseCommonInteractionProps): Promise<boolean> => {
      if (!noteId) {
        return false;
      }

      const found: TNote | null = await host.service.findOneBy({
        query: {
          _id: noteId,
        } as unknown as Query<TNote>,
        select: {
          _id: true,
        } as Select<TNote>,
        props,
      });

      return Boolean(found);
    };
  }

  private static async isRequiredFor<TNote extends BaseModel>(
    host: PublicNoteApprovalKind<TNote>,
    note: NoteFields,
  ): Promise<boolean> {
    if (!note.projectId) {
      return false;
    }

    return await PublicNoteApprovalPolicy.isRequired({
      projectId: note.projectId,
      eventType: host.eventType,
    });
  }

  // Whether the project of any of these notes asks for approval: each project asked once.
  private static async isRequiredForAnyOf<TNote extends BaseModel>(
    host: PublicNoteApprovalKind<TNote>,
    notes: Array<NoteFields>,
  ): Promise<boolean> {
    const asked: Set<string> = new Set<string>();

    for (const note of notes) {
      const projectId: string = note.projectId?.toString() || "";

      if (!projectId || asked.has(projectId)) {
        continue;
      }

      asked.add(projectId);

      if (await this.isRequiredFor(host, note)) {
        return true;
      }
    }

    return false;
  }

  private static async addFeedItem<TNote extends BaseModel>(data: {
    host: PublicNoteApprovalHost<TNote>;
    note: NoteFields;
    markdown: (record: PublicNoteApprovalFeedRecord) => MarkdownText;
    userId?: ObjectID | undefined;
    // The request's: the API key it was made with, when it was.
    props?: DatabaseCommonInteractionProps | undefined;
    color: Color;
  }): Promise<void> {
    const parentId: ObjectID | null = this.parentIdOf(data.host, data.note);

    if (!parentId || !data.note.projectId) {
      return;
    }

    const record: PublicNoteApprovalRecordInfo | null =
      await data.host.getRecord({
        projectId: data.note.projectId,
        parentId,
      });

    if (!record) {
      return;
    }

    await data.host.addFeedItem({
      projectId: data.note.projectId,
      parentId,
      markdown: data.markdown({ label: record.label, url: record.url }),
      userId: data.userId,
      apiKeyActor: data.props
        ? FeedApiKeyActorUtil.fromProps(data.props)
        : undefined,
      color: data.color,
    });
  }

  private static async getFacts<TNote extends BaseModel>(
    host: PublicNoteApprovalHost<TNote>,
    note: NoteFields,
    isEdit: boolean,
  ): Promise<PublicNoteApprovalMessageFacts | null> {
    const parentId: ObjectID | null = this.parentIdOf(host, note);

    if (!parentId || !note.projectId) {
      return null;
    }

    const record: PublicNoteApprovalRecordInfo | null = await host.getRecord({
      projectId: note.projectId,
      parentId,
    });

    if (!record) {
      return null;
    }

    return {
      projectId: note.projectId,
      recordLabel: record.label,
      recordTitle: record.title,
      recordNoun: host.recordNoun,
      notesUrl: record.notesUrl,
      note: (isEdit ? note.pendingNote : note.note) || note.note || "",
      isEdit,
      ...host.getMessageIds(parentId),
    };
  }

  /*
   * The text an approver of this note is asked about: the edit that waits,
   * for a note that is published, else the note - the text every message
   * that asks shows (getFacts), and what a press from chat is checked
   * against (WorkspacePublicNoteApprovalActions).
   */
  public static getTextToApprove(note: {
    isPublished?: boolean | null | undefined;
    note?: string | null | undefined;
    pendingNote?: string | null | undefined;
  }): string {
    const isEdit: boolean = note.isPublished !== false;

    return (isEdit ? note.pendingNote : note.note) || note.note || "";
  }

  private static async getTeamNames(
    teamIds: ReadonlyArray<string>,
  ): Promise<Record<string, string>> {
    const ids: Array<string> = Array.from(new Set(teamIds)).filter(Boolean);
    const names: Record<string, string> = {};

    if (ids.length === 0) {
      return names;
    }

    const teams: Array<Team> = await TeamService.findBy({
      query: {
        _id: QueryHelper.any(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: ids.length,
      skip: 0,
      props: ROOT,
    });

    for (const team of teams) {
      const id: string = team.id?.toString() || "";
      const name: string = team.name?.toString() || "";

      if (id && name) {
        names[id] = name;
      }
    }

    return names;
  }

  private static parentIdOf<TNote extends BaseModel>(
    host: PublicNoteApprovalKind<TNote>,
    note: NoteFields,
  ): ObjectID | null {
    const value: unknown = (note as Record<string, unknown>)[
      host.parentIdColumn
    ];

    if (!value) {
      return null;
    }

    return value instanceof ObjectID ? value : new ObjectID(String(value));
  }

  private static fileIdsOf(note: NoteFields): Array<string> {
    return (note.attachments || [])
      .map((file: File): string => {
        return (file.id || file._id || "").toString();
      })
      .filter(Boolean);
  }

  private static idOf(note: BaseModel | null | undefined): string | null {
    if (!note) {
      return null;
    }

    const id: unknown = note.id || note._id;

    return id ? id.toString() : null;
  }

  // Writes `write` onto a create's or an update's data, null clearing.
  private static assign(target: unknown, write: PublicNoteApprovalWrite): void {
    const record: Record<string, unknown> = target as Record<string, unknown>;

    for (const [column, value] of Object.entries(write)) {
      record[column] = value;
    }
  }
}
