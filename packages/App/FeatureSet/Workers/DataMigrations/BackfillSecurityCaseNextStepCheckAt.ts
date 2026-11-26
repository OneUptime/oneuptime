import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SecurityCaseService from "Common/Server/Services/SecurityCaseService";
import logger from "Common/Server/Utils/Logger";

/*
 * Schedules the first check of the Response Plan's steps (#10340) of every
 * security case that was open before OneUptime checked them: a case opened
 * from now on is scheduled as it opens (SecurityCaseService), and one
 * reopened as it reopens, but one already open would otherwise wait for
 * something on it to change.
 *
 * Each case's first check is spread over the next half hour, so an upgrade
 * with many open cases reads their telemetry a little at a time rather than
 * all in the first minute. A closed case is left as it is: its steps are not
 * checked.
 *
 * Paged on the id, so each statement writes a few hundred rows at most and
 * holds no lock for long on a table every detection writes. Idempotent, and
 * safe to run twice at once: a case is written only while its column is
 * still empty, so one the step checks or the other run scheduled keeps that
 * time.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface CaseIdRow {
  _id: string;
}

export const PAGE_SIZE: number = 500;

// The open cases of one page of ids ($1) not scheduled yet, each within the next half hour.
export const SCHEDULE_OPEN_CASES_SQL: string = `UPDATE "SecurityCase" SET "nextStepCheckAt" = now() + random() * interval '30 minutes' WHERE "_id" = ANY($1::uuid[]) AND "nextStepCheckAt" IS NULL AND "closedAt" IS NULL AND "deletedAt" IS NULL RETURNING "_id"`;

export default class BackfillSecurityCaseNextStepCheckAt extends DataMigrationBase {
  public constructor() {
    super("BackfillSecurityCaseNextStepCheckAt");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      SecurityCaseService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    let lastId: string | null = null;
    let scheduled: number = 0;
    let failed: number = 0;

    while (true) {
      // The open cases, by id alone, so the page is the same however the writes change them.
      const rows: Array<CaseIdRow> = (await repository.manager.query(
        `SELECT "_id" FROM "SecurityCase" WHERE "closedAt" IS NULL AND "deletedAt" IS NULL${
          lastId ? ` AND "_id" > $2` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId ? [PAGE_SIZE, lastId] : [PAGE_SIZE],
      )) as Array<CaseIdRow>;

      if (rows.length === 0) {
        break;
      }

      try {
        scheduled += BackfillSecurityCaseNextStepCheckAt.countRows(
          await repository.manager.query(SCHEDULE_OPEN_CASES_SQL, [
            rows.map((row: CaseIdRow): string => {
              return row._id;
            }),
          ]),
        );
      } catch (err) {
        /*
         * A page that fails holds no other back: its cases are checked once
         * something on them changes, as before.
         */
        failed += rows.length;
        logger.error(
          `BackfillSecurityCaseNextStepCheckAt: the cases after ${lastId || "the first"} were not scheduled.`,
        );
        logger.error(err);
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `BackfillSecurityCaseNextStepCheckAt: scheduled ${scheduled} open cases' step checks, ${failed} could not be scheduled.`,
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
    if (Array.isArray(result)) {
      if (result.length === 2 && typeof result[1] === "number") {
        return result[1];
      }

      return result.length;
    }

    return 0;
  }
}
