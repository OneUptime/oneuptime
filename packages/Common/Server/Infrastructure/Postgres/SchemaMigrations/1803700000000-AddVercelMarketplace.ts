import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Vercel Marketplace: "VercelMarketplaceInstallation" (a Vercel team that
 * installed OneUptime, with the access token OneUptime calls Vercel with and
 * where its invoices stand) and "VercelMarketplaceConnection" (a Vercel
 * project connected to a OneUptime resource, and the monitor of its
 * production domain). New tables and indexes on them only, so the migration
 * blocks nobody.
 */
export class AddVercelMarketplace1803700000000 implements MigrationInterface {
  public name: string = "AddVercelMarketplace1803700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "VercelMarketplaceInstallation" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "installationId" character varying(100) NOT NULL, "vercelAccountId" character varying(100), "accessToken" text, "tokenType" character varying(100), "scopes" jsonb, "acceptedPolicies" jsonb, "accountName" character varying(500), "accountUrl" character varying(500), "contactEmail" character varying(100), "contactName" character varying(500), "status" character varying(100) NOT NULL, "deleteRequestedAt" TIMESTAMP WITH TIME ZONE, "invoicedUntil" TIMESTAMP WITH TIME ZONE, "billingDataSentAt" TIMESTAMP WITH TIME ZONE, "lastBillingError" character varying(500), CONSTRAINT "PK_d1adc32baaca3b128eaa2e88bc6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0aca0186ac6a6cfc937752154a" ON "VercelMarketplaceInstallation" ("installationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8befc35f6e691161951008a92b" ON "VercelMarketplaceInstallation" ("vercelAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a338169d688a846c0b77ffead6" ON "VercelMarketplaceInstallation" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VercelMarketplaceConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "marketplaceSubscriptionId" uuid NOT NULL, "projectId" uuid NOT NULL, "vercelProjectId" character varying(100) NOT NULL, "vercelProjectName" character varying(500), "productionDomain" character varying(500), "monitorId" uuid, CONSTRAINT "PK_2b93dfd7fcb659ecdd6bdf5d4cc" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c438c3c1b3fd25893f905db6b3" ON "VercelMarketplaceConnection" ("marketplaceSubscriptionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_461caa3e211302aa1fddadcbd4" ON "VercelMarketplaceConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cd8f44b307d3ccf0e5362f3e6a" ON "VercelMarketplaceConnection" ("marketplaceSubscriptionId", "vercelProjectId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd8f44b307d3ccf0e5362f3e6a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_461caa3e211302aa1fddadcbd4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c438c3c1b3fd25893f905db6b3"`,
    );
    await queryRunner.query(`DROP TABLE "VercelMarketplaceConnection"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a338169d688a846c0b77ffead6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8befc35f6e691161951008a92b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0aca0186ac6a6cfc937752154a"`,
    );
    await queryRunner.query(`DROP TABLE "VercelMarketplaceInstallation"`);
  }
}
