import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
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
 *    (`privateNote`), which stays with the team.
 *
 * The note is posted as the person changing the state, and posting a note is
 * a permission of its own (Create Alert Internal Note, Create Incident Status
 * Page Note, ...), apart from changing the state. A note posted once the
 * change is saved used to fail after the fact: the change was saved, and the
 * person who sent it was answered with an error, as if nothing had happened.
 *
 * So every state timeline asks first, before anything of the change is read
 * or written, with the very check the note's own create runs
 * (ModelPermission.checkCreatePermissions, with the same note and the same
 * props), and a change whose note its sender may not post is refused whole,
 * with one plain message: the state was not changed, why, and that leaving
 * the note out lets the change through. OneUptime's own changes (root) are
 * not asked, as the note's create does not ask them.
 */

export enum StateChangeNoteType {
  Public = "public",
  Private = "private",
}

const ENDS_A_SENTENCE: RegExp = /[.!?]$/;

export default class StateChangeNote {
  // The misc data prop a private note travels under (Dashboard Utils/BulkStateChange).
  public static readonly privateNoteKey: string = "privateNote";

  /*
   * The private note posted with a state change, as it was written, or
   * undefined when there is none. A note with no text in it - spaces and
   * line breaks only - is none, and so is anything that is not text, as for
   * the public note (StateChangeSubscriberNotification.getPublicNote): the
   * dashboard never sends a blank one, and one would post an empty note.
   */
  public static getPrivateNote(
    miscDataProps: JSONObject | undefined | null,
  ): string | undefined {
    if (!miscDataProps || typeof miscDataProps !== "object") {
      return undefined;
    }

    const note: unknown = miscDataProps[this.privateNoteKey];

    if (typeof note !== "string" || note.trim().length === 0) {
      return undefined;
    }

    return note;
  }

  /*
   * The private note a state change posts, built and checked in the state
   * timeline's onBeforeCreate: undefined when the change carries none, else
   * the note - filled in by `fill` with its event, text, time and project -
   * once its sender is known to be allowed to post it. A sender who may not
   * is refused here, and with them the whole change. The state timeline
   * posts the note it is given once the change is saved.
   */
  public static preparePrivateNote<TNote extends BaseModel>(data: {
    miscDataProps: JSONObject | undefined | null;
    noteModelType: { new (): TNote };
    props: DatabaseCommonInteractionProps;
    fill: (note: TNote, text: string) => void;
  }): TNote | undefined {
    const text: string | undefined = StateChangeNote.getPrivateNote(
      data.miscDataProps,
    );

    if (!text) {
      return undefined;
    }

    const note: TNote = new data.noteModelType();
    data.fill(note, text);

    StateChangeNote.assertCallerMayPost({
      noteType: StateChangeNoteType.Private,
      noteModelType: data.noteModelType,
      note: note,
      props: data.props,
    });

    return note;
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
}
