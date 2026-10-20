import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Every kind of AI fix verified in production: which check a merged fix
 * pull request is watched with (FixProductionCheck - the exception it fixed,
 * the operation it made faster, the monitor it stopped, the telemetry it
 * added), and what that check measured before the merge
 * (FixProductionBaseline).
 *
 * Two nullable columns on an existing table: no index, no foreign key, no
 * rewrite.
 */
export class AddFixProductionCheck1804950000000 implements MigrationInterface {
  public name: string = "AddFixProductionCheck1804950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "productionCheck" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "productionBaseline" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "productionBaseline"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "productionCheck"`,
    );
  }
}
