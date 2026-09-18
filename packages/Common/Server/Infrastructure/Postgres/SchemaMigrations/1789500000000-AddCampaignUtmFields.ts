import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * GA4's second tier of campaign parameters, on the two tables that already
 * carry the first five.
 *
 * `utm_id`, `utm_source_platform`, `utm_creative_format` and
 * `utm_marketing_tactic` arrive on the landing URL from Google Ads auto-tagging
 * and the GA4 URL builder. Until now the browser captured them nowhere and the
 * signup door dropped them, so a campaign that distinguished its creatives
 * only by `utm_creative_format` was reportable as one undifferentiated
 * campaign.
 *
 * Nullable with no default, matching utmSource..utmContent beside them: an
 * existing row has no campaign to backfill, and NULL says "not known" rather
 * than claiming an empty campaign.
 */
export class AddCampaignUtmFields1789500000000 implements MigrationInterface {
  public name: string = "AddCampaignUtmFields1789500000000";

  private static readonly columns: Array<string> = [
    "utmId",
    "utmSourcePlatform",
    "utmCreativeFormat",
    "utmMarketingTactic",
  ];

  private static readonly tables: Array<string> = ["User", "Project"];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddCampaignUtmFields1789500000000.tables) {
      for (const column of AddCampaignUtmFields1789500000000.columns) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ADD "${column}" character varying(500)`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddCampaignUtmFields1789500000000.tables) {
      for (const column of AddCampaignUtmFields1789500000000.columns) {
        await queryRunner.query(
          `ALTER TABLE "${table}" DROP COLUMN "${column}"`,
        );
      }
    }
  }
}
