import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two additions, both in service of debugging a code-fix run that went wrong.
 *
 * 1. AIRun.taskNumber + Project.aiRunCounter — the per-project "#42" handle,
 *    allocated exactly like Incident.incidentNumber (ProjectService holds the
 *    counter behind a Redis semaphore; see incrementAndGetAIRunCounter).
 * 2. AIRunEvent.contentPayload — the verbatim prompt/response/tool transcript.
 *
 * The DDL here was produced by `npm run generate-postgres-migration`. Two
 * unrelated OnCallDutyPolicyScheduleLayer default changes the generator also
 * emitted (pre-existing whitespace drift between the entity defaults and the
 * local schema) were dropped: they are not part of this change.
 *
 * The backfill rides along in the same migration rather than a follow-up so
 * there is no window in which existing tasks are on-screen with a blank
 * number.
 */
export class AddAITaskNumberAndRunTranscript1784124919694
  implements MigrationInterface
{
  public name: string = "AddAITaskNumberAndRunTranscript1784124919694";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiRunCounter" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "taskNumber" integer`);
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" ADD "contentPayload" jsonb`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ede30aa8b14a167586bd555fa9" ON "AIRun" ("taskNumber") `,
    );

    /*
     * Number the tasks that already exist, oldest first, per project — so the
     * list does not read "#1, -, -, #2" the day this ships. Scoped to
     * runType = 'CodeFix' because only code-fix runs are tasks; chat and
     * investigation runs share this table and must stay null.
     *
     * Soft-deleted rows are numbered too. Not to prevent reuse (a skipped row
     * would hold no number to reuse) but to keep the sequence a stable
     * function of creation order: a run that is soft-deleted later must not
     * renumber the runs after it, and an undeleted row must not collide with
     * a number already handed out. The cost is gaps in what the list shows,
     * which is the same thing incidents do.
     */
    await queryRunner.query(`
      WITH numbered AS (
        SELECT
          "_id",
          ROW_NUMBER() OVER (
            PARTITION BY "projectId"
            ORDER BY "createdAt" ASC, "_id" ASC
          ) AS "rowNumber"
        FROM "AIRun"
        WHERE "runType" = 'CodeFix'
      )
      UPDATE "AIRun"
      SET "taskNumber" = numbered."rowNumber"
      FROM numbered
      WHERE "AIRun"."_id" = numbered."_id"
    `);

    /*
     * Advance each project's counter past what the backfill just handed out,
     * so the next allocation continues the sequence instead of restarting at
     * #1 and colliding. Projects with no code-fix runs keep the 0 default.
     */
    await queryRunner.query(`
      UPDATE "Project"
      SET "aiRunCounter" = "maxPerProject"."maxTaskNumber"
      FROM (
        SELECT "projectId", MAX("taskNumber") AS "maxTaskNumber"
        FROM "AIRun"
        WHERE "runType" = 'CodeFix' AND "taskNumber" IS NOT NULL
        GROUP BY "projectId"
      ) AS "maxPerProject"
      WHERE "Project"."_id" = "maxPerProject"."projectId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ede30aa8b14a167586bd555fa9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" DROP COLUMN "contentPayload"`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "taskNumber"`);
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "aiRunCounter"`);
  }
}
