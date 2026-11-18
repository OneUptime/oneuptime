import DataMigrationBase from "./DataMigrationBase";
import TestPageAcknowledgementBackfill, {
  TestPageAcknowledgementBackfillResult,
} from "Common/Server/Utils/WelcomeChecklist/TestPageAcknowledgementBackfill";
import logger from "Common/Server/Utils/Logger";

/*
 * An invited member's first steps on Home end when a test page has reached
 * them (#6807), noted on the project's Welcome checklist state when they
 * acknowledge one. A member who acknowledged a test page before that note
 * was kept - or whose note a write lost before #7043 - still saw "Send
 * yourself a test page" as a step to do. This notes them, from the
 * acknowledgements every test page already records (#7042;
 * Common/Server/Utils/WelcomeChecklist/TestPageAcknowledgementBackfill says
 * where from).
 *
 * Postgres only. Idempotent, and safe to run twice at once: a member noted
 * already is left as they are, and each project's state is written holding
 * its row's lock, as every write of it is, so a member noted live meanwhile
 * is kept. A failure stops the run, which is not recorded as done, so the
 * next boot does it again.
 */
export default class NoteTestPagesAcknowledgedBeforeFirstSteps extends DataMigrationBase {
  public constructor() {
    super("NoteTestPagesAcknowledgedBeforeFirstSteps");
  }

  public override async migrate(): Promise<void> {
    const result: TestPageAcknowledgementBackfillResult =
      await TestPageAcknowledgementBackfill.backfill();

    logger.info(
      `NoteTestPagesAcknowledgedBeforeFirstSteps: read ${result.projects} project(s); ${result.projectsWithTestPages} had a test page acknowledged, and ${result.membersNoted} member(s) are noted now.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: a member noted did acknowledge a test page.
    return;
  }
}
