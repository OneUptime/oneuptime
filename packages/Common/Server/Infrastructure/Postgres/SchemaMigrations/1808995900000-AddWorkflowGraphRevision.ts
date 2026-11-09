import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (the statement TypeORM
 * generates for the model), then renumbered after the last registered
 * migration.
 *
 * A workflow counts the saves of its graph (Workflow.graphRevision), so the
 * builder can save only while nobody else has saved a newer graph since it
 * opened the workflow (issue #6257). The column has a constant default, so
 * on Postgres 11 and later the ADD changes the table's metadata only: no row
 * is rewritten, and every existing workflow starts at 0.
 */
export class AddWorkflowGraphRevision1808995900000
  implements MigrationInterface
{
  public name: string = "AddWorkflowGraphRevision1808995900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "graphRevision" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "graphRevision"`,
    );
  }
}
