import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStepsColumnTransformer from "../../../Types/Monitor/MonitorStepsColumnTransformer";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * THE MONITOR A PROBE IS HANDED, READ BY THE CLAIM'S OWN STATEMENT (#11120).
 *
 * A probe's /monitor/list claimed its due monitor probes in one statement
 * (MonitorProbeService.claimMonitorProbesForProbing), then read them again
 * with their monitor (MonitorProbeService.findBy by _id) to build its
 * answer: two round trips to Postgres for every request, each holding the
 * request's probe scheduling slot. On a busy database a round trip is most
 * of what a request costs. The claim already reads each claimed row's
 * monitor (its interval, its pause flags), so it now hands back the
 * monitor's columns the answer is made of too, and the answer is built from
 * them: one round trip.
 *
 * These are exactly the columns the read used to select, and each is read
 * as TypeORM reads it from a monitor joined through MonitorProbe.monitor:
 * through the column's own transformer, a NULL as null. So the probe is
 * handed the same JSON it always was (MonitorProbeClaimedMonitorsPostgres
 * compares the two on Postgres). A column added to the probe's answer goes
 * here and into COLUMNS together.
 */

// The monitor's columns, as the claim's statement names them.
export interface ClaimedMonitorRow {
  monitorId?: string | null;
  monitorProjectId?: string | null;
  monitorType?: string | null;
  monitoringInterval?: string | null;
  monitorSteps?: unknown;
}

const OBJECT_ID_TRANSFORMER: ValueTransformer =
  ObjectID.getDatabaseTransformer();

export default class ClaimedMonitor {
  /*
   * What the claim's read of the due rows selects of each one's monitor
   * (`m`), besides the interval it schedules by - which it already selects,
   * as "monitoringInterval".
   */
  public static readonly COLUMNS: ReadonlyArray<string> = [
    `m."_id" AS "monitorId"`,
    `m."projectId" AS "monitorProjectId"`,
    `m."monitorType"`,
    `m."monitorSteps"`,
  ];

  // The same columns, as the claimed rows hand them on (a CTE's `c`).
  public static readonly COLUMNS_OF_CLAIMED: ReadonlyArray<string> = [
    `c."monitorId"`,
    `c."monitorProjectId"`,
    `c."monitorType"`,
    `c."monitorSteps"`,
  ];

  /*
   * The monitor of a claimed row, as the probe is handed it: its id,
   * project, type, interval and steps. A row with no monitor id (never
   * one the claim's inner join hands back) gives a monitor without one,
   * which the route leaves out as it always did.
   */
  public static fromRow(row: ClaimedMonitorRow): Monitor {
    const monitor: Monitor = new Monitor();

    if (row.monitorId) {
      monitor._id = String(row.monitorId);
    }

    /*
     * As TypeORM hydrates each column: a value the statement did not hand
     * back stays unset, a NULL goes through the column's transformer too,
     * and a text column is node-postgres's string, a NULL as null.
     */
    if (row.monitorProjectId !== undefined) {
      monitor.projectId = OBJECT_ID_TRANSFORMER.from(
        row.monitorProjectId,
      ) as ObjectID;
    }

    if (row.monitorType !== undefined) {
      monitor.monitorType = row.monitorType as MonitorType;
    }

    if (row.monitoringInterval !== undefined) {
      monitor.monitoringInterval = row.monitoringInterval as string;
    }

    if (row.monitorSteps !== undefined) {
      monitor.monitorSteps = MonitorStepsColumnTransformer.from(
        row.monitorSteps,
      ) as MonitorSteps;
    }

    return monitor;
  }
}
