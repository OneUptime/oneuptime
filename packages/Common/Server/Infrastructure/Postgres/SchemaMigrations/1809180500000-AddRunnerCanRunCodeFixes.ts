import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #6115) after
 * Runner gained canRunCodeFixes: whether a global Runner takes OneUptime
 * AI's code fixes, the switch a master admin turns on the Admin
 * Dashboard's Global Runners page. The server reads it where a global
 * Runner's key proves a code-fix identity (CodeFixAgentAuth), where its
 * heartbeat is granted code fixes (RunnerIngress), and where a global
 * Runner is counted for a repository's work (Types/Runner/RunnerCodeFixes).
 *
 * NOT NULL with a constant default of true: adding it rewrites no row, and
 * every global Runner there is keeps taking code fixes, as it has since
 * 14.0.94. It is in no index. Nothing is backfilled.
 */
export class AddRunnerCanRunCodeFixes1809180500000
  implements MigrationInterface
{
  public name: string = "AddRunnerCanRunCodeFixes1809180500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD "canRunCodeFixes" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP COLUMN "canRunCodeFixes"`,
    );
  }
}
