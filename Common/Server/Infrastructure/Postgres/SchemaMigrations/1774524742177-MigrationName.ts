import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774524742177 implements MigrationInterface {
  name = "MigrationName1774524742177";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DashboardDomain" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "domainId" uuid NOT NULL, "dashboardId" uuid NOT NULL, "subdomain" character varying(100) NOT NULL, "fullDomain" character varying(100) NOT NULL, "createdByUserId" uuid, "cnameVerificationToken" character varying(100) NOT NULL, "isCnameVerified" boolean NOT NULL DEFAULT false, "isSslOrdered" boolean NOT NULL DEFAULT false, "isSslProvisioned" boolean NOT NULL DEFAULT false, "deletedByUserId" uuid, "customCertificate" text, "customCertificateKey" text, "isCustomCertificate" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_3897ff3212d5d8ddbdeca684bf6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c0e357d0490d45c89ee673005" ON "DashboardDomain" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f58973f28172817bf9c1b34e7" ON "DashboardDomain" ("domainId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_601f68ad16b421ede8b06b3f40" ON "DashboardDomain" ("dashboardId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "isPublicDashboard" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "enableMasterPassword" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "masterPassword" character varying(64)`,
    );
    await queryRunner.query(`ALTER TABLE "Dashboard" ADD "ipWhitelist" text`);
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" ADD CONSTRAINT "FK_8c0e357d0490d45c89ee673005c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" ADD CONSTRAINT "FK_0f58973f28172817bf9c1b34e73" FOREIGN KEY ("domainId") REFERENCES "Domain"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" ADD CONSTRAINT "FK_601f68ad16b421ede8b06b3f40c" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" ADD CONSTRAINT "FK_de80950ba9f0d034f5c47940b3c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" ADD CONSTRAINT "FK_de0c87b9c94b5dfeb21f1ce106f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" DROP CONSTRAINT "FK_de0c87b9c94b5dfeb21f1ce106f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" DROP CONSTRAINT "FK_de80950ba9f0d034f5c47940b3c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" DROP CONSTRAINT "FK_601f68ad16b421ede8b06b3f40c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" DROP CONSTRAINT "FK_0f58973f28172817bf9c1b34e73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardDomain" DROP CONSTRAINT "FK_8c0e357d0490d45c89ee673005c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "ipWhitelist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "masterPassword"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "enableMasterPassword"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "isPublicDashboard"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_601f68ad16b421ede8b06b3f40"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f58973f28172817bf9c1b34e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c0e357d0490d45c89ee673005"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardDomain"`);
  }
}
