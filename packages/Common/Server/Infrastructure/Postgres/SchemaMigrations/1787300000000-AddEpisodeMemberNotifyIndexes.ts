import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Partial indexes behind the two episode-member "owner notified" sweeps:
 *
 *   AlertEpisodeOwner:SendAlertAddedEmail    -> AlertEpisodeMember
 *   IncidentEpisodeOwner:SendIncidentAddedEmail -> IncidentEpisodeMember
 *
 * Both run EVERY_MINUTE and select the rows whose notify flag is still
 * false. The flag is written false on insert and flipped true by the sweep
 * itself, so in steady state nearly every row is true and each tick was a
 * full sequential scan that returned nothing — 2 x 1,440 = 2,880 zero-row
 * scans a day across the two tables.
 *
 * PARTIAL rather than a plain index on the column: a full index would be the
 * size of the table to serve a predicate matching a handful of rows, and
 * every notification write would maintain it. Restricted to
 * `flag = false AND "deletedAt" IS NULL` it stays about the size of the
 * sweep's own working set. The soft-delete clause is not decoration: the
 * sweep always carries it (TypeORM adds it for the delete-date column), and
 * nothing ever flips the flag on a soft-deleted row, so without it those
 * rows would sit in the index forever.
 *
 * Hand-written rather than emitted by `npm run generate-postgres-migration`,
 * which needs a live Postgres to diff against and none was reachable. Both
 * statements are exactly what the generator emits for these decorators:
 * TypeORM's DefaultNamingStrategy names an index
 * `"IDX_" + sha1(table_sortedColumns_where).slice(0, 26)` — note the WHERE
 * text is part of the hashed key, so the names below are tied to the exact
 * predicate string in the models — and PostgresQueryRunner.createIndexSql
 * emits `CREATE INDEX <name> ON <table> (<columns>) WHERE <where>`. Compare
 * "IDX_91e00aa0bbe2c0cdcfbf884a2d" on "NetworkEndpoint" in
 * 1784757142154-AddNetworkSiteHierarchyAndEndpoints for the partial-index
 * shape. The accompanying test recomputes both names from TypeORM's own
 * naming strategy so the Schema Drift job finds nothing left to generate.
 */
export class AddEpisodeMemberNotifyIndexes1787300000000
  implements MigrationInterface
{
  public name: string = "AddEpisodeMemberNotifyIndexes1787300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_76aa0238e90e515992b65bc0a6" ON "AlertEpisodeMember" ("isOwnerNotifiedOfAlertAdded") WHERE "isOwnerNotifiedOfAlertAdded" = false AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79e3a24f776e52d635dbeb9c27" ON "IncidentEpisodeMember" ("isOwnerNotifiedOfIncidentAdded") WHERE "isOwnerNotifiedOfIncidentAdded" = false AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79e3a24f776e52d635dbeb9c27"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76aa0238e90e515992b65bc0a6"`,
    );
  }
}
