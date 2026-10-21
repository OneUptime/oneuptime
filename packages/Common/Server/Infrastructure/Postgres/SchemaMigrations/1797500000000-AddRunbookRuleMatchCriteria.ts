import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Runbook rules match on what the other incident, alert and scheduled
 * maintenance rules match on: monitors, incident or alert severities, the
 * record's labels, its monitors' labels, and its monitors' names and
 * descriptions - not only on the title and description. One join table per
 * relation (RunbookRuleMonitor, RunbookRuleIncidentSeverity,
 * RunbookRuleAlertSeverity, RunbookRuleLabel, RunbookRuleMonitorLabel) and
 * two pattern columns. Every existing rule keeps matching exactly as before:
 * the new criteria start empty, which matches anything.
 */
export class AddRunbookRuleMatchCriteria1797500000000
  implements MigrationInterface
{
  public name: string = "AddRunbookRuleMatchCriteria1797500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookRuleMonitor" ("runbookRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_71f954e60c8eeec32f21173df60" PRIMARY KEY ("runbookRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aedc28e91cf9db0a1c8708492c" ON "RunbookRuleMonitor" ("runbookRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd2932a2f3236f9bd597df119e" ON "RunbookRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookRuleIncidentSeverity" ("runbookRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_4f1b1b7952f42dd02fc6255e7b2" PRIMARY KEY ("runbookRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ffff834fd429ad4cf44002984f" ON "RunbookRuleIncidentSeverity" ("runbookRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c482dc306d1126957561d11f78" ON "RunbookRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookRuleAlertSeverity" ("runbookRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_2e5f9d0859282c9ba62f52b09e2" PRIMARY KEY ("runbookRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_639ca86757549eaf1b89815b77" ON "RunbookRuleAlertSeverity" ("runbookRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e7154db9bdfd011e40678b86c" ON "RunbookRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookRuleLabel" ("runbookRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_6f3a620c7779b70d489a0236a98" PRIMARY KEY ("runbookRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c3edc7356bd5ce4bd3214e6b8c" ON "RunbookRuleLabel" ("runbookRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_442acb3e9ef78f665d77ae343d" ON "RunbookRuleLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookRuleMonitorLabel" ("runbookRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_b58f8750fda970f967fa7d53df1" PRIMARY KEY ("runbookRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6e8eb29acae948f9a7bd10045" ON "RunbookRuleMonitorLabel" ("runbookRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd5bde6fc5994f74e4b5a63fde" ON "RunbookRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" ADD "monitorNamePattern" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" ADD "monitorDescriptionPattern" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitor" ADD CONSTRAINT "FK_aedc28e91cf9db0a1c8708492c0" FOREIGN KEY ("runbookRuleId") REFERENCES "RunbookRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitor" ADD CONSTRAINT "FK_cd2932a2f3236f9bd597df119ef" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleIncidentSeverity" ADD CONSTRAINT "FK_ffff834fd429ad4cf44002984ff" FOREIGN KEY ("runbookRuleId") REFERENCES "RunbookRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleIncidentSeverity" ADD CONSTRAINT "FK_c482dc306d1126957561d11f782" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleAlertSeverity" ADD CONSTRAINT "FK_639ca86757549eaf1b89815b77c" FOREIGN KEY ("runbookRuleId") REFERENCES "RunbookRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleAlertSeverity" ADD CONSTRAINT "FK_9e7154db9bdfd011e40678b86cb" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleLabel" ADD CONSTRAINT "FK_c3edc7356bd5ce4bd3214e6b8c7" FOREIGN KEY ("runbookRuleId") REFERENCES "RunbookRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleLabel" ADD CONSTRAINT "FK_442acb3e9ef78f665d77ae343db" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitorLabel" ADD CONSTRAINT "FK_a6e8eb29acae948f9a7bd100451" FOREIGN KEY ("runbookRuleId") REFERENCES "RunbookRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitorLabel" ADD CONSTRAINT "FK_dd5bde6fc5994f74e4b5a63fde9" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitorLabel" DROP CONSTRAINT "FK_dd5bde6fc5994f74e4b5a63fde9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitorLabel" DROP CONSTRAINT "FK_a6e8eb29acae948f9a7bd100451"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleLabel" DROP CONSTRAINT "FK_442acb3e9ef78f665d77ae343db"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleLabel" DROP CONSTRAINT "FK_c3edc7356bd5ce4bd3214e6b8c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleAlertSeverity" DROP CONSTRAINT "FK_9e7154db9bdfd011e40678b86cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleAlertSeverity" DROP CONSTRAINT "FK_639ca86757549eaf1b89815b77c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleIncidentSeverity" DROP CONSTRAINT "FK_c482dc306d1126957561d11f782"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleIncidentSeverity" DROP CONSTRAINT "FK_ffff834fd429ad4cf44002984ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitor" DROP CONSTRAINT "FK_cd2932a2f3236f9bd597df119ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRuleMonitor" DROP CONSTRAINT "FK_aedc28e91cf9db0a1c8708492c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" DROP COLUMN "monitorDescriptionPattern"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookRule" DROP COLUMN "monitorNamePattern"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd5bde6fc5994f74e4b5a63fde"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6e8eb29acae948f9a7bd10045"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_442acb3e9ef78f665d77ae343d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c3edc7356bd5ce4bd3214e6b8c"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookRuleLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e7154db9bdfd011e40678b86c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_639ca86757549eaf1b89815b77"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c482dc306d1126957561d11f78"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ffff834fd429ad4cf44002984f"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd2932a2f3236f9bd597df119e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aedc28e91cf9db0a1c8708492c"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookRuleMonitor"`);
  }
}
