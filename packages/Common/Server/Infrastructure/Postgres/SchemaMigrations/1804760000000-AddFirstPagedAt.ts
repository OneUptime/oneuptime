import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * When an on-call policy or a direct page first notified somebody about an
 * incident, an alert or an episode (FirstPagedAt): what "Time to acknowledge
 * after paging" counts from, where every other response time counts from
 * the record's creation.
 *
 * Four nullable columns without a default: adding them rewrites no rows.
 * Records paged before the upgrade get theirs from their on-call timelines
 * in the background (Workers/DataMigrations/BackfillFirstPagedAt), never
 * here, where an UPDATE of every row would hold ADD COLUMN's lock on these
 * tables for as long as it ran.
 */
export class AddFirstPagedAt1804760000000 implements MigrationInterface {
  public name: string = "AddFirstPagedAt1804760000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "firstPagedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "firstPagedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD "firstPagedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "firstPagedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Alert" DROP COLUMN "firstPagedAt"`);
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP COLUMN "firstPagedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "firstPagedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "firstPagedAt"`,
    );
  }
}
