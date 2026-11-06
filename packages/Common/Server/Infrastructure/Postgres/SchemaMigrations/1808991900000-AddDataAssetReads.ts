import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * When each table was last read, and the time from which it is known to
 * have had none (DataAssetReads): from the engine's read counters, and the
 * services seen reading it. A table nobody has read for 90 days is unused.
 *
 * Nullable, with no default and no row written: each is written by the next
 * collection. Adding them is a catalogue change, not a rewrite.
 */
export class AddDataAssetReads1808991900000 implements MigrationInterface {
  public name: string = "AddDataAssetReads1808991900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD "lastReadAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD "unreadSince" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP COLUMN "unreadSince"`,
    );
    await queryRunner.query(`ALTER TABLE "DataAsset" DROP COLUMN "lastReadAt"`);
  }
}
