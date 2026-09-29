import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Drop the per-ad-platform upload state from the conversion ledger.
 *
 * OneUptime no longer uploads offline conversions to Google Ads, Meta,
 * Microsoft Advertising, LinkedIn or Reddit. The ledger is now purely
 * OneUptime's own reporting record, so the only column that existed to track
 * delivery to those platforms has nothing left to describe.
 *
 * The down migration restores the column but not its contents: the statuses
 * were per-provider delivery bookkeeping, they are not recoverable from
 * anything else in the schema, and no reporting reads them. Nothing else on
 * the row changes — conversions, their attribution and their chains are
 * untouched.
 */
export class RemoveMarketingConversionUploadState1788700000000
  implements MigrationInterface
{
  public name: string = "RemoveMarketingConversionUploadState1788700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" DROP COLUMN IF EXISTS "uploadState"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MarketingConversion" ADD "uploadState" jsonb`,
    );
  }
}
