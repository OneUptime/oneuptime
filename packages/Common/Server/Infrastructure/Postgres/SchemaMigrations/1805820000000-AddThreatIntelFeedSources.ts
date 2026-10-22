import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A threat-intel feed has a source (ThreatIntelFeed.feedType,
 * Types/SecurityEvent/ThreatIntelFeedType): a TAXII 2.1 collection, as every
 * feed was, a list of indicators at an https address (listUrl, with the
 * indicatorConfidence its indicators get) or Google SecOps, read through a
 * Google SecOps connection (securityEventConnectionId).
 *
 * Nothing to backfill: feedType starts 'taxii' on every feed there is, so
 * each one keeps polling its collection as before. A NOT NULL column with a
 * constant default is added without rewriting a row. apiRootUrl and
 * collectionId are a TAXII feed's alone, so they may now be empty. Deleting
 * a connection leaves its feeds in place, without a connection, and the feed
 * says so on its next poll.
 *
 * The index on "securityEventConnectionId" and its foreign key to
 * "SecurityEventConnection" are built online, without blocking the table's
 * writes, by AddThreatIntelFeedConnectionIndexAndKey1805840000000.
 */
export class AddThreatIntelFeedSources1805820000000
  implements MigrationInterface
{
  public name: string = "AddThreatIntelFeedSources1805820000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD "feedType" character varying(100) NOT NULL DEFAULT 'taxii'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD "listUrl" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD "indicatorConfidence" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD "securityEventConnectionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ALTER COLUMN "apiRootUrl" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ALTER COLUMN "collectionId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only a TAXII feed has a collection: the other sources' feeds go with them.
    await queryRunner.query(
      `DELETE FROM "ThreatIntelFeed" WHERE "apiRootUrl" IS NULL OR "collectionId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ALTER COLUMN "collectionId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ALTER COLUMN "apiRootUrl" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP COLUMN "securityEventConnectionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP COLUMN "indicatorConfidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP COLUMN "listUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP COLUMN "feedType"`,
    );
  }
}
