import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as npm run generate-postgres-migration writes it, and numbered
 * after the last registered migration.
 *
 * The major release of OneUptime a custom probe's owners were last told it
 * is behind (#9977): Probe.majorVersionBehindNotifiedFor. Workers'
 * Probe:NotifyMajorReleaseBehind tells them once a day of a major release
 * they were not told of yet, and keeps it here, so a probe that stays
 * behind is not told of again.
 *
 * A nullable column with no default: adding it rewrites no row of "Probe"
 * and holds its lock for an instant (Docs/migrations/README.md). Nothing
 * is backfilled: no probe's owners were told before, so every probe starts
 * with nothing told.
 */
export class AddProbeMajorVersionBehindNotifiedFor1809187530000
  implements MigrationInterface
{
  public name: string = "AddProbeMajorVersionBehindNotifiedFor1809187530000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD "majorVersionBehindNotifiedFor" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "majorVersionBehindNotifiedFor"`,
    );
  }
}
