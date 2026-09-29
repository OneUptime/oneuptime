import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * IoT monitoring product (cloned from the Proxmox infra product):
 * one parent fleet table plus a child device-inventory table. A row per
 * monitored IoTFleet, auto-discovered at OTel ingest from the
 * `iot.fleet.name` resource attribute (the `name` column is the join key —
 * like ProxmoxCluster there is no separate identifier column) or manually
 * registered. IoTDevice rows are written by the metrics-ingest snapshot scan
 * under isRoot and are read-only to users.
 *
 * Unlike the historical two-migration Proxmox split (table create + V2
 * hardening), everything ships in this one migration: the IoTFleet table
 * carries the DB-level UNIQUE(projectId, name) race-defense index from the
 * start, alongside the owner/label rule engine tables, the owner join
 * models, and the IoTDevice inventory table with its unique identity index.
 *
 * Columns/indexes/FKs are derived from the model decorators in
 * Common/Models/DatabaseModels/{IoTFleet,IoTDevice,IoTFleetOwnerTeam,
 * IoTFleetOwnerUser,IoTFleetOwnerRule,IoTFleetLabelRule}.ts.
 *
 * Abbreviations to stay under Postgres's 63-char identifier limit:
 * ifor = IoTFleetOwnerRule, iflr = IoTFleetLabelRule.
 */
