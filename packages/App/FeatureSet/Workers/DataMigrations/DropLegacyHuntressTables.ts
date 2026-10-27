import DataMigrationBase from "./DataMigrationBase";
import HuntressConnectionsToWorkflows, {
  LegacyTablesDropSummary,
} from "Common/Server/Utils/Huntress/HuntressConnectionsToWorkflows";
import logger from "Common/Server/Utils/Logger";

/*
 * THE LEGACY HUNTRESS TABLES GO, once every connection has its workflow.
 *
 * Huntress connections became workflows (MoveHuntressConnectionsToWorkflows,
 * which runs before this), and nothing reads or writes "HuntressConnection",
 * its two join tables or "HuntressIncidentReport" since. They are dropped in
 * one statement - unless a connection in use has no workflow, because its
 * move failed or its workflow was deleted since: then what it was set up to
 * do is only there, so they are all kept, and the log says how many such
 * connections there are. The move is not run again first: it would make
 * again a workflow someone deleted.
 *
 * What it decides, and the SQL, are in
 * Common/Server/Utils/Huntress/HuntressConnectionsToWorkflows
 * (dropLegacyTables), tested against a migrated Postgres beside the move.
 *
 * A failure to read or drop reaches the runner, to be tried again; keeping
 * the tables is not a failure.
 */
export default class DropLegacyHuntressTables extends DataMigrationBase {
  public constructor() {
    super("DropLegacyHuntressTables");
  }

  public override async migrate(): Promise<void> {
    const summary: LegacyTablesDropSummary =
      await HuntressConnectionsToWorkflows.dropLegacyTables();

    if (summary.outcome === "dropped") {
      logger.info(
        "DropLegacyHuntressTables: every Huntress connection has its workflow, so the legacy Huntress tables were dropped.",
      );
      return;
    }

    if (summary.outcome === "kept") {
      logger.warn(
        `DropLegacyHuntressTables: ${summary.unmoved} Huntress connection(s) have no workflow - their move failed, or the workflow was deleted since - so the legacy Huntress tables are kept, and nothing of theirs is lost.`,
      );
      return;
    }

    logger.info("DropLegacyHuntressTables: no legacy Huntress tables to drop.");
  }

  public override async rollback(): Promise<void> {
    // Dropped tables do not come back: the workflows hold what they held.
    return;
  }
}
