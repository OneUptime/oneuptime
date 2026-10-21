import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A server shutting down hands the AI runs it is executing back to the
 * queue (AIInvestigationQueue.handBackRunsInFlight), and handedBackCount
 * counts those hand-backs, so the claims they end are not counted as failed
 * attempts. A NOT NULL column with a constant default is added without
 * rewriting a row: every run there is starts at 0, never handed back.
 */
export class AddAIRunHandedBackCount1805220000000
  implements MigrationInterface
{
  public name: string = "AddAIRunHandedBackCount1805220000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "handedBackCount" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "handedBackCount"`,
    );
  }
}