export class AddIoTFleetAndDeviceTables1782900000000
  implements MigrationInterface
{
  public name = "AddIoTFleetAndDeviceTables1782900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IoT fleet table.
    await queryRunner.query(
      `CREATE TABLE "IoTFleet" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "deviceCount" integer DEFAULT '0', "onlineDeviceCount" integer DEFAULT '0', "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_iot_fleet_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_projectId" ON "IoTFleet" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_name" ON "IoTFleet" ("name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_fleet_slug" ON "IoTFleet" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_isArchived" ON "IoTFleet" ("projectId", "isArchived")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_fleet_projectId_name" ON "IoTFleet" ("projectId", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_archivedByUserId" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // IoT fleet label join table.
    await queryRunner.query(
      `CREATE TABLE "IoTFleetLabel" ("iotFleetId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_iot_fleet_label" PRIMARY KEY ("iotFleetId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_iotFleetId" ON "IoTFleetLabel" ("iotFleetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_labelId" ON "IoTFleetLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" ADD CONSTRAINT "FK_iot_fleet_label_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" ADD CONSTRAINT "FK_iot_fleet_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    /*
     * ------------------------------------------------------------------
     * Owner/label rule engine tables.
     * ------------------------------------------------------------------
     */

    // IoTFleetOwnerRule
    await queryRunner.query(
      `CREATE TABLE "IoTFleetOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "iotFleetNamePattern" character varying(500), "iotFleetDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_iot_fleet_owner_rule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_rule_projectId" ON "IoTFleetOwnerRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_rule_name" ON "IoTFleetOwnerRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_rule_isEnabled" ON "IoTFleetOwnerRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_iot_fleet_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_iot_fleet_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_iot_fleet_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // IoTFleetLabelRule
    await queryRunner.query(
      `CREATE TABLE "IoTFleetLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "iotFleetNamePattern" character varying(500), "iotFleetDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_iot_fleet_label_rule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_rule_projectId" ON "IoTFleetLabelRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_rule_name" ON "IoTFleetLabelRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_rule_isEnabled" ON "IoTFleetLabelRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_iot_fleet_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_iot_fleet_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_iot_fleet_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    /*
     * ------------------------------------------------------------------
     * Rule matcher/action join tables.
     * Abbreviations: ifor = IoTFleetOwnerRule, iflr = IoTFleetLabelRule.
     * ------------------------------------------------------------------
     */

    // IoTFleetOwnerRuleIoTFleetLabel (matcher labels)
    await queryRunner.query(
      `CREATE TABLE "IoTFleetOwnerRuleIoTFleetLabel" ("iotFleetOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ifor_fleet_label" PRIMARY KEY ("iotFleetOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_fleet_label_ruleId" ON "IoTFleetOwnerRuleIoTFleetLabel" ("iotFleetOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_fleet_label_labelId" ON "IoTFleetOwnerRuleIoTFleetLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" ADD CONSTRAINT "FK_ifor_fleet_label_ruleId" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" ADD CONSTRAINT "FK_ifor_fleet_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IoTFleetOwnerRuleOwnerUser
    await queryRunner.query(
      `CREATE TABLE "IoTFleetOwnerRuleOwnerUser" ("iotFleetOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_ifor_owner_user" PRIMARY KEY ("iotFleetOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_user_ruleId" ON "IoTFleetOwnerRuleOwnerUser" ("iotFleetOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_user_userId" ON "IoTFleetOwnerRuleOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ifor_owner_user_ruleId" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ifor_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IoTFleetOwnerRuleOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "IoTFleetOwnerRuleOwnerTeam" ("iotFleetOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_ifor_owner_team" PRIMARY KEY ("iotFleetOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_team_ruleId" ON "IoTFleetOwnerRuleOwnerTeam" ("iotFleetOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_team_teamId" ON "IoTFleetOwnerRuleOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ifor_owner_team_ruleId" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ifor_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IoTFleetLabelRuleIoTFleetLabel (matcher labels)
    await queryRunner.query(
      `CREATE TABLE "IoTFleetLabelRuleIoTFleetLabel" ("iotFleetLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_iflr_fleet_label" PRIMARY KEY ("iotFleetLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_fleet_label_ruleId" ON "IoTFleetLabelRuleIoTFleetLabel" ("iotFleetLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_fleet_label_labelId" ON "IoTFleetLabelRuleIoTFleetLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" ADD CONSTRAINT "FK_iflr_fleet_label_ruleId" FOREIGN KEY ("iotFleetLabelRuleId") REFERENCES "IoTFleetLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" ADD CONSTRAINT "FK_iflr_fleet_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IoTFleetLabelRuleLabelToAdd (action labels)
    await queryRunner.query(
      `CREATE TABLE "IoTFleetLabelRuleLabelToAdd" ("iotFleetLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_iflr_label_to_add" PRIMARY KEY ("iotFleetLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_label_to_add_ruleId" ON "IoTFleetLabelRuleLabelToAdd" ("iotFleetLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_label_to_add_labelId" ON "IoTFleetLabelRuleLabelToAdd" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" ADD CONSTRAINT "FK_iflr_label_to_add_ruleId" FOREIGN KEY ("iotFleetLabelRuleId") REFERENCES "IoTFleetLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" ADD CONSTRAINT "FK_iflr_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    /*
     * ------------------------------------------------------------------
     * Owner join models (the prerequisite for the Owners page and
     * useResourceOwners facets).
     * ------------------------------------------------------------------
     */

    // IoTFleetOwnerUser
    await queryRunner.query(
      `CREATE TABLE "IoTFleetOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_iot_fleet_owner_user" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_projectId" ON "IoTFleetOwnerUser" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_userId" ON "IoTFleetOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_iotFleetId" ON "IoTFleetOwnerUser" ("iotFleetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_isOwnerNotified" ON "IoTFleetOwnerUser" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // IoTFleetOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "IoTFleetOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_iot_fleet_owner_team" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_projectId" ON "IoTFleetOwnerTeam" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_teamId" ON "IoTFleetOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_iotFleetId" ON "IoTFleetOwnerTeam" ("iotFleetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_isOwnerNotified" ON "IoTFleetOwnerTeam" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    /*
     * ------------------------------------------------------------------
     * IoT device inventory table (read-only to users, written by the
     * metrics-ingest snapshot scan under isRoot). externalId is the
     * `device.id` datapoint label; kind is the device class.
     * ------------------------------------------------------------------
     */
    await queryRunner.query(
      `CREATE TABLE "IoTDevice" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(100), "deviceType" character varying(100), "firmwareVersion" character varying(100), "isUp" boolean, "uptimeSeconds" integer, "latestCpuPercent" numeric, "latestMemoryBytes" bigint, "maxMemoryBytes" bigint, "latestMemoryPercent" numeric, "latestBatteryPercent" numeric, "latestSignalStrengthDbm" numeric, "latestTemperatureCelsius" numeric, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_iot_device_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_projectId" ON "IoTDevice" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_iotFleetId" ON "IoTDevice" ("iotFleetId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_device_identity" ON "IoTDevice" ("projectId", "iotFleetId", "kind", "externalId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IoT device inventory table.
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_device_identity"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_device_iotFleetId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_device_projectId"`);
    await queryRunner.query(`DROP TABLE "IoTDevice"`);

    // Owner join models.
    await queryRunner.query(`DROP TABLE "IoTFleetOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "IoTFleetOwnerUser"`);

    // Rule matcher/action join tables.
    await queryRunner.query(`DROP TABLE "IoTFleetLabelRuleLabelToAdd"`);
    await queryRunner.query(`DROP TABLE "IoTFleetLabelRuleIoTFleetLabel"`);
    await queryRunner.query(`DROP TABLE "IoTFleetOwnerRuleOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "IoTFleetOwnerRuleOwnerUser"`);
    await queryRunner.query(`DROP TABLE "IoTFleetOwnerRuleIoTFleetLabel"`);

    // Rule tables.
    await queryRunner.query(`DROP TABLE "IoTFleetLabelRule"`);
    await queryRunner.query(`DROP TABLE "IoTFleetOwnerRule"`);

    // IoT fleet label join table.
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" DROP CONSTRAINT "FK_iot_fleet_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" DROP CONSTRAINT "FK_iot_fleet_label_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_label_iotFleetId"`,
    );
    await queryRunner.query(`DROP TABLE "IoTFleetLabel"`);

    // IoT fleet table.
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_projectId_name"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_isArchived"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_slug"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_projectId"`);
    await queryRunner.query(`DROP TABLE "IoTFleet"`);
  }
}
