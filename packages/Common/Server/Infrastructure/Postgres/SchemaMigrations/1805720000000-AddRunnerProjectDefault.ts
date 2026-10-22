import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A project can make one of its own Runners its default Runner
 * (Runner.isProjectDefault), as it makes one Twilio config its default: a
 * runbook step that picks no Runner of its own runs on it, in place of the
 * Global Runner (Types/Runner/RunnerChoice, the default order).
 *
 * Nothing to backfill: the column starts false on every Runner there is, so
 * no project has a default Runner and every step runs where it ran before
 * until someone makes a Runner the default. A NOT NULL column with a
 * constant default is added without rewriting a row. No index: a project's
 * default is looked up among the project's own Runners, which the projectId
 * index already narrows to a handful.
 */
export class AddRunnerProjectDefault1805720000000
  implements MigrationInterface
{
  public name: string = "AddRunnerProjectDefault1805720000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD "isProjectDefault" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP COLUMN "isProjectDefault"`,
    );
  }
}
