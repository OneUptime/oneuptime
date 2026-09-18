import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Replace the conversion ledger with outbound webhooks, and give an enterprise
 * licence a contact email.
 *
 * TWO CHANGES, ONE MIGRATION, because they are one decision: conversions are
 * no longer stored in OneUptime, they are emitted as they happen and joined by
 * the receiver on email. EnterpriseLicense.email is what makes a sales-led
 * licence joinable to the meeting_booked that produced it, months earlier —
 * without it, dropping the ledger would leave enterprise revenue attributable
 * to nothing at all.
 *
 * The DROP is not reversible in any way that matters. `down` recreates the
 * table's shape so a rollback finds the schema it expects, but every
 * conversion, its attribution and its chain are gone: nothing else in the
 * schema holds them, and nothing writes them any more. Export the table before
 * running this if the history is wanted.
 */
export class DropMarketingConversionAddEnterpriseLicenseEmail1788800000000
  implements MigrationInterface
{
  public name: string =
    "DropMarketingConversionAddEnterpriseLicenseEmail1788800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "email" character varying(100)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_enterprise_license_email" ON "EnterpriseLicense" ("email")`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "MarketingConversion"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Shape only — deliberately no data. Recreated so a rollback to the
     * previous release starts against the schema it was built for.
     */
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "MarketingConversion" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "conversionType" character varying(100) NOT NULL, "userId" uuid, "projectId" uuid, "email" character varying(100), "clickIds" jsonb NOT NULL, "conversionAt" TIMESTAMP WITH TIME ZONE NOT NULL, "conversionValueInUSDCents" integer, "utmCampaign" character varying(500), "utmSource" character varying(500), "utmMedium" character varying(500), "utmTerm" character varying(500), "utmContent" character varying(500), "utmUrl" character varying(500), "firstTouchAttribution" jsonb, "emailHash" character varying(100), "attributedToConversionId" uuid, CONSTRAINT "PK_MarketingConversion_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_enterprise_license_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN IF EXISTS "email"`,
    );
  }
}
