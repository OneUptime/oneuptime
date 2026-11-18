import DataMigrationBase from "./DataMigrationBase";
import IncidentCallTranscriptSignInBackfill from "Common/Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptSignInBackfill";

/*
 * IncidentVideoCall.transcriptSignInAccountId, added by the schema migration
 * AddIncidentCallTranscriptPostsAndSignIn1809184700000 (#9289): the account
 * whose sign-in OneUptime read a call's transcript through, so that the
 * account removing OneUptime from Zoom deletes it.
 *
 * A transcript read from now on names it. This names the ones an earlier
 * release read, and marks for deletion those read through a sign-in Zoom
 * already removed (IncidentCallTranscriptSignInBackfill); the Workers job
 * DeleteTranscriptsOfRemovedSignIns deletes them within minutes.
 *
 * Postgres only. Idempotent, and safe to run twice at once: a call named
 * once is never named again.
 */
export default class BackfillIncidentCallTranscriptSignInAccount extends DataMigrationBase {
  public constructor() {
    super("BackfillIncidentCallTranscriptSignInAccount");
  }

  public override async migrate(): Promise<void> {
    await IncidentCallTranscriptSignInBackfill.run();
  }

  public override async rollback(): Promise<void> {
    // The column goes with the schema migration's down(); nothing to undo here.
    return;
  }
}
