import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * What a database's engine last reported, as its recommended alerts read
 * it (DatabaseServer.engineReadings, one entry per reporting agent), when
 * that was written (engineReadingsAt), and what the alerts' lines make of
 * it (engineHealth: healthy, degraded or unhealthy). The metrics ingest
 * writes them about once a minute per agent; the Databases list, a
 * database's Overview and its Needs attention read them. Three nullable
 * columns with no default, so adding them rewrites nothing and existing
 * databases start empty until their engine's next batch arrives.
 */
export class AddDatabaseServerEngineReadings1808990000000
  implements MigrationInterface
{
  public name: string = "AddDatabaseServerEngineReadings1808990000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "engineReadings" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "engineReadingsAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "engineHealth" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "engineHealth"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "engineReadingsAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "engineReadings"`,
    );
  }
}
