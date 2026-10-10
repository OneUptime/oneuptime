import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Drops Workflow.lastSavedByUserId and its foreign key, which
 * AddWorkflowLastSavedBy1800600000000 and
 * AddWorkflowLastSavedByForeignKey1800650000000 added (released in 14.0.26
 * to 14.0.31). A workflow's steps were asked about the person who last
 * saved them before they could make a change that takes the read of
 * runbook credentials; they are now never lent that read
 * (RunbookCredentialReaders), so nothing reads who last saved a workflow's
 * steps any more. Both earlier migrations stay registered: an install that
 * never ran them runs all three, in order, and ends where every other does.
 *
 * Dropping a column and a constraint changes no row and scans nothing.
 * `down` puts the column back empty, as it was added.
 */
export class DropWorkflowLastSavedBy1801200000000
  implements MigrationInterface
{
  public name: string = "DropWorkflowLastSavedBy1801200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_cfb3d733c4f4b78897f3339187b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "lastSavedByUserId"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "lastSavedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_cfb3d733c4f4b78897f3339187b" FOREIGN KEY ("lastSavedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
