import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import ModelPermission from "../Types/Database/Permissions/Index";

/*
 * THE NOTE A STATE CHANGE POSTS IS ONE ITS SENDER MAY POST.
 *
 * Moving an event to another state can post a note with it: the folded "Add
 * a public note" / "Add a private note" of the state change dialogs, the
 * Change State bulk action, or `miscDataProps` on a state timeline create
 * over the API.
 *
 *  - Incidents and scheduled maintenance post a public note (`publicNote`),
 *    which reaches the status page (StatusPage/StateChangePublicNote).
 *  - Alerts, alert episodes and incident episodes post a private note
 *    (`privateNote`; an alert also takes the older `internalNote`), which
 *    stays with the team.
 *
 * The note is posted as the person changing the state, and posting a note is
 * a permission of its own (Create Alert Internal Note, Create Incident Status
 * Page Note, ...), apart from changing the state. A note posted once the
 * change is saved used to fail after the fact: the change was saved, and the
 * person who sent it was answered with an error, as if nothing had happened.
 *
 * So every state timeline asks first - before the change reads or writes
 * anything, and all but the incident timeline before it even takes the
 * event's lock - with the very check the note's own create runs
 * (ModelPermission.checkCreatePermissions, with the same note and the same
 * props), and a change whose note its sender may not post is refused whole,
 * with one plain message: the state was not changed, why, and that leaving
 * the note out lets the change through. OneUptime's own changes (root) are
 * not asked, as the note's create does not ask them.
 *
 * The note, public or private, is then posted once the change is saved, so
 * it comes after the change in the feed, and a change that is refused or
 * fails to save leaves no note behind: preparePrivateNotes builds and checks
 * a private note, postPrivateNotes posts it, and the public note's two
 * timelines do the same with theirs (StatusPage/StateChangePublicNote).
 */

export enum StateChangeNoteType {
  Public = "public",
  Private = "private",
}

// The note's own columns every private note model has.
const NOTE_TEXT_COLUMN: string = "note";
const NOTE_TIME_COLUMN: string = "createdAt";
const NOTE_PROJECT_COLUMN: string = "projectId";

// The state change's columns the note takes its time and project from.
const STATE_CHANGE_TIME_COLUMN: string = "startsAt";
const STATE_CHANGE_PROJECT_COLUMN: string = "projectId";

const ENDS_A_SENTENCE: RegExp = /[.!?]$/;

// What creates a note: the note model's service.
export interface PrivateNoteService<TNote extends BaseModel> {
  create: (createBy: CreateBy<TNote>) => Promise<TNote>;
}

export default class StateChangeNote {
  // The misc data prop a private note travels under (Dashboard Utils/BulkStateChange).
  public static readonly privateNoteKey: string = "privateNote";

  /*
   * The prop an alert's private note travelled under before `privateNote`.
   * Nothing in OneUptime sends it any more; an API client still may, and the
   * alert timeline treats it the same way.
   */
  public static readonly legacyAlertInternalNoteKey: string = "internalNote";

  /*
   * The private note posted with a state change, as it was written, or
   * undefined when there is none. A note with no text in it - spaces and
   * line breaks only - is none, and so is anything that is not text, as for
   * the public note (StateChangeSubscriberNotification.getPublicNote): the
   * dashboard never sends a blank one, and one would post an empty note.
   */
  public static getPrivateNote(
    miscDataProps: JSONObject | undefined | null,
    noteKey: string = StateChangeNote.privateNoteKey,
  ): string | undefined {
    if (!miscDataProps || typeof miscDataProps !== "object") {
      return undefined;
    }

    const note: unknown = miscDataProps[noteKey];

    if (typeof note !== "string" || note.trim().length === 0) {
      return undefined;
    }

    return note;
  }

