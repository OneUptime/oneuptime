import DataMigrationBase from "./DataMigrationBase";
import WorkspaceNotificationSummaryService, {
  WorkspaceSummaryTimezoneBackfillResult,
} from "Common/Server/Services/WorkspaceNotificationSummaryService";
import logger from "Common/Server/Utils/Logger";

/*
 * Gives every workspace summary made before summaries had a time zone one
 * (WorkspaceNotificationSummary.timezone, schema migration
 * 1798900000000-AddWorkspaceSummaryTimezone):
 *
 *   - its creator's, from their profile: the dashboard showed and read the
 *     first summary's time on that clock, so a summary set for 09:00 in
 *     Berlin is one its creator meant to go out at 09:00 in Berlin - and
 *     from now on it does, also after the clocks change;
 *   - UTC for a summary with no creator (an API key or a workflow made it)
 *     or whose creator has no time zone: what it has been read in all
 *     along, so nothing changes for it.
 *
 * Only the time zone is written, without the update hooks: no next send
 * moves, so no summary goes out early, late or twice because of this. The
 * report worker counts each summary's sends on its time zone's clock from
 * its next send on.
 *
 * Postgres-only. Idempotent, and safe to run twice at once as this runner
 * requires (see Workers/Utils/DataMigration.ts): a summary is written only
 * while it still has no time zone, so one picked in the meantime is kept
 * (WorkspaceNotificationSummaryService.fillTimezonesFromCreators).
 */
export default class SetWorkspaceSummaryTimezones extends DataMigrationBase {
  public constructor() {
    super("SetWorkspaceSummaryTimezones");
  }

  public override async migrate(): Promise<void> {
    const result: WorkspaceSummaryTimezoneBackfillResult =
      await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    logger.info(
      `SetWorkspaceSummaryTimezones: gave ${result.fromCreator} workspace summary(ies) their creator's time zone and ${result.utc} UTC, the time zone they were read in until now.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: dropping the column (the schema migration's down)
     * takes the time zones with it.
     */
    return;
  }
}
