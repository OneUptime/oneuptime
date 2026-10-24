import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Profiles gets an AI section (Types/AI/TelemetryAi): OneUptime finds slow
 * code in a service's profiles, and OneUptime AI looks into it and opens a
 * pull request that makes it faster.
 *
 *   - Project "enableAutomaticProfileRemediation": the section's switch,
 *     "Find and fix slow code". Off here for every project that exists -
 *     an upgrade spends no AI credits and opens no pull request unasked -
 *     and turned on for new projects as they are created
 *     (ProjectService NEW_PROJECT_AI_DEFAULT_COLUMNS).
 *   - AutoRemediationRule "serviceNamePattern", and the join tables
 *     "AutoRemediationRuleService" and "AutoRemediationRuleServiceLabel":
 *     what a profile AI rule (an AI rule whose triggerEntityType is
 *     Profile) matches on - the service the slow code is in, picked, by its
 *     labels or by its name.
 *
 * Nothing to backfill: no rule is a profile AI rule yet. The new tables are
 * empty when their indexes and keys are added, so building them blocks
 * nothing; the column with a constant default and the nullable column are
 * added without rewriting a row.
 */
export class AddProfileAiRules1807000000000 implements MigrationInterface {
  public name: string = "AddProfileAiRules1807000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleService" ("autoRemediationRuleId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_2967e6d12f6e121bd9e428a545f" PRIMARY KEY ("autoRemediationRuleId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed4f5538bb2e4e9244783a2497" ON "AutoRemediationRuleService" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6749ca919bee4603a504f950ea" ON "AutoRemediationRuleService" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleServiceLabel" ("autoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_f2c83b9cf13b8d58cb91d01a04a" PRIMARY KEY ("autoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_05f7f975548060f054be8ad807" ON "AutoRemediationRuleServiceLabel" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e70bac3245574253d21580767" ON "AutoRemediationRuleServiceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticProfileRemediation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "serviceNamePattern" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleService" ADD CONSTRAINT "FK_ed4f5538bb2e4e9244783a24970" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleService" ADD CONSTRAINT "FK_6749ca919bee4603a504f950eae" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleServiceLabel" ADD CONSTRAINT "FK_05f7f975548060f054be8ad807f" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleServiceLabel" ADD CONSTRAINT "FK_7e70bac3245574253d21580767f" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleServiceLabel" DROP CONSTRAINT "FK_7e70bac3245574253d21580767f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleServiceLabel" DROP CONSTRAINT "FK_05f7f975548060f054be8ad807f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleService" DROP CONSTRAINT "FK_6749ca919bee4603a504f950eae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleService" DROP CONSTRAINT "FK_ed4f5538bb2e4e9244783a24970"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "serviceNamePattern"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticProfileRemediation"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e70bac3245574253d21580767"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05f7f975548060f054be8ad807"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleServiceLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6749ca919bee4603a504f950ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed4f5538bb2e4e9244783a2497"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleService"`);
  }
}
