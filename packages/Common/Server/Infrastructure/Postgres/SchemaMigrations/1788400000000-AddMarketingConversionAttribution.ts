import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Campaign attribution and identity on the conversion ledger.
 *
 * Until now a MarketingConversion held only click IDs, so a conversion could
 * be handed to an ad platform but never grouped by campaign in OneUptime's own
 * data, and two conversions by the same person on either side of a demo had
 * nothing in common to join on. The utm* columns mirror the ones already on
 * User and Project; emailHash and attributedToConversionId are new.
 *
 * Every column is nullable with no default, so existing rows are untouched and
 * the migration takes no table rewrite.
 */
export class AddMarketingConversionAttribution1788400000000
  implements MigrationInterface
{
  public name: string = "AddMarketingConversionAttribution1788400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "utmCampaign" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "utmSource" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "utmMedium" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "utmTerm" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "utmContent" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "utmUrl" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "firstTouchAttribution" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "emailHash" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "attributedToConversionId" uuid`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_marketing_conversion_utm_campaign" ON "MarketingConversion" ("utmCampaign")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_marketing_conversion_utm_source" ON "MarketingConversion" ("utmSource")`,
    );
    /*
     * The chain-linking pass reads every conversion sharing one emailHash, and
     * the ad-platform uploads read it per row — both want this index.
     */
    await queryRunner.query(
      `CREATE INDEX "idx_marketing_conversion_email_hash" ON "MarketingConversion" ("emailHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_marketing_conversion_attributed_to" ON "MarketingConversion" ("attributedToConversionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_marketing_conversion_attributed_to"`,
    );
    await queryRunner.query(`DROP INDEX "idx_marketing_conversion_email_hash"`);
    await queryRunner.query(`DROP INDEX "idx_marketing_conversion_utm_source"`);
    await queryRunner.query(
      `DROP INDEX "idx_marketing_conversion_utm_campaign"`,
    );

    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "attributedToConversionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "emailHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "firstTouchAttribution"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "utmUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "utmContent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "utmTerm"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "utmMedium"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "utmSource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN "utmCampaign"`,
    );
  }
}
