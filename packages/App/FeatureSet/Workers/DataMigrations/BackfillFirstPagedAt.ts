import DataMigrationBase from "./DataMigrationBase";
import FirstPagedAt, {
  FirstPagedAtBackfillResult,
} from "Common/Server/Utils/OnCall/FirstPagedAt";
import logger from "Common/Server/Utils/Logger";

/*
 * Fills First Paged At - when somebody was first paged about the record -
 * on every incident, alert and episode paged before the upgrade, from the
 * steps of their on-call runs: the earliest step that paged somebody and
 * says the page went out (Common/Server/Utils/OnCall/FirstPagedAt). Records
 * nobody was paged about keep it empty.
 *
 * Measurements are worked out for past records too, so "Time to acknowledge
 * after paging" needs these: a measurement that starts or ends at First
 * Paged At is asked to be worked out again for every record once its
 * records are filled.
 *
 * Not in the schema migration that added the columns
 * (1804760000000-AddFirstPagedAt): it runs in one transaction, and an
 * UPDATE of every row there would hold ADD COLUMN's lock on the incident and
 * alert tables - stopping every new incident and alert - for as long as it
 * took. Here each table is walked in primary key order, a batch at a time.
 *
 * Idempotent, and safe to run twice concurrently as this runner requires
 * (see Workers/Utils/DataMigration.ts): every write fills only what is still
 * empty, checked again by the UPDATE itself, so a page recorded since the
 * upgrade is kept, and two passes write the same values.
 */
export default class BackfillFirstPagedAt extends DataMigrationBase {
  public constructor() {
    super("BackfillFirstPagedAt");
  }

  public override async migrate(): Promise<void> {
    const result: FirstPagedAtBackfillResult = await FirstPagedAt.backfill();

    const filled: string = Object.entries(result.filledByTable)
      .map((entry: [string, number]): string => {
        return `${entry[1]} ${entry[0]}`;
      })
      .join(", ");

    logger.info(
      `BackfillFirstPagedAt: recorded when somebody was first paged on ${filled || "no records"}, and asked ${result.measurementsRequeued} measurement(s) that start or end at it to be worked out again.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: a filled First Paged At is what the column should hold.
    return;
  }
}
