import StatusPageVisibility, {
  StatusPageVisibilitySwitches,
} from "./StatusPageVisibility";

/*
 * A PRIVATE INCIDENT OR EPISODE TAKES NO PUBLIC NOTES.
 *
 * A public note is an update for the people outside the team: it is shown
 * on the status pages its incident or episode is shown on, and it can be
 * sent to their subscribers. A private incident or episode is shown on no
 * status page and is told to no subscriber (StatusPageVisibility), so a
 * public note posted on one reached nobody it was written for - while the
 * form that wrote it promised it would ("visible to all subscribers of this
 * incident and will show up on the status page"). So one that is private
 * takes no new public notes, on every way a public note is made:
 *
 *  - the server refuses it, with the one sentence below: the API and
 *    workflows, the AI's status update, Slack and Microsoft Teams, an SLA's
 *    reminders, and the note a state change posts
 *    (Server/Utils/Notes/PrivateRecordPublicNoteRule);
 *  - the Dashboard does not offer it: Add Public Note is locked with that
 *    sentence, the Public Notes page says it, and a private incident's state
 *    change dialog offers a private note instead;
 *  - in Slack and Microsoft Teams a public note asked for on one - a 📣 on a
 *    message, or a form opened before it was made private - is saved as a
 *    private note, and the answer says so.
 *
 * The public notes it had before it was made private stay as they were:
 * read by the people who can read it, shown on no status page while it is
 * private, and shown again with it once it is not.
 *
 * Shared by the server, which refuses, and the Dashboard, which locks: the
 * two say the same thing.
 */

// The records that have public notes and can be made private.
export enum PrivateRecordKind {
  Incident = "Incident",
  IncidentEpisode = "IncidentEpisode",
}

// How a sentence names each one.
const RECORD_NOUNS: Record<PrivateRecordKind, string> = {
  [PrivateRecordKind.Incident]: "incident",
  [PrivateRecordKind.IncidentEpisode]: "episode",
};

export default class PrivateRecordPublicNotes {
  /*
   * Whether a record takes new public notes: it is not private. A record
   * that was not read (undefined) is not refused here - whatever reads it
   * decides - and an odd Private value counts as private
   * (StatusPageVisibility.isPrivate), so it is refused rather than let
   * through.
   */
  public static takesPublicNotes(
    record: StatusPageVisibilitySwitches | undefined | null,
  ): boolean {
    return !StatusPageVisibility.isPrivate(record);
  }

  // "incident", "episode".
  public static getNoun(kind: PrivateRecordKind): string {
    return RECORD_NOUNS[kind];
  }

  /*
   * Why a public note is not taken, in English: the API's refusal, and the
   * words of the Dashboard's lock (its translation key is the same sentence
   * with {{event}} for the record). "This incident is private, so public
   * notes cannot be added to it. Use a private note."
   */
  public static getRefusalMessage(kind: PrivateRecordKind): string {
    return `This ${RECORD_NOUNS[kind]} is private, so public notes cannot be added to it. Use a private note.`;
  }

  /*
   * What a state change that comes with a public note is told on a private
   * record: refused whole, as a change whose note cannot be posted always is
   * (Server/Utils/StateChangeNote), and how to make it.
   */
  public static getStateChangeRefusalMessage(kind: PrivateRecordKind): string {
    return `The state was not changed: it comes with a public note, and this ${RECORD_NOUNS[kind]} is private, so public notes cannot be added to it. Post the note as a private note, or leave it out.`;
  }
}
