import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration: what a cloud account
 * costs, the ways to spend less, budgets, and each cloud resource's health.
 *
 *   - "CloudBudget" and its on-call policies ("CloudBudgetOnCallDutyPolicy"):
 *     what a month may cost, for one account or all of them, and who is
 *     paged as it is passed;
 *   - "CloudCostRecommendation": the ways to spend less each cloud's own
 *     recommender makes, one row per recommendation, written by the
 *     connections and unique per project, cloud and recommendation;
 *   - "CloudAccount"."costSummary" and "savingsSummary": an account's costs
 *     and savings at a glance, written after each read of them;
 *   - "CloudResource"."cloudReadings", "cloudReadingsAt" and
 *     "healthSeverity": each resource's key metrics as last read, and what
 *     its health rules made of them.
 *
 * Every column added to a table that holds rows is nullable with no
 * default: a catalogue change, not a rewrite. The partial index of the
 * resources that need attention is built online, in
 * AddCloudResourceHealthSeverityIndex1808910000000. The costs themselves
 * are in ClickHouse ("CloudCostV1"), created by its own schema.
 */
export class AddCloudCostsAndResourceHealth1808900000000
  implements MigrationInterface
{
  public name: string = "AddCloudCostsAndResourceHealth1808900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudBudget" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "cloudAccountId" uuid, "monthlyAmount" numeric NOT NULL, "currency" character varying(100) NOT NULL DEFAULT 'USD', "alertThresholds" character varying(100) NOT NULL DEFAULT '80,100', "alertOnProjection" boolean NOT NULL DEFAULT true, "alertSeverityId" uuid, "spentThisMonth" numeric, "projectedThisMonth" numeric, "lastCheckedAt" TIMESTAMP WITH TIME ZONE, "alertState" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_14c48f5f7b1119f6d4f91be7888" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_99e2ef892310a35b3703670340" ON "CloudBudget" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31142fe0655acf853a8a69e0de" ON "CloudBudget" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bdc598d01f0ffc391833e24201" ON "CloudBudget" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb7fc0cd29352860a49de883c7" ON "CloudBudget" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudCostRecommendation" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cloudAccountId" uuid NOT NULL, "cloudResourceId" uuid, "provider" character varying(100) NOT NULL, "recommendationId" character varying(500) NOT NULL, "region" character varying(100), "resourceId" character varying(500), "resourceType" character varying(100), "resourceName" character varying(100), "kind" character varying(100) NOT NULL, "action" character varying(500) NOT NULL, "currentConfiguration" character varying(500), "recommendedConfiguration" character varying(500), "monthlySavings" numeric NOT NULL, "monthlyCost" numeric, "currency" character varying(100) NOT NULL, "effort" character varying(100), "source" character varying(100) NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b124b5e0576709dd75187ff811f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6197a0aa9b95cd273c3d948a35" ON "CloudCostRecommendation" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_27b780fe33a2af3645ca4426b7" ON "CloudCostRecommendation" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46bfe2849acad4e5876b4563b0" ON "CloudCostRecommendation" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_424c50bf8f68467154036e8180" ON "CloudCostRecommendation" ("projectId", "provider", "recommendationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudBudgetOnCallDutyPolicy" ("cloudBudgetId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_a1ca45ea828ce11d60a0aad8f3c" PRIMARY KEY ("cloudBudgetId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b87132baebff74b11285508c1" ON "CloudBudgetOnCallDutyPolicy" ("cloudBudgetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ec131443b0467243b5d6d90b9" ON "CloudBudgetOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudReadings" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudReadingsAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "healthSeverity" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "costSummary" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "savingsSummary" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD CONSTRAINT "FK_99e2ef892310a35b37036703402" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD CONSTRAINT "FK_bdc598d01f0ffc391833e242011" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD CONSTRAINT "FK_eb7fc0cd29352860a49de883c7e" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD CONSTRAINT "FK_fa4499210261d53ea0e439db473" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" ADD CONSTRAINT "FK_714c7eb992ad62e9b9e0379d992" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" ADD CONSTRAINT "FK_6197a0aa9b95cd273c3d948a351" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" ADD CONSTRAINT "FK_27b780fe33a2af3645ca4426b71" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" ADD CONSTRAINT "FK_46bfe2849acad4e5876b4563b0c" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" ADD CONSTRAINT "FK_8ed3d8d4d9acbeec688c3a9ff55" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_3b87132baebff74b11285508c1e" FOREIGN KEY ("cloudBudgetId") REFERENCES "CloudBudget"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_4ec131443b0467243b5d6d90b91" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetOnCallDutyPolicy" DROP CONSTRAINT "FK_4ec131443b0467243b5d6d90b91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudgetOnCallDutyPolicy" DROP CONSTRAINT "FK_3b87132baebff74b11285508c1e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" DROP CONSTRAINT "FK_8ed3d8d4d9acbeec688c3a9ff55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" DROP CONSTRAINT "FK_46bfe2849acad4e5876b4563b0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" DROP CONSTRAINT "FK_27b780fe33a2af3645ca4426b71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudCostRecommendation" DROP CONSTRAINT "FK_6197a0aa9b95cd273c3d948a351"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP CONSTRAINT "FK_714c7eb992ad62e9b9e0379d992"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP CONSTRAINT "FK_fa4499210261d53ea0e439db473"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP CONSTRAINT "FK_eb7fc0cd29352860a49de883c7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP CONSTRAINT "FK_bdc598d01f0ffc391833e242011"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudBudget" DROP CONSTRAINT "FK_99e2ef892310a35b37036703402"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "savingsSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "costSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "healthSeverity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudReadingsAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudReadings"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ec131443b0467243b5d6d90b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b87132baebff74b11285508c1"`,
    );
    await queryRunner.query(`DROP TABLE "CloudBudgetOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_424c50bf8f68467154036e8180"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46bfe2849acad4e5876b4563b0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27b780fe33a2af3645ca4426b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6197a0aa9b95cd273c3d948a35"`,
    );
    await queryRunner.query(`DROP TABLE "CloudCostRecommendation"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb7fc0cd29352860a49de883c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdc598d01f0ffc391833e24201"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31142fe0655acf853a8a69e0de"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_99e2ef892310a35b3703670340"`,
    );
    await queryRunner.query(`DROP TABLE "CloudBudget"`);
  }
}
