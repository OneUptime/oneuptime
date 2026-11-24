import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration, with the backfill below added by hand.
 *
 * StorageArray "countsByKind" (#11000): one count per inventory kind, so a
 * storage platform's own kinds (a NetApp array's aggregates and SVMs) need
 * no column - and no migration - of their own. The ingest merges each
 * batch's counts into it (StorageArrayService.mergeCountsByKind).
 *
 * Filled here from the count columns, so an array shows its counts from
 * the moment the release starts rather than from its next scrape: each
 * array of a platform that has the columns gets the kinds that platform
 * reports - a FlashArray its volumes, hosts, pods and hardware, a
 * FlashBlade its file systems, buckets and hardware - and an array whose
 * platform is not known keeps NULL, which no kind of count is read from.
 * The values are the platforms' as they were when this ran, written out:
 * a migration never reads the registry, which changes after it. The table
 * holds one row per array, so one UPDATE per platform takes it whole; the
 * column, nullable and without a default, is added without rewriting a
 * row.
 */
export class AddStorageArrayCountsByKind1809187661000
  implements MigrationInterface
{
  public name: string = "AddStorageArrayCountsByKind1809187661000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StorageArray" ADD "countsByKind" jsonb`,
    );
    await queryRunner.query(
      `UPDATE "StorageArray" SET "countsByKind" = jsonb_strip_nulls(jsonb_build_object('Volume', "volumeCount", 'Host', "hostCount", 'Pod', "podCount", 'Hardware', "hardwareComponentCount")) WHERE "storageSystem" = 'purestorage.flasharray' AND "countsByKind" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "StorageArray" SET "countsByKind" = jsonb_strip_nulls(jsonb_build_object('FileSystem', "fileSystemCount", 'Bucket', "bucketCount", 'Hardware', "hardwareComponentCount")) WHERE "storageSystem" = 'purestorage.flashblade' AND "countsByKind" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StorageArray" DROP COLUMN "countsByKind"`,
    );
  }
}
