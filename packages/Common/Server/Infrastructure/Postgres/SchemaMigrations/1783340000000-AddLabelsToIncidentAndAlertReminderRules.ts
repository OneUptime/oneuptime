import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLabelsToIncidentAndAlertReminderRules1783340000000
  implements MigrationInterface
{
  public name = "AddLabelsToIncidentAndAlertReminderRules1783340000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentReminderRuleLabel" ("incidentReminderRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ff2a1d0c9b5e4a7c8d3e1f6b204" PRIMARY KEY ("incidentReminderRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce1b7a4d3f0e8c2a9b5d6e14f21" ON "IncidentReminderRuleLabel" ("incidentReminderRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da5c8e6f2b1a4d7c093e5f18a37" ON "IncidentReminderRuleLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertReminderRuleLabel" ("alertReminderRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ab3c5d7e9f1027384a6b8c0d2e4" PRIMARY KEY ("alertReminderRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf4d6e8a0c2153749b5c7d9e0f2" ON "AlertReminderRuleLabel" ("alertReminderRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd7e9f1b3a5062748c6d8e0f193" ON "AlertReminderRuleLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleLabel" ADD CONSTRAINT "FK_ce1b7a4d3f0e8c2a9b5d6e14f21" FOREIGN KEY ("incidentReminderRuleId") REFERENCES "IncidentReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleLabel" ADD CONSTRAINT "FK_da5c8e6f2b1a4d7c093e5f18a37" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleLabel" ADD CONSTRAINT "FK_bf4d6e8a0c2153749b5c7d9e0f2" FOREIGN KEY ("alertReminderRuleId") REFERENCES "AlertReminderRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleLabel" ADD CONSTRAINT "FK_cd7e9f1b3a5062748c6d8e0f193" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleLabel" DROP CONSTRAINT "FK_cd7e9f1b3a5062748c6d8e0f193"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertReminderRuleLabel" DROP CONSTRAINT "FK_bf4d6e8a0c2153749b5c7d9e0f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleLabel" DROP CONSTRAINT "FK_da5c8e6f2b1a4d7c093e5f18a37"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentReminderRuleLabel" DROP CONSTRAINT "FK_ce1b7a4d3f0e8c2a9b5d6e14f21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd7e9f1b3a5062748c6d8e0f193"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf4d6e8a0c2153749b5c7d9e0f2"`,
    );
    await queryRunner.query(`DROP TABLE "AlertReminderRuleLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da5c8e6f2b1a4d7c093e5f18a37"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce1b7a4d3f0e8c2a9b5d6e14f21"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentReminderRuleLabel"`);
  }
}
