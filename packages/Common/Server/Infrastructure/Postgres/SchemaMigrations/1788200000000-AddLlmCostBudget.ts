import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLlmCostBudget1788200000000 implements MigrationInterface {
  public name: string = "AddLlmCostBudget1788200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LlmCostBudget" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "dailyBudgetInUSD" numeric NOT NULL, "warningThresholdPercent" integer NOT NULL DEFAULT '80', "serviceId" uuid, "llmSystem" character varying(100), "llmModel" character varying(100), "alertSeverityId" uuid, "currentDaySpendInUSD" numeric, "spendLastEvaluatedAt" TIMESTAMP WITH TIME ZONE, "lastWarningAlertCreatedAt" TIMESTAMP WITH TIME ZONE, "lastBreachAlertCreatedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_d578bebf3f6052e17b704cf258f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2c16269206814b595fe8989fc" ON "LlmCostBudget" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_406f25110eaf6728f1621c25b4" ON "LlmCostBudget" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_040ebc679deb8d1153c1df38ec" ON "LlmCostBudget" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dfe6c27c42564e7422d26c8b1e" ON "LlmCostBudget" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "LlmCostBudgetOnCallDutyPolicy" ("llmCostBudgetId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_1312da5439a5bc0ba61e5cbf005" PRIMARY KEY ("llmCostBudgetId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d05f7b557fdd92c4c9ff42e910" ON "LlmCostBudgetOnCallDutyPolicy" ("llmCostBudgetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76020c2c8f8f264128f6adfd89" ON "LlmCostBudgetOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD CONSTRAINT "FK_a2c16269206814b595fe8989fcf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD CONSTRAINT "FK_040ebc679deb8d1153c1df38ec4" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD CONSTRAINT "FK_dfe6c27c42564e7422d26c8b1ed" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD CONSTRAINT "FK_1b9d9408f33a0915ba0351d0040" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD CONSTRAINT "FK_74898628624d84ba6c9a55bb5fc" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_d05f7b557fdd92c4c9ff42e9107" FOREIGN KEY ("llmCostBudgetId") REFERENCES "LlmCostBudget"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_76020c2c8f8f264128f6adfd899" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudgetOnCallDutyPolicy" DROP CONSTRAINT "FK_76020c2c8f8f264128f6adfd899"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudgetOnCallDutyPolicy" DROP CONSTRAINT "FK_d05f7b557fdd92c4c9ff42e9107"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP CONSTRAINT "FK_74898628624d84ba6c9a55bb5fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP CONSTRAINT "FK_1b9d9408f33a0915ba0351d0040"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP CONSTRAINT "FK_dfe6c27c42564e7422d26c8b1ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP CONSTRAINT "FK_040ebc679deb8d1153c1df38ec4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP CONSTRAINT "FK_a2c16269206814b595fe8989fcf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76020c2c8f8f264128f6adfd89"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d05f7b557fdd92c4c9ff42e910"`,
    );
    await queryRunner.query(`DROP TABLE "LlmCostBudgetOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfe6c27c42564e7422d26c8b1e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_040ebc679deb8d1153c1df38ec"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_406f25110eaf6728f1621c25b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2c16269206814b595fe8989fc"`,
    );
    await queryRunner.query(`DROP TABLE "LlmCostBudget"`);
  }
}
