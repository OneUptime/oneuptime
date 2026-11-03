import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Alert incident rules (AlertIncidentRule): which alerts have an incident
 * declared from them - their conditions, their place in the list, the
 * incident's severity, the wait before declaring and whether the incident
 * shows on status pages - with the join tables of the monitors, severities
 * and labels a rule matches. Every table is new.
 *
 * "Alert" gains "nextIncidentRuleCheckAt": when the rule that matched an
 * alert, and waits for it to stay unresolved, is checked again. The column
 * is new and nullable, with no default: adding it only changes the
 * catalogue, never rewrites a row or holds a long lock. Its index is built
 * online in AddAlertIncidentRuleCheckIndex.
 */
export class AddAlertIncidentRules1808991210000 implements MigrationInterface {
  public name: string = "AddAlertIncidentRules1808991210000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertIncidentRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "order" integer NOT NULL DEFAULT '1', "alertTitlePattern" character varying(500), "alertDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "incidentSeverityId" uuid, "declareAfterInMinutes" integer NOT NULL DEFAULT '0', "showIncidentOnStatusPage" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_20c9623a9d1e61b1b3e4aa184e9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2173814ff2cf27784628f754e9" ON "AlertIncidentRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00546d6e0ac5814da66319b064" ON "AlertIncidentRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e4682bc710641eb05a310d042" ON "AlertIncidentRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9546754e15242b2d96140ff41d" ON "AlertIncidentRule" ("order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c60e1f0a273569c840577ceb21" ON "AlertIncidentRule" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertIncidentRuleMonitor" ("alertIncidentRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_02cd98dbaa791eacf6b533de214" PRIMARY KEY ("alertIncidentRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_294d61029a66cc7d44b67cd344" ON "AlertIncidentRuleMonitor" ("alertIncidentRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4cff4a3fdcd90da94e503dc075" ON "AlertIncidentRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertIncidentRuleAlertSeverity" ("alertIncidentRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_0bd1763840011608311f1484a5e" PRIMARY KEY ("alertIncidentRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c8f7d2947121b3f4c460137ad9" ON "AlertIncidentRuleAlertSeverity" ("alertIncidentRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9bfbd10e107f69613b59c0906b" ON "AlertIncidentRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertIncidentRuleAlertLabel" ("alertIncidentRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ed2201aa3c45d70f413b553c11c" PRIMARY KEY ("alertIncidentRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_547e6948a92f6fa8a1e1f3df4c" ON "AlertIncidentRuleAlertLabel" ("alertIncidentRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9dac1bb3bcd634970468485ce" ON "AlertIncidentRuleAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertIncidentRuleMonitorLabel" ("alertIncidentRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_57e84063dc86ddc91776f25425f" PRIMARY KEY ("alertIncidentRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e87b8fbe3de940b9c6ff0aa9c" ON "AlertIncidentRuleMonitorLabel" ("alertIncidentRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5bc52176dad1755a05dbed8ed6" ON "AlertIncidentRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "nextIncidentRuleCheckAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" ADD CONSTRAINT "FK_2173814ff2cf27784628f754e96" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" ADD CONSTRAINT "FK_c60e1f0a273569c840577ceb21f" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" ADD CONSTRAINT "FK_ce32de0d81181798fed4dd60a62" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" ADD CONSTRAINT "FK_f524a5f7df716f6d0f91e0b217e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitor" ADD CONSTRAINT "FK_294d61029a66cc7d44b67cd3443" FOREIGN KEY ("alertIncidentRuleId") REFERENCES "AlertIncidentRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitor" ADD CONSTRAINT "FK_4cff4a3fdcd90da94e503dc0753" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertSeverity" ADD CONSTRAINT "FK_c8f7d2947121b3f4c460137ad9a" FOREIGN KEY ("alertIncidentRuleId") REFERENCES "AlertIncidentRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertSeverity" ADD CONSTRAINT "FK_9bfbd10e107f69613b59c0906b5" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertLabel" ADD CONSTRAINT "FK_547e6948a92f6fa8a1e1f3df4ca" FOREIGN KEY ("alertIncidentRuleId") REFERENCES "AlertIncidentRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertLabel" ADD CONSTRAINT "FK_f9dac1bb3bcd634970468485ce0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitorLabel" ADD CONSTRAINT "FK_1e87b8fbe3de940b9c6ff0aa9c1" FOREIGN KEY ("alertIncidentRuleId") REFERENCES "AlertIncidentRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitorLabel" ADD CONSTRAINT "FK_5bc52176dad1755a05dbed8ed6b" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitorLabel" DROP CONSTRAINT "FK_5bc52176dad1755a05dbed8ed6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitorLabel" DROP CONSTRAINT "FK_1e87b8fbe3de940b9c6ff0aa9c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertLabel" DROP CONSTRAINT "FK_f9dac1bb3bcd634970468485ce0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertLabel" DROP CONSTRAINT "FK_547e6948a92f6fa8a1e1f3df4ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertSeverity" DROP CONSTRAINT "FK_9bfbd10e107f69613b59c0906b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleAlertSeverity" DROP CONSTRAINT "FK_c8f7d2947121b3f4c460137ad9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitor" DROP CONSTRAINT "FK_4cff4a3fdcd90da94e503dc0753"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRuleMonitor" DROP CONSTRAINT "FK_294d61029a66cc7d44b67cd3443"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" DROP CONSTRAINT "FK_f524a5f7df716f6d0f91e0b217e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" DROP CONSTRAINT "FK_ce32de0d81181798fed4dd60a62"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" DROP CONSTRAINT "FK_c60e1f0a273569c840577ceb21f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIncidentRule" DROP CONSTRAINT "FK_2173814ff2cf27784628f754e96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "nextIncidentRuleCheckAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5bc52176dad1755a05dbed8ed6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e87b8fbe3de940b9c6ff0aa9c"`,
    );
    await queryRunner.query(`DROP TABLE "AlertIncidentRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9dac1bb3bcd634970468485ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_547e6948a92f6fa8a1e1f3df4c"`,
    );
    await queryRunner.query(`DROP TABLE "AlertIncidentRuleAlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9bfbd10e107f69613b59c0906b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c8f7d2947121b3f4c460137ad9"`,
    );
    await queryRunner.query(`DROP TABLE "AlertIncidentRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4cff4a3fdcd90da94e503dc075"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_294d61029a66cc7d44b67cd344"`,
    );
    await queryRunner.query(`DROP TABLE "AlertIncidentRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c60e1f0a273569c840577ceb21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9546754e15242b2d96140ff41d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e4682bc710641eb05a310d042"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00546d6e0ac5814da66319b064"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2173814ff2cf27784628f754e9"`,
    );
    await queryRunner.query(`DROP TABLE "AlertIncidentRule"`);
  }
}
