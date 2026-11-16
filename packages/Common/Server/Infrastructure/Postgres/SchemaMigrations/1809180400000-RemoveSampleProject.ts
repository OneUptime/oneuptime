import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The sample project is removed: OneUptime no longer makes a made-up
 * project to look around in (AddSampleProject, issue #6808).
 *
 * The sample projects that exist go first, while Project.isSampleProject
 * still finds them. Nothing would keep one apart any more: the code that
 * stopped a sample from notifying, probing, ingesting or being billed is
 * gone, so a sample left behind would be an ordinary project full of
 * made-up monitors, incidents and on-call people. Deleting the project
 * deletes everything in it, as deleting any project does (ON DELETE
 * CASCADE), its made-up people included (User.sampleProjectId cascades).
 * The made-up people of a sample that is somehow already gone are deleted
 * after it: nobody signs in as one, and none may become a counted user.
 * A sample's rows in the analytics database are left to their retention,
 * as every deleted project's are.
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
export class RemoveSampleProject1809180400000 implements MigrationInterface {
  public name: string = "RemoveSampleProject1809180400000";

  // DROP INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn("Project", "isSampleProject")) {
      await queryRunner.query(
        `DELETE FROM "Project" WHERE "isSampleProject" = true`,
      );
    }

    if (await queryRunner.hasColumn("User", "sampleProjectId")) {
      await queryRunner.query(
        `DELETE FROM "User" WHERE "sampleProjectId" IS NOT NULL`,
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
}
