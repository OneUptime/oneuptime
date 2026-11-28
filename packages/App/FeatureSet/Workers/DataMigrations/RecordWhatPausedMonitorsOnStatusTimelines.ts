import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorPausedBy from "Common/Types/Monitor/MonitorPausedBy";

/*
 * Says, on the status events that marked a monitor's time left out because
 * a pause - rather than its monitoring switch - stopped its checks, what
 * paused it (MonitorStatusTimeline.pausedBy, issue #11433): an incident
 * declared by hand (#11141), scheduled maintenance (#11301), or both. The
 * day bars, their dialog and the Status Timeline then say that time was
 * "paused", and why, as they do for every such event marked since, and keep
 * "monitoring off" for monitoring turned off.
 *
 * Which events those are is read from the note each was written with
 * (MonitorIncidentPause.getUptimeRootCause, Utils/Monitor/StatusChangeNotes):
 * every one opens "Monitoring is paused by", and the maintenance ones say so
 * as written. A row whose note was typed by a person, or that marks
 * monitoring turned off, keeps none.
 *
 * Paged by monitor, each page one UPDATE that the (monitorId, startsAt)
 * index narrows to the page's monitors, so the table is never scanned. Only
 * rows with no pausedBy yet are written: safe to run twice, and twice at
 * once. A page that fails is logged and the rest go on; its rows keep
 * reading "monitoring off", as before.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorIdRow {
  _id: string;
}

export const PAGE_SIZE: number = 500;

/*
 * Each note a pause marks time with opens the same way, and the ones that
 * name maintenance say so where the incidents' would be.
 */
export const PAUSED_NOTE_PREFIX: string = "Monitoring is paused by ";
export const PAUSED_FOR_MAINTENANCE_NOTE_PREFIX: string =
  "Monitoring is paused by scheduled maintenance (";
export const PAUSED_BY_BOTH_NOTE_PART: string =
  ", declared by hand, and by scheduled maintenance (";

export const RECORD_WHAT_PAUSED_SQL: string = `UPDATE "MonitorStatusTimeline" AS "timeline" SET "pausedBy" = CASE WHEN "timeline"."rootCause" LIKE '${PAUSED_FOR_MAINTENANCE_NOTE_PREFIX}%' THEN '${MonitorPausedBy.ScheduledMaintenance}' WHEN "timeline"."rootCause" LIKE '${PAUSED_NOTE_PREFIX}%${PAUSED_BY_BOTH_NOTE_PART}%' THEN '${MonitorPausedBy.IncidentAndScheduledMaintenance}' ELSE '${MonitorPausedBy.Incident}' END WHERE "timeline"."monitorId" = ANY($1::uuid[]) AND "timeline"."isMonitoringOff" = true AND "timeline"."pausedBy" IS NULL AND "timeline"."rootCause" LIKE '${PAUSED_NOTE_PREFIX}%' RETURNING "timeline"."_id"`;

export default class RecordWhatPausedMonitorsOnStatusTimelines extends DataMigrationBase {
  public constructor() {
    super("RecordWhatPausedMonitorsOnStatusTimelines");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    let lastId: string | null = null;
    let read: number = 0;
    let recorded: number = 0;
    let failed: number = 0;

    while (true) {
      // Every monitor, deleted ones too: their rows read as any others.
      const rows: Array<MonitorIdRow> = (await repository.manager.query(
        `SELECT "_id" FROM "Monitor"${
          lastId ? ` WHERE "_id" > $2` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId ? [PAGE_SIZE, lastId] : [PAGE_SIZE],
      )) as Array<MonitorIdRow>;

      if (rows.length === 0) {
        break;
      }

      read += rows.length;

      try {
        recorded += RecordWhatPausedMonitorsOnStatusTimelines.countRows(
          await repository.manager.query(RECORD_WHAT_PAUSED_SQL, [
            rows.map((row: MonitorIdRow): string => {
              return row._id;
            }),
          ]),
        );
      } catch (err) {
        failed += rows.length;
        logger.error(
          `RecordWhatPausedMonitorsOnStatusTimelines: what paused the monitors after ${lastId || "the first"} was not recorded; their paused time keeps reading as monitoring off.`,
        );
        logger.error(err);
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `RecordWhatPausedMonitorsOnStatusTimelines: recorded what paused ${recorded} status event(s) of ${read} monitor(s); ${failed} monitor(s) could not be read.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }

  /*
   * TypeORM answers an UPDATE ... RETURNING on Postgres with [rows, count];
   * a driver that hands back the rows alone is counted by them.
   */
  public static countRows(result: unknown): number {
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[1];
    }

    if (Array.isArray(result)) {
      return result.length;
    }

    return 0;
  }
}