  /*
   * The private notes a state change posts, built and checked in the state
   * timeline's onBeforeCreate, one for each of `noteKeys` the change carries
   * a note under (`privateNote` unless said), in that order. Each is a note
   * on the event the change moves - `eventColumn` names it, on the change
   * and on the note alike - at the time the change starts, in its project,
   * and is checked as its sender: someone who may not post it is refused
   * here, and with them the whole change. The state timeline posts the notes
   * once the change is saved (postPrivateNotes).
   */
  public static preparePrivateNotes<TNote extends BaseModel>(data: {
    noteModelType: { new (): TNote };
    stateChange: BaseModel;
    eventColumn: string;
    miscDataProps: JSONObject | undefined | null;
    props: DatabaseCommonInteractionProps;
    noteKeys?: Array<string> | undefined;
  }): Array<TNote> {
    const notes: Array<TNote> = [];

    for (const noteKey of data.noteKeys || [StateChangeNote.privateNoteKey]) {
      const text: string | undefined = StateChangeNote.getPrivateNote(
        data.miscDataProps,
        noteKey,
      );

      if (!text) {
        continue;
      }

      const note: TNote = new data.noteModelType();

      StateChangeNote.setNoteColumn(
        note,
        data.eventColumn,
        data.stateChange.getColumnValue(data.eventColumn),
      );
      StateChangeNote.setNoteColumn(note, NOTE_TEXT_COLUMN, text);
      StateChangeNote.setNoteColumn(
        note,
        NOTE_TIME_COLUMN,
        data.stateChange.getColumnValue(STATE_CHANGE_TIME_COLUMN),
      );
      StateChangeNote.setNoteColumn(
        note,
        NOTE_PROJECT_COLUMN,
        data.stateChange.getColumnValue(STATE_CHANGE_PROJECT_COLUMN) ||
          data.props.tenantId ||
          null,
      );

      StateChangeNote.assertCallerMayPost({
        noteType: StateChangeNoteType.Private,
        noteModelType: data.noteModelType,
        note: note,
        props: data.props,
      });

      notes.push(note);
    }

    return notes;
  }

  /*
   * Posts the notes preparePrivateNotes built, once the change is saved: at
   * the time and in the project the change was saved with, as the person who
   * changed the state. preparePrivateNotes filled both in from the change as
   * it was sent, so the check saw the note that is posted; the saved change
   * has the last word on them, as the note belongs with the change it is
   * posted with.
   */
  public static async postPrivateNotes<TNote extends BaseModel>(data: {
    notes: Array<TNote> | undefined;
    noteService: PrivateNoteService<TNote>;
    savedStateChange: BaseModel;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    for (const note of data.notes || []) {
      StateChangeNote.setNoteColumn(
        note,
        NOTE_TIME_COLUMN,
        data.savedStateChange.getColumnValue(STATE_CHANGE_TIME_COLUMN),
      );
      StateChangeNote.setNoteColumn(
        note,
        NOTE_PROJECT_COLUMN,
        data.savedStateChange.getColumnValue(STATE_CHANGE_PROJECT_COLUMN),
      );

      await data.noteService.create({
        data: note,
        props: data.props,
      });
    }
  }

  /*
   * Refuses a state change whose note the person changing the state may not
   * post: the check the note's create runs, asked before anything of the
   * change is read or written. A permission refusal is reworded to say what
   * it means for the change; anything else is passed on as it is.
   */
  public static assertCallerMayPost<TNote extends BaseModel>(data: {
    noteType: StateChangeNoteType;
    noteModelType: { new (): TNote };
    note: TNote;
    props: DatabaseCommonInteractionProps;
  }): void {
    try {
      ModelPermission.checkCreatePermissions(
        data.noteModelType,
        data.note,
        data.props,
      );
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          StateChangeNote.getRefusalMessage(data.noteType, error.message),
        );
      }

      throw error;
    }
  }

  /*
   * What a refused change says: that it was not saved, why (the note's own
   * refusal, which names the permissions that post one), and what to do.
   */
  public static getRefusalMessage(
    noteType: StateChangeNoteType,
    reason: string,
  ): string {
    const trimmedReason: string = reason.trim();
    const reasonSentence: string = ENDS_A_SENTENCE.test(trimmedReason)
      ? trimmedReason
      : `${trimmedReason}.`;

    return `The state was not changed: it comes with a ${noteType} note, which you may not post. ${reasonSentence} To change the state, leave the ${noteType} note out.`;
  }

  /*
   * Writes one column of a note, or nothing when there is nothing to write.
   * A column the note model does not have is a mistake in the caller, never
   * something to skip quietly.
   */
  private static setNoteColumn(
    note: BaseModel,
    column: string,
    value: unknown,
  ): void {
    if (!note.isTableColumn(column)) {
      throw new BadDataException(
        `${note.singularName || "The note"} has no ${column} column to post a state change's note with.`,
      );
    }

    if (value === null || value === undefined) {
      return;
    }

    note.setColumnValue(column, value as JSONValue | ObjectID | Date);
  }
}
