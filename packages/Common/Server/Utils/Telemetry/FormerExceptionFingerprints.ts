import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../Services/ExceptionInstanceService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import JobDeadline from "../JobDeadline";
import logger from "../Logger";

/*
 * AN EXCEPTION'S FORMER FINGERPRINT IS KEPT ONLY WHILE AN OCCURRENCE CARRIES IT
 * (#10619).
 *
 * An exception moved to a private fingerprint (TelemetryExceptionRekey)
 * keeps its old one as a row merged into it, because the occurrences
 * recorded before the move carry the old one in ClickHouse, where a sort key
 * is never rewritten: the exception's page, its monitors and the links from
 * its session replays and security events find them through that row. Those
 * occurrences go when their retention ends. Then the row finds nothing, and
 * only keeps an unkeyed hash of text a scrub rule hid, which anyone who
 * reads the exception could hash guesses against - so it is deleted, and the
 * old fingerprint is gone from Postgres too.
 *
 * Every day, in batches: the rows that keep a former fingerprint, a day or
 * more after the move - by then no process groups an occurrence under the old
 * fingerprint any more, as each keeps what it looked up for ten minutes at
 * most - and, of those, the ones no occurrence ClickHouse still keeps
 * carries, project by project. A project whose occurrences cannot be read
 * keeps its rows for the next run. Its exception's counts, seen times and
 * state are its own row's and are not touched.
 */

// How long after the move a former fingerprint is kept, at least.
export const FORMER_FINGERPRINT_MIN_AGE_MS: number = 24 * 60 * 60 * 1000;

// How many rows a batch reads.
export const FORMER_FINGERPRINTS_PER_BATCH: number = 500;

// The lowest id, which every row's is above.
const FIRST_ID: string = "00000000-0000-0000-0000-000000000000";

interface FormerFingerprintRow {
  id: string;
  projectId: string;
  fingerprint: string;
}

export interface FormerFingerprintsRetired {
  // The rows that keep a former fingerprint read, and those deleted.
  read: number;
  retired: number;
}

export default class FormerExceptionFingerprints {
  /*
   * Of `fingerprints`, those an occurrence of `projectId` that ClickHouse
   * still keeps carries: any occurrence, a repeat of a crash too.
   */
  public static buildCarriedStatement(data: {
    projectId: ObjectID;
    fingerprints: Array<string>;
  }): Statement {
    return SQL`SELECT fingerprint FROM ${AnalyticsTableName.ExceptionInstance} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND fingerprint IN (${{
      type: TableColumnType.Text,
      value: new Includes(data.fingerprints),
    }}) AND retentionDate >= now() GROUP BY fingerprint`;
  }

  // Those carried still; null when they cannot be read.
  public static async readCarried(data: {
    projectId: ObjectID;
    fingerprints: Array<string>;
  }): Promise<Set<string> | null> {
    if (data.fingerprints.length === 0) {
      return new Set<string>();
    }

    try {
      const result: Results = await ExceptionInstanceService.executeQuery(
        FormerExceptionFingerprints.buildCarriedStatement(data),
      );
      const response: DbJSONResponse = await result.json<{
        data?: Array<JSONObject>;
      }>();

      return new Set<string>(
        (response.data || []).map((row: JSONObject): string => {
          return String(row["fingerprint"] || "");
        }),
      );
    } catch (err) {
      logger.warn(
        `Could not read which former exception fingerprints of project ${data.projectId.toString()} occurrences still carry; they are kept for now: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  // Deletes the rows that keep a former fingerprint no occurrence carries.
  public static async retireUncarried(
    data: {
      deadline?: JobDeadline | undefined;
      // How long a run reads, at most; what is left waits for the next run.
      timeBudgetMs?: number | undefined;
      now?: Date | undefined;
    } = {},
  ): Promise<FormerFingerprintsRetired> {
    const deadline: JobDeadline = data.deadline || JobDeadline.none();
    const startedAt: number = Date.now();
    const isOutOfTime: () => boolean = (): boolean => {
      return (
        deadline.hasPassed() ||
        (data.timeBudgetMs !== undefined &&
          Date.now() - startedAt >= data.timeBudgetMs)
      );
    };
    const movedBefore: Date = new Date(
      (data.now || new Date()).getTime() - FORMER_FINGERPRINT_MIN_AGE_MS,
    );
    const total: FormerFingerprintsRetired = { read: 0, retired: 0 };
    let after: string = FIRST_ID;

    while (!isOutOfTime()) {
      const rows: Array<FormerFingerprintRow> =
        (await TelemetryExceptionService.getRepository().manager.query(
          `SELECT "_id"::text AS "id", "projectId"::text AS "projectId", "fingerprint" FROM "TelemetryException" WHERE "formerFingerprintOfTelemetryExceptionId" IS NOT NULL AND "mergedAt" < $1 AND "_id" > $2::uuid ORDER BY "_id" LIMIT $3`,
          [movedBefore, after, FORMER_FINGERPRINTS_PER_BATCH],
        )) || [];

      if (rows.length === 0) {
        break;
      }

      total.read += rows.length;
      after = rows[rows.length - 1]!.id;

      const byProject: Map<string, Array<FormerFingerprintRow>> = new Map();

      for (const row of rows) {
        byProject.set(row.projectId, [
          ...(byProject.get(row.projectId) || []),
          row,
        ]);
      }

      const toRetire: Array<string> = [];
      const projects: Array<string> = [];

      for (const [projectId, projectRows] of byProject) {
        const carried: Set<string> | null =
          await FormerExceptionFingerprints.readCarried({
            projectId: new ObjectID(projectId),
            fingerprints: projectRows.map((row: FormerFingerprintRow) => {
              return row.fingerprint;
            }),
          });

        if (!carried) {
          continue;
        }

        const uncarried: Array<FormerFingerprintRow> = projectRows.filter(
          (row: FormerFingerprintRow): boolean => {
            return !carried.has(row.fingerprint);
          },
        );

        if (uncarried.length > 0) {
          projects.push(projectId);
          toRetire.push(
            ...uncarried.map((row: FormerFingerprintRow): string => {
              return row.id;
            }),
          );
        }
      }

      if (toRetire.length > 0) {
        await TelemetryExceptionService.getRepository().manager.query(
          `DELETE FROM "TelemetryException" WHERE "_id" = ANY($1::uuid[]) AND "formerFingerprintOfTelemetryExceptionId" IS NOT NULL`,
          [toRetire],
        );

        total.retired += toRetire.length;

        // Their exceptions' groups lost a member: every process reads them again.
        await TelemetryExceptionService.forgetGroupFingerprints(projects);
      }

      if (rows.length < FORMER_FINGERPRINTS_PER_BATCH) {
        break;
      }
    }

    return total;
  }
}
