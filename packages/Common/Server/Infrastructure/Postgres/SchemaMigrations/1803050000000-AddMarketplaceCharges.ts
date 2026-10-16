import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "MarketplaceCharge": a top-up of a marketplace-billed project's balance
 * (SMS, calls, WhatsApp and Telegram; AI credits), billed through its cloud
 * marketplace with the next hourly usage report instead of on a card. A new
 * table and indexes on it only, so the migration blocks nobody.
 */
export class AddMarketplaceCharges1803050000000 implements MigrationInterface {
  public name: string = "AddMarketplaceCharges1803050000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MarketplaceCharge" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "marketplaceSubscriptionId" uuid NOT NULL, "projectId" uuid NOT NULL, "marketplace" character varying(100) NOT NULL, "balanceType" character varying(100) NOT NULL, "amountInUSD" numeric NOT NULL, "isAutomatic" boolean NOT NULL DEFAULT false, "marketplaceUsageReportId" uuid, CONSTRAINT "PK_01f6520ddffc295c53a9012bb81" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e701a797e972e7e6f7c193c35" ON "MarketplaceCharge" ("marketplaceSubscriptionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6439b40922d5325c34ef5902c0" ON "MarketplaceCharge" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c43f25b3ffab503c895c9dd083" ON "MarketplaceCharge" ("marketplaceUsageReportId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c43f25b3ffab503c895c9dd083"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6439b40922d5325c34ef5902c0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e701a797e972e7e6f7c193c35"`,
    );
    await queryRunner.query(`DROP TABLE "MarketplaceCharge"`);
  }
}
