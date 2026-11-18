import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import TelemetryMilestoneBackfill, {
  TELEMETRY_MILESTONE_BACKFILL_TABLES,
  TelemetryMilestoneBackfillResult,
} from "Common/Server/Utils/Activation/TelemetryMilestoneBackfill";
import logger from "Common/Server/Utils/Logger";

/*
 * The first-data marks (ProjectMilestone: first logs, traces, metrics,
 * exceptions and profiles) of every project whose telemetry ClickHouse
 * holds, at its earliest row, so a project that sent telemetry before the
 * marks were kept and nothing since does not meet "Send your first logs"
 * over its own logs, nor "Logs - Not set up" in the products menu (#9454).
 * BackfillProjectMilestones read them from metered usage, which a
 * self-hosted server did not have yet and OneUptime Cloud keeps only for
 * what it bills (TelemetryMilestoneBackfill says what each missed).
 *
 * Reads ClickHouse through its Distributed tables, so it runs on every
 * install (runsInClusterMode stays true). A batch of projects at a time,
 * every statement bounded, the whole run within a time budget, a table the
 * install never had skipped; a read that fails is logged and the project
 * gets its mark with its next data, so nothing here holds back the
 * migrations after it. Idempotent, and safe to run twice at once: every
 * mark goes in with ON CONFLICT DO NOTHING, and a mark kept live stays as
 * it was.
 */
export default class BackfillTelemetryMilestonesFromClickhouse extends DataMigrationBase {
  public constructor() {
    super("BackfillTelemetryMilestonesFromClickhouse");
  }

  public override async migrate(): Promise<void> {
    const result: TelemetryMilestoneBackfillResult =
      await TelemetryMilestoneBackfill.backfill({
        tableExists: async (tableName: string): Promise<boolean> => {
          return await ClickHouseMigrationUtil.tableExists(tableName);
        },
      });

    for (const message of BackfillTelemetryMilestonesFromClickhouse.describe(
      result,
    )) {
      if (message.isWarning) {
        logger.warn(message.text);
      } else {
        logger.info(message.text);
      }
    }
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: a backfilled mark is data the project has.
    return;
  }

  // What the run did, as the lines the log says it with.
  public static describe(
    result: TelemetryMilestoneBackfillResult,
  ): Array<{ text: string; isWarning: boolean }> {
    const name: string = "BackfillTelemetryMilestonesFromClickhouse";

    if (
      result.missingTables.length === TELEMETRY_MILESTONE_BACKFILL_TABLES.length
    ) {
      return [
        {
          text: `${name}: this install has no telemetry tables (${result.missingTables.join(", ")}); nothing to read.`,
          isWarning: false,
        },
      ];
    }

    const kept: string = Object.entries(result.keptByMilestone)
      .filter((entry: [string, number | undefined]): boolean => {
        return Boolean(entry[1]);
      })
      .map((entry: [string, number | undefined]): string => {
        return `${entry[1]} ${entry[0]}`;
      })
      .join(", ");

    const lines: Array<{ text: string; isWarning: boolean }> = [
      {
        text: `${name}: read ${result.projects} project(s) and kept ${kept || "no marks"}.`,
        isWarning: false,
      },
    ];

    if (result.missingTables.length > 0) {
      lines.push({
        text: `${name}: skipped the tables this install does not have: ${result.missingTables.join(", ")}.`,
        isWarning: false,
      });
    }

    if (
      result.failedReads > 0 ||
      result.unkeptMarks > 0 ||
      result.isStoppedByTimeBudget ||
      result.uncheckedTables.length > 0
    ) {
      const what: Array<string> = [];

      if (result.uncheckedTables.length > 0) {
        what.push(
          `did not read ${result.uncheckedTables.join(", ")}, which ClickHouse could not say it has`,
        );
      }

      if (result.isStoppedByTimeBudget) {
        what.push("stopped at its time budget");
      }

      if (result.failedReads > 0) {
        what.push(`${result.failedReads} read(s) of a project's table failed`);
      }

      if (result.unkeptMarks > 0) {
        what.push(`${result.unkeptMarks} mark(s) could not be written`);
      }

      lines.push({
        text: `${name}: ${what.join(", ")}; those projects get their marks with their next data${result.lastError ? ` (last error: ${result.lastError})` : ""}.`,
        isWarning: true,
      });
    }

    return lines;
  }
}
