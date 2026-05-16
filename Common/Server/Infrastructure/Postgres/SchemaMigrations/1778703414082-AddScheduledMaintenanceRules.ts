import { MigrationInterface, QueryRunner } from "typeorm";

export class AddScheduledMaintenanceRules1778703414082
  implements MigrationInterface
{
  public name: string = "AddScheduledMaintenanceRules1778703414082";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "titlePattern" character varying(500), "descriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "inheritOwnersFromMonitors" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6cb32958f4e40bb2c317ebaa892" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01a9c87593e6688e0d0c15c3b8" ON "ScheduledMaintenanceOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a0be85be36eab4598d07c4be69" ON "ScheduledMaintenanceOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac93c1b589d5cea03ed221ec74" ON "ScheduledMaintenanceOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "titlePattern" character varying(500), "descriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "inheritLabelsFromMonitors" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4170d5bdaa26c1eddd0758ef54c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd64fbdd982eeeb2340fc6a815" ON "ScheduledMaintenanceLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24c79a56281cb096790e82e681" ON "ScheduledMaintenanceLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_120cd2e57155c12f12ba8780ef" ON "ScheduledMaintenanceLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceOwnerRuleMonitor" ("scheduledMaintenanceOwnerRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_1d6e4fb5fabe30f02fce664d2be" PRIMARY KEY ("scheduledMaintenanceOwnerRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33205e5a39ce7e8bf98ca38559" ON "ScheduledMaintenanceOwnerRuleMonitor" ("scheduledMaintenanceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_27e6c491c2f2648cc9abb826ad" ON "ScheduledMaintenanceOwnerRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceOwnerRuleEventLabel" ("scheduledMaintenanceOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_d851e3101fdd2f76849e521565b" PRIMARY KEY ("scheduledMaintenanceOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea9ebab035cd9bdabfd33f0449" ON "ScheduledMaintenanceOwnerRuleEventLabel" ("scheduledMaintenanceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10b714d735c25957a821005121" ON "ScheduledMaintenanceOwnerRuleEventLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceOwnerRuleMonitorLabel" ("scheduledMaintenanceOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_eab4cb25664e196dae16cc312f7" PRIMARY KEY ("scheduledMaintenanceOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24a2f62253ffaeae532e7090f0" ON "ScheduledMaintenanceOwnerRuleMonitorLabel" ("scheduledMaintenanceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c6c9b8367990c5d55d3cf5bdc" ON "ScheduledMaintenanceOwnerRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceOwnerRuleOwnerUser" ("scheduledMaintenanceOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_53b347b4b644b68b36831eff2ef" PRIMARY KEY ("scheduledMaintenanceOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10a0ce20eeb9716874128a234f" ON "ScheduledMaintenanceOwnerRuleOwnerUser" ("scheduledMaintenanceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f48f0c8378db2362845ba66f6" ON "ScheduledMaintenanceOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceOwnerRuleOwnerTeam" ("scheduledMaintenanceOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_16dfce6adea8899f703d0862ff1" PRIMARY KEY ("scheduledMaintenanceOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4df06b1821bbd792aed37346fd" ON "ScheduledMaintenanceOwnerRuleOwnerTeam" ("scheduledMaintenanceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a37b20b80dbad75e42a4f0d2c5" ON "ScheduledMaintenanceOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceLabelRuleMonitor" ("scheduledMaintenanceLabelRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_a2058ed7ca99369d1665c13c237" PRIMARY KEY ("scheduledMaintenanceLabelRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a567eb1e5b507528c74135145" ON "ScheduledMaintenanceLabelRuleMonitor" ("scheduledMaintenanceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a4080041a3aca5df84cd2b33b" ON "ScheduledMaintenanceLabelRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceLabelRuleEventLabel" ("scheduledMaintenanceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_cb2e5938a24f587c799aee7cf89" PRIMARY KEY ("scheduledMaintenanceLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fb238794f11ab058e1179f013" ON "ScheduledMaintenanceLabelRuleEventLabel" ("scheduledMaintenanceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1eaccb8e8d25c835f7ad35fa0c" ON "ScheduledMaintenanceLabelRuleEventLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceLabelRuleMonitorLabel" ("scheduledMaintenanceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_d63ffcea88f2f662d0199d85cd1" PRIMARY KEY ("scheduledMaintenanceLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34e04750215e709c5d74298d4c" ON "ScheduledMaintenanceLabelRuleMonitorLabel" ("scheduledMaintenanceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_763fc95cd34d413ea107461671" ON "ScheduledMaintenanceLabelRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceLabelRuleLabelToAdd" ("scheduledMaintenanceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9c3de33fcbbd4b9a8b6dae7112b" PRIMARY KEY ("scheduledMaintenanceLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb01e92f038bf0d7b03d148c89" ON "ScheduledMaintenanceLabelRuleLabelToAdd" ("scheduledMaintenanceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a9f46f8085e0d439e919ea706" ON "ScheduledMaintenanceLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD CONSTRAINT "FK_01a9c87593e6688e0d0c15c3b8b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD CONSTRAINT "FK_035e9e064716d0054bc0888eac8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD CONSTRAINT "FK_23fcf535a32d5a7052096e3716a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD CONSTRAINT "FK_bd64fbdd982eeeb2340fc6a8159" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD CONSTRAINT "FK_105a513812610b4df6e08cc2c02" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD CONSTRAINT "FK_e6274cc26a01a5545f75a95ad6f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitor" ADD CONSTRAINT "FK_33205e5a39ce7e8bf98ca385592" FOREIGN KEY ("scheduledMaintenanceOwnerRuleId") REFERENCES "ScheduledMaintenanceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitor" ADD CONSTRAINT "FK_27e6c491c2f2648cc9abb826ad0" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleEventLabel" ADD CONSTRAINT "FK_ea9ebab035cd9bdabfd33f0449d" FOREIGN KEY ("scheduledMaintenanceOwnerRuleId") REFERENCES "ScheduledMaintenanceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleEventLabel" ADD CONSTRAINT "FK_10b714d735c25957a821005121c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_24a2f62253ffaeae532e7090f03" FOREIGN KEY ("scheduledMaintenanceOwnerRuleId") REFERENCES "ScheduledMaintenanceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_5c6c9b8367990c5d55d3cf5bdc9" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_10a0ce20eeb9716874128a234f9" FOREIGN KEY ("scheduledMaintenanceOwnerRuleId") REFERENCES "ScheduledMaintenanceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_6f48f0c8378db2362845ba66f6a" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_4df06b1821bbd792aed37346fdf" FOREIGN KEY ("scheduledMaintenanceOwnerRuleId") REFERENCES "ScheduledMaintenanceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_a37b20b80dbad75e42a4f0d2c5e" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitor" ADD CONSTRAINT "FK_4a567eb1e5b507528c741351454" FOREIGN KEY ("scheduledMaintenanceLabelRuleId") REFERENCES "ScheduledMaintenanceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitor" ADD CONSTRAINT "FK_0a4080041a3aca5df84cd2b33ba" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleEventLabel" ADD CONSTRAINT "FK_1fb238794f11ab058e1179f0133" FOREIGN KEY ("scheduledMaintenanceLabelRuleId") REFERENCES "ScheduledMaintenanceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleEventLabel" ADD CONSTRAINT "FK_1eaccb8e8d25c835f7ad35fa0c8" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitorLabel" ADD CONSTRAINT "FK_34e04750215e709c5d74298d4c6" FOREIGN KEY ("scheduledMaintenanceLabelRuleId") REFERENCES "ScheduledMaintenanceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitorLabel" ADD CONSTRAINT "FK_763fc95cd34d413ea1074616710" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_bb01e92f038bf0d7b03d148c89a" FOREIGN KEY ("scheduledMaintenanceLabelRuleId") REFERENCES "ScheduledMaintenanceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_9a9f46f8085e0d439e919ea7068" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_9a9f46f8085e0d439e919ea7068"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_bb01e92f038bf0d7b03d148c89a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitorLabel" DROP CONSTRAINT "FK_763fc95cd34d413ea1074616710"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitorLabel" DROP CONSTRAINT "FK_34e04750215e709c5d74298d4c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleEventLabel" DROP CONSTRAINT "FK_1eaccb8e8d25c835f7ad35fa0c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleEventLabel" DROP CONSTRAINT "FK_1fb238794f11ab058e1179f0133"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitor" DROP CONSTRAINT "FK_0a4080041a3aca5df84cd2b33ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRuleMonitor" DROP CONSTRAINT "FK_4a567eb1e5b507528c741351454"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_a37b20b80dbad75e42a4f0d2c5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_4df06b1821bbd792aed37346fdf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_6f48f0c8378db2362845ba66f6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_10a0ce20eeb9716874128a234f9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_5c6c9b8367990c5d55d3cf5bdc9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_24a2f62253ffaeae532e7090f03"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleEventLabel" DROP CONSTRAINT "FK_10b714d735c25957a821005121c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleEventLabel" DROP CONSTRAINT "FK_ea9ebab035cd9bdabfd33f0449d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitor" DROP CONSTRAINT "FK_27e6c491c2f2648cc9abb826ad0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRuleMonitor" DROP CONSTRAINT "FK_33205e5a39ce7e8bf98ca385592"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP CONSTRAINT "FK_e6274cc26a01a5545f75a95ad6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP CONSTRAINT "FK_105a513812610b4df6e08cc2c02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP CONSTRAINT "FK_bd64fbdd982eeeb2340fc6a8159"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP CONSTRAINT "FK_23fcf535a32d5a7052096e3716a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP CONSTRAINT "FK_035e9e064716d0054bc0888eac8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP CONSTRAINT "FK_01a9c87593e6688e0d0c15c3b8b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a9f46f8085e0d439e919ea706"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb01e92f038bf0d7b03d148c89"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceLabelRuleLabelToAdd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_763fc95cd34d413ea107461671"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34e04750215e709c5d74298d4c"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceLabelRuleMonitorLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1eaccb8e8d25c835f7ad35fa0c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fb238794f11ab058e1179f013"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceLabelRuleEventLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a4080041a3aca5df84cd2b33b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a567eb1e5b507528c74135145"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceLabelRuleMonitor"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a37b20b80dbad75e42a4f0d2c5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4df06b1821bbd792aed37346fd"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceOwnerRuleOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f48f0c8378db2362845ba66f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10a0ce20eeb9716874128a234f"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceOwnerRuleOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c6c9b8367990c5d55d3cf5bdc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24a2f62253ffaeae532e7090f0"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceOwnerRuleMonitorLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10b714d735c25957a821005121"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea9ebab035cd9bdabfd33f0449"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceOwnerRuleEventLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27e6c491c2f2648cc9abb826ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33205e5a39ce7e8bf98ca38559"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceOwnerRuleMonitor"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_120cd2e57155c12f12ba8780ef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24c79a56281cb096790e82e681"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd64fbdd982eeeb2340fc6a815"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac93c1b589d5cea03ed221ec74"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a0be85be36eab4598d07c4be69"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01a9c87593e6688e0d0c15c3b8"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceOwnerRule"`);
  }
}
