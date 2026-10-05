import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import ModelPermission from "../../Types/Database/Permissions/Index";

/*
 * THE PUBLIC NOTE A STATE CHANGE POSTS.
 *
 * Moving an incident or a scheduled maintenance event to another state can
 * post a public note with it: "Add a public note" in the state change
 * dialogs, the Change State bulk action, or `miscDataProps.publicNote` over
 * the API. With "Notify Status Page Subscribers" on, that note is the one
 * message subscribers get about the change, and the change itself is
 * recorded as sent by it (StateChangeSubscriberNotification). So:
 *
 *  - The note is posted whenever the change is saved, or the change is not
 *    saved. The scheduled maintenance timeline posts its note before the
 *    change, as the person changing the state, so a note they may not post
 *    refuses the change. The incident timeline posts its note once the
 *    change is saved, so that the note comes after the change in the
 *    incident feed and in Slack, and a refused note used to leave a change
 *    recorded as sent by a note that never existed: nobody was told. Both
 *    now ask first (assertCallerMayPost), with the very check the note's own
 *    create runs, and refuse the whole change with one plain message.
 *
 *  - The note names the state the event moved to. It carries the state
 *    (IncidentPublicNote.postedWithIncidentState,
 *    ScheduledMaintenancePublicNote.postedWithScheduledMaintenanceState), and
 *    the public note jobs put it in every default message: the email, the
 *    SMS, Slack, Microsoft Teams and the webhook payload ("Status:
 *    Resolved"). A note posted on its own carries none, and its messages are
 *    as they were.
 *
 * Only the note a state timeline service posts with a change carries a
 * state. The service marks the note it is about to create (markPostedWith),
 * and the note service keeps the state on a note marked so and on no other
 * (getStatePostedWith): a note from the Public Notes page, Slack, a workflow
 * or an API call has none, whatever its create sent, so no message says a
 * state changed when it did not. The mark is the note object itself, held
 * weakly for the length of its create: nothing a request carries can make
 * one.
 */

const STATES_OF_NOTES_POSTED_WITH_A_CHANGE: WeakMap<BaseModel, ObjectID> =
  new WeakMap<BaseModel, ObjectID>();

const ENDS_A_SENTENCE: RegExp = /[.!?]$/;

export default class StateChangePublicNote {
  /*
   * Marks `note`, about to be created, as the public note of a state change
   * to `stateId`.
   */
  public static markPostedWith(note: BaseModel, stateId: ObjectID): void {
    STATES_OF_NOTES_POSTED_WITH_A_CHANGE.set(note, stateId);
  }

  /*
   * The state the note being created was posted with: the one its state
   * change marked it with, or null for a note posted on its own.
   */
  public static getStatePostedWith(
    note: BaseModel | null | undefined,
  ): ObjectID | null {
    if (!note) {
      return null;
    }

    return STATES_OF_NOTES_POSTED_WITH_A_CHANGE.get(note) || null;
  }

  /*
   * Refuses a state change whose public note the person changing the state
   * may not post: the check the note's create runs
   * (ModelPermission.checkCreatePermissions, with the same note and the same
   * props), asked before anything of the change is read or written. A
   * permission refusal is reworded to say what it means for the change;
   * anything else is passed on as it is. OneUptime's own changes (root) are
   * not asked, as the note's create does not ask them.
   */
  public static assertCallerMayPost<TNote extends BaseModel>(data: {
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
          StateChangePublicNote.getRefusalMessage(error.message),
        );
      }

      throw error;
    }
  }

  /*
   * What a refused change says: that it was not saved, why (the note's own
   * refusal, which names the permissions that post one), and what to do.
   */
  public static getRefusalMessage(reason: string): string {
    const trimmedReason: string = reason.trim();
    const reasonSentence: string = ENDS_A_SENTENCE.test(trimmedReason)
      ? trimmedReason
      : `${trimmedReason}.`;

    return `The state was not changed: it comes with a public note, which you may not post. ${reasonSentence} To change the state, leave the public note out.`;
  }
}
