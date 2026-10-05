import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The Storage Arrays product: the StorageArray table (one row per array,
 * auto-registered from the `storage.array.name` resource attribute the
 * OneUptime Storage Array Agent stamps), its inventory table
 * (StorageArrayResource — volumes, hosts, pods, hardware, file systems,
 * buckets...), the feed, owner and label rule tables, and the join tables
 * that let incidents, alerts, scheduled maintenance and monitors name the
 * arrays they affect. Mirrors the Ceph cluster tables.
 */

export class AddStorageArrayTables1798400000000 implements MigrationInterface {
  public name: string = "AddStorageArrayTables1798400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StorageArray" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "storageSystem" character varying(100), "reportedName" character varying(100), "systemId" character varying(100), "osName" character varying(100), "osVersion" character varying(100), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "capacityBytes" bigint, "usedBytes" bigint, "capacityUsedPercent" numeric, "dataReductionRatio" numeric, "openAlertCount" integer DEFAULT '0', "criticalAlertCount" integer DEFAULT '0', "warningAlertCount" integer DEFAULT '0', "volumeCount" integer DEFAULT '0', "hostCount" integer DEFAULT '0', "podCount" integer DEFAULT '0', "fileSystemCount" integer DEFAULT '0', "bucketCount" integer DEFAULT '0', "hardwareComponentCount" integer DEFAULT '0', "unhealthyHardwareCount" integer DEFAULT '0', "healthStatus" integer, "createdByUserId" uuid, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "deletedByUserId" uuid, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, CONSTRAINT "PK_2a95a1b3b2bb1095a226671f5dd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db5c8abce7bd56eddd57902020" ON "StorageArray" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b86ef9285ec05fb0d4e914164c" ON "StorageArray" ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_storage_array_slug" ON "StorageArray" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85ac85f02e7f4be1bdb7f116c9" ON "StorageArray" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_80af2a544ca48dff24c5dc0069" ON "StorageArray" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_59aec9a95d98378fa65c7596f39" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb730a5a5b5a3abbedaac1bc67" ON "StorageArrayOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00373ee73ac60d8a5f6a6e864e" ON "StorageArrayOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3f5ad66411f709c48aff79cfd" ON "StorageArrayOwnerTeam" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6da624f525f89cbd6e40179e75" ON "StorageArrayOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_61acfafcc4e8ae218f84051431" ON "StorageArrayOwnerTeam" ("storageArrayId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_20ab7bb01bbc82253fe3db7ddd9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e66416693040b6dfb6832cc5f5" ON "StorageArrayOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38991309e48972e78eaa060278" ON "StorageArrayOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77e070ebdb26594aa4c603d97b" ON "StorageArrayOwnerUser" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4a8613ceab7fe099c67188c91" ON "StorageArrayOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5035666be37f4dfaf765827e00" ON "StorageArrayOwnerUser" ("storageArrayId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "externalId" character varying(500) NOT NULL, "name" character varying(500), "status" character varying(100), "statusDetail" character varying(100), "componentType" character varying(100), "model" character varying(100), "firmwareVersion" character varying(100), "groupName" character varying(500), "capacityBytes" bigint, "usedBytes" bigint, "dataReductionRatio" numeric, "readLatencyUsec" numeric, "writeLatencyUsec" numeric, "readIops" numeric, "writeIops" numeric, "readBytesPerSec" numeric, "writeBytesPerSec" numeric, "temperatureCelsius" numeric, "replicationLagMs" numeric, "connectionCount" integer, "details" jsonb, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_088c1db0d13d20b2f97d1e1c804" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_93ae9705b1227da14af5186927" ON "StorageArrayResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34be61f1d0f13e880758680880" ON "StorageArrayResource" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f212c842ad7a290f65eb1da01d" ON "StorageArrayResource" ("projectId", "storageArrayId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "storageArrayNamePattern" character varying(500), "storageArrayDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_308b8eae239d0c3b510ec07f445" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6c9005f6d3745fc086ba0f474" ON "StorageArrayOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5372a3b9808df91d327a86713" ON "StorageArrayOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89dde3986dd7d6cd16d7203559" ON "StorageArrayOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "storageArrayNamePattern" character varying(500), "storageArrayDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_56a4fd313709213b5af6e7bffd2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_06ced52e8ea244094ddccec309" ON "StorageArrayLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce53b8d209a7ac0f0f65eac40c" ON "StorageArrayLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db91e0c4c2419c52ab00ae1ca9" ON "StorageArrayLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "storageArrayFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_4c742d5bcf0afcaf788adf58958" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfc11948f2c1498ac1a84f2dba" ON "StorageArrayFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d31a5e31a8725ef418a02bbed0" ON "StorageArrayFeed" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_99f8365dd3f6ee0035ed73d824" ON "StorageArrayFeed" ("storageArrayId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayLabel" ("storageArrayId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_92ffe341950198630bd43c0d687" PRIMARY KEY ("storageArrayId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_317541940f969e13a3d2c4eacb" ON "StorageArrayLabel" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ffdfcd6d73712a634b81a011b0" ON "StorageArrayLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorStorageArray" ("monitorId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, CONSTRAINT "PK_e4d66701e5fe6d2cfd69be91785" PRIMARY KEY ("monitorId", "storageArrayId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97827be5dd251b93a15d3e704b" ON "MonitorStorageArray" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2b12ae4cdfbb552d662b853227" ON "MonitorStorageArray" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentStorageArray" ("incidentId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, CONSTRAINT "PK_7f77f471ef6ad1c30f5da02b5dd" PRIMARY KEY ("incidentId", "storageArrayId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6bc0d89036742ce80a63ae7ced" ON "IncidentStorageArray" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c81cd88f07e167ac19a01ce0ac" ON "IncidentStorageArray" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertStorageArray" ("alertId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, CONSTRAINT "PK_01612b4297cfb09926b49ab4ffa" PRIMARY KEY ("alertId", "storageArrayId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e96172141bf2c826e01efb4b25" ON "AlertStorageArray" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db53002bc7b3f8a810c8ec9ebe" ON "AlertStorageArray" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceStorageArray" ("scheduledMaintenanceId" uuid NOT NULL, "storageArrayId" uuid NOT NULL, CONSTRAINT "PK_362c06853e5bc963c6ddeb7b9a2" PRIMARY KEY ("scheduledMaintenanceId", "storageArrayId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_60d856255ae1978c8088ba3442" ON "ScheduledMaintenanceStorageArray" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_888e8ff609798836b6ff69df11" ON "ScheduledMaintenanceStorageArray" ("storageArrayId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayOwnerRuleStorageArrayLabel" ("storageArrayOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_e1fbe092efbe6a616f1314b4027" PRIMARY KEY ("storageArrayOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd2dffd5c5d1eb8207e174b67c" ON "StorageArrayOwnerRuleStorageArrayLabel" ("storageArrayOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a3a4af3fca927040ab35c04b5" ON "StorageArrayOwnerRuleStorageArrayLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayOwnerRuleOwnerUser" ("storageArrayOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_81643e4ded9347b8f4e4a1ded48" PRIMARY KEY ("storageArrayOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_51124909b547eb8817642b7961" ON "StorageArrayOwnerRuleOwnerUser" ("storageArrayOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_05f6d96ec2b0a922abe27532f7" ON "StorageArrayOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayOwnerRuleOwnerTeam" ("storageArrayOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_498b3cd5a84c9a5204de4b18dc4" PRIMARY KEY ("storageArrayOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_113d3abdd2ba27459cc672fa58" ON "StorageArrayOwnerRuleOwnerTeam" ("storageArrayOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d18ccd8006236c7be529c6686" ON "StorageArrayOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayLabelRuleStorageArrayLabel" ("storageArrayLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_06a6cd8c8783119296f90b67e5f" PRIMARY KEY ("storageArrayLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c923027abf54dc46f53161be9" ON "StorageArrayLabelRuleStorageArrayLabel" ("storageArrayLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f73a42b330a5365dd2e1c61af8" ON "StorageArrayLabelRuleStorageArrayLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StorageArrayLabelRuleLabelToAdd" ("storageArrayLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_335126fece614fe3bbe3a6e39ca" PRIMARY KEY ("storageArrayLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa3e90ddf051fb6eb48a677bbb" ON "StorageArrayLabelRuleLabelToAdd" ("storageArrayLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdc55b94cbf96c690a6bf90695" ON "StorageArrayLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" ADD CONSTRAINT "FK_db5c8abce7bd56eddd579020208" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" ADD CONSTRAINT "FK_f7984cc0b5caf6b0311e186a36c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" ADD CONSTRAINT "FK_86667125b50c232fa7098fd9154" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" ADD CONSTRAINT "FK_980983fabc9e82cc9ae4f52cc9c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" ADD CONSTRAINT "FK_bb730a5a5b5a3abbedaac1bc67d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" ADD CONSTRAINT "FK_00373ee73ac60d8a5f6a6e864e6" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" ADD CONSTRAINT "FK_d3f5ad66411f709c48aff79cfd9" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" ADD CONSTRAINT "FK_e2b685158310478196378286a71" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" ADD CONSTRAINT "FK_711e83e05403f1bafa3aa3ba234" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" ADD CONSTRAINT "FK_e66416693040b6dfb6832cc5f58" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" ADD CONSTRAINT "FK_38991309e48972e78eaa060278b" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" ADD CONSTRAINT "FK_77e070ebdb26594aa4c603d97b2" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" ADD CONSTRAINT "FK_b5eccf8d664b72504289a401009" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" ADD CONSTRAINT "FK_9a06186536dee516853a4578e8e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" ADD CONSTRAINT "FK_93ae9705b1227da14af5186927c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" ADD CONSTRAINT "FK_34be61f1d0f13e880758680880b" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" ADD CONSTRAINT "FK_97c43af2938d74a4874c1b8875f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" ADD CONSTRAINT "FK_dad5db8e8755eba24d9d482bc84" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" ADD CONSTRAINT "FK_e6c9005f6d3745fc086ba0f474d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" ADD CONSTRAINT "FK_8fb8220fe224a64a9bd99d8c3d7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" ADD CONSTRAINT "FK_6450783fd34e22ee215b6a3efff" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" ADD CONSTRAINT "FK_06ced52e8ea244094ddccec309b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" ADD CONSTRAINT "FK_812251516094362fd5f9f667edc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" ADD CONSTRAINT "FK_0a68832a07aa0678dd40b4dbca9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" ADD CONSTRAINT "FK_cfc11948f2c1498ac1a84f2dba1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" ADD CONSTRAINT "FK_d31a5e31a8725ef418a02bbed03" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" ADD CONSTRAINT "FK_9414ae890ed0957c3a659e61752" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" ADD CONSTRAINT "FK_c8f59c3191463c05dd9097f0738" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" ADD CONSTRAINT "FK_9df5490f0c0bc17da12c0058d56" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabel" ADD CONSTRAINT "FK_317541940f969e13a3d2c4eacbf" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabel" ADD CONSTRAINT "FK_ffdfcd6d73712a634b81a011b06" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStorageArray" ADD CONSTRAINT "FK_97827be5dd251b93a15d3e704b3" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStorageArray" ADD CONSTRAINT "FK_2b12ae4cdfbb552d662b853227e" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStorageArray" ADD CONSTRAINT "FK_6bc0d89036742ce80a63ae7ced2" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStorageArray" ADD CONSTRAINT "FK_c81cd88f07e167ac19a01ce0ac0" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStorageArray" ADD CONSTRAINT "FK_e96172141bf2c826e01efb4b255" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStorageArray" ADD CONSTRAINT "FK_db53002bc7b3f8a810c8ec9ebed" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStorageArray" ADD CONSTRAINT "FK_60d856255ae1978c8088ba34423" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStorageArray" ADD CONSTRAINT "FK_888e8ff609798836b6ff69df116" FOREIGN KEY ("storageArrayId") REFERENCES "StorageArray"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleStorageArrayLabel" ADD CONSTRAINT "FK_dd2dffd5c5d1eb8207e174b67ce" FOREIGN KEY ("storageArrayOwnerRuleId") REFERENCES "StorageArrayOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleStorageArrayLabel" ADD CONSTRAINT "FK_5a3a4af3fca927040ab35c04b5a" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerUser" ADD CONSTRAINT "FK_51124909b547eb8817642b79611" FOREIGN KEY ("storageArrayOwnerRuleId") REFERENCES "StorageArrayOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerUser" ADD CONSTRAINT "FK_05f6d96ec2b0a922abe27532f7b" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_113d3abdd2ba27459cc672fa589" FOREIGN KEY ("storageArrayOwnerRuleId") REFERENCES "StorageArrayOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_8d18ccd8006236c7be529c66866" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleStorageArrayLabel" ADD CONSTRAINT "FK_0c923027abf54dc46f53161be9e" FOREIGN KEY ("storageArrayLabelRuleId") REFERENCES "StorageArrayLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleStorageArrayLabel" ADD CONSTRAINT "FK_f73a42b330a5365dd2e1c61af8c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleLabelToAdd" ADD CONSTRAINT "FK_fa3e90ddf051fb6eb48a677bbb3" FOREIGN KEY ("storageArrayLabelRuleId") REFERENCES "StorageArrayLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleLabelToAdd" ADD CONSTRAINT "FK_fdc55b94cbf96c690a6bf906955" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleLabelToAdd" DROP CONSTRAINT "FK_fdc55b94cbf96c690a6bf906955"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleLabelToAdd" DROP CONSTRAINT "FK_fa3e90ddf051fb6eb48a677bbb3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleStorageArrayLabel" DROP CONSTRAINT "FK_f73a42b330a5365dd2e1c61af8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRuleStorageArrayLabel" DROP CONSTRAINT "FK_0c923027abf54dc46f53161be9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_8d18ccd8006236c7be529c66866"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_113d3abdd2ba27459cc672fa589"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerUser" DROP CONSTRAINT "FK_05f6d96ec2b0a922abe27532f7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleOwnerUser" DROP CONSTRAINT "FK_51124909b547eb8817642b79611"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleStorageArrayLabel" DROP CONSTRAINT "FK_5a3a4af3fca927040ab35c04b5a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRuleStorageArrayLabel" DROP CONSTRAINT "FK_dd2dffd5c5d1eb8207e174b67ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStorageArray" DROP CONSTRAINT "FK_888e8ff609798836b6ff69df116"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStorageArray" DROP CONSTRAINT "FK_60d856255ae1978c8088ba34423"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStorageArray" DROP CONSTRAINT "FK_db53002bc7b3f8a810c8ec9ebed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStorageArray" DROP CONSTRAINT "FK_e96172141bf2c826e01efb4b255"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStorageArray" DROP CONSTRAINT "FK_c81cd88f07e167ac19a01ce0ac0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStorageArray" DROP CONSTRAINT "FK_6bc0d89036742ce80a63ae7ced2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStorageArray" DROP CONSTRAINT "FK_2b12ae4cdfbb552d662b853227e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStorageArray" DROP CONSTRAINT "FK_97827be5dd251b93a15d3e704b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabel" DROP CONSTRAINT "FK_ffdfcd6d73712a634b81a011b06"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabel" DROP CONSTRAINT "FK_317541940f969e13a3d2c4eacbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" DROP CONSTRAINT "FK_9df5490f0c0bc17da12c0058d56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" DROP CONSTRAINT "FK_c8f59c3191463c05dd9097f0738"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" DROP CONSTRAINT "FK_9414ae890ed0957c3a659e61752"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" DROP CONSTRAINT "FK_d31a5e31a8725ef418a02bbed03"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayFeed" DROP CONSTRAINT "FK_cfc11948f2c1498ac1a84f2dba1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" DROP CONSTRAINT "FK_0a68832a07aa0678dd40b4dbca9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" DROP CONSTRAINT "FK_812251516094362fd5f9f667edc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayLabelRule" DROP CONSTRAINT "FK_06ced52e8ea244094ddccec309b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" DROP CONSTRAINT "FK_6450783fd34e22ee215b6a3efff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" DROP CONSTRAINT "FK_8fb8220fe224a64a9bd99d8c3d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerRule" DROP CONSTRAINT "FK_e6c9005f6d3745fc086ba0f474d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" DROP CONSTRAINT "FK_dad5db8e8755eba24d9d482bc84"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" DROP CONSTRAINT "FK_97c43af2938d74a4874c1b8875f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" DROP CONSTRAINT "FK_34be61f1d0f13e880758680880b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayResource" DROP CONSTRAINT "FK_93ae9705b1227da14af5186927c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" DROP CONSTRAINT "FK_9a06186536dee516853a4578e8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" DROP CONSTRAINT "FK_b5eccf8d664b72504289a401009"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" DROP CONSTRAINT "FK_77e070ebdb26594aa4c603d97b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" DROP CONSTRAINT "FK_38991309e48972e78eaa060278b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerUser" DROP CONSTRAINT "FK_e66416693040b6dfb6832cc5f58"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" DROP CONSTRAINT "FK_711e83e05403f1bafa3aa3ba234"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" DROP CONSTRAINT "FK_e2b685158310478196378286a71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" DROP CONSTRAINT "FK_d3f5ad66411f709c48aff79cfd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" DROP CONSTRAINT "FK_00373ee73ac60d8a5f6a6e864e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArrayOwnerTeam" DROP CONSTRAINT "FK_bb730a5a5b5a3abbedaac1bc67d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" DROP CONSTRAINT "FK_980983fabc9e82cc9ae4f52cc9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" DROP CONSTRAINT "FK_86667125b50c232fa7098fd9154"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" DROP CONSTRAINT "FK_f7984cc0b5caf6b0311e186a36c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StorageArray" DROP CONSTRAINT "FK_db5c8abce7bd56eddd579020208"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fdc55b94cbf96c690a6bf90695"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa3e90ddf051fb6eb48a677bbb"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f73a42b330a5365dd2e1c61af8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c923027abf54dc46f53161be9"`,
    );
    await queryRunner.query(
      `DROP TABLE "StorageArrayLabelRuleStorageArrayLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d18ccd8006236c7be529c6686"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_113d3abdd2ba27459cc672fa58"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05f6d96ec2b0a922abe27532f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_51124909b547eb8817642b7961"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a3a4af3fca927040ab35c04b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd2dffd5c5d1eb8207e174b67c"`,
    );
    await queryRunner.query(
      `DROP TABLE "StorageArrayOwnerRuleStorageArrayLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_888e8ff609798836b6ff69df11"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_60d856255ae1978c8088ba3442"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceStorageArray"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db53002bc7b3f8a810c8ec9ebe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e96172141bf2c826e01efb4b25"`,
    );
    await queryRunner.query(`DROP TABLE "AlertStorageArray"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c81cd88f07e167ac19a01ce0ac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6bc0d89036742ce80a63ae7ced"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentStorageArray"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2b12ae4cdfbb552d662b853227"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97827be5dd251b93a15d3e704b"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorStorageArray"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ffdfcd6d73712a634b81a011b0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_317541940f969e13a3d2c4eacb"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_99f8365dd3f6ee0035ed73d824"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d31a5e31a8725ef418a02bbed0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfc11948f2c1498ac1a84f2dba"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db91e0c4c2419c52ab00ae1ca9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce53b8d209a7ac0f0f65eac40c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_06ced52e8ea244094ddccec309"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89dde3986dd7d6cd16d7203559"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5372a3b9808df91d327a86713"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6c9005f6d3745fc086ba0f474"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f212c842ad7a290f65eb1da01d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34be61f1d0f13e880758680880"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_93ae9705b1227da14af5186927"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5035666be37f4dfaf765827e00"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4a8613ceab7fe099c67188c91"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77e070ebdb26594aa4c603d97b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38991309e48972e78eaa060278"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e66416693040b6dfb6832cc5f5"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_61acfafcc4e8ae218f84051431"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6da624f525f89cbd6e40179e75"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3f5ad66411f709c48aff79cfd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00373ee73ac60d8a5f6a6e864e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb730a5a5b5a3abbedaac1bc67"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArrayOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80af2a544ca48dff24c5dc0069"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85ac85f02e7f4be1bdb7f116c9"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_storage_array_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b86ef9285ec05fb0d4e914164c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db5c8abce7bd56eddd57902020"`,
    );
    await queryRunner.query(`DROP TABLE "StorageArray"`);
  }
}
