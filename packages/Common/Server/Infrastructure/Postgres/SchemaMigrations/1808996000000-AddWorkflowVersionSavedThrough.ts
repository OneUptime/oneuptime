import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (the statement TypeORM
 * generates for the model), then renumbered after the last registered
 * migration.
 *
 * A workflow version says when Ask AI saved it for the person who asked
 * (WorkflowVersion.savedThrough, issue #6258), so each of Ask AI's changes
 * is a version of its own. The column is nullable with no default: adding it
 * changes the table's metadata only, and every existing version reads as
 * the person's own, as it was recorded.
 */
export class AddWorkflowVersionSavedThrough1808996000000
  implements MigrationInterface
{
  public name: string = "AddWorkflowVersionSavedThrough1808996000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" ADD "savedThrough" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowVersion" DROP COLUMN "savedThrough"`,
    );
  }
}
