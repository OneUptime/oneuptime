import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A project can allow an incident in only one incident episode, and an alert
 * in only one alert episode (Common/Types/Episode/EpisodeSingleMembership):
 * the switches on Incidents -> Settings -> Episode Membership and Alerts ->
 * Settings -> Episode Membership.
 *
 * Generated with npm run generate-postgres-migration, then renumbered to a
 * round slot above the registered migrations. Each column is added with a
 * constant default, which Postgres records in the catalog without rewriting
 * a row, so the table keeps taking writes. False is what every project had:
 * an incident or an alert can be in several episodes, as before, until the
 * project turns its switch on. Nobody is taken out of an episode.
 */
export class AddLimitRecordsToOneEpisode1803200000000
  implements MigrationInterface
{
  public name: string = "AddLimitRecordsToOneEpisode1803200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "limitIncidentsToOneEpisode" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "limitAlertsToOneEpisode" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "limitAlertsToOneEpisode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "limitIncidentsToOneEpisode"`,
    );
  }
}
