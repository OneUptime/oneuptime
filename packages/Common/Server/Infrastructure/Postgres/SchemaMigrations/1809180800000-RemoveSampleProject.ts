import OnlineDdl from "../OnlineDdl";
import logger from "../../../Utils/Logger";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The sample project is removed: OneUptime no longer makes a made-up
 * project to look around in (AddSampleProject, issue #6808).
 *
 * The samples that exist go first, while User.sampleProjectId and
 * Project.isSampleProject still find them. Nothing would keep one apart any
 * more: the code that stopped a sample from notifying, probing, ingesting or
 * being billed is gone, so a sample left behind would be an ordinary project
 * full of made-up monitors, incidents and on-call people. And its made-up
 * people would be counted users - in the license's user count and the
 * marketplaces' usage - though nobody signs in as one.
 *
 * Each made-up person is deleted in a statement of their own, then each
 * sample project (which deletes everything in it, as deleting any project
 * does: ON DELETE CASCADE), each within OnlineDdl's long limits. Deleting a
 * "User" row makes Postgres look for the user in every column that
 * references "User" - over a thousand, most without an index - one
 * sequential scan each: about 12 seconds a person on OneUptime Cloud. This
 * migration first deleted every sample in one statement, which took their
 * people with it (User.sampleProjectId cascades) - 13 samples and 52 people
 * there, ten minutes - and it ran out of DATABASE_STATEMENT_TIMEOUT_MS
 * (30 s) at every attempt, so the release's migrate Job failed and its pods
 * never started. One person a statement keeps each statement to seconds
 * and lets a run stopped part way keep what it did. A deleted project's
 * other rows are found by their indexed projectId. A sample's rows in the
 * analytics database are left to their retention, as every deleted
 * project's are.
 *
 * Then the columns go, as the generator writes it for the models: the
 * foreign key, the index and User.sampleProjectId, then
 * Project.isSampleProject. The index is dropped online ("User" is a table
 * every sign-in writes), so the migration runs outside a transaction, and
 * each step is safe to run again after a stop part way.
 *
 * Nothing here needs PERMISSION_ROW_MIGRATIONS: the memberships deleted
 * are of the deleted samples, and a permission set cached for a project
 * that no longer exists grants nothing.
 */
export class RemoveSampleProject1809180800000 implements MigrationInterface {
  public name: string = "RemoveSampleProject1809180800000";

  // DROP INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const people: Array<string> = (await queryRunner.hasColumn(
      "User",
      "sampleProjectId",
    ))
      ? await RemoveSampleProject1809180800000.selectIds(
          queryRunner,
          `SELECT "_id" FROM "User" WHERE "sampleProjectId" IS NOT NULL ORDER BY "_id"`,
        )
      : [];

    const samples: Array<string> = (await queryRunner.hasColumn(
      "Project",
      "isSampleProject",
    ))
      ? await RemoveSampleProject1809180800000.selectIds(
          queryRunner,
          `SELECT "_id" FROM "Project" WHERE "isSampleProject" = true ORDER BY "_id"`,
        )
      : [];

    if (people.length > 0 || samples.length > 0) {
      logger.info(
        `Removing ${samples.length} sample project(s) and ${people.length} made-up person(s), one statement each: deleting a person scans every table that references "User", which takes seconds per person on a large database.`,
      );
    }

    for (const personId of people) {
      await OnlineDdl.runLongStatement(
        queryRunner,
        `DELETE FROM "User" WHERE "_id" = $1 AND "sampleProjectId" IS NOT NULL`,
        [personId],
      );
    }

    for (const sampleId of samples) {
      await OnlineDdl.runLongStatement(
        queryRunner,
        `DELETE FROM "Project" WHERE "_id" = $1 AND "isSampleProject" = true`,
        [sampleId],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "FK_25e3ed56d0b14e81457332f2048"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_25e3ed56d0b14e81457332f204"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN IF EXISTS "sampleProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN IF EXISTS "isSampleProject"`,
    );
  }

  /*
   * The columns come back, every project not a sample and nobody a sample
   * person. The samples deleted above are not: they were made up. TypeORM
   * reverts a migration inside a transaction whatever its `transaction`
   * says, where an index cannot be built online, so the build is a plain
   * one.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "isSampleProject" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "User" ADD "sampleProjectId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_25e3ed56d0b14e81457332f204" ON "User" ("sampleProjectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD CONSTRAINT "FK_25e3ed56d0b14e81457332f2048" FOREIGN KEY ("sampleProjectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  // The ids a SELECT of "_id" answered, as text.
  private static async selectIds(
    queryRunner: QueryRunner,
    select: string,
  ): Promise<Array<string>> {
    const rows: unknown = await queryRunner.query(select);

    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row: { _id?: unknown }): string => {
        return String(row?._id ?? "");
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });
  }
}
