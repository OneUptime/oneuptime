import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * The blocklist (#10338): SecurityBlock, one address or range a project
 * blocks, with its expiry and who made it - one active block per value, by
 * a partial unique index - and SecurityBlockEnforcement, where each block is
 * enforced, one row per destination. Both are new tables, empty until
 * someone blocks something, so their indexes and keys are built with them.
 * And Probe.egressIpAddress, the address a probe checks in from, which the
 * blocklist never blocks: a nullable column, added without a rewrite.
 */
export class AddSecurityBlocklist1809187150000 implements MigrationInterface {
  public name: string = "AddSecurityBlocklist1809187150000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityBlock" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "indicatorType" character varying(100) NOT NULL, "value" character varying(100) NOT NULL, "action" character varying(100) NOT NULL DEFAULT 'Block', "state" character varying(100) NOT NULL DEFAULT 'Active', "expiresAt" TIMESTAMP WITH TIME ZONE, "reason" character varying(500), "securityCaseId" uuid, "source" character varying(100) NOT NULL DEFAULT 'Person', "createdByUserId" uuid, "securityPlaybookRunId" uuid, "liftedAt" TIMESTAMP WITH TIME ZONE, "liftedByUserId" uuid, "liftReason" character varying(500), CONSTRAINT "PK_a261b8e88f112b78fb495e6d96b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_472d0ef94e7e1b93c088453f60" ON "SecurityBlock" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_995a5322f2a8dad75fbeff1002" ON "SecurityBlock" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c21144919110a946569ac163e" ON "SecurityBlock" ("expiresAt") WHERE "state" = 'Active' AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_226a25de3149d8b961603a5f4c" ON "SecurityBlock" ("projectId", "state", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a4755bd06e3601ee046fcd7fe4" ON "SecurityBlock" ("projectId", "value") WHERE "state" = 'Active' AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityBlockEnforcement" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityBlockId" uuid NOT NULL, "destinationKey" character varying(500) NOT NULL, "provider" character varying(100) NOT NULL, "destinationName" character varying(100) NOT NULL, "connectionId" uuid, "state" character varying(100) NOT NULL DEFAULT 'Pending', "appliedAt" TIMESTAMP WITH TIME ZONE, "lastConfirmedAt" TIMESTAMP WITH TIME ZONE, "providerRef" character varying(100), "error" character varying(500), "failedAttempts" integer NOT NULL DEFAULT '0', "retryAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_68fe37f3f99f4187276da6ef547" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ede02ca0e8e78b514bd5dd98bb" ON "SecurityBlockEnforcement" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0fd9c5774dadec1d1d56004733" ON "SecurityBlockEnforcement" ("securityBlockId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e9173ba8b7ce1b7bbe6707dfc7" ON "SecurityBlockEnforcement" ("state") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6d1355d89c3e7f8ebe4c831f1" ON "SecurityBlockEnforcement" ("projectId", "destinationKey") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9c64944cb1802431a8675c4b63" ON "SecurityBlockEnforcement" ("securityBlockId", "destinationKey") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD "egressIpAddress" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD CONSTRAINT "FK_472d0ef94e7e1b93c088453f60f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD CONSTRAINT "FK_995a5322f2a8dad75fbeff1002e" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD CONSTRAINT "FK_192d1624b11f7b86c954e480201" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD CONSTRAINT "FK_36e3f72e6deb416f44f97f564b8" FOREIGN KEY ("securityPlaybookRunId") REFERENCES "SecurityPlaybookRun"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD CONSTRAINT "FK_ebdd6ba00d603fc6465451fbba5" FOREIGN KEY ("liftedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockEnforcement" ADD CONSTRAINT "FK_ede02ca0e8e78b514bd5dd98bb1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockEnforcement" ADD CONSTRAINT "FK_0fd9c5774dadec1d1d560047332" FOREIGN KEY ("securityBlockId") REFERENCES "SecurityBlock"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockEnforcement" DROP CONSTRAINT "FK_0fd9c5774dadec1d1d560047332"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockEnforcement" DROP CONSTRAINT "FK_ede02ca0e8e78b514bd5dd98bb1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP CONSTRAINT "FK_ebdd6ba00d603fc6465451fbba5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP CONSTRAINT "FK_36e3f72e6deb416f44f97f564b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP CONSTRAINT "FK_192d1624b11f7b86c954e480201"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP CONSTRAINT "FK_995a5322f2a8dad75fbeff1002e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP CONSTRAINT "FK_472d0ef94e7e1b93c088453f60f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "egressIpAddress"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c64944cb1802431a8675c4b63"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6d1355d89c3e7f8ebe4c831f1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e9173ba8b7ce1b7bbe6707dfc7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0fd9c5774dadec1d1d56004733"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ede02ca0e8e78b514bd5dd98bb"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityBlockEnforcement"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4755bd06e3601ee046fcd7fe4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_226a25de3149d8b961603a5f4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c21144919110a946569ac163e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_995a5322f2a8dad75fbeff1002"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_472d0ef94e7e1b93c088453f60"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityBlock"`);
  }
}
