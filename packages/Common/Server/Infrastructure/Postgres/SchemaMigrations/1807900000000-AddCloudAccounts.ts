import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Cloud accounts and what their inventories list, generated with npm run
 * generate-postgres-migration:
 *
 *   - "CloudAccount": one row per AWS account, Azure subscription or Google
 *     Cloud project a cloud connection reaches (unique per project, cloud
 *     and account id), with its labels ("CloudAccountLabel");
 *   - on "CloudResource", what a connection's inventory says beyond the
 *     metrics: its tags, a few properties, its relationships, the hosts it
 *     answers on, when it was last listed, and the fingerprint that lets an
 *     unchanged listing skip the write;
 *   - "cloudTagPattern" on the cloud label and owner rules;
 *   - the links of monitors, incidents and alerts to cloud resources
 *     ("MonitorCloudResource", "IncidentCloudResource",
 *     "AlertCloudResource").
 *
 * Every index and foreign key is on a table this migration creates, so each
 * is built on an empty table; the existing tables only gain nullable
 * columns with no default.
 */
export class AddCloudAccounts1807900000000 implements MigrationInterface {
  public name: string = "AddCloudAccounts1807900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudAccount" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "provider" character varying(100) NOT NULL, "accountId" character varying(100) NOT NULL, "providerAccountName" character varying(100), "cloudConnectionId" uuid, "resourceCount" integer, "regionCount" integer, "resourceSummary" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "inventoryListedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_10f957a1f084fd6ff7080a5248f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0218b0032b7103d501980fbfa" ON "CloudAccount" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ef1e6518fd3e04206d8f4d08d" ON "CloudAccount" ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6da18647d3a2f274679e09de7f" ON "CloudAccount" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3bfc7910122657fc8f56cc98c" ON "CloudAccount" ("cloudConnectionId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6dc4578485ddbaf5aeb603ad03" ON "CloudAccount" ("projectId", "provider", "accountId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorCloudResource" ("monitorId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, CONSTRAINT "PK_39e1813b0f622bcd89af5ab452b" PRIMARY KEY ("monitorId", "cloudResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b91bff1f906a797018c03ee7c" ON "MonitorCloudResource" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67ac8b19adb0039b6fe366a959" ON "MonitorCloudResource" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudAccountLabel" ("cloudAccountId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_f59034f9a055e13ceb6a940078c" PRIMARY KEY ("cloudAccountId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_416b956a56a2d67036435d4837" ON "CloudAccountLabel" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_620cd8333776b08c6ec21702d2" ON "CloudAccountLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentCloudResource" ("incidentId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, CONSTRAINT "PK_cd2a69352c2b7581dd720b2b22a" PRIMARY KEY ("incidentId", "cloudResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_caca591a707999451eff9b9e85" ON "IncidentCloudResource" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a3682e5e406e408bebf1200ad" ON "IncidentCloudResource" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertCloudResource" ("alertId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, CONSTRAINT "PK_b743a05ae2596cd4c4a4a212a37" PRIMARY KEY ("alertId", "cloudResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_968b33d5922f3e0e80206d3261" ON "AlertCloudResource" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ec1ef27b3ec2aab0661116440e" ON "AlertCloudResource" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudTags" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudProperties" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudRelationships" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudEndpoints" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "inventoriedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudInventoryFingerprint" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" ADD "cloudTagPattern" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" ADD "cloudTagPattern" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD CONSTRAINT "FK_f0218b0032b7103d501980fbfa3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD CONSTRAINT "FK_f3bfc7910122657fc8f56cc98ca" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD CONSTRAINT "FK_9df77c35d0f9b17aff704990854" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD CONSTRAINT "FK_32257fddccb69f15adb3db46a25" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCloudResource" ADD CONSTRAINT "FK_9b91bff1f906a797018c03ee7cf" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCloudResource" ADD CONSTRAINT "FK_67ac8b19adb0039b6fe366a9598" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountLabel" ADD CONSTRAINT "FK_416b956a56a2d67036435d48375" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountLabel" ADD CONSTRAINT "FK_620cd8333776b08c6ec21702d2f" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCloudResource" ADD CONSTRAINT "FK_caca591a707999451eff9b9e85a" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCloudResource" ADD CONSTRAINT "FK_6a3682e5e406e408bebf1200ad8" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCloudResource" ADD CONSTRAINT "FK_968b33d5922f3e0e80206d3261d" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCloudResource" ADD CONSTRAINT "FK_ec1ef27b3ec2aab0661116440ee" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertCloudResource" DROP CONSTRAINT "FK_ec1ef27b3ec2aab0661116440ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCloudResource" DROP CONSTRAINT "FK_968b33d5922f3e0e80206d3261d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCloudResource" DROP CONSTRAINT "FK_6a3682e5e406e408bebf1200ad8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCloudResource" DROP CONSTRAINT "FK_caca591a707999451eff9b9e85a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountLabel" DROP CONSTRAINT "FK_620cd8333776b08c6ec21702d2f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccountLabel" DROP CONSTRAINT "FK_416b956a56a2d67036435d48375"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCloudResource" DROP CONSTRAINT "FK_67ac8b19adb0039b6fe366a9598"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCloudResource" DROP CONSTRAINT "FK_9b91bff1f906a797018c03ee7cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP CONSTRAINT "FK_32257fddccb69f15adb3db46a25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP CONSTRAINT "FK_9df77c35d0f9b17aff704990854"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP CONSTRAINT "FK_f3bfc7910122657fc8f56cc98ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP CONSTRAINT "FK_f0218b0032b7103d501980fbfa3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" DROP COLUMN "cloudTagPattern"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" DROP COLUMN "cloudTagPattern"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudInventoryFingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "inventoriedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudEndpoints"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudRelationships"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudProperties"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudTags"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ec1ef27b3ec2aab0661116440e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_968b33d5922f3e0e80206d3261"`,
    );
    await queryRunner.query(`DROP TABLE "AlertCloudResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a3682e5e406e408bebf1200ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_caca591a707999451eff9b9e85"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentCloudResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_620cd8333776b08c6ec21702d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_416b956a56a2d67036435d4837"`,
    );
    await queryRunner.query(`DROP TABLE "CloudAccountLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67ac8b19adb0039b6fe366a959"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b91bff1f906a797018c03ee7c"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorCloudResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6dc4578485ddbaf5aeb603ad03"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3bfc7910122657fc8f56cc98c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6da18647d3a2f274679e09de7f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ef1e6518fd3e04206d8f4d08d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0218b0032b7103d501980fbfa"`,
    );
    await queryRunner.query(`DROP TABLE "CloudAccount"`);
  }
}
