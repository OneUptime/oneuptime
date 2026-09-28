import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Team compliance rules scoped by severity and channel.
 *
 * - "notificationChannel": the channel an on-call compliance rule insists on
 *   (Call, Push, ...). Nullable with no default, so every existing rule reads
 *   as "any channel" - exactly what it checked before.
 * - "TeamComplianceSettingIncidentSeverity" / "...AlertSeverity": the
 *   severities an on-call compliance rule is scoped to. Empty means every
 *   severity, which is again what every existing rule already checked. Both
 *   cascade from the rule and from the severity.
 * - The unique ("teamId", "ruleType") index goes: "Call for Critical
 *   incidents" and "Push for Critical incidents" are both
 *   HasIncidentOnCallRules on one team. TeamComplianceSettingService rejects
 *   exact duplicates instead. Existing data cannot violate the change - it only
 *   relaxes a constraint.
 */
export class AddTeamComplianceRuleScope1796000000000
  implements MigrationInterface
{
  public name: string = "AddTeamComplianceRuleScope1796000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef7342919ff02501c2b0ddc029"`,
    );
    await queryRunner.query(
      `CREATE TABLE "TeamComplianceSettingIncidentSeverity" ("teamComplianceSettingId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_0071a6d21730a2ed9e098873b2e" PRIMARY KEY ("teamComplianceSettingId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_013768788937d0e484fb3c1bcb" ON "TeamComplianceSettingIncidentSeverity" ("teamComplianceSettingId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e477b60ddefe41bfdee3e6142" ON "TeamComplianceSettingIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "TeamComplianceSettingAlertSeverity" ("teamComplianceSettingId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_ba665b5e7d6413db2be11bf2f09" PRIMARY KEY ("teamComplianceSettingId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c01a8eeea98cb41a45806fe5c7" ON "TeamComplianceSettingAlertSeverity" ("teamComplianceSettingId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_573637e6a2df47b516b0f955d9" ON "TeamComplianceSettingAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSetting" ADD "notificationChannel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingIncidentSeverity" ADD CONSTRAINT "FK_013768788937d0e484fb3c1bcb8" FOREIGN KEY ("teamComplianceSettingId") REFERENCES "TeamComplianceSetting"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingIncidentSeverity" ADD CONSTRAINT "FK_6e477b60ddefe41bfdee3e61424" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingAlertSeverity" ADD CONSTRAINT "FK_c01a8eeea98cb41a45806fe5c77" FOREIGN KEY ("teamComplianceSettingId") REFERENCES "TeamComplianceSetting"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingAlertSeverity" ADD CONSTRAINT "FK_573637e6a2df47b516b0f955d96" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingAlertSeverity" DROP CONSTRAINT "FK_573637e6a2df47b516b0f955d96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingAlertSeverity" DROP CONSTRAINT "FK_c01a8eeea98cb41a45806fe5c77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingIncidentSeverity" DROP CONSTRAINT "FK_6e477b60ddefe41bfdee3e61424"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSettingIncidentSeverity" DROP CONSTRAINT "FK_013768788937d0e484fb3c1bcb8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamComplianceSetting" DROP COLUMN "notificationChannel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_573637e6a2df47b516b0f955d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c01a8eeea98cb41a45806fe5c7"`,
    );
    await queryRunner.query(`DROP TABLE "TeamComplianceSettingAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e477b60ddefe41bfdee3e6142"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_013768788937d0e484fb3c1bcb"`,
    );
    await queryRunner.query(
      `DROP TABLE "TeamComplianceSettingIncidentSeverity"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ef7342919ff02501c2b0ddc029" ON "TeamComplianceSetting" ("teamId", "ruleType") `,
    );
  }
}
