import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Which master API key is set (#8903): when it was made, by whom, and its
 * hint - its last four characters - so Admin Dashboard > Settings > API Key
 * can say "A key is set, made by Ada Lovelace on 16 Nov 2026 · ends in
 * 2b34" in place of the key, which is stored hashed and shown once.
 *
 * Generated with npm run generate-postgres-migration and renumbered after
 * the last registered migration. Three nullable columns on the server's
 * settings row, which Postgres adds without rewriting the table: a key
 * made before has none of them until the HashMasterApiKey data migration
 * writes its hint, and the page says nothing it does not know. No foreign
 * key on the maker: the row outlives any one admin.
 */
export class AddMasterApiKeyCreatedByAndHint1809181300000
  implements MigrationInterface
{
  public name: string = "AddMasterApiKeyCreatedByAndHint1809181300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "masterApiKeyCreatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "masterApiKeyCreatedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "masterApiKeyHint" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "masterApiKeyHint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "masterApiKeyCreatedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "masterApiKeyCreatedAt"`,
    );
  }
}
