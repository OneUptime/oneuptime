import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Google Ads' own campaign parameters, beside the UTM columns on the two
 * tables that carry them: gad_source and gad_campaignid, which Google Ads adds
 * to the landing URL of its ad clicks. Until now they were kept only inside
 * utmUrl, which is cut at 500 characters - and Google appends them after the
 * ad's own parameters, so a long landing URL lost them first.
 *
 * Nullable with no default, matching the utm* columns beside them: an
 * existing row has no campaign to backfill, and NULL says "not known".
 */
export class AddGoogleAdsCampaignFields1808850000000
  implements MigrationInterface
{
  public name: string = "AddGoogleAdsCampaignFields1808850000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "gadSource" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "gadCampaignId" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "gadSource" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "gadCampaignId" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "gadCampaignId"`,
    );
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "gadSource"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "gadCampaignId"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "gadSource"`);
  }
}
