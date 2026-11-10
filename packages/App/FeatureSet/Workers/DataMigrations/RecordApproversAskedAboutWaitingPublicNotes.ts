import DataMigrationBase from "./DataMigrationBase";
import PublicNoteApproverChanges from "Common/Server/Utils/Notes/PublicNoteApproverChanges";
import logger from "Common/Server/Utils/Logger";

/*
 * Since #6353 OneUptime records whom it asked to approve each step of a
 * public note (PublicNoteApprovalRequest), so that when who approves changes
 * while a note waits - its approval steps, or the members of a team a step
 * names - the step's people who were not asked yet are asked, and nobody
 * twice. A note that was already waiting when that began was asked without
 * a record: this records the people the step it waits for asks now as
 * asked about it, as they were when the note reached the step, without
 * asking anybody - so the first change after the upgrade asks only those who
 * are new to it.
 *
 * Postgres-only. Idempotent, and safe to run twice at once: a request is
 * written once (its unique index), and a note recorded already writes
 * nothing.
 */
export default class RecordApproversAskedAboutWaitingPublicNotes extends DataMigrationBase {
  public constructor() {
    super("RecordApproversAskedAboutWaitingPublicNotes");
  }

  public override async migrate(): Promise<void> {
    const recorded: number =
      await PublicNoteApproverChanges.recordWaitingNotesAsAsked();

    logger.info(
      `RecordApproversAskedAboutWaitingPublicNotes: recorded ${recorded} request(s) of approvers already asked about public notes waiting for approval.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: the records only say whom a step asked already.
    return;
  }
}
