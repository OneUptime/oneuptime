import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Selling OneUptime Cloud on AWS Marketplace, Microsoft Marketplace and
 * Google Cloud Marketplace (Server/Utils/Marketplace):
 *
 *   - "MarketplaceSubscription": one purchase made on a marketplace and the
 *     project it pays for. Unique on (marketplace, externalSubscriptionId),
 *     so the landing page and the marketplace's own notification for the
 *     same purchase cannot record it twice.
 *   - "MarketplaceUsageReport": every report of a project's charges to its
 *     marketplace, written before it is sent so a retry is never billed twice.
 *   - "Project"."billingMarketplace": the marketplace that bills a project,
 *     empty for a project billed by card. Nullable with no default, which
 *     Postgres adds without rewriting or scanning the table.
 *
 * The indexes are on the two new tables, created in this migration, so they
 * block nobody.
 */
export class AddMarketplaceSubscriptions1803000000000
  implements MigrationInterface
{
  public name: string = "AddMarketplaceSubscriptions1803000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MarketplaceSubscription" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "marketplace" character varying(100) NOT NULL, "externalSubscriptionId" character varying(500) NOT NULL, "externalCustomerId" character varying(100), "externalEntitlementId" character varying(500), "externalOfferId" character varying(500), "externalPlanId" character varying(500), "quantity" integer, "usageReportingId" character varying(500), "status" character varying(100) NOT NULL, "externalState" character varying(500), "projectId" uuid, "linkedByUserId" uuid, "linkedAt" TIMESTAMP WITH TIME ZONE, "purchaserEmail" character varying(100), "isFreeTrial" boolean NOT NULL DEFAULT false, "isUsageMetered" boolean NOT NULL DEFAULT true, "claimTokenHash" character varying(255), "claimTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "usageReportedUntil" TIMESTAMP WITH TIME ZONE, "unreportedUsageInUSD" numeric, "lastSyncedAt" TIMESTAMP WITH TIME ZONE, "details" jsonb, CONSTRAINT "PK_b6b42a4d52bc5978b57c0c1f73d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_940a1799e93c24589b35c16693" ON "MarketplaceSubscription" ("externalCustomerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_681eee5c07c9cbcf2f9ddb6712" ON "MarketplaceSubscription" ("externalEntitlementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_114c534cb14204f7892bbcd6e6" ON "MarketplaceSubscription" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_586e345fc18154b245a3e14086" ON "MarketplaceSubscription" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_64fdf38590534409569b5d8cd1" ON "MarketplaceSubscription" ("claimTokenHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d5b37b4b42a2bd54d98e2e80af" ON "MarketplaceSubscription" ("marketplace", "externalSubscriptionId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MarketplaceUsageReport" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "marketplaceSubscriptionId" uuid NOT NULL, "projectId" uuid NOT NULL, "marketplace" character varying(100) NOT NULL, "periodStart" TIMESTAMP WITH TIME ZONE NOT NULL, "periodEnd" TIMESTAMP WITH TIME ZONE NOT NULL, "quantity" integer NOT NULL, "status" character varying(100) NOT NULL, "reportedAt" TIMESTAMP WITH TIME ZONE, "externalReportId" character varying(500), "attempts" integer NOT NULL DEFAULT '0', "lastError" character varying(500), "breakdown" jsonb, CONSTRAINT "PK_f50c34a6c28c5acaadf866d4fc7" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d99a9315087364250f02ea698" ON "MarketplaceUsageReport" ("marketplaceSubscriptionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12180c09204233f380a81beedc" ON "MarketplaceUsageReport" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_11c206394e371d70bf4970135a" ON "MarketplaceUsageReport" ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "billingMarketplace" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "billingMarketplace"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_11c206394e371d70bf4970135a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12180c09204233f380a81beedc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d99a9315087364250f02ea698"`,
    );
    await queryRunner.query(`DROP TABLE "MarketplaceUsageReport"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5b37b4b42a2bd54d98e2e80af"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_64fdf38590534409569b5d8cd1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_586e345fc18154b245a3e14086"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_114c534cb14204f7892bbcd6e6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_681eee5c07c9cbcf2f9ddb6712"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_940a1799e93c24589b35c16693"`,
    );
    await queryRunner.query(`DROP TABLE "MarketplaceSubscription"`);
  }
}
