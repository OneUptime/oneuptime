import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and split in two (issue #10767).
 *
 * Show Incidents Grouped by Episode (StatusPage.groupIncidentsByEpisode):
 * while a status page shows both incidents and episodes, on, it draws an
 * episode as one card that lists its incidents, and those incidents get no
 * card of their own.
 *
 * The generator adds the column with the model's default, true, which would
 * have regrouped every status page there is on the day of the upgrade. A
 * page made before the setting existed keeps what it shows instead: the
 * column is added off, so every row there is now reads false, and only then
 * does its default become true, for a page made from now on. Neither step
 * rewrites a row - a constant default is kept in the catalog, and a new
 * default touches no row at all - so the table is locked for an instant and
 * nothing waits on a scan.
 */
export class AddGroupIncidentsByEpisodeToStatusPage1809187610767
  implements MigrationInterface
{
  public name: string = "AddGroupIncidentsByEpisodeToStatusPage1809187610767";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "groupIncidentsByEpisode" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `ALTER TABLE "StatusPage" ALTER COLUMN "groupIncidentsByEpisode" SET DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "groupIncidentsByEpisode"`,
    );
  }
}
