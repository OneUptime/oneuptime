import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Amortized and net costs (#11007) and commitments (#11011):
 *   - CloudCostSetting: a project's cost basis (billed, amortized or net)
 *     and when its commitments alert, with the alerts' severity, on-call
 *     policies and owners - one row per project, made on first use;
 *   - CloudCommitment: every commitment the cloud connections read;
 *   - CloudBudget.costBasis: the basis a budget watches, empty for the
 *     project's;
 *   - CloudCostRecommendation.commitmentDetails: what a "commit to use"
 *     recommendation would buy.
 *
 * New tables are empty, so their indexes and keys need no online DDL; the
 * two columns are nullable with no default, added without rewriting a row.
 */
export class AddCloudCostBasesAndCommitments1809187660117
  implements MigrationInterface
{
  public name: string = "AddCloudCostBasesAndCommitments1809187660117";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudCommitment" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "cloudAccountId" uuid NOT NULL, "provider" character varying(100) NOT NULL, "commitmentId" character varying(500) NOT NULL, "kind" character varying(100) NOT NULL, "name" character varying(500) NOT NULL, "commitmentType" character varying(500), "covers" character varying(500), "region" character varying(100), "scope" character varying(100), "appliesTo" character varying(500), "termMonths" integer, "paymentOption" character varying(100), "startsAt" TIMESTAMP WITH TIME ZONE, "endsAt" TIMESTAMP WITH TIME ZONE, "state" character varying(100) NOT NULL, "isAutoRenew" boolean, "hourlyCommitment" numeric, "quantity" numeric, "upfrontCost" numeric, "recurringHourlyCost" numeric, "currency" character varying(100) NOT NULL, "utilizationPercent" numeric, "weekUtilizationPercent" numeric, "figures" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "alertState" jsonb, "createdByUserId" uuid, CONSTRAINT "PK_c348295954854ed0b021ad73ec9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dc0715c0c733c0805a4ed7e494" ON "CloudCommitment" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f746414c1a2b9d196da7f27080" ON "CloudCommitment" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb734cad70bd65a9e82aa918e0" ON "CloudCommitment" ("endsAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e8037243c837e5e643cede3056" ON "CloudCommitment" ("projectId", "provider", "commitmentId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "costBasis" character varying(100) NOT NULL DEFAULT 'amortized', "isCommitmentAlertsEnabled" boolean NOT NULL DEFAULT true, "commitmentExpiryAlertDays" character varying(100) NOT NULL DEFAULT '90, 30, 7', "commitmentUtilizationThreshold" integer NOT NULL DEFAULT '80', "commitmentCoverageThreshold" integer DEFAULT '60', "commitmentAlertSeverityId" uuid, "commitmentAlertState" jsonb, CONSTRAINT "PK_64d6255520807001bc659964387" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d9d88c0a46cedbe28a014149d" ON "CloudCostSetting" ("commitmentAlertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7cc55ab03e6eb02f2bfad29c80" ON "CloudCostSetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostSettingOnCallDutyPolicy" ("cloudCostSettingId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_75f853e2fbbbd446d7a71559457" PRIMARY KEY ("cloudCostSettingId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8bf6878e3fd9cdd939a868e674" ON "CloudCostSettingOnCallDutyPolicy" ("cloudCostSettingId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80bb2845ec3e3b09de8d7d3c9f" ON "CloudCostSettingOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostSettingOwnerUser" ("cloudCostSettingId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_a7caf2de597fff7aec7df0a7f8c" PRIMARY KEY ("cloudCostSettingId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8120d054c7443991ede96a59df" ON "CloudCostSettingOwnerUser" ("cloudCostSettingId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3944634614d95e4bec3d30fa81" ON "CloudCostSettingOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostSettingOwnerTeam" ("cloudCostSettingId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_9046198cfebea0e7710bbe7b5eb" PRIMARY KEY ("cloudCostSettingId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0037e4ec8248ed0da571fc7b1" ON "CloudCostSettingOwnerTeam" ("cloudCostSettingId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a1d857aac05bbb5974a80614fa" ON "CloudCostSettingOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD "costBasis" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" ADD "commitmentDetails" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCommitment" ADD CONSTRAINT "FK_dc0715c0c733c0805a4ed7e494d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCommitment" ADD CONSTRAINT "FK_f746414c1a2b9d196da7f270805" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSetting" ADD CONSTRAINT "FK_7cc55ab03e6eb02f2bfad29c806" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSetting" ADD CONSTRAINT "FK_9d9d88c0a46cedbe28a014149d0" FOREIGN KEY ("commitmentAlertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOnCallDutyPolicy" ADD CONSTRAINT "FK_8bf6878e3fd9cdd939a868e6742" FOREIGN KEY ("cloudCostSettingId") REFERENCES "CloudCostSetting"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOnCallDutyPolicy" ADD CONSTRAINT "FK_80bb2845ec3e3b09de8d7d3c9fd" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerUser" ADD CONSTRAINT "FK_8120d054c7443991ede96a59df2" FOREIGN KEY ("cloudCostSettingId") REFERENCES "CloudCostSetting"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerUser" ADD CONSTRAINT "FK_3944634614d95e4bec3d30fa81c" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerTeam" ADD CONSTRAINT "FK_b0037e4ec8248ed0da571fc7b16" FOREIGN KEY ("cloudCostSettingId") REFERENCES "CloudCostSetting"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerTeam" ADD CONSTRAINT "FK_a1d857aac05bbb5974a80614fab" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerTeam" DROP CONSTRAINT "FK_a1d857aac05bbb5974a80614fab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerTeam" DROP CONSTRAINT "FK_b0037e4ec8248ed0da571fc7b16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerUser" DROP CONSTRAINT "FK_3944634614d95e4bec3d30fa81c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOwnerUser" DROP CONSTRAINT "FK_8120d054c7443991ede96a59df2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOnCallDutyPolicy" DROP CONSTRAINT "FK_80bb2845ec3e3b09de8d7d3c9fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSettingOnCallDutyPolicy" DROP CONSTRAINT "FK_8bf6878e3fd9cdd939a868e6742"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSetting" DROP CONSTRAINT "FK_9d9d88c0a46cedbe28a014149d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostSetting" DROP CONSTRAINT "FK_7cc55ab03e6eb02f2bfad29c806"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCommitment" DROP CONSTRAINT "FK_f746414c1a2b9d196da7f270805"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCommitment" DROP CONSTRAINT "FK_dc0715c0c733c0805a4ed7e494d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" DROP COLUMN "commitmentDetails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP COLUMN "costBasis"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a1d857aac05bbb5974a80614fa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0037e4ec8248ed0da571fc7b1"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostSettingOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3944634614d95e4bec3d30fa81"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8120d054c7443991ede96a59df"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostSettingOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80bb2845ec3e3b09de8d7d3c9f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bf6878e3fd9cdd939a868e674"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostSettingOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7cc55ab03e6eb02f2bfad29c80"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d9d88c0a46cedbe28a014149d"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostSetting"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8037243c837e5e643cede3056"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb734cad70bd65a9e82aa918e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f746414c1a2b9d196da7f27080"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dc0715c0c733c0805a4ed7e494"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCommitment"`);
  }
}
