import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackUsageAndBudgets1808993950000
  implements MigrationInterface
{
  public name: string = "AddOpenStackUsageAndBudgets1808993950000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OpenStackProjectUsage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "openStackCloudId" uuid NOT NULL, "openStackProjectId" character varying(100) NOT NULL, "period" character varying(100) NOT NULL, "name" character varying(100), "domainId" character varying(100), "domainName" character varying(100), "quantities" jsonb, "vcpuHours" numeric, "memoryGbHours" numeric, "volumeGbHours" numeric, "floatingIpHours" numeric, "estimatedCost" numeric, "lastMonthCost" numeric, "onCourseFor" numeric, "growth" numeric, "costSource" character varying(100), "unpricedLineCount" integer, "sortValue" numeric NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c8f7c5320c66fd4903b5aa584af" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d4fa944839a3ac0132d947985" ON "OpenStackProjectUsage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f1d1701fa0de59e432d97c035" ON "OpenStackProjectUsage" ("openStackCloudId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7da818367383e63a7f7cefb3ee" ON "OpenStackProjectUsage" ("openStackCloudId", "openStackProjectId", "period") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_077de5fa194a7188722c579e20" ON "OpenStackProjectUsage" ("projectId", "openStackCloudId", "period", "sortValue") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bd658088eaa76ccb87cb4e5abf" ON "OpenStackProjectUsage" ("projectId", "openStackCloudId", "period", "openStackProjectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OpenStackBudget" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "openStackCloudId" uuid NOT NULL, "openStackProjectId" character varying(100), "name" character varying(100) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "monthlyAmount" numeric NOT NULL, "alertThresholds" character varying(100) NOT NULL DEFAULT '80,100', "alertOnProjection" boolean NOT NULL DEFAULT true, "alertSeverityId" uuid, "spentThisMonth" numeric, "projectedThisMonth" numeric, "lastCheckedAt" TIMESTAMP WITH TIME ZONE, "alertState" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_fc6899a61160b58a0069283e5ea" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b1a15d0435c568bee8e6474f4" ON "OpenStackBudget" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5b476d8f1a59146a8e71ccfc5b" ON "OpenStackBudget" ("openStackCloudId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e794daaa5353efc089060050e8" ON "OpenStackBudget" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69e0802ea5e85bf9934cab7bc7" ON "OpenStackBudget" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OpenStackBudgetOnCallDutyPolicy" ("openStackBudgetId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_12aa2e085fab5764a61b80b16cb" PRIMARY KEY ("openStackBudgetId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1c210afa300b1d09c980d69b0" ON "OpenStackBudgetOnCallDutyPolicy" ("openStackBudgetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46830f1a1efa2c84bb034c9f0b" ON "OpenStackBudgetOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" ADD "spendSnapshot" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" ADD "usageReadAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" ADD "priceList" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" ADD CONSTRAINT "FK_8d4fa944839a3ac0132d9479852" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" ADD CONSTRAINT "FK_1f1d1701fa0de59e432d97c0351" FOREIGN KEY ("openStackCloudId") REFERENCES "OpenStackCloud"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" ADD CONSTRAINT "FK_d021d652ccbbcae11f0ff9e5ca0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" ADD CONSTRAINT "FK_7766afbc86e056d62a6be019004" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" ADD CONSTRAINT "FK_8b1a15d0435c568bee8e6474f45" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" ADD CONSTRAINT "FK_5b476d8f1a59146a8e71ccfc5b3" FOREIGN KEY ("openStackCloudId") REFERENCES "OpenStackCloud"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" ADD CONSTRAINT "FK_69e0802ea5e85bf9934cab7bc7c" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" ADD CONSTRAINT "FK_e71a7d93508348621c6a062199d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" ADD CONSTRAINT "FK_a50dcd1c0917396608a6ad70aa8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_e1c210afa300b1d09c980d69b0a" FOREIGN KEY ("openStackBudgetId") REFERENCES "OpenStackBudget"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_46830f1a1efa2c84bb034c9f0b1" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudgetOnCallDutyPolicy" DROP CONSTRAINT "FK_46830f1a1efa2c84bb034c9f0b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudgetOnCallDutyPolicy" DROP CONSTRAINT "FK_e1c210afa300b1d09c980d69b0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" DROP CONSTRAINT "FK_a50dcd1c0917396608a6ad70aa8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" DROP CONSTRAINT "FK_e71a7d93508348621c6a062199d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" DROP CONSTRAINT "FK_69e0802ea5e85bf9934cab7bc7c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" DROP CONSTRAINT "FK_5b476d8f1a59146a8e71ccfc5b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackBudget" DROP CONSTRAINT "FK_8b1a15d0435c568bee8e6474f45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" DROP CONSTRAINT "FK_7766afbc86e056d62a6be019004"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" DROP CONSTRAINT "FK_d021d652ccbbcae11f0ff9e5ca0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" DROP CONSTRAINT "FK_1f1d1701fa0de59e432d97c0351"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectUsage" DROP CONSTRAINT "FK_8d4fa944839a3ac0132d9479852"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" DROP COLUMN "priceList"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" DROP COLUMN "usageReadAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" DROP COLUMN "spendSnapshot"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46830f1a1efa2c84bb034c9f0b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1c210afa300b1d09c980d69b0"`,
    );
    await queryRunner.query(`DROP TABLE "OpenStackBudgetOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_69e0802ea5e85bf9934cab7bc7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e794daaa5353efc089060050e8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b476d8f1a59146a8e71ccfc5b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b1a15d0435c568bee8e6474f4"`,
    );
    await queryRunner.query(`DROP TABLE "OpenStackBudget"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd658088eaa76ccb87cb4e5abf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_077de5fa194a7188722c579e20"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7da818367383e63a7f7cefb3ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f1d1701fa0de59e432d97c035"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d4fa944839a3ac0132d947985"`,
    );
    await queryRunner.query(`DROP TABLE "OpenStackProjectUsage"`);
  }
}
