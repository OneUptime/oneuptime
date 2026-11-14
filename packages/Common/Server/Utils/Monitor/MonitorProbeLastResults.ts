import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import MonitorProbeService from "../../Services/MonitorProbeService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A monitor's probes as a probe's check result needs them, and that result
 * stored as the probe's last for its step (MonitorProbe.lastMonitoringLog) -
 * in one statement.
 *
 * lastMonitoringLog holds each probe's last result of every step of the
 * monitor: response bodies, headers, a Synthetic monitor's screenshots. A
 * result used to read every probe's whole column, add its own step on the
 * server and write the whole column back. It needs far less:
 *
 *   - its own entry is merged in by Postgres
 *     (COALESCE("lastMonitoringLog", '{}') || jsonb_build_object(step, result)),
 *     so the probe's column is never read out to be written back, and the
 *     entries of its other steps stay as they were;
 *   - of the others, only the step being judged, and only where probe
 *     agreement judges it - an enabled probe that is connected. A disabled or
 *     disconnected probe's column, and the reporting probe's own, are not
 *     read at all; a monitor checked by one probe reads none.
 *
 * The write touches lastMonitoringLog and updatedAt only - no indexed column
 * - so Postgres can make it a HOT update, given room on the page (the
 * table's fillfactor leaves it).
 *
 * The statement is run as OneUptime, without hooks: MonitorProbe's writes
 * of a check result have none (see MonitorResource), and nobody may set
 * lastMonitoringLog through the API.
 */

export interface MonitorProbeOfResult {
  monitorProbeId: ObjectID;
  probeId: ObjectID;
  isEnabled: boolean;
  probeName: string | undefined;
  probeConnectionStatus: ProbeConnectionStatus | undefined;
  /*
   * The probe's last result for the step being judged, read where probe
   * agreement reads it: an enabled, connected probe other than the one
   * reporting - and the reporting probe too when the step judged is not the
   * step it reported (a step deleted since the probe was handed the check).
   * Undefined everywhere else, and where the probe has no result for it.
   */
  resultForJudgedStep: ProbeMonitorResponse | undefined;
}

export interface MonitorProbesOfResult {
  probes: Array<MonitorProbeOfResult>;
  // Whether the reporting probe's result was stored under its row.
  isResultStored: boolean;
}

interface MonitorProbeRow {
  monitorProbeId: string;
  probeId: string;
  isEnabled: boolean | null;
  probeName: string | null;
  probeConnectionStatus: string | null;
  resultForJudgedStep: JSONObject | null;
  storedCount?: number | string | null;
}

export default class MonitorProbeLastResults {
  /*
   * Stores `result` as the reporting probe's last result of
   * `reportedStepId`, if the probe is one of the monitor's, and reads the
   * monitor's probes. The write is the UPDATE of a data-modifying CTE: the
   * rows read are the ones from before it, so the reporting probe's own
   * column is never part of the answer.
   *
   * With no `result` (an SNMP trap, which is not a check of its own), the
   * probes are only read. With no `judgedStepId` (nothing will be judged),
   * no probe's result is read.
   */
  @CaptureSpan()
  public static async storeResultAndReadProbes(input: {
    monitorId: ObjectID;
    reportingProbeId: ObjectID;
    reportedStepId: string;
    judgedStepId: string | undefined;
    // The storable copy of the result, as the column keeps it.
    result: JSONObject | undefined;
  }): Promise<MonitorProbesOfResult> {
    const params: Array<unknown> = [
      input.monitorId.toString(),
      input.reportingProbeId.toString(),
      input.judgedStepId || null,
      input.reportedStepId,
      ProbeConnectionStatus.Connected,
      LIMIT_PER_PROJECT,
    ];

    let sql: string = this.getProbesSelect({ withStoredCount: false });

    if (input.result !== undefined) {
      params.push(JSON.stringify(input.result));
      sql = `WITH "stored" AS (
        UPDATE "MonitorProbe"
           SET "lastMonitoringLog" = COALESCE("lastMonitoringLog", '{}'::jsonb) || jsonb_build_object($4::text, $7::jsonb),
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE "monitorId" = $1 AND "probeId" = $2 AND "deletedAt" IS NULL
         RETURNING 1
      ) ${this.getProbesSelect({ withStoredCount: true })}`;
    }

    const rows: Array<MonitorProbeRow> =
      (await MonitorProbeService.getRepository().manager.query(
        sql,
        params,
      )) as Array<MonitorProbeRow>;

    return {
      probes: rows.map((row: MonitorProbeRow) => {
        return this.toProbe(row);
      }),
      isResultStored:
        input.result !== undefined &&
        rows.length > 0 &&
        Number(rows[0]!.storedCount || 0) > 0,
    };
  }

  /*
   * The monitor's probes and, of those agreement reads, their last result
   * of `judgedStepId` - for a result that names no reporting probe of its
   * own to store.
   */
  @CaptureSpan()
  public static async readProbes(input: {
    monitorId: ObjectID;
    judgedStepId: string;
  }): Promise<Array<MonitorProbeOfResult>> {
    const rows: Array<MonitorProbeRow> =
      (await MonitorProbeService.getRepository().manager.query(
        this.getProbesSelect({ withStoredCount: false }),
        [
          input.monitorId.toString(),
          null,
          input.judgedStepId,
          input.judgedStepId,
          ProbeConnectionStatus.Connected,
          LIMIT_PER_PROJECT,
        ],
      )) as Array<MonitorProbeRow>;

    return rows.map((row: MonitorProbeRow) => {
      return this.toProbe(row);
    });
  }

  /*
   * $1 the monitor, $2 the reporting probe (null: none), $3 the step judged
   * (null: none), $4 the step reported, $5 the connected status, $6 the
   * limit. A probe's step is extracted only where agreement reads it, so
   * Postgres detoasts no other column. The probe join keeps a deleted
   * probe's name and status out, as the ORM's relation read did, and the
   * order is the ORM's default read order (newest first): probe agreement
   * breaks a tie by the order it meets the probes in.
   */
  private static getProbesSelect(data: { withStoredCount: boolean }): string {
    return `SELECT mp."_id" AS "monitorProbeId",
           mp."probeId" AS "probeId",
           mp."isEnabled" AS "isEnabled",
           p."name" AS "probeName",
           p."connectionStatus" AS "probeConnectionStatus",
           CASE
             WHEN $3::text IS NULL THEN NULL
             WHEN ($2::uuid IS NULL OR mp."probeId" <> $2::uuid)
                  AND mp."isEnabled" = true
                  AND p."connectionStatus" = $5::text
               THEN mp."lastMonitoringLog" -> $3::text
             WHEN mp."probeId" = $2::uuid AND $3::text <> $4::text
               THEN mp."lastMonitoringLog" -> $3::text
             ELSE NULL
           END AS "resultForJudgedStep"${
             data.withStoredCount
               ? `,
           (SELECT count(*) FROM "stored")::int AS "storedCount"`
               : ""
           }
      FROM "MonitorProbe" mp
      LEFT JOIN "Probe" p ON p."_id" = mp."probeId" AND p."deletedAt" IS NULL
     WHERE mp."monitorId" = $1 AND mp."deletedAt" IS NULL
     ORDER BY mp."createdAt" DESC, mp."_id"
     LIMIT $6`;
  }

  private static toProbe(row: MonitorProbeRow): MonitorProbeOfResult {
    return {
      monitorProbeId: new ObjectID(row.monitorProbeId),
      probeId: new ObjectID(row.probeId),
      isEnabled: row.isEnabled === true,
      probeName: row.probeName || undefined,
      probeConnectionStatus:
        (row.probeConnectionStatus as ProbeConnectionStatus | null) ||
        undefined,
      resultForJudgedStep:
        (row.resultForJudgedStep as unknown as ProbeMonitorResponse | null) ||
        undefined,
    };
  }
}
